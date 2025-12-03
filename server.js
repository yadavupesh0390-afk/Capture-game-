import express from "express";
import path from "path";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import axios from "axios";
import { fileURLToPath } from "url";

import db from "./firebase.js";
import { ref, get, set, update } from "firebase/database";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(_dirname, "..", "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(_dirname, "..", "public", "index.html"));
});

// ---------------- Razorpay ----------------
const razor = new Razorpay({
  key_id: "rzp_live_z5X8cFJEBrqXF9",
  key_secret: "I1uUH50qsq29gPFTosFecZqP"
});

// JWT
const SECRET = "SUPERSECRETKEY";

// ---------------- Coupon Logic ----------------
function calculateCoupon(counter, captchaCorrect) {
  if (counter >= 100000000) {
    return { coupon: 0, reset: true };
  }

  const milestones = {
    100: 10,
    1000: 100,
    10000: 1000,
    100000: 10000,
    1000000: 100000,
    10000000: 350000
  };

  if (captchaCorrect) {
    if (milestones[counter]) return { coupon: milestones[counter], reset: false };
    return { coupon: 0.40, reset: false };
  }

  return { coupon: 0.30, reset: false };
}

// ---------------- Middleware ----------------
function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.json({ success: false, msg: "Login required" });

    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.json({ success: false, msg: "Invalid token" });
  }
}

// ---------------- Signup ----------------
app.post("/signup", async (req, res) => {
  try {
    const { name, mobile, password } = req.body;

    const userRef = ref(db, "users/" + mobile);
    const snap = await get(userRef);

    if (snap.exists())
      return res.json({ success: false, msg: "Mobile already exists" });

    await set(userRef, { name, password, wallet: 0 });

    res.json({ success: true, msg: "Signup successful" });
  } catch (err) {
    res.json({ success: false, msg: "Signup failed" });
  }
});

// ---------------- Login ----------------
app.post("/login", async (req, res) => {
  const { mobile, password } = req.body;

  const userRef = ref(db, "users/" + mobile);
  const snap = await get(userRef);

  if (!snap.exists()) return res.json({ success: false, msg: "Invalid login" });

  const user = snap.val();

  if (user.password !== password)
    return res.json({ success: false, msg: "Invalid login" });

  const token = jwt.sign({ mobile }, SECRET);

  res.json({
    success: true,
    msg: "Login successful",
    token,
    user: { mobile, name: user.name }
  });
});

// ---------------- Get User (Wallet) ----------------
app.post("/get-user", auth, async (req, res) => {
  const userRef = ref(db, "users/" + req.user.mobile);
  const userSnap = await get(userRef);

  const counterSnap = await get(ref(db, "counter"));
  const counter = counterSnap.exists() ? counterSnap.val() : 0;

  res.json({
    success: true,
    wallet: userSnap.val().wallet,
    counter
  });
});

// ---------------- PAY ₹1 ----------------
app.post("/pay1", auth, async (req, res) => {
  try {
    const order = await razor.orders.create({
      amount: 100,
      currency: "INR",
      receipt: "order_" + Date.now()
    });

    res.json({
      success: true,
      key: razor.key_id,
      id: order.id,
      amount: order.amount
    });
  } catch (err) {
    console.error("Pay1 Error:", err);
    res.json({ success: false, msg: "Order creation failed" });
  }
});

// ---------------- Captcha Page ----------------
app.get("/after-payment", (req, res) => {
  res.sendFile(path.join(_dirname, "..", "public", "captcha.html"));
});

// ---------------- VERIFY PAYMENT + CAPTCHA + REWARD ----------------
app.post("/verify", auth, async (req, res) => {
  const { orderId, paymentId, signature, captchaStatus } = req.body;

  try {
    const expected_signature = crypto
      .createHmac("sha256", razor.key_secret)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    if (expected_signature !== signature)
      return res.json({ success: false, msg: "Invalid signature" });

    const payment = await razor.payments.fetch(paymentId);
    if (!payment || payment.status !== "captured")
      return res.json({ success: false, msg: "Payment not captured" });

    // Counter update
    let counterSnap = await get(ref(db, "counter"));
    let counter = counterSnap.exists() ? counterSnap.val() + 1 : 1;

    const coupon = calculateCoupon(counter, captchaStatus);

    const userRef = ref(db, "users/" + req.user.mobile);
    const userSnap = await get(userRef);

    const newWallet = userSnap.val().wallet + coupon.coupon;

    await update(userRef, { wallet: newWallet });
    await set(ref(db, "counter"), counter);

    res.json({
      success: true,
      msg: "Payment verified successfully",
      prize: coupon.coupon,
      wallet: newWallet
    });
  } catch (err) {
    console.error("Verify Error:", err);
    res.json({ success: false, msg: "Server error verifying payment" });
  }
});

// ---------------- Withdraw ----------------
app.post("/withdraw", auth, async (req, res) => {
  try {
    const { upi } = req.body;

    const userRef = ref(db, "users/" + req.user.mobile);
    const userSnap = await get(userRef);

    const user = userSnap.val();
    const amount = user.wallet;

    if (amount < 10.0)
      return res.json({ success: false, msg: "Minimum withdraw ₹0.80 required" });

    if (!upi)
      return res.json({ success: false, msg: "UPI ID required" });

    // RazorpayX process
    const contact = await axios.post(
      "https://api.razorpay.com/v1/contacts",
      {
        name: user.name,
        email: req.user.mobile + "@example.com",
        contact: req.user.mobile,
        type: "customer"
      },
      { auth: { username: razor.key_id, password: razor.key_secret } }
    );

    const fundAcc = await axios.post(
      "https://api.razorpay.com/v1/fund_accounts",
      {
        contact_id: contact.data.id,
        account_type: "vpa",
        vpa: { address: upi }
      },
      { auth: { username: razor.key_id, password: razor.key_secret } }
    );

    const payout = await axios.post(
      "https://api.razorpay.com/v1/payouts",
      {
        account_number: "12345678901234",
        fund_account_id: fundAcc.data.id,
        amount: amount * 100,
        currency: "INR",
        mode: "UPI",
        purpose: "withdrawal"
      },
      { auth: { username: razor.key_id, password: razor.key_secret } }
    );

    await update(userRef, { wallet: 0 });

    res.json({
      success: true,
      msg: "Withdrawal initiated!",
      payout_id: payout.data.id
    });
  } catch (err) {
    console.log(err.response?.data || err);
    res.json({ success: false, msg: "Withdrawal failed" });
  }
});

// ---------------- Start Server ----------------
app.listen(5000, () => console.log("Server running on 5000"));
