import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminServices, normalizeRole, roleLabel, rolePermissions } from "@/app/lib/firebase-admin";
import { CrmWorkspace } from "../../page";

export const dynamic = "force-dynamic";

const portalRoles = {
  admin: "admin",
  "sub-admin": "sub_admin",
  "senior-technical": "senior_technical",
  "jn-technical": "jn_technical",
};

export default async function DashboardPage({ params }) {
  const { portal } = await params;
  const expectedRole = portalRoles[portal];
  if (!expectedRole) redirect("/");

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("crm-session")?.value;
  if (!sessionCookie) redirect("/");

  let session;
  let accessState = "allowed";
  try {
    const { auth, db } = getAdminServices();
    const decoded = await auth.verifySessionCookie(sessionCookie, true);
    const profileSnapshot = await db.collection("users").doc(decoded.uid).get();
    if (!profileSnapshot.exists) redirect("/");
    const profile = profileSnapshot.data();
    const role = normalizeRole(profile.role);
    if (profile.status !== "active") accessState = "deactivated";
    else if (role !== expectedRole) accessState = "denied";
    else session = { uid: decoded.uid, name: profile.name, email: profile.email, role, roleLabel: roleLabel(role), permissions: Array.isArray(profile.permissions) ? profile.permissions : rolePermissions[role] || [] };
  } catch {
    redirect("/");
  }

  if (accessState === "deactivated") return <main className="access-message"><h1>Your account has been deactivated.</h1><p>Please contact your administrator.</p></main>;
  if (accessState === "denied") return <main className="access-message"><h1>Access denied. You are not authorized to access this page.</h1></main>;
  return <CrmWorkspace initialSession={session} />;
}
