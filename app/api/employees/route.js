import { authenticateRequest, hasPermission, isRoleBelow, jsonError, normalizePhone, normalizeRole, roleOrder, rolePermissions } from "@/app/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

function normalizeStatus(status) {
  return String(status ?? "active").trim().toLowerCase();
}

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

export async function GET(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);
  const canViewEmployees = ["manage_employees", "manage_lower_employees", "manage_junior_employees", "manage_assignments"].some((permission) => hasPermission(caller.profile, permission));
  if (!canViewEmployees) return jsonError("You are not authorized to view employee records.", 403);

  const profiles = caller.profile.role === "admin"
    ? (await caller.db.collection("users").get()).docs.map((record) => ({ uid: record.id, ...record.data() })).filter((profile) => isRoleBelow(caller.profile.role, profile.role))
    : (await getManagedProfiles(caller.db, caller.uid)).filter((profile) => isRoleBelow(caller.profile.role, profile.role));
  return Response.json({ employees: profiles.filter((profile) => profile.uid !== caller.uid) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);

  try {
    const { name, email, phone, role, password, managerUid, status = "active" } = await request.json();
    const normalizedRole = normalizeRole(role);
    const normalizedStatus = normalizeStatus(status);
    if (!normalizedRole || !roleOrder.includes(normalizedRole) || !["active", "inactive"].includes(normalizedStatus)) {
      return jsonError("Invalid role or account status.");
    }
    if (!isRoleBelow(caller.profile.role, normalizedRole) || normalizedRole === "admin") {
      return jsonError("You are not authorized to create an employee with this role.", 403);
    }
    const creationPermission = { admin: "manage_employees", sub_admin: "manage_lower_employees", senior_technical: "manage_junior_employees" }[caller.profile.role];
    if (!creationPermission || !hasPermission(caller.profile, creationPermission)) return jsonError("Your account does not have permission to add employees.", 403);
    const parentUid = managerUid || caller.uid;
    if (caller.profile.role !== "admin" && parentUid !== caller.uid) return jsonError("You can only add employees to your own team.", 403);
    const parentSnapshot = parentUid === caller.uid ? null : await caller.db.collection("users").doc(parentUid).get();
    const parentProfile = parentUid === caller.uid ? caller.profile : parentSnapshot?.exists ? parentSnapshot.data() : null;
    if (!parentProfile || parentProfile.status !== "active" || !isRoleBelow(parentProfile.role, normalizedRole)) {
      return jsonError("Choose an active manager whose role is above the employee role.");
    }
    if (!name?.trim() || !email?.trim() || !phone?.trim() || typeof password !== "string" || password.length < 8) {
      return jsonError("Name, email, phone, and a password of at least 8 characters are required.");
    }
    const phoneNumber = normalizePhone(phone);

    const user = await caller.auth.createUser({
      displayName: name.trim(),
      email: email.trim().toLowerCase(),
      phoneNumber,
      password,
      disabled: normalizedStatus !== "active",
    });
    const profile = {
      uid: user.uid,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phoneNumber,
      role: normalizedRole,
      status: normalizedStatus,
      createdBy: caller.uid,
      managerUid: parentUid,
      createdAt: FieldValue.serverTimestamp(),
      permissions: rolePermissions[normalizedRole],
    };

    try {
      await caller.db.collection("users").doc(user.uid).create(profile);
    } catch (error) {
      await caller.auth.deleteUser(user.uid).catch(() => {});
      throw error;
    }
    return Response.json({ employee: { ...profile, createdAt: null } }, { status: 201 });
  } catch (error) {
    const status = error.code === "auth/email-already-exists" ? 409 : 400;
    return jsonError(error.message || "Could not create employee.", status);
  }
}

