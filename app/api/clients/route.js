import { createHash } from "node:crypto";
import { authenticateRequest, hasPermission, isRoleBelow, jsonError } from "@/app/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

async function getManagedProfiles(db, managerUid) {
  const found = new Map();
  let parentUids = [managerUid];
  while (parentUids.length) {
    const snapshots = await Promise.all(parentUids.map((uid) => Promise.all([
      db.collection("users").where("managerUid", "==", uid).get(),
      db.collection("users").where("createdBy", "==", uid).get(),
    ])));
    const nextUids = [];
    for (const [managedSnapshot, legacySnapshot] of snapshots) {
      const records = [...managedSnapshot.docs, ...legacySnapshot.docs.filter((record) => record.data().managerUid == null)];
      for (const record of records) {
        if (!found.has(record.id)) {
          found.set(record.id, { uid: record.id, ...record.data() });
          nextUids.push(record.id);
        }
      }
    }
    parentUids = nextUids;
  }
  return [...found.values()];
}

function normalizeIdentity(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export async function GET(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);

  const managerProfiles = caller.profile.role === "admin"
    ? (await caller.db.collection("users").get()).docs.map((record) => ({ uid: record.id, ...record.data() }))
    : [{ uid: caller.uid, ...caller.profile }, ...(await getManagedProfiles(caller.db, caller.uid)).filter((profile) => isRoleBelow(caller.profile.role, profile.role))];
  const profileNames = new Map(managerProfiles.map((profile) => [profile.uid, profile.name]));
  const visibleUids = [caller.uid];
  if (caller.profile.role === "admin") {
    const snapshot = await caller.db.collection("clients").get();
    return Response.json({ clients: snapshot.docs.map((record) => {
      const data = record.data();
      const received = Number(data.totalReceived ?? data.received) || 0;
      const amount = Number(data.totalAmount ?? data.amount) || 0;
      return { id: record.id, ...data, owner: profileNames.get(data.assignedTo) || data.owner || "Unassigned", assignedToName: profileNames.get(data.assignedTo) || data.owner || "Unassigned", received, amount, remaining: Math.max(amount - received, 0), payment: data.paymentStatus || data.payment || "Pending" };
    }) }, { headers: { "Cache-Control": "no-store" } });
  }

  const descendants = managerProfiles.filter((profile) => profile.uid !== caller.uid);
  visibleUids.push(...descendants.map((profile) => profile.uid));
  const clientSnapshots = await Promise.all(visibleUids.map((uid) => caller.db.collection("clients").where("assignedTo", "==", uid).get()));
  const clients = clientSnapshots.flatMap((snapshot) => snapshot.docs.map((record) => {
    const data = record.data();
    const received = Number(data.totalReceived ?? data.received) || 0;
    const amount = Number(data.totalAmount ?? data.amount) || 0;
    const owner = profileNames.get(data.assignedTo) || data.owner || "Unassigned";
    return { id: record.id, ...data, owner, assignedToName: owner, received, amount, remaining: Math.max(amount - received, 0), payment: data.paymentStatus || data.payment || "Pending" };
  }));
  return Response.json({ clients }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);
  if (!hasPermission(caller.profile, "manage_assignments")) return jsonError("Your account does not have permission to assign clients.", 403);

  try {
    const body = await request.json();
    const { name, provider, assignedTo } = body;
    if (!name?.trim() || !provider?.trim() || !assignedTo) return jsonError("Client name, service, and assignee are required.");

    const managedProfiles = caller.profile.role === "admin"
      ? (await caller.db.collection("users").get()).docs.map((record) => ({ uid: record.id, ...record.data() }))
      : await getManagedProfiles(caller.db, caller.uid);
    const target = managedProfiles.find((profile) => profile.uid === assignedTo);
    if (!target || target.status !== "active" || !isRoleBelow(caller.profile.role, target.role)) {
      return jsonError("You are not authorized to assign clients to this employee.", 403);
    }

    const cnicValue = String(body.cnic || "").trim();
    const emailValue = String(body.email || "").trim();
    const normalizedCnic = cnicValue.replace(/\D/g, "");
    const normalizedEmail = normalizeIdentity(emailValue);
    const normalizedName = normalizeIdentity(name);
    const normalizedProvider = normalizeIdentity(provider);
    const identityKey = normalizedCnic
      ? `cnic:${normalizedCnic}`
      : normalizedEmail
        ? `email:${normalizedEmail}`
        : `name-provider:${normalizedName}|${normalizedProvider}`;
    const duplicateCheck = normalizedCnic
      ? caller.db.collection("clients").where("cnic", "==", cnicValue).limit(1).get()
      : normalizedEmail
        ? caller.db.collection("clients").where("email", "==", emailValue).limit(1).get()
        : caller.db.collection("clients")
          .where("name", "==", name.trim())
          .where("provider", "==", provider.trim())
          .limit(1)
          .get();
    const identityRefs = [caller.db.collection("clientIdentityLocks")
      .doc(createHash("sha256").update(identityKey).digest("hex"))];
    const existingMatch = await duplicateCheck;
    if (!existingMatch.empty) {
      return jsonError("A client with the same CNIC, email, or name and service already exists.", 409);
    }

    const amount = Number(body.totalAmount ?? body.amount) || 0;
    const received = Number(body.totalReceived ?? body.received) || 0;
    if (amount < 0 || received < 0 || received > amount) return jsonError("Payment amounts must be non-negative and received cannot exceed total.");
    const workStatus = ["New", "Pending", "In Progress", "Completed", "Cancelled"].includes(body.status) ? body.status : "Pending";
    const paymentStatus = received >= amount && amount > 0 ? "Received" : received > 0 ? "Partial" : "Pending";
    const clientRef = caller.db.collection("clients").doc();
    const initialPaymentRef = received > 0 ? caller.db.collection("payments").doc() : null;
    const clientRecord = {
      ...Object.fromEntries(["date", "cell", "cnic", "pin", "password", "email", "work", "description", "initials", "color", "paymentDate"].filter((key) => body[key] !== undefined).map((key) => [key, body[key]])),
      name: name.trim(),
      provider: provider.trim(),
      assignedTo,
      owner: target.name,
      assignedBy: caller.uid,
      assignedAt: FieldValue.serverTimestamp(),
      assignmentHistory: [{ from: null, to: assignedTo, changedBy: caller.uid, changedAt: new Date() }],
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      status: workStatus,
      amount,
      totalAmount: amount,
      received,
      totalReceived: received,
      remaining: Math.max(amount - received, 0),
      payment: paymentStatus,
      paymentStatus,
    };
    if (received > 0) {
      clientRecord.paymentDate = body.paymentDate || body.date || new Date().toISOString().slice(0, 10);
    }
    await caller.db.runTransaction(async (transaction) => {
      const existingLocks = await Promise.all(identityRefs.map((identityRef) => transaction.get(identityRef)));
      if (existingLocks.some((snapshot) => snapshot.exists)) {
        const error = new Error("A client with the same CNIC, email, or name and service already exists.");
        error.code = "duplicate-client";
        throw error;
      }

      transaction.create(clientRef, clientRecord);
      identityRefs.forEach((identityRef) => transaction.create(identityRef, {
        clientId: clientRef.id,
        createdAt: FieldValue.serverTimestamp(),
      }));
      if (initialPaymentRef) {
        transaction.create(initialPaymentRef, {
          clientId: clientRef.id,
          clientName: name.trim(),
          assignedTo,
          amount: received,
          date: clientRecord.paymentDate,
          recordedBy: caller.uid,
          recordedByName: caller.profile.name || "Unknown user",
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return Response.json({ client: { id: clientRef.id, name: name.trim(), provider: provider.trim(), assignedTo, status: workStatus, amount, received, remaining: Math.max(amount - received, 0), payment: paymentStatus } }, { status: 201 });
  } catch (error) {
    return jsonError(error.message || "Could not create client assignment.", error.code === "duplicate-client" ? 409 : 400);
  }
}

export async function PATCH(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);

  try {
    const body = await request.json();
    const { clientId, assignedTo, status } = body;
    if (body.action === "edit") {
      if (!clientId) return jsonError("Client ID is required.");
      const name = String(body.name || "").trim();
      const provider = String(body.provider || "").trim();
      if (!name || !provider) return jsonError("Client name and provider are required.");

      const cnic = String(body.cnic || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const duplicateChecks = [
        cnic ? caller.db.collection("clients").where("cnic", "==", cnic).get() : null,
        email ? caller.db.collection("clients").where("email", "==", email).get() : null,
      ].filter(Boolean);
      const duplicateSnapshots = await Promise.all(duplicateChecks);
      if (duplicateSnapshots.some((snapshot) => snapshot.docs.some((record) => record.id !== clientId))) {
        return jsonError("Another client already uses this CNIC or email.", 409);
      }

      const totalAmount = Number(body.totalAmount);
      const totalReceived = Number(body.totalReceived);
      if (!Number.isFinite(totalAmount) || !Number.isFinite(totalReceived) || totalAmount < 0 || totalReceived < 0 || totalReceived > totalAmount) {
        return jsonError("Payment amounts must be non-negative, and received cannot exceed total.");
      }
      if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return jsonError("Client date must use YYYY-MM-DD format.");

      const clientRef = caller.db.collection("clients").doc(clientId);
      let updatedClient;
      await caller.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(clientRef);
        if (!snapshot.exists) throw new Error("Client not found.");
        const client = snapshot.data();
        if (caller.profile.role !== "admin" && client.assignedBy !== caller.uid) {
          throw new Error("You are not authorized to edit this client; only its assigner can edit it.");
        }

        const paymentStatus = totalReceived >= totalAmount && totalAmount > 0
          ? "Received"
          : totalReceived > 0
            ? "Partial"
            : "Pending";
        updatedClient = {
          date: body.date || client.date || "",
          name,
          provider,
          cell: String(body.cell || "").trim(),
          cnic,
          pin: String(body.pin || "").trim(),
          password: String(body.password || ""),
          email,
          work: String(body.work || "").trim(),
          description: String(body.description || "").trim(),
          amount: totalAmount,
          totalAmount,
          received: totalReceived,
          totalReceived,
          remaining: totalAmount - totalReceived,
          payment: paymentStatus,
          paymentStatus,
          updatedBy: caller.uid,
          updatedAt: FieldValue.serverTimestamp(),
        };
        transaction.update(clientRef, updatedClient);
      });
      return Response.json({ clientId, ...updatedClient, updatedAt: null });
    }
    if (status !== undefined) {
      if (!clientId || !["New", "Pending", "In Progress", "Completed", "Cancelled"].includes(status)) return jsonError("Client and valid work status are required.");
      const managedProfiles = caller.profile.role === "admin"
        ? []
        : await getManagedProfiles(caller.db, caller.uid);
      const permittedUids = [caller.uid, ...managedProfiles.filter((profile) => isRoleBelow(caller.profile.role, profile.role)).map((profile) => profile.uid)];
      const clientRef = caller.db.collection("clients").doc(clientId);
      await caller.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(clientRef);
        if (!snapshot.exists) throw new Error("Client not found.");
        if (caller.profile.role !== "admin" && !permittedUids.includes(snapshot.data().assignedTo)) {
          throw new Error("You are not authorized to update this client's work status.");
        }
        transaction.update(clientRef, { status, updatedBy: caller.uid, updatedAt: FieldValue.serverTimestamp() });
      });
      return Response.json({ clientId, status });
    }

    if (!hasPermission(caller.profile, "manage_assignments")) return jsonError("Your account does not have permission to transfer clients.", 403);
    if (!clientId || !assignedTo || assignedTo === caller.uid) return jsonError("Client and lower-level assignee are required.");

    const managedProfiles = caller.profile.role === "admin"
      ? (await caller.db.collection("users").get()).docs.map((record) => ({ uid: record.id, ...record.data() }))
      : await getManagedProfiles(caller.db, caller.uid);
    const target = managedProfiles.find((profile) => profile.uid === assignedTo);
    if (!target || target.status !== "active" || !isRoleBelow(caller.profile.role, target.role)) {
      return jsonError("You are not authorized to assign clients to this employee.", 403);
    }

    const clientRef = caller.db.collection("clients").doc(clientId);
    let updatedClient;
    await caller.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(clientRef);
      if (!snapshot.exists) throw new Error("Client not found.");
      const client = snapshot.data();
      const previousProfile = managedProfiles.find((profile) => profile.uid === client.assignedTo);
      const previousAssigneeIsInScope = caller.profile.role === "admin"
        || client.assignedTo === caller.uid
        || (previousProfile && isRoleBelow(caller.profile.role, previousProfile.role));
      if (!previousAssigneeIsInScope) throw new Error("You are not authorized to transfer this client.");
      updatedClient = {
        assignedTo,
        assignedBy: caller.uid,
        assignedAt: FieldValue.serverTimestamp(),
        assignmentHistory: FieldValue.arrayUnion({ from: client.assignedTo || null, to: assignedTo, changedBy: caller.uid, changedAt: new Date() }),
      };
      transaction.update(clientRef, updatedClient);
    });
    return Response.json({ clientId, ...updatedClient });
  } catch (error) {
    const status = error.message.includes("not authorized") ? 403 : error.message.includes("not found") ? 404 : 400;
    return jsonError(error.message || "Could not transfer client.", status);
  }
}
