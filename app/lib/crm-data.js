import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  or,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getApps, initializeApp } from "firebase/app";
import { app, auth, db, passwordResetSettings } from "./firebase.js";
import {
  hasPermission,
  isRoleBelow,
  normalizePhone,
  normalizeRole,
  reportableRoles,
  roleOrder,
  rolePermissions,
} from "./roles.js";

const employeeAuthAppName = "crm-employee-provisioning";
// Firestore on a warm connection costs one network round-trip (~150-400ms) per
// read. A single dashboard refresh used to issue 10-20 of them because the
// signed-in user's profile was re-fetched on every call and every view change.
// These two caches remove the repeat reads: the profile is fetched once per
// session, and the role-scoped record set is reused for a short window (see
// CACHE_TTL_MS) so switching tabs paints immediately instead of waiting on
// the network again.
const CACHE_TTL_MS = 30000;
let profileCache = null;
let recordsCache = null;

function clearCaches() {
  profileCache = null;
  recordsCache = null;
}

function recordFromSnapshot(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

// Splits a value list into "in" filter groups. Firestore caps an "in" filter at
// 30 values and rejects an empty one outright:
// https://firebase.google.com/docs/firestore/query-data/queries#in_not-in_and_array-contains-any
// Both limits are enforced in one place so no caller can send a malformed query.
function chunkValues(values, size) {
  const unique = [...new Set((values || []).filter((value) => value != null))];
  const chunks = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
}

function workShiftFromTime(workTime) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(workTime || "").trim());
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) {
    return "";
  }
  const totalMinutes = hours * 60 + minutes;
  const startMinutes = 10 * 60;
  const endMinutes = 17 * 60;
  return totalMinutes >= startMinutes && totalMinutes < endMinutes ? "Morning" : "Night";
}

function normalizeWorkTime(value) {
  const raw = String(value || "").trim();
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw : "";
}

