import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCDaf3wBpDUG9AI4XlSg1ia_8CFi7BlByo",
  authDomain: "sppg-smart.firebaseapp.com",
  projectId: "sppg-smart",
  storageBucket: "sppg-smart.firebasestorage.app",
  messagingSenderId: "424347685140",
  appId: "1:424347685140:web:12ded02c32a9d8dbba7201",
  measurementId: "G-09CKXWMSFB",
};

export const app = initializeApp(firebaseConfig);
export const functions = getFunctions(app, "asia-southeast1");
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export const accountCollection = "app_users";
export const controlAdminEmail = "rahmatdev09@gmail.com";
