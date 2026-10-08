import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
