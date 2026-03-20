// src/firebase-config.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDkzUHzsNx5rJCE0i-bQ_g9n0-5L4cKQh4",
  authDomain: "node-red-alerts.firebaseapp.com",
  projectId: "node-red-alerts",
  storageBucket: "node-red-alerts.firebasestorage.app",
  messagingSenderId: "176963151151",
  appId: "1:176963151151:web:73ba0776a231da4154adda",
  measurementId: "G-ZLHEBBBCJN",
};

// ✅ Vite/HMR safe
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

const shouldForceLongPolling = (() => {
  if (typeof window === "undefined") {
    return !import.meta.env.DEV;
  }

  const forcedValue = window.localStorage.getItem("firestoreForceLongPolling");
  if (forcedValue === "1") return true;
  if (forcedValue === "0") return false;

  return !import.meta.env.DEV;
})();

const firestoreSettings = shouldForceLongPolling ? {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
} : {
  useFetchStreams: false,
};

export const db = initializeFirestore(app, firestoreSettings);

// ✅ IMPORTANT: pin Functions to us-central1
export const functions = getFunctions(app, "us-central1");

// Debug helper
export const FUNCTIONS_REGION = "us-central1";

if (typeof window !== "undefined") {
  window.__FIREBASE__ = { app, auth, db, functions, FUNCTIONS_REGION, firestoreSettings };
}