function workTimeFromTimestamp(value) {
  const parsed = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeDigitField(value, label, length) {
  const raw = String(value || "").trim();
  const normalized = raw.replace(/[\s()-]/g, "");
  if (!new RegExp(`^\\d{${length}}$`).test(normalized)) {
    throw new Error(`${label} must contain exactly ${length} digits.`);
  }
  return normalized;
}

function profileFromSnapshot(snapshot, uid) {
  if (!snapshot.exists()) {
    throw new Error("Account profile not found. Contact your administrator.");
  }
  const profile = snapshot.data();
  if (profile.status !== "active") {
    throw new Error(
      "Your account has been deactivated. Please contact your administrator.",
    );
  }
  return { uid, ...profile, role: normalizeRole(profile.role) };
}

async function requireActiveProfile(uid) {
  if (profileCache && profileCache.uid === uid) return profileCache;
  const profile = profileFromSnapshot(await getDoc(doc(db, "users", uid)), uid);
  profileCache = profile;
  return profile;
}

// Builds the profile object returned by requireActiveProfile() without any
// network read. Callers that have already fetched their own profile document
// (the dashboard, before it mounts the workspace) hydrate the cache with this so
// the first workspace refresh does not read the same document a second time.
export function primeProfileCache(profile) {
  if (profile?.uid) profileCache = profile;
}

// Points the data layer's cached profile at the signed-in user, reading it only
// when the cache is cold or holds a different account. Returns the profile so
// callers can gate on its role/status without a second read.
export async function useProfile(user) {
  if (!user) throw new Error("Your Firebase sign-in is not ready. Please sign in again.");
  return requireActiveProfile(user.uid);
}

// The team list is read by filtered query rather than by walking the
// managerUid/createdBy chain: a Sub Admin, and now a Social Media user, may see
// every role beneath them (see the canListTeam/canReadUser scope in
// firestore.rules), and a chain walk would hide lower-ranked staff whose
// managerUid points at someone else, leaving the Team view dropdown empty. The
// filter is also what makes the read legal — neither role has a blanket
// permission to list /users.
//
// Every read compares the role field against a value list, and Firestore rejects
// an "in" filter whose array is empty, so both lists are derived from the single
// role order in app/lib/roles.js. The values must match the names firestore.rules
// whitelists; both teamRoleFilter and the rule list widen automatically when a
// role is added beneath sub_admin (Social Media).
const adminTeamRoles = reportableRoles("admin");
const subAdminTeamRoles = reportableRoles("sub_admin");
// The order the rules match: Senior Technical, JN Technical, then Social Media.
const technicalTeamRoles = subAdminTeamRoles.filter((role) => role !== "social_media");
const anyRoleFilter = ["admin", ...subAdminTeamRoles];

function assertQueryValues(label, values) {
  if (!values.length) throw new Error(`Cannot list users: ${label} is empty.`);
  return values;
}

// Every employee is listed, never a capped first page: both queries filter on
// `role`, so the role clause must stay in the query rather than be dropped for a
// single-role caller. Dropping it while the rules require it (or leaving it out
// entirely) is what produced Invalid Query errors before.
function teamListQuery(roles) {
  return query(
    collection(db, "users"),
    where("role", "in", assertQueryValues("team role filter", roles)),
    where("status", "==", "active"),
  );
}

// Which role values a team read is allowed to carry. An Admin (and an Admin-only
// caller such as the bootstrap path) reads the whole directory including Social
// Media accounts; a Sub Admin reads its technical team; a Social Media user
// reads the technical team below it. Firestore's team-list rule accepts the
// whole set for any caller that passes the read scope, so the narrower query is
// purely the caller's own scope.
function teamRolesFor(profile) {
  if (profile.role === "admin") return adminTeamRoles;
  if (profile.role === "social_media") return technicalTeamRoles;
  return subAdminTeamRoles;
}

async function getTeamProfiles(profile) {
  const snapshot = await getDocs(teamListQuery(teamRolesFor(profile)));
  return snapshot.docs
    .map((record) => ({ uid: record.id, ...record.data() }))
    .filter(
      (employee) =>
        employee.uid !== profile.uid && isRoleBelow(profile.role, employee.role),
    );
}

// The Admin directory: the whole role list rather than a per-caller subset, so
// this stays the complete employee list no matter how many employees exist.
async function getDirectoryProfiles(profile) {
  const snapshot = await getDocs(
    query(
      collection(db, "users"),
      where("role", "in", assertQueryValues("directory role filter", anyRoleFilter)),
    ),
  );
  return snapshot.docs
    .map((record) => ({ uid: record.id, ...record.data() }))
    .filter((employee) => isRoleBelow(profile.role, employee.role));
}

async function getManagedProfiles(profile) {
  if (profile.role === "admin") {
    return getDirectoryProfiles(profile);
  }

  // Both roles that outrank the technical staff read them by filtered query
  // rather than by walking the reporting chain (see getTeamProfiles). Social
  // Media has no permission to list /users, so the team query is also the only
  // read of employees its account can make.
  if (profile.role === "sub_admin" || profile.role === "social_media") {
    return getTeamProfiles(profile);
  }

  const found = new Map();
  let parentUids = [profile.uid];
  while (parentUids.length) {
    const snapshots = await Promise.all(
      parentUids.flatMap((uid) => [
        getDocs(
          query(collection(db, "users"), where("managerUid", "==", uid)),
        ),
        getDocs(query(collection(db, "users"), where("createdBy", "==", uid))),
      ]),
    );
    const nextUids = [];
    for (const snapshot of snapshots) {
      for (const record of snapshot.docs) {
        if (!found.has(record.id)) {
          found.set(record.id, { uid: record.id, ...record.data() });
          nextUids.push(record.id);
        }
      }
    }
    parentUids = nextUids;
  }
  return [...found.values()].filter((employee) =>
    isRoleBelow(profile.role, employee.role),
  );
}

async function getAssignableProfiles(profile) {
  if (profile.role === "sub_admin") {
    return getTeamProfiles(profile);
  }
  return getManagedProfiles(profile);
}

async function getClientRecords(profile, teamProfiles) {
  const visibleUids = [...new Set([profile.uid, ...teamProfiles.map((employee) => employee.uid)])];
  // Chunked "in" queries instead of one query per teammate: 40 employees used to
  // mean 40 separate round-trips competing for the same socket, which is what
  // made the dashboard feel stalled. Firestore allows 30 values per "in" query.
  // visibleUids always contains at least the caller, so this clamp only guards
  // against a caller with no UID — the empty "in" filter would otherwise throw
  // and take the whole clients read down with it.
  const chunks = chunkValues([...new Set(visibleUids)], 30);
  if (!chunks.length) return [];
  const snapshots =
    profile.role === "admin"
      ? [await getDocs(collection(db, "clients"))]
      : await Promise.all(
          chunks.map((chunk) =>
            getDocs(
              query(collection(db, "clients"), where("assignedTo", "in", chunk)),
            ),
          ),
        );
  const names = new Map(
    teamProfiles.map((employee) => [employee.uid, employee.name]),
  );
  names.set(profile.uid, profile.name);
  return snapshots
    .flatMap((snapshot) => snapshot.docs)
    .filter((record) => !record.data().archivedAt)
    .map((record) => {
      const data = record.data();
      const amount = Number(data.totalAmount ?? data.amount) || 0;
      const received = Number(data.totalReceived ?? data.received) || 0;
      const owner =
        names.get(data.assignedTo) || data.owner || "Unassigned";
      const workTime =
        normalizeWorkTime(data.workTime) || workTimeFromTimestamp(data.createdAt);
      return {
        id: record.id,
        ...data,
        owner,
        assignedToName: owner,
        amount,
        received,
        remaining: Math.max(amount - received, 0),
        payment: data.paymentStatus || data.payment || "Pending",
        workTime,
        workShift: workShiftFromTime(workTime),
      };
    });
}

async function getEmployees(profile) {
  const allowed = [
    "manage_employees",
    "manage_lower_employees",
    "manage_junior_employees",
    "manage_assignments",
  ].some((permission) => hasPermission(profile, permission));
  if (!allowed) {
    throw new Error("You are not authorized to view employee records.");
  }
  // The whole directory is readable by an Admin that holds manage_employees (see
  // canListEmployees in firestore.rules); every other role is scoped to the
  // technical roles it may actually see, so its list stays a team list.
  const employees = profile.role === "admin"
    ? await getDirectoryProfiles(profile)
    : await getTeamProfiles(profile);
  return employees.filter((employee) => employee.uid !== profile.uid);
}

// One role-scoped read shared by every GET. The workspace renders Overview,
// Clients, Employees, Payments and Reports from the same client/payment/employee
// set, so re-reading all of it for each nav change only added latency.
function cachedRecords(profile) {
  if (
    recordsCache &&
    recordsCache.uid === profile.uid &&
    Date.now() - recordsCache.at < CACHE_TTL_MS
  ) {
    return recordsCache.value;
  }
  return null;
}

async function loadRecords(profile) {
  const cached = cachedRecords(profile);
  if (cached) return cached;

  const assignmentProfiles = await getAssignableProfiles(profile);
  const clients = await getClientRecords(profile, assignmentProfiles);
  // The same profile document is read several times while assembling a scope
  // (client reads, service scope, assignment targets). Awaiting each one in
  // sequence doubled the perceived load time; the union keeps them concurrent.
  const [services, payments] = await Promise.all([
    getServices(profile, assignmentProfiles, clients),
    getPayments(profile, clients, assignmentProfiles),
  ]);
  const value = { clients, services, payments, assignmentProfiles };
  recordsCache = { uid: profile.uid, at: Date.now(), value };
  return value;
}

async function getServices(profile, teamProfiles, clients) {
  if (profile.role === "admin") {
    const snapshot = await getDocs(collection(db, "services"));
    if (snapshot.size) return snapshot.docs.map(recordFromSnapshot);
  } else {
    const visibleUids = chunkValues([profile.uid, ...teamProfiles.map(({ uid }) => uid)], 30);
    const clientIds = chunkValues(clients.map(({ id }) => id), 30);
    // At least one side of this OR must carry values: an "in" filter with an
    // empty array is rejected by Firestore before the query is even sent.
    if (visibleUids.length || clientIds.length) {
      // One "in" query per side (createdBy OR assignedTo OR clientId) replaces
      // the old per-user / per-client fan-out, which reached hundreds of reads.
      const clauses = [];
      for (const chunk of visibleUids) {
        clauses.push(where("createdBy", "in", chunk));
        clauses.push(where("assignedTo", "in", chunk));
      }
      for (const chunk of clientIds) {
        clauses.push(where("clientId", "in", chunk));
      }
      const snapshot = await getDocs(
        clauses.length === 1
          ? query(collection(db, "services"), clauses[0])
          : query(collection(db, "services"), or(...clauses)),
      );
      const stored = new Map();
      for (const record of snapshot.docs) {
        stored.set(record.id, recordFromSnapshot(record));
      }
      if (stored.size) return [...stored.values()];
    }
  }

  const summaries = new Map();
  for (const client of clients) {
    const name = client.work || client.provider || "Unspecified work";
    const service = summaries.get(name) || {
      name,
      category: client.provider || "Service",
      clients: 0,
      amount: 0,
      status: "Completed",
    };
    service.clients += 1;
    service.amount += Number(client.totalReceived ?? client.received) || 0;
    if (client.status !== "Completed") service.status = client.status || "Active";
    summaries.set(name, service);
  }
  return [...summaries.values()];
}

async function getPayments(profile, clients, teamProfiles) {
  const clientChunks = chunkValues(clients.map(({ id }) => id), 30);
  if (!clientChunks.length && profile.role !== "admin") return [];
  const snapshots =
    profile.role === "admin"
      ? [await getDocs(collection(db, "payments"))]
      : await Promise.all(
          clientChunks.map((chunk) =>
            getDocs(query(collection(db, "payments"), where("clientId", "in", chunk))),
          ),
        );
  const recorders = new Map(
    [[profile.uid, profile.name], ...teamProfiles.map(({ uid, name }) => [uid, name])],
  );
  const activeClientIds = new Set(clients.map(({ id }) => id));
  return snapshots
    .flatMap((snapshot) => snapshot.docs)
    .map(recordFromSnapshot)
    .filter(
      (payment) =>
        profile.role !== "admin" || activeClientIds.has(payment.clientId),
    )
    .map((payment) => ({
      ...payment,
      recordedByName:
        recorders.get(payment.recordedBy) ||
        (payment.recordedByName &&
        payment.recordedByName !== payment.recordedBy
          ? payment.recordedByName
          : "Unknown user"),
    }));
}

function profilePermissions(role) {
  return rolePermissions[role] || [];
}

async function createEmployee(caller, input) {
  const role = normalizeRole(input.role);
  const status = String(input.status || "active").trim().toLowerCase();
  if (!roleOrder.includes(role) || !["active", "inactive"].includes(status)) {
    throw new Error("Invalid role or account status.");
  }
  if (!isRoleBelow(caller.role, role) || role === "admin") {
    throw new Error("You are not authorized to create an employee with this role.");
  }
  const permission = {
    admin: "manage_employees",
    sub_admin: "manage_lower_employees",
    senior_technical: "manage_junior_employees",
  }[caller.role];
  if (!permission || !hasPermission(caller, permission)) {
    throw new Error("Your account does not have permission to add employees.");
  }
  const managerUid = input.managerUid || caller.uid;
  const profiles = await getManagedProfiles(caller);
  const manager =
    managerUid === caller.uid
      ? caller
      : profiles.find(({ uid }) => uid === managerUid);
  if (
    !manager ||
    manager.status !== "active" ||
    !isRoleBelow(manager.role, role)
  ) {
    throw new Error("Choose an active manager whose role is above the employee role.");
  }
  if (caller.role !== "admin" && managerUid !== caller.uid) {
    throw new Error("You can only add employees to your own team.");
  }
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const phone = normalizePhone(input.phone);
  if (!name || !email || typeof input.password !== "string" || input.password.length < 8) {
    throw new Error("Name, email, phone, and a password of at least 8 characters are required.");
  }

  let secondaryAuth;
  let employeeProfile;
  try {
    const employeeApp =
      getApps().find((existing) => existing.name === employeeAuthAppName) ||
      initializeApp(app.options, employeeAuthAppName);
    secondaryAuth = getAuth(employeeApp);
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      input.password,
    );
    employeeProfile = {
      uid: credential.user.uid,
      name,
      email,
      phone,
      role,
      status,
      createdBy: caller.uid,
      managerUid,
      createdAt: serverTimestamp(),
      permissions: profilePermissions(role),
    };
    await setDoc(doc(db, "users", credential.user.uid), employeeProfile);
  } catch (error) {
    if (secondaryAuth?.currentUser) {
      try {
        await deleteUser(secondaryAuth.currentUser);
      } catch (cleanupError) {
        throw new Error(
          `${error.message} The new Firebase Auth account could not be removed: ${cleanupError.message}`,
        );
      }
    }
    if (error.code === "auth/email-already-in-use") {
      throw new Error("An account with this email already exists.");
    }
    throw error;
  }
  await signOut(secondaryAuth);
  return { employee: { ...employeeProfile, createdAt: null } };
}

