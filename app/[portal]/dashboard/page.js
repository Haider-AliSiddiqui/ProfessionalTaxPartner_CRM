"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CrmWorkspace } from "../../page";
import { subscribeToAuthUser } from "@/app/lib/firebase";
import { getCurrentProfile } from "@/app/lib/crm-data";
import { normalizeRole, roleLabel, rolePermissions } from "@/app/lib/roles";

const portalRoles = {
  admin: "admin",
  "sub-admin": "sub_admin",
  "social-media": "social_media",
  "senior-technical": "senior_technical",
  "jn-technical": "jn_technical",
};

// The role -> session mapping is pure, so a returning visitor can render the
// workspace shell from this in-memory copy while the profile check runs in the
// background. Keeps repeat visits instant instead of showing a blank screen.
let lastSession = null;

function sessionFromProfile(uid, profile, role) {
  return {
    uid,
    name: profile.name,
    email: profile.email,
    role,
    roleLabel: roleLabel(role),
    permissions: Array.isArray(profile.permissions)
      ? profile.permissions
      : rolePermissions[role] || [],
  };
}

async function loadSession(user, expectedRole) {
  const profile = await getCurrentProfile(user);
  if (profile.status !== "active") return { status: "deactivated", session: null };
  if (normalizeRole(profile.role) !== expectedRole) return { status: "denied", session: null };
  const session = sessionFromProfile(user.uid, profile, expectedRole);
  lastSession = { uid: user.uid, role: expectedRole, session };
  return { status: "allowed", session };
}

export default function DashboardPage() {
  const { portal } = useParams();
  const router = useRouter();
  const expectedRole = portalRoles[portal];
  const [state, setState] = useState(() => {
    if (!expectedRole || !lastSession || lastSession.role !== expectedRole) {
      return { status: "loading", session: null };
    }
    return { status: "allowed", session: lastSession.session };
  });

  // State is mirrored in a ref so the auth subscription is never torn down and
  // re-created just because the status changed (which would re-trigger the
  // profile read).
  const stateRef = useRef(null);
  stateRef.current = state;

  useEffect(() => {
    if (!expectedRole) {
      router.replace("/");
      return undefined;
    }

    let cancelled = false;
    return subscribeToAuthUser(async (user) => {
      if (!user) {
        stateRef.current = { status: "loading", session: null };
        router.replace("/login");
        return;
      }
      // Re-mounting the workspace for the same account would wipe its state, so
      // a repeat event for the user already on screen is ignored.
      if (
        stateRef.current?.status === "allowed" &&
        lastSession?.uid === user.uid &&
        lastSession.role === expectedRole
      ) {
        return;
      }
      try {
        const next = await loadSession(user, expectedRole);
        stateRef.current = next;
        if (!cancelled) setState(next);
      } catch {
        if (!cancelled) router.replace("/login");
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
