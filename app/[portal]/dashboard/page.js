"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useParams, useRouter } from "next/navigation";
import { CrmWorkspace } from "../../page";
import { auth } from "@/app/lib/firebase";
import { getCurrentProfile } from "@/app/lib/crm-data";
import { normalizeRole, roleLabel, rolePermissions } from "@/app/lib/roles";

const portalRoles = {
  admin: "admin",
  "sub-admin": "sub_admin",
  "senior-technical": "senior_technical",
  "jn-technical": "jn_technical",
};

export default function DashboardPage() {
  const { portal } = useParams();
  const router = useRouter();
  const [state, setState] = useState({ status: "loading", session: null });
  const expectedRole = portalRoles[portal];

  useEffect(() => {
    if (!expectedRole) {
      router.replace("/");
      return undefined;
    }

    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const profile = await getCurrentProfile(user);
        if (profile.status !== "active") {
          setState({ status: "deactivated", session: null });
          return;
        }
        if (normalizeRole(profile.role) !== expectedRole) {
          setState({ status: "denied", session: null });
          return;
        }
        setState({
          status: "allowed",
          session: {
            uid: user.uid,
            name: profile.name,
            email: profile.email,
            role: expectedRole,
            roleLabel: roleLabel(expectedRole),
            permissions: Array.isArray(profile.permissions)
              ? profile.permissions
              : rolePermissions[expectedRole] || [],
          },
        });
      } catch {
        router.replace("/login");
      }
    });
  }, [expectedRole, router]);

  if (state.status === "deactivated") {
    return (
      <main className="access-message">
        <h1>Your account has been deactivated.</h1>
        <p>Please contact your administrator.</p>
      </main>
    );
  }
  if (state.status === "denied") {
    return (
      <main className="access-message">
        <h1>Access denied. You are not authorized to access this page.</h1>
      </main>
    );
  }
  return state.status === "allowed" ? (
    <CrmWorkspace initialSession={state.session} />
  ) : null;
}
