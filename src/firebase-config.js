// src/firebase-config.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// You can get this from your Firebase project settings.
const firebaseConfig = {
  apiKey: "AIzaSyDkzUHzsNx5rJCE0i-bQ_g9n0-5L4cKQh4",
  authDomain: "node-red-alerts.firebaseapp.com",
  projectId: "node-red-alerts",
  storageBucket: "node-red-alerts.firebasestorage.app",
  messagingSenderId: "176963151151",
  appId: "1:176963151151:web:73ba0776a231da4154adda",
  measurementId: "G-ZLHEBBBCJN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);