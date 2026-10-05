import {
  getAdminServices,
  normalizePhone,
  rolePermissions,
} from "@/app/lib/firebase-admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { db } = getAdminServices();
    const bootstrapSnapshot = await db
      .collection("system")
      .doc("bootstrap")
      .get();
    const existingAdmins = await db
      .collection("users")
      .where("role", "==", "admin")
      .limit(1)
      .get();
    const available =
      existingAdmins.empty &&
      (!bootstrapSnapshot.exists ||
        bootstrapSnapshot.data().status === "uninitialized");
    return Response.json(
      { available },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "Firebase Admin setup check failed. Verify server credentials and Firestore access.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request) {
  let createdUid = null;
  let reserved = false;
  let auth;
  let db;
  let FieldValue;
  let bootstrapRef;

  try {
    ({ auth, db, FieldValue } = getAdminServices());
    bootstrapRef = db.collection("system").doc("bootstrap");
    const { name, email, phone, password } = await request.json();
    if (
      !name?.trim() ||
      !email?.trim() ||
      !phone?.trim() ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return Response.json(
        {
          error:
            "Enter your name, email, phone, and a password of at least 8 characters.",
        },
        { status: 400 },
      );
    }
    const phoneNumber = normalizePhone(phone);

    await db.runTransaction(async (transaction) => {
      const bootstrapSnapshot = await transaction.get(bootstrapRef);
      const existingAdmins = await transaction.get(
        db.collection("users").where("role", "==", "admin").limit(1),
      );
      if (
        !existingAdmins.empty ||
        (bootstrapSnapshot.exists &&
          bootstrapSnapshot.data().status !== "uninitialized")
      ) {
        throw new Error(
          "Admin signup is closed. Ask an administrator to create your account.",
        );
      }
      transaction.set(bootstrapRef, {
        status: "provisioning",
        startedAt: FieldValue.serverTimestamp(),
      });
    });
    reserved = true;

    const user = await auth.createUser({
      displayName: name.trim(),
      email: email.trim().toLowerCase(),
      phoneNumber,
      password,
      disabled: false,
    });
    createdUid = user.uid;

    await db.collection("users").doc(user.uid).set({
      uid: user.uid,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phoneNumber,
      role: "admin",
      status: "active",
      createdBy: null,
      createdAt: FieldValue.serverTimestamp(),
      permissions: rolePermissions.admin,
    });
    await bootstrapRef.set({
      status: "initialized",
      adminUid: user.uid,
      initializedAt: FieldValue.serverTimestamp(),
    });

    return Response.json({ uid: user.uid }, { status: 201 });
  } catch (error) {
    if (createdUid) await auth?.deleteUser(createdUid).catch(() => {});
    if (reserved) await bootstrapRef?.delete().catch(() => {});
    const status =
      error.code === "auth/email-already-exists"
        ? 409
        : error.message.includes("signup is closed")
          ? 403
          : 400;
    const configurationError =
      !auth ||
      error.message.includes("FIREBASE_SERVICE_ACCOUNT_JSON") ||
      error.message.includes("GOOGLE_APPLICATION_CREDENTIALS");
    return Response.json(
      {
        error: configurationError
          ? "Firebase server configuration is unavailable."
          : error.message || "Could not create the initial Admin account.",
      },
      { status: configurationError ? 503 : status },
    );
  }
}
