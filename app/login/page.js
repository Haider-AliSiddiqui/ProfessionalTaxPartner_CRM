"use client";

import { useEffect, useState } from "react";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth } from "@/app/lib/firebase";

const portalForRole = {
  admin: "/admin/dashboard",
  sub_admin: "/sub-admin/dashboard",
  senior_technical: "/senior-technical/dashboard",
  jn_technical: "/jn-technical/dashboard",
};

function PasswordField({
  label,
  name,
  value,
  onChange,
  minLength = 8,
  required = true,
  autoComplete,
  placeholder,
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <label>
      {label}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid #dfe3ea",
          borderRadius: 10,
          background: "#fff",
          padding: "0 10px",
        }}
      >
        <input
          name={name}
          type={showPassword ? "text" : "password"}
          minLength={minLength}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            flex: 1,
            padding: "12px 0",
          }}
        />
        <button
          type="button"
          onClick={() => setShowPassword((current) => !current)}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "#374151",
            fontSize: 14,
            fontWeight: 600,
            padding: 0,
          }}
        >
          {showPassword ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [adminSignupStatus, setAdminSignupStatus] = useState("checking");
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [setupError, setSetupError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/admin-signup", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Initial Admin setup status is unavailable.",
          );
        setAdminSignupStatus(result.available ? "available" : "closed");
        setSetupError("");
      })
      .catch((requestError) => {
        setAdminSignupStatus("unavailable");
        setSetupError(requestError.message);
      });
  }, []);

  const updateField = (event) =>
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));

  async function sendPasswordReset() {
    const email = form.email.trim();
    setError("");
    setResetMessage("");
    if (!email) {
      setError("Enter your account email first, then select Forgot password.");
      return;
    }

    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetMessage("Password reset email sent. Check your inbox and spam folder.");
    } catch (resetError) {
      setError(
        resetError.code === "auth/invalid-email"
          ? "Enter a valid email address."
          : "Could not send the reset email. Check the address and Firebase email settings, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function establishSession(user) {
    const idToken = await user.getIdToken(true);
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sign-in was rejected.");
    const destination = portalForRole[result.role];
    if (!destination) throw new Error("This account has no valid CRM role.");
    router.replace(destination);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let credential;
      if (mode === "signup") {
        if (adminSignupStatus === "closed")
          throw new Error("Initial Admin signup is closed.");
        if (form.password !== form.confirmPassword)
          throw new Error("Passwords do not match.");
        const response = await fetch("/api/auth/admin-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            phone: form.phone,
            password: form.password,
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Admin account could not be created.",
          );
        credential = await signInWithEmailAndPassword(
          auth,
          form.email.trim(),
          form.password,
        );
        setAdminSignupStatus("closed");
        setMode("login");
      } else {
        credential = await signInWithEmailAndPassword(
          auth,
          form.email.trim(),
          form.password,
        );
      }
      await establishSession(credential.user);
    } catch (requestError) {
      await signOut(auth).catch(() => {});
      if (requestError.message?.toLowerCase().includes("signup is closed")) {
        setAdminSignupStatus("closed");
        setMode("login");
      }

      const code = requestError?.code || "";
      const message =
        code === "auth/invalid-credential"
          ? "Incorrect password."
          : code === "auth/user-not-found"
            ? "Incorrect email or password."
            : code === "auth/user-disabled"
              ? "Your account has been deactivated. Please contact your administrator."
              : requestError.message || "Authentication failed.";

      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const canOfferSignup = adminSignupStatus !== "closed";
  const canSignup = canOfferSignup && mode === "signup";
  return (
    <main className="auth-shell">
      <section className="auth-visual">
        <div className="auth-brand">
          <div className="brand-mark">PTP</div>
          <span>Professional Tax Partner</span>
        </div>
        <div className="auth-visual-content">
          <p className="eyebrow">Private operations workspace</p>
          <h1>
            Clarity for every
            <br />
            <em>client decision.</em>
          </h1>
          <p>Secure access for your team, clients, and tax operations.</p>
        </div>
        <div className="auth-visual-footer">
          <span>Professional Tax Partner</span>
          <span>
            <i /> Role-protected access
          </span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="mobile-auth-brand">
            <div className="brand-mark">PTP</div>
            <strong>Professional Tax Partner</strong>
          </div>
          <div className="auth-heading">
            <span className="auth-kicker">
              {canSignup ? "INITIAL ADMIN SETUP" : "TEAM ACCESS"}
            </span>
            <h2>{canSignup ? "Create Admin account" : "Welcome back"}</h2>
            <p>
              {canSignup
                ? "Set up the first administrator for this workspace."
                : "Sign in with your employee account."}
            </p>
          </div>
          {canOfferSignup && (
            <div className="auth-tabs">
              <button
                className={mode === "login" ? "active" : ""}
                type="button"
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
              >
                Login
              </button>
              <button
                className={mode === "signup" ? "active" : ""}
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
              >
                Create Initial Admin
              </button>
            </div>
          )}
          {adminSignupStatus === "unavailable" && (
            <p className="auth-error" role="status">
              Initial Admin setup status could not be verified. Check the
              server-only Firebase Admin credential setting and Firestore
              access. Signup stays visible, but account creation needs this
              server configuration. {setupError}
            </p>
          )}
          <form className="auth-form" onSubmit={submit}>
            {canSignup && (
              <label>
                Full name
                <input
                  name="name"
                  required
                  autoComplete="name"
                  value={form.name}
                  onChange={updateField}
                />
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                value={form.email}
                onChange={updateField}
              />
            </label>
            {canSignup && (
              <label>
                Phone
                <input
                  name="phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  value={form.phone}
                  onChange={updateField}
                />
              </label>
            )}
            <PasswordField
              label="Password"
              name="password"
              value={form.password}
              onChange={updateField}
              minLength={8}
              required
              autoComplete={canSignup ? "new-password" : "current-password"}
            />
            {!canSignup && (
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={sendPasswordReset}
              >
                Forgot password?
              </button>
            )}
            {resetMessage && (
              <p className="form-note" role="status">
                {resetMessage}
              </p>
            )}
            {canSignup && (
              <PasswordField
                label="Confirm password"
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={updateField}
                minLength={8}
                required
                autoComplete="new-password"
              />
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button auth-submit"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "Please wait..."
                : canSignup
                  ? "Create Initial Admin"
                  : "Sign in"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
