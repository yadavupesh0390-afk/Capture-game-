import express from "express";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import axios from "axios";

import db from "./firebase.js";
import { ref, get, set, update } from "firebase/database";

const app = express();
app.use(express.json());
app.use(cors());

// ---------------- Razorpay ----------
const razor = new Razorpay({
  key_id: "rzp_live_z5X8cFJEBrqXF9",
  key_secret: "I1uUH50qsq29gPFTosFecZqP"
});

// JWT secret
const SECRET = "SUPERSECRETKEY";

// ---------------- AUTH MIDDLEWARE ------------
function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.json({ success: false, msg: "Login required" });

    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.json({ success: false, msg: "Invalid token" });
  }
}

// ---------------- SIGNUP ---------------------
app.post("/signup", async (req, res) => {
  const { phone, name, password } = req.body;

  const userRef = ref(db, "users/" + phone);
  const snap = await get(userRef);

  if (snap.exists()) {
    return res.json({ success: false, msg: "Mobile already exists" });
  }

  await set(userRef, {
    name,
    password,
    wallet: 0
  });

  res.json({ success: true, msg: "Signup successful" });
});

// ---------------- LOGIN ---------------------
app.post("/login", async (req, res) => {
  const { phone, password } = req.body;

  const userRef = ref(db, "users/" + phone);
  const snap = await get(userRef);

  if (!snap.exists()) {
    return res.json({ success: false, msg: "User not found" });
  }

  const user = snap.val();

  if (user.password !== password) {
    return res.json({ success: false, msg: "Wrong password" });
  }

  const token = jwt.sign({ phone }, SECRET);

  res.json({
    success: true,
    msg: "Login successful",
    token,
    user: { phone, name: user.name }
  });
});

// ---------------- USER DATA -----------------
app.post("/get-user", auth, async (req, res) => {
  const phone = req.user.phone;

  const userRef = ref(db, "users/" + phone);
  const snap = await get(userRef);

  const counterRef = ref(db, "counter");
  const counterSnap = await get(counterRef);

  res.json({
    success: true,
    wallet: snap.val().wallet,
    counter: counterSnap.exists() ? counterSnap.val() : 0
  });
});

// ---------------- PAY ₹1 ---------------------
app.post("/pay1", auth, async (req, res) => {
  const order = await razor.orders.create({
    amount: 100,
    currency: "INR",
    receipt: "order_" + Date.now(),
  });

  res.json({
    success: true,
    key: razor.key_id,
    id: order.id,
    amount: order.amount
  });
});

// ---------------- VERIFY PAYMENT ------------
app.post("/verify", auth, async (req, res) => {
  const { orderId, paymentId, signature, captchaStatus } = req.body;
  const phone = req.user.phone;

  const expected_signature = crypto
    .createHmac("sha256", razor.key_secret)
    .update(orderId + "|" + paymentId)
    .digest("hex");

  if (expected_signature !== signature) {
    return res.json({ success: false, msg: "Invalid signature" });
  }

  const payment = await razor.payments.fetch(paymentId);
  if (payment.status !== "captured") {
    return res.json({ success: false, msg: "Payment not captured" });
  }

  // Fetch counter
  const counterRef = ref(db, "counter");
  const counterSnap = await get(counterRef);
  let counter = counterSnap.exists() ? counterSnap.val() : 0;
  counter++;

  // Reward logic
  let reward = captchaStatus ? 0.40 : 0.30;

  // Save counter
  await set(counterRef, counter);

  // Update wallet
  const userRef = ref(db, "users/" + phone);
  const snap = await get(userRef);
  const wallet = snap.val().wallet + reward;

  await update(userRef, { wallet });

  res.json({
    success: true,
    prize: reward,
    wallet
  });
});

// ---------------- START SERVER -------------
app.listen(5000, () => {
  console.log("Backend running on port 5000");
});
