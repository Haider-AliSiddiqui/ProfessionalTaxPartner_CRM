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

function clientServiceSummaries(clients) {
  const services = new Map();
  for (const client of clients) {
    const name = client.work || client.provider || "Unspecified work";
    const service = services.get(name) || { name, category: client.provider || "Service", clients: 0, amount: 0, status: "Completed" };
    service.clients += 1;
    service.amount += Number(client.totalReceived ?? client.received) || 0;
    if (client.status !== "Completed") service.status = client.status || "Active";
    services.set(name, service);
  }
  return [...services.values()];
}

export async function GET(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);

  try {
    if (caller.profile.role === "admin") {
      const [serviceSnapshot, clientSnapshot] = await Promise.all([
        caller.db.collection("services").get(),
        caller.db.collection("clients").get(),
      ]);
      const records = serviceSnapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
      const activeClients = clientSnapshot.docs.filter((record) => !record.data().archivedAt).map((record) => record.data());
      return Response.json({ services: records.length ? records : clientServiceSummaries(activeClients) }, { headers: { "Cache-Control": "no-store" } });
    }

    const managedProfiles = await getManagedProfiles(caller.db, caller.uid);
    const visibleProfiles = [{ uid: caller.uid, ...caller.profile }, ...managedProfiles.filter((profile) => isRoleBelow(caller.profile.role, profile.role))];
    const visibleUids = visibleProfiles.map((profile) => profile.uid);
    const clientSnapshots = await Promise.all(visibleUids.map((uid) => caller.db.collection("clients").where("assignedTo", "==", uid).get()));
    const visibleClients = clientSnapshots.flatMap((snapshot) => snapshot.docs.filter((record) => !record.data().archivedAt).map((record) => ({ id: record.id, ...record.data() })));
    const visibleClientIds = new Set(visibleClients.map((client) => client.id));
    const serviceSnapshots = await Promise.all(visibleUids.flatMap((uid) => [
      caller.db.collection("services").where("createdBy", "==", uid).get(),
      caller.db.collection("services").where("assignedTo", "==", uid).get(),
    ]));
    const scopedServices = new Map();
    for (const snapshot of serviceSnapshots) {
      for (const record of snapshot.docs) scopedServices.set(record.id, { id: record.id, ...record.data() });
    }
    const linkedServiceSnapshot = await Promise.all([...visibleClientIds].map((clientId) => caller.db.collection("services").where("clientId", "==", clientId).get()));
    for (const snapshot of linkedServiceSnapshot) {
      for (const record of snapshot.docs) scopedServices.set(record.id, { id: record.id, ...record.data() });
    }
    const storedServices = [...scopedServices.values()];
    return Response.json({ services: storedServices.length ? storedServices : clientServiceSummaries(visibleClients) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError("Could not load authorized service records.", 503);
  }
}

export async function POST(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);
  if (caller.profile.role === "jn_technical" || !hasPermission(caller.profile, "manage_clients")) {
    return jsonError("Your account does not have permission to add services.", 403);
  }

  try {
    const { name, category } = await request.json();
    if (!name?.trim() || !category?.trim()) return jsonError("Service name and category are required.");
    const service = {
      name: name.trim(),
      category: category.trim(),
      clients: 0,
      amount: 0,
      status: "Active",
      createdBy: caller.uid,
      assignedTo: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
    };
    const serviceRef = await caller.db.collection("services").add(service);
    return Response.json({ service: { id: serviceRef.id, ...service, createdAt: null } }, { status: 201 });
  } catch (error) {
    return jsonError(error.message || "Could not create service.", 400);
  }
}