export async function PATCH(request) {
  const caller = await authenticateRequest(request);
  if (caller.error) return jsonError(caller.error, caller.status);

  try {
    const { uid, status, role, permissions, name, email, phone, password, managerUid } = await request.json();
    const normalizedStatus = status !== undefined ? normalizeStatus(status) : undefined;
    if (!uid || (normalizedStatus !== undefined && !["active", "inactive"].includes(normalizedStatus)) || (password !== undefined && (typeof password !== "string" || password.length < 8))) return jsonError("Employee UID, valid account status, and any new password of at least 8 characters are required.");
    const targetRef = caller.db.collection("users").doc(uid);
    const targetSnapshot = await targetRef.get();
    if (!targetSnapshot.exists) return jsonError("Employee not found.", 404);

    const target = targetSnapshot.data();
    const managesTarget = caller.profile.role === "admin"
      ? isRoleBelow(caller.profile.role, target.role)
      : (await getManagedProfiles(caller.db, caller.uid)).some((employee) => employee.uid === uid);
    if (!managesTarget || !isRoleBelow(caller.profile.role, target.role)) {
      return jsonError("You are not authorized to manage this employee.", 403);
    }
    const managementPermission = { admin: "manage_employees", sub_admin: "manage_lower_employees", senior_technical: "manage_junior_employees" }[caller.profile.role];
    if (!managementPermission || !hasPermission(caller.profile, managementPermission)) return jsonError("Your account does not have permission to manage employees.", 403);

    const updates = { updatedAt: FieldValue.serverTimestamp() };
    const authUpdates = {};
    const nextStatus = normalizedStatus ?? normalizeStatus(target.status);
    const nextRole = role === undefined ? target.role : normalizeRole(role);
    if (normalizedStatus !== undefined) updates.status = normalizedStatus;
    if (name !== undefined) {
      if (!name.trim()) return jsonError("Employee name cannot be empty.");
      updates.name = name.trim();
      authUpdates.displayName = name.trim();
    }
    if (email !== undefined) {
      if (!email.trim()) return jsonError("Employee email cannot be empty.");
      updates.email = email.trim().toLowerCase();
      authUpdates.email = updates.email;
    }
    if (phone !== undefined) {
      updates.phone = normalizePhone(phone);
      authUpdates.phoneNumber = updates.phone;
    }
    if (password !== undefined) authUpdates.password = password;
    if (role !== undefined) {
      if (!nextRole || !roleOrder.includes(nextRole) || !isRoleBelow(caller.profile.role, nextRole)) return jsonError("You cannot assign this employee role.", 403);
      updates.role = nextRole;
      updates.permissions = rolePermissions[nextRole];
    }
    if (managerUid !== undefined) {
      if (caller.profile.role !== "admin") return jsonError("Only Admin can change an employee's manager.", 403);
      const parentSnapshot = managerUid === caller.uid ? null : await caller.db.collection("users").doc(managerUid).get();
      const parentProfile = managerUid === caller.uid ? caller.profile : parentSnapshot?.exists ? parentSnapshot.data() : null;
      if (!parentProfile || parentProfile.status !== "active" || !isRoleBelow(parentProfile.role, nextRole)) {
        return jsonError("Choose an active manager whose role is above the employee role.");
      }
      updates.managerUid = managerUid;
    }
    if (permissions !== undefined) {
      const knownPermissions = Object.values(rolePermissions).flat();
      if (caller.profile.role !== "admin" || !hasPermission(caller.profile, "manage_permissions") || !Array.isArray(permissions) || permissions.some((permission) => !knownPermissions.includes(permission))) {
        return jsonError("Only Admin can assign valid employee permissions.", 403);
      }
      updates.permissions = [...new Set(permissions)];
    }

    if (status !== undefined) authUpdates.disabled = nextStatus !== "active";
    if (Object.keys(authUpdates).length) await caller.auth.updateUser(uid, authUpdates);
    await targetRef.update(updates);
    return Response.json({
      uid,
      status: nextStatus,
      role: updates.role || target.role,
      permissions: updates.permissions || target.permissions || [],
      name: updates.name || target.name,
      email: updates.email || target.email,
      phone: updates.phone || target.phone,
      createdBy: target.createdBy,
      managerUid: updates.managerUid ?? target.managerUid ?? target.createdBy,
    });
  } catch (error) {
    const status = error.code === "auth/email-already-exists" ? 409 : 400;
    return jsonError(error.message || "Could not update employee.", status);
  }
}
