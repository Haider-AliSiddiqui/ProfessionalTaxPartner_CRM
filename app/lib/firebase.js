import { getApps, initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { resetSessionCache } from "./crm-data.js";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDBY_yf9bL0_W2utjKGDP4CI2A7xPbcJDI",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    "ptp-crm-website-b9ed8.firebaseapp.com",
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ptp-crm-website-b9ed8",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    "ptp-crm-website-b9ed8.firebasestorage.app",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "766246286551",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
    "1:766246286551:web:533790adc4b860003dec92",
  measurementId:
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-9G4M6GKS79",
};

const appName = "ptp-crm-client";
const app =
  getApps().find((firebaseApp) => firebaseApp.name === appName) ||
  initializeApp(firebaseConfig, appName);
const auth = getAuth(app);
const db = getFirestore(app);

// Both the login screen and the portal dashboard used to subscribe to auth
// separately, so every navigation duplicated the queued ID-token and profile
// lookups. One shared subscription (created on the first call, reused after)
// lets a late subscriber read the already-resolved user instead of paying for
// another round-trip.
let authListener = null;
let currentAuthUser;
let authResolved = false;

function startAuthListener() {
  if (authListener) return;
  authListener = { callbacks: new Set() };
  onAuthStateChanged(auth, (user) => {
    if (user?.uid !== currentAuthUser?.uid) resetSessionCache();
    currentAuthUser = user;
    authResolved = true;
    authListener.callbacks.forEach((callback) => callback(user));
  });
}

// Mirrors onAuthStateChanged(auth, callback) but replays the current user when
// auth has already settled. Returns an unsubscribe function.
export function subscribeToAuthUser(callback) {
  startAuthListener();
  authListener.callbacks.add(callback);
  if (authResolved) callback(currentAuthUser);
  return () => authListener.callbacks.delete(callback);
}

// Sent with every password-reset email. Firebase validates that this URL's
// domain is listed under Authentication -> Settings -> Authorized domains, and
// it is where the user lands after choosing a new password. The browser-only
// origin is used in the app, with a production fallback for non-browser code.
const continueOrigin =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : `https://${firebaseConfig.authDomain}`;

export const passwordResetSettings = {
  url: `${continueOrigin}/login`,
  handleCodeInApp: false,
};

export { app, auth, db, firebaseConfig };
