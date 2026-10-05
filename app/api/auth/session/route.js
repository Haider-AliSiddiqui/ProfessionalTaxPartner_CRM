import { getAdminServices } from "@/app/lib/firebase-admin";

export const runtime = "nodejs";

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
    const isAuthError = String(error.code || "").startsWith("auth/");
    return Response.json(
      {
        error: isAuthError
          ? "Firebase authentication was rejected."
          : "Firebase server authorization is unavailable.",
      },
      { status: isAuthError ? 401 : 503 },
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
