import { getAdminServices } from "@/app/lib/firebase-admin";

export const runtime = "nodejs";

function describeError(error) {
  const message =
    typeof error?.message === "string" ? error.message : "Unknown server error.";

  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    code: typeof error?.code === "string" ? error.code : "unknown",
    message: message
      .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED]")
      .replace(
        /"(?:private_key|password|client_secret|refresh_token|access_token)"\s*:\s*"[^"]*"/gi,
        '"[REDACTED]":"[REDACTED]"',
      )
      .replace(/\b(?:Bearer\s+)?eyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[REDACTED]"),
  };
}

export async function POST(request) {
  try {
    const { idToken } = await request.json();
    if (!idToken)
      return Response.json(
        { error: "Firebase ID token is required." },
        { status: 400 },
      );

    const { auth, db } = getAdminServices();
    const decodedToken = await auth.verifyIdToken(idToken, true);
    const profileSnapshot = await db
      .collection("users")
      .doc(decodedToken.uid)
      .get();
    if (!profileSnapshot.exists)
      return Response.json(
        { error: "Account profile not found." },
        { status: 403 },
      );

    const profile = profileSnapshot.data();
    if (profile.status !== "active") {
      return Response.json(
        {
          error:
            "Your account has been deactivated. Please contact your administrator.",
        },
        { status: 403 },
      );
    }

    const expiresIn = 5 * 24 * 60 * 60 * 1000;
    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn,
    });
    return Response.json(
      {
        uid: decodedToken.uid,
        name: profile.name,
        email: profile.email,
        role: profile.role,
      },
      {
        headers: {
          "Set-Cookie": `crm-session=${sessionCookie}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${expiresIn / 1000}`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const details = describeError(error);
    console.error("Firebase session creation failed:", details);
    const isAuthError = details.code.startsWith("auth/");
    const isRequestError = error instanceof SyntaxError;
    const isFirestoreError = [
      "5",
      "7",
      "14",
      "deadline-exceeded",
      "permission-denied",
      "unavailable",
    ].includes(details.code);
    const status = isAuthError ? 401 : isRequestError ? 400 : isFirestoreError ? 503 : 500;
    return Response.json(
      {
        error: isAuthError
          ? "Firebase authentication was rejected."
          : isRequestError
            ? "The sign-in request could not be read."
            : isFirestoreError
              ? "Firebase server authorization is unavailable. Check server credentials and Firestore access."
              : "The sign-in session could not be created because of a server error. Check the server logs.",
      },
      { status },
    );
  }
}

export async function DELETE() {
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie":
          "crm-session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
        "Cache-Control": "no-store",
      },
    },
  );
}