async function updateEmployee(caller, input) {
  const { uid } = input;
  if (!uid || uid === caller.uid) {
    throw new Error("Choose an employee in your management scope.");
  }
  const snapshot = await getDoc(doc(db, "users", uid));
  if (!snapshot.exists()) throw new Error("Employee not found.");
  const target = { uid, ...snapshot.data(), role: normalizeRole(snapshot.data().role) };
  const managed = (await getManagedProfiles(caller)).some(
    (employee) => employee.uid === uid,
  );
  if (!managed || !isRoleBelow(caller.role, target.role)) {
    throw new Error("You are not authorized to manage this employee.");
  }
  const permission = {
    admin: "manage_employees",
    sub_admin: "manage_lower_employees",
    senior_technical: "manage_junior_employees",
  }[caller.role];
  if (!permission || !hasPermission(caller, permission)) {
    throw new Error("Your account does not have permission to manage employees.");
  }

  const updates = { updatedAt: serverTimestamp() };
  if (input.status !== undefined) {
    const status = String(input.status).trim().toLowerCase();
    if (!["active", "inactive"].includes(status)) {
      throw new Error("Invalid employee account status.");
    }
    updates.status = status;
  }
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new Error("Employee name cannot be empty.");
    updates.name = name;
  }
  if (input.phone !== undefined) updates.phone = normalizePhone(input.phone);
  if (input.role !== undefined) {
    const role = normalizeRole(input.role);
    if (!roleOrder.includes(role) || !isRoleBelow(caller.role, role)) {
      throw new Error("You cannot assign this employee role.");
    }
    updates.role = role;
    updates.permissions = profilePermissions(role);
  }
  if (input.managerUid !== undefined) {
    if (caller.role !== "admin") {
      throw new Error("Only Admin can change an employee's manager.");
    }
    const managerUid = String(input.managerUid);
    const managerSnapshot = await getDoc(doc(db, "users", managerUid));
    const manager =
      managerUid === caller.uid
        ? caller
        : managerSnapshot.exists()
          ? { ...managerSnapshot.data(), uid: managerUid }
          : null;
    const nextRole = updates.role || target.role;
    if (
      !manager ||
      manager.status !== "active" ||
      !isRoleBelow(manager.role, nextRole)
    ) {
      throw new Error("Choose an active manager whose role is above the employee role.");
    }
    updates.managerUid = managerUid;
  }
  if (input.permissions !== undefined) {
    const allowed = new Set(Object.values(rolePermissions).flat());
    if (
      caller.role !== "admin" ||
      !hasPermission(caller, "manage_permissions") ||
      !Array.isArray(input.permissions) ||
      input.permissions.some((item) => !allowed.has(item))
    ) {
      throw new Error("Only Admin can assign valid employee permissions.");
    }
    updates.permissions = [...new Set(input.permissions)];
  }
  if (input.password !== undefined && input.password !== null && input.password !== "") {
    if (caller.role !== "admin") {
      throw new Error("Only Admin can set a new employee password.");
    }
    const password = String(input.password);
    if (password.length < 8) {
      throw new Error("The new password must be at least 8 characters.");
    }
    updates.passwordReset = password;
  }
  await updateDoc(doc(db, "users", uid), updates);
  const { passwordReset: _passwordReset, ...safeUpdates } = updates;
  return {
    uid,
    ...target,
    ...safeUpdates,
    role: updates.role || target.role,
    status: updates.status || target.status,
    permissions: updates.permissions || target.permissions || [],
    createdAt: target.createdAt || null,
  };
}

