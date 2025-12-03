import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCJbmgvBuJ-PP2U9kf_hJQ-rMWtAd551sA",
  authDomain: "game-bbdc6.firebaseapp.com",
  databaseURL: "https://game-bbdc6-default-rtdb.firebaseio.com",
  projectId: "game-bbdc6",
  storageBucket: "game-bbdc6.firebasestorage.app",
  messagingSenderId: "390252047078",
  appId: "1:390252047078:web:bf415ec022efd738d06927",
  measurementId: "G-NZWFJDTLHB"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export default db;

