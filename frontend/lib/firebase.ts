import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDUvGFCLzHmGVUy24sdEqHfSRQzBDdYKEY",
  authDomain: "ethoz1970.firebaseapp.com",
  projectId: "ethoz1970",
  storageBucket: "ethoz1970.firebasestorage.app",
  messagingSenderId: "808696804946",
  appId: "1:808696804946:web:9d703f94d6899dfb1bd18b",
  measurementId: "G-GXMVS4V3QJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

export default app;