async function createClient(caller, input) {
  if (!hasPermission(caller, "manage_assignments")) {
    throw new Error("Your account does not have permission to assign clients.");
  }
  const name = String(input.name || "").trim();
  const provider = String(input.provider || "").trim();
  const assignedTo = String(input.assignedTo || "");
  if (!name || !provider || !assignedTo) {
    throw new Error("Client name, service, and assignee are required.");
  }
  // Only a role that assigns on its own behalf can be the assignee itself: for
  // Admin, Sub Admin and Social Media `isRoleBelow(role, role)` is false, so this
  // identity path never widens what those roles may assign to.
  const employees = await getAssignableProfiles(caller);
  const target =
    assignedTo === caller.uid && isRoleBelow(caller.role, caller.role)
      ? caller
      : employees.find((employee) => employee.uid === assignedTo);
  if (
    !target ||
    target.status !== "active" ||
    !isRoleBelow(caller.role, target.role)
  ) {
    throw new Error("You are not authorized to assign clients to this employee.");
  }

  const clients = await getClientRecords(caller, employees);
  const cell = normalizeDigitField(input.cell, "Cell number", 11);
  const cnic = normalizeDigitField(input.cnic, "CNIC", 13);
  const email = String(input.email || "").trim();
  const identity = cnic
    ? `cnic:${cnic.replace(/\D/g, "")}`
    : email
      ? `email:${normalizeIdentity(email)}`
      : `name-provider:${normalizeIdentity(name)}|${normalizeIdentity(provider)}`;
  const duplicate = clients.some((client) => {
    if (client.archivedAt) return false;
    const existingIdentity = client.cnic
      ? `cnic:${String(client.cnic).replace(/\D/g, "")}`
      : client.email
        ? `email:${normalizeIdentity(client.email)}`
        : `name-provider:${normalizeIdentity(client.name)}|${normalizeIdentity(client.provider)}`;
    return existingIdentity === identity;
  });
  if (duplicate) {
    throw new Error("A client with the same CNIC, email, or name and service already exists.");
  }

  const amount = Number(input.totalAmount ?? input.amount) || 0;
  const received = Number(input.totalReceived ?? input.received) || 0;
  if (amount < 0 || received < 0 || received > amount) {
    throw new Error("Payment amounts must be non-negative and received cannot exceed total.");
  }
  const status = ["New", "Pending", "In Progress", "Completed", "Cancelled"].includes(input.status)
    ? input.status
    : "Pending";
  const paymentStatus =
    received >= amount && amount > 0
      ? "Received"
      : received > 0
        ? "Partial"
        : "Pending";
  const clientRef = doc(collection(db, "clients"));
  const paymentRef = received > 0 ? doc(collection(db, "payments")) : null;
  const paymentDate =
    input.paymentDate || input.date || new Date().toISOString().slice(0, 10);
  const workTime = normalizeWorkTime(input.workTime);
  const client = {
    ...Object.fromEntries(
      [
        "date",
        "cell",
        "cnic",
        "pin",
        "password",
        "email",
        "work",
        "description",
        "document",
        "documentName",
        "documentType",
        "initials",
        "color",
      ]
        .filter((key) => input[key] !== undefined)
        .map((key) => [key, input[key]]),
    ),
    name,
    provider,
    cell,
    cnic,
    assignedTo,
    owner: target.name,
    assignedBy: caller.uid,
    assignedAt: serverTimestamp(),
    assignmentHistory: [
      { from: null, to: assignedTo, changedBy: caller.uid, changedAt: new Date() },
    ],
    createdBy: caller.uid,
    createdAt: serverTimestamp(),
    workTime,
    workShift: workShiftFromTime(workTime),
    status,
    amount,
    totalAmount: amount,
    received,
    totalReceived: received,
    remaining: Math.max(amount - received, 0),
    payment: paymentStatus,
    paymentStatus,
    ...(received > 0
      ? { paymentDate, lastPaymentId: paymentRef.id }
      : {}),
  };
  await runTransaction(db, async (transaction) => {
    transaction.set(clientRef, client);
    if (paymentRef) {
      transaction.set(paymentRef, {
        clientId: clientRef.id,
        clientName: name,
        assignedTo,
        amount: received,
        date: paymentDate,
        receivedAt: String(input.receivedAt || "").trim(),
        recordedBy: caller.uid,
        recordedByName: caller.name || "Unknown user",
        createdAt: serverTimestamp(),
      });
    }
  });
  return {
    client: {
      id: clientRef.id,
      name,
      provider,
      assignedTo,
      document: String(input.document || "").trim(),
      documentName: String(input.documentName || "").trim(),
      documentType: String(input.documentType || "").trim(),
      status,
      amount,
      received,
      remaining: Math.max(amount - received, 0),
      payment: paymentStatus,
    },
  };
}

