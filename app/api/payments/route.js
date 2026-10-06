import {
  authenticateRequest,
  isRoleBelow,
  jsonError,
} from "@/app/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

async function getManagedProfiles(db, managerUid) {
  const found = new Map();
  let parentUids = [managerUid];
  while (parentUids.length) {
    const snapshots = await Promise.all(
      parentUids.map((uid) =>
        Promise.all([
          db.collection("users").where("managerUid", "==", uid).get(),
          db.collection("users").where("createdBy", "==", uid).get(),
        ]),
      ),
    );
    const nextUids = [];
    for (const [managedSnapshot, legacySnapshot] of snapshots) {
      const records = [
        ...managedSnapshot.docs,
        ...legacySnapshot.docs.filter(
          (record) => record.data().managerUid == null,
        ),
      ];
      for (const record of records) {
        if (!found.has(record.id)) {
          found.set(record.id, { uid: record.id, ...record.data() });
          nextUids.push(record.id);
        }
      }
    }
    parentUids = nextUids;
  }
  return [...found.values()].filter((profile) =>
    isRoleBelow("admin", profile.role),
  );
}

async function addRecorderNames(db, payments) {
  const recorderUids = [
    ...new Set(payments.map((payment) => payment.recordedBy).filter(Boolean)),
  ];
  const recorderSnapshots = recorderUids.length
    ? await db.getAll(
        ...recorderUids.map((uid) => db.collection("users").doc(uid)),
      )
    : [];
  const recorderNames = new Map(
    recorderSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, snapshot.data().name]),
  );

  return payments.map((payment) => ({
    ...payment,
    recordedByName:
      recorderNames.get(payment.recordedBy) ||
      (payment.recordedByName && payment.recordedByName !== payment.recordedBy
        ? payment.recordedByName
        : "Unknown user"),
  }));
}

export async function GET(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);

  if (caller.profile.role === "admin") {
    const [paymentSnapshot, clientSnapshot] = await Promise.all([
      caller.db.collection("payments").get(),
      caller.db.collection("clients").get(),
    ]);
    const activeClientIds = new Set(
      clientSnapshot.docs
        .filter((record) => !record.data().archivedAt)
        .map((record) => record.id),
    );
    const payments = await addRecorderNames(
      caller.db,
      paymentSnapshot.docs
        .map((record) => ({ id: record.id, ...record.data() }))
        .filter((payment) => activeClientIds.has(payment.clientId)),
    );
    return Response.json(
      { payments },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const visibleUids = [
    caller.uid,
    ...(await getManagedProfiles(caller.db, caller.uid))
      .filter((profile) => isRoleBelow(caller.profile.role, profile.role))
      .map((profile) => profile.uid),
  ];
  const clientSnapshots = await Promise.all(
    visibleUids.map((uid) =>
      caller.db.collection("clients").where("assignedTo", "==", uid).get(),
    ),
  );
  const visibleClientIds = clientSnapshots.flatMap((snapshot) =>
    snapshot.docs
      .filter((record) => !record.data().archivedAt)
      .map((record) => record.id),
  );
  const paymentSnapshots = await Promise.all(
    visibleClientIds.map((clientId) =>
      caller.db.collection("payments").where("clientId", "==", clientId).get(),
    ),
  );
  const payments = await addRecorderNames(
    caller.db,
    paymentSnapshots.flatMap((snapshot) =>
      snapshot.docs.map((record) => ({ id: record.id, ...record.data() })),
    ),
  );
  return Response.json(
    { payments },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);

  try {
    const { clientId, amount, date } = await request.json();
    const paymentAmount = Number(amount);
    if (!clientId || !Number.isFinite(paymentAmount) || paymentAmount <= 0)
      return jsonError(
        "Client and a payment amount greater than zero are required.",
      );
    const paymentDate = date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate))
      return jsonError("Payment date must use YYYY-MM-DD format.");

    const permittedUids =
      caller.profile.role === "admin"
        ? null
        : [
            caller.uid,
            ...(await getManagedProfiles(caller.db, caller.uid))
              .filter((profile) =>
                isRoleBelow(caller.profile.role, profile.role),
              )
              .map((profile) => profile.uid),
          ];
    const clientRef = caller.db.collection("clients").doc(clientId);
    const paymentRef = caller.db.collection("payments").doc();
    let payment;

    await caller.db.runTransaction(async (transaction) => {
      const clientSnapshot = await transaction.get(clientRef);
      if (!clientSnapshot.exists) throw new Error("Client not found.");
      const client = clientSnapshot.data();
      if (client.archivedAt) throw new Error("Client not found.");
      if (permittedUids && !permittedUids.includes(client.assignedTo))
        throw new Error(
          "You are not authorized to record a payment for this client.",
        );

      const totalAmount = Number(client.totalAmount ?? client.amount) || 0;
      const previousReceived =
        Number(client.totalReceived ?? client.received) || 0;
      const totalReceived = previousReceived + paymentAmount;
      if (!totalAmount || totalReceived > totalAmount)
        throw new Error("The payment exceeds the client's remaining balance.");
      const remaining = totalAmount - totalReceived;
      const paymentStatus = remaining === 0 ? "Received" : "Partial";
      const nextClientStatus =
        remaining === 0
          ? "Completed"
          : ["New", "Pending", "In Progress"].includes(client.status)
            ? "In Progress"
            : client.status || "Pending";
      payment = {
        id: paymentRef.id,
        clientId,
        clientName: client.name || "",
        assignedTo: client.assignedTo,
        amount: paymentAmount,
        date: paymentDate,
        recordedBy: caller.uid,
        recordedByName: caller.profile.name || "Unknown user",
        createdAt: FieldValue.serverTimestamp(),
      };
      transaction.create(paymentRef, payment);
      transaction.update(clientRef, {
        amount: totalAmount,
        totalAmount,
        received: totalReceived,
        totalReceived,
        remaining,
        status: nextClientStatus,
        payment: paymentStatus,
        paymentStatus,
        paymentDate,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return Response.json(
      { payment: { ...payment, createdAt: null } },
      { status: 201 },
    );
  } catch (error) {
    const status = error.message.includes("not authorized")
      ? 403
      : error.message.includes("not found")
        ? 404
        : 400;
    return jsonError(error.message || "Could not record payment.", status);
  }
}
