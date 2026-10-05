import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth"; // for authentication
import { getFirestore } from "firebase/firestore"; // for firestore database
import { getAnalytics } from "firebase/analytics"; // for analytics
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDBY_yf9bL0_W2utjKGDP4CI2A7xPbcJDI",
  authDomain: "ptp-crm-website-b9ed8.firebaseapp.com",
  projectId: "ptp-crm-website-b9ed8",
  storageBucket: "ptp-crm-website-b9ed8.firebasestorage.app",
  messagingSenderId: "766246286551",
  appId: "1:766246286551:web:533790adc4b860003dec92",
  measurementId: "G-9G4M6GKS79",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

//Authentication
const auth = getAuth(app);

//Firebase Database
const db = getFirestore(app);
const analytics = typeof window === "undefined" ? null : getAnalytics(app);

export { app, auth, db, analytics };