async function updateClient(caller, input) {
  const { clientId, assignedTo, status } = input;
  if (!clientId) throw new Error("Client ID is required.");
  const clientRef = doc(db, "clients", clientId);
  const snapshot = await getDoc(clientRef);
  if (!snapshot.exists() || snapshot.data().archivedAt) {
    throw new Error("Client not found.");
  }
  const client = snapshot.data();
  if (input.action === "delete") {
    if (
      caller.role !== "admin" &&
      (client.assignedBy || client.createdBy) !== caller.uid
    ) {
      throw new Error("You are not authorized to delete this client; only its assigner can delete it.");
    }
    const [payments, services] = await Promise.all([
      getDocs(query(collection(db, "payments"), where("clientId", "==", clientId))),
      getDocs(query(collection(db, "services"), where("clientId", "==", clientId))),
    ]);
    if (payments.size + services.size + 1 > 500) {
      throw new Error("This client has too many linked records to delete in one transaction. Contact Admin for assistance.");
    }
    const batch = writeBatch(db);
    payments.docs.forEach((record) => batch.delete(record.ref));
    services.docs.forEach((record) => batch.delete(record.ref));
    batch.delete(clientRef);
    await batch.commit();
    return { clientId, deleted: true };
  }
  if (input.action === "edit") {
    if (
      caller.role !== "admin" &&
      (client.assignedBy || client.createdBy) !== caller.uid
    ) {
      throw new Error("You are not authorized to edit this client; only its assigner can edit it.");
    }
    const name = String(input.name || "").trim();
    const provider = String(input.provider || "").trim();
    const totalAmount = Number(input.totalAmount);
    const totalReceived = Number(input.totalReceived);
    if (!name || !provider) throw new Error("Client name and provider are required.");
    if (
      !Number.isFinite(totalAmount) ||
      !Number.isFinite(totalReceived) ||
      totalAmount < 0 ||
      totalReceived < 0 ||
      totalReceived > totalAmount
    ) {
      throw new Error("Payment amounts must be non-negative, and received cannot exceed total.");
    }
    if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new Error("Client date must use YYYY-MM-DD format.");
    }
    const cell = normalizeDigitField(input.cell, "Cell number", 11);
    const cnic = normalizeDigitField(input.cnic, "CNIC", 13);
    const email = String(input.email || "").trim().toLowerCase();
    const visibleClients = await getClientRecords(
      caller,
      await getManagedProfiles(caller),
    );
    const duplicate = visibleClients.some(
      (record) =>
        record.id !== clientId &&
        !record.archivedAt &&
        ((cnic && String(record.cnic || "").trim() === cnic) ||
          (email &&
            normalizeIdentity(record.email) === normalizeIdentity(email))),
    );
    if (duplicate) {
      throw new Error("Another client already uses this CNIC or email.");
    }
    const paymentStatus =
      totalReceived >= totalAmount && totalAmount > 0
        ? "Received"
        : totalReceived > 0
          ? "Partial"
          : "Pending";
    const workTime = normalizeWorkTime(input.workTime);
    await runTransaction(db, async (transaction) => {
      const currentSnapshot = await transaction.get(clientRef);
      if (!currentSnapshot.exists() || currentSnapshot.data().archivedAt) {
        throw new Error("Client not found.");
      }
      const current = currentSnapshot.data();
      if (
        caller.role !== "admin" &&
        (current.assignedBy || current.createdBy) !== caller.uid
      ) {
        throw new Error("You are not authorized to edit this client; only its assigner can edit it.");
      }
      transaction.update(clientRef, {
        date: input.date || current.date || "",
        name,
        provider,
        cell,
        cnic,
        pin: String(input.pin || "").trim(),
        password: String(input.password || ""),
        email,
        work: String(input.work || "").trim(),
        description: String(input.description || "").trim(),
        document: String(input.document || "").trim(),
        workTime,
        workShift: workShiftFromTime(workTime),
        amount: totalAmount,
        totalAmount,
        received: totalReceived,
        totalReceived,
        remaining: totalAmount - totalReceived,
        payment: paymentStatus,
        paymentStatus,
        updatedBy: caller.uid,
        updatedAt: serverTimestamp(),
      });
    });
    return { clientId };
  }
  if (status !== undefined) {
    if (!["New", "Pending", "In Progress", "Completed", "Cancelled"].includes(status)) {
      throw new Error("Client and valid work status are required.");
    }
    await runTransaction(db, async (transaction) => {
      const currentSnapshot = await transaction.get(clientRef);
      if (!currentSnapshot.exists() || currentSnapshot.data().archivedAt) {
        throw new Error("Client not found.");
      }
      transaction.update(clientRef, {
        status,
        updatedBy: caller.uid,
        updatedAt: serverTimestamp(),
      });
    });
    return { clientId, status };
  }
  if (!hasPermission(caller, "manage_assignments")) {
    throw new Error("Your account does not have permission to transfer clients.");
  }
  const employees = await getAssignableProfiles(caller);
  const target = employees.find((employee) => employee.uid === assignedTo);
  if (
    !target ||
    target.status !== "active" ||
    !isRoleBelow(caller.role, target.role)
  ) {
    throw new Error("You are not authorized to assign clients to this employee.");
  }
  await runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(clientRef);
    if (!currentSnapshot.exists()) throw new Error("Client not found.");
    const current = currentSnapshot.data();
    const previous = employees.find(
      (employee) => employee.uid === current.assignedTo,
    );
    const mayTransferRest =
      caller.role === "admin" ||
      (current.assignedTo === caller.uid && isRoleBelow(caller.role, caller.role)) ||
      (previous && isRoleBelow(caller.role, previous.role));
    if (!mayTransferRest) {
      throw new Error("You are not authorized to transfer this client.");
    }
    transaction.update(clientRef, {
      assignedTo,
      assignedBy: caller.uid,
      assignedAt: serverTimestamp(),
      assignmentHistory: [
        ...(Array.isArray(current.assignmentHistory)
          ? current.assignmentHistory
          : []),
        {
          from: current.assignedTo || null,
          to: assignedTo,
          changedBy: caller.uid,
          changedAt: new Date(),
        },
      ],
    });
  });
  return { clientId, assignedTo };
}

