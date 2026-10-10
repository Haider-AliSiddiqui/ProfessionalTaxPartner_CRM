// Ordered from highest to lowest authority. The index of a role is its rank:
// roleOrder.indexOf(role) is the single source of truth for "who is above
// whom", and isRoleBelow/reportableRoles below are built on it. "social_media"
// sits directly under admin and above sub_admin, so a Social Media user can
// create and assign clients to Sub Admin, Senior Technical and JN Technical —
// every role beneath it.
export const roleOrder = [
  "admin",
  "social_media",
  "sub_admin",
  "senior_technical",
  "jn_technical",
];

export const rolePermissions = {
  admin: [
    "manage_employees",
    "manage_permissions",
    "manage_clients",
    "manage_assignments",
  ],
  // A Social Media account staffs and distributes beneath itself: it creates
  // Sub Admin / Senior Technical / JN Technical accounts and assigns clients to
  // them, carrying the same lower-employee authority a Sub Admin used to have.
  social_media: ["manage_lower_employees", "manage_clients", "manage_assignments"],
  sub_admin: ["manage_lower_employees", "manage_clients", "manage_assignments"],
  senior_technical: ["manage_junior_employees", "manage_assignments"],
  jn_technical: [],
};

export const roleLabels = {
  admin: "Admin",
  sub_admin: "Sub Admin",
  social_media: "Social Media",
  senior_technical: "Senior Technical",
  jn_technical: "JN Technical",
};

export function normalizeRole(role) {
  return String(role || "").toLowerCase().replaceAll(" ", "_");
}

export function roleLabel(role) {
  return roleLabels[normalizeRole(role)] || "Unknown";
}

export function isRoleBelow(actorRole, targetRole) {
  const actorIndex = roleOrder.indexOf(normalizeRole(actorRole));
  const targetIndex = roleOrder.indexOf(normalizeRole(targetRole));
  return actorIndex >= 0 && targetIndex > actorIndex;
}

// Every role a given role outranks, as role codes. Assignment and team queries
// filter on this list instead of hard-coding role names, so adding or
// reordering a role in roleOrder is the only edit needed.
export function reportableRoles(actorRole) {
  const actorIndex = roleOrder.indexOf(normalizeRole(actorRole));
  return actorIndex < 0 ? [] : roleOrder.slice(actorIndex + 1);
}

export function hasPermission(profile, permission) {
  const configured = Array.isArray(profile?.permissions)
    ? profile.permissions
    : rolePermissions[normalizeRole(profile?.role)] || [];
  return configured.includes(permission);
}

export function normalizePhone(phone) {
  const value = String(phone || "").replace(/[\s()-]/g, "");
  if (/^\+?[0-9]+$/.test(value)) {
    const digits = value.replace(/^\+/, "");
    if (/^923\d{9}$/.test(digits)) return `+${digits}`;
    if (/^3\d{9}$/.test(digits)) return `+92${digits}`;
    if (/^03\d{9}$/.test(digits)) return `+92${digits.slice(1)}`;
    if (/^92\d{10}$/.test(digits)) return `+${digits}`;
  }
  throw new Error(
    "Enter a valid phone number, such as 03XXXXXXXXX, 3XXXXXXXXX, or +923XXXXXXXXX.",
  );
}
