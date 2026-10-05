import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function getAdminApp() {
  const existingApp = getApps().find((app) => app.name === "crm-admin");
  if (existingApp) return existingApp;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccount = serviceAccountJson
    ? JSON.parse(serviceAccountJson)
    : null;
  const credential = serviceAccount
    ? cert({
        ...serviceAccount,
        privateKey: serviceAccount.private_key?.replaceAll("\\n", "\n"),
      })
    : process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? applicationDefault()
      : null;
  if (!credential)
    throw new Error(
      "Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS on the server.",
    );

  return initializeApp(
    {
      credential,
      projectId:
        process.env.FIREBASE_PROJECT_ID ||
        serviceAccount?.project_id ||
        "ptp-crm-website-b9ed8",
    },
    "crm-admin",
  );
}

export function getAdminServices() {
  const app = getAdminApp();
  return { auth: getAuth(app), db: getFirestore(app), FieldValue };
}

export const roleOrder = [
  "admin",
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
  sub_admin: ["manage_lower_employees", "manage_clients", "manage_assignments"],
  senior_technical: ["manage_junior_employees", "manage_assignments"],
  jn_technical: [],
};

export function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .replaceAll(" ", "_");
}

export function roleLabel(role) {
  return (
    {
      admin: "Admin",
      sub_admin: "Sub Admin",
      senior_technical: "Senior Technical",
      jn_technical: "JN Technical",
    }[normalizeRole(role)] || "Unknown"
  );
}

export function isRoleBelow(actorRole, targetRole) {
  const actorIndex = roleOrder.indexOf(normalizeRole(actorRole));
  const targetIndex = roleOrder.indexOf(normalizeRole(targetRole));
  return actorIndex >= 0 && targetIndex > actorIndex;
}

export function hasPermission(profile, permission) {
  const configuredPermissions = Array.isArray(profile.permissions)
    ? profile.permissions
    : rolePermissions[normalizeRole(profile.role)] || [];
  return configuredPermissions.includes(permission);
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

export async function authenticateRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!bearerToken) return { error: "Authentication required.", status: 401 };

  try {
    const { auth, db } = getAdminServices();
    const decodedToken = await auth.verifyIdToken(bearerToken, true);
    const profileSnapshot = await db
      .collection("users")
      .doc(decodedToken.uid)
      .get();
    if (!profileSnapshot.exists)
      return { error: "Account profile not found.", status: 403 };
    const profile = profileSnapshot.data();
    if (profile.status !== "active") {
      return {
        error:
          "Your account has been deactivated. Please contact your administrator.",
        status: 403,
      };
    }
    return {
      uid: decodedToken.uid,
      profile: { ...profile, role: normalizeRole(profile.role) },
      auth,
      db,
    };
  } catch (error) {
    const isAuthError = String(error.code || "").startsWith("auth/");
    return {
      error: isAuthError
        ? "Invalid or expired authentication token."
        : "Firebase server authorization is unavailable.",
      status: isAuthError ? 401 : 503,
    };
  }
}

export function jsonError(message, status = 400) {
  return Response.json({ error: message }, { status });
}