async function createPayment(caller, input) {
  const clientId = String(input.clientId || "");
  const amount = Number(input.amount);
  const date = input.date || new Date().toISOString().slice(0, 10);
  const receivedAt = String(input.receivedAt || "").trim();
  if (!clientId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Client and a payment amount greater than zero are required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Payment date must use YYYY-MM-DD format.");
  }
  const clientRef = doc(db, "clients", clientId);
  const paymentRef = doc(collection(db, "payments"));
  let payment;
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(clientRef);
    if (!snapshot.exists() || snapshot.data().archivedAt) {
      throw new Error("Client not found.");
    }
    const client = snapshot.data();
    const totalAmount = Number(client.totalAmount ?? client.amount) || 0;
    const previousReceived = Number(client.totalReceived ?? client.received) || 0;
    const totalReceived = previousReceived + amount;
    if (!totalAmount || totalReceived > totalAmount) {
      throw new Error("The payment exceeds the client's remaining balance.");
    }
    const remaining = totalAmount - totalReceived;
    const paymentStatus = remaining === 0 ? "Received" : "Partial";
    const nextClientStatus =
      remaining === 0
        ? "Completed"
        : ["New", "Pending", "In Progress"].includes(client.status)
          ? "In Progress"
          : client.status || "Pending";
    payment = {
      clientId,
      clientName: client.name || "",
      assignedTo: client.assignedTo,
      amount,
      date,
      receivedAt,
      recordedBy: caller.uid,
      recordedByName: caller.name || "Unknown user",
      createdAt: serverTimestamp(),
    };
    transaction.set(paymentRef, payment);
    transaction.update(clientRef, {
      amount: totalAmount,
      totalAmount,
      received: totalReceived,
      totalReceived,
      remaining,
      status: nextClientStatus,
      payment: paymentStatus,
      paymentStatus,
      paymentDate: date,
      lastPaymentId: paymentRef.id,
      updatedAt: serverTimestamp(),
    });
  });
  return { payment: { id: paymentRef.id, ...payment, createdAt: null } };
}

async function dispatch(profile, path, method, input) {
  const needsRecords =
    method === "GET" ||
    (method === "POST" && (path === "services" || path === "payments")) ||
    (method === "PATCH" && path === "clients");
  const records = needsRecords ? await loadRecords(profile) : null;

  if (method === "GET" && path === "employees") {
    return {
      employees: await getEmployees(profile),
      assignableEmployees: records.assignmentProfiles.filter(
        (employee) => employee.uid !== profile.uid,
      ),
    };
  }
  if (method === "GET" && path === "clients") {
    return { clients: records.clients };
  }
  if (method === "GET" && path === "services") {
    return { services: records.services };
  }
  if (method === "GET" && path === "payments") {
    return { payments: records.payments };
  }
  if (method === "POST" && path === "employees") {
    return createEmployee(profile, input);
  }
  if (method === "PATCH" && path === "employees") {
    return updateEmployee(profile, input);
  }
  if (method === "POST" && path === "clients") {
    const created = await createClient(profile, input);
    clearCaches();
    return created;
  }
  if (method === "PATCH" && path === "clients") {
    const updated = await updateClient(profile, input);
    clearCaches();
    return updated;
  }
  if (method === "POST" && path === "payments") {
    const created = await createPayment(profile, input);
    clearCaches();
    return created;
  }
  if (method === "POST" && path === "services") {
    if (!hasPermission(profile, "manage_clients")) {
      throw new Error("Your account does not have permission to add services.");
    }
    const name = String(input.name || "").trim();
    const category = String(input.category || "").trim();
    if (!name || !category) throw new Error("Service name and category are required.");
    const service = {
      name,
      category,
      clients: 0,
      amount: 0,
      status: "Active",
      createdBy: profile.uid,
      assignedTo: profile.uid,
      createdAt: serverTimestamp(),
    };
    const serviceRef = doc(collection(db, "services"));
    await setDoc(serviceRef, service);
    clearCaches();
    return { service: { id: serviceRef.id, ...service, createdAt: null } };
  }
  throw new Error("Unsupported Firebase data operation.");
}

export async function crmRequest(user, path, method = "GET", input = {}) {
  if (!user) throw new Error("Your Firebase sign-in is not ready. Please sign in again.");
  const uid = user.uid;
  const profile = await requireActiveProfile(uid);
  const result = await dispatch(profile, path, method, input);
  if (method !== "GET" && path === "employees") clearCaches();
  return result;
}

// Called when the signed-in account changes (sign-in / sign-out) so a previous
// session's cached profile and records can never be shown to the next one.
export function resetSessionCache() {
  clearCaches();
}

export async function sendEmployeePasswordReset(email) {
  await sendPasswordResetEmail(auth, email, passwordResetSettings);
}

// Confirms that an email address belongs to an Admin account before a password
// reset link is sent. This runs before the caller is signed in, so it relies on
// the narrow "recovery lookup" rule in firestore.rules: the query may only match
// the email the caller already typed, and only documents whose role is 'admin'
// are readable. No password (or password hash) is ever exposed — Firebase never
// stores it in a recoverable form — the caller only learns whether the account
// exists, and a reset link is emailed to the account's own inbox.
export async function verifyAdminRecoveryEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("Enter your account email first, then select Forgot password.");
  }
  const snapshot = await getDocs(
    query(
      collection(db, "users"),
      where("email", "==", normalized),
      where("role", "==", "admin"),
      limit(1),
    ),
  );
  return snapshot.docs.map((record) => record.data())[0] || null;
}

export async function createInitialAdmin({ name, email, phone, password }) {
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedName || !normalizedEmail || typeof password !== "string" || password.length < 8) {
    throw new Error("Enter your name, email, and a password of at least 8 characters.");
  }
  const phoneNumber = normalizePhone(phone);
  const credential = await createUserWithEmailAndPassword(
    auth,
    normalizedEmail,
    password,
  );
  try {
    const bootstrapRef = doc(db, "system", "bootstrap");
    const profileRef = doc(db, "users", credential.user.uid);
    await runTransaction(db, async (transaction) => {
      const bootstrapSnapshot = await transaction.get(bootstrapRef);
      if (
        bootstrapSnapshot.exists() &&
        bootstrapSnapshot.data().status !== "uninitialized"
      ) {
        throw new Error("Admin signup is closed. Ask an administrator to create your account.");
      }
      transaction.set(bootstrapRef, {
        status: "initialized",
        adminUid: credential.user.uid,
        initializedAt: serverTimestamp(),
      });
      transaction.set(profileRef, {
        uid: credential.user.uid,
        name: normalizedName,
        email: normalizedEmail,
        phone: phoneNumber,
        role: "admin",
        status: "active",
        createdBy: null,
        createdAt: serverTimestamp(),
        permissions: rolePermissions.admin,
      });
    });
    return credential.user;
  } catch (error) {
    try {
      await deleteUser(credential.user);
    } catch (cleanupError) {
      await signOut(auth);
      throw new Error(
        `${error.message} The new Firebase Auth account could not be removed: ${cleanupError.message}`,
      );
    }
    await signOut(auth);
    throw error;
  }
}

export async function getCurrentProfile(user) {
  if (!user) throw new Error("Sign in to continue.");
  const snapshot = await getDoc(doc(db, "users", user.uid));
  if (!snapshot.exists()) throw new Error("Account profile not found.");
  const profile = { uid: user.uid, ...snapshot.data(), role: normalizeRole(snapshot.data().role) };
  // Hand the already-fetched profile to the data layer, so mounting the
  // workspace right afterwards does not read the same document again.
  primeProfileCache(profile);
  return profile;
}

export async function getBootstrapStatus() {
  try {
    const snapshot = await getDoc(doc(db, "system", "bootstrap"));
    if (!snapshot.exists()) {
      return "available";
    }
    return snapshot.data()?.status === "uninitialized" ? "available" : "closed";
  } catch (error) {
    console.error("Could not check bootstrap status:", error);
    return "unavailable";
  }
}

export async function removeCurrentSession() {
  await signOut(auth);
}
