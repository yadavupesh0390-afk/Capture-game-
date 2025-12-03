import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import axios from "axios";
import { fileURLToPath } from "url";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);


const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(_dirname, '..', 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(_dirname, '..', 'public', 'index.html'));
});

// ---------------- Razorpay ----------------
const razor = new Razorpay({
  key_id: "rzp_live_z5X8cFJEBrqXF9",
  key_secret: "I1uUH50qsq29gPFTosFecZqP"
});

// JWT
const SECRET = "SUPERSECRETKEY";

// DB File
const DATA_FILE = path.join(_dirname, "data.json");

function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ counter: 0, users: {} }, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}


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

  // Captcha correct
  if (captchaCorrect) {
    if (milestones[counter]) {
      return { coupon: milestones[counter], reset: false };
    }
    return { coupon: 0.40, reset: false };
  }

  // Captcha wrong
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
    let db = loadDB();

    if (!db.users) db.users = {};
    if (db.users[mobile])
      return res.json({ success: false, msg: "Mobile already exists" });

    db.users[mobile] = { name, password, wallet: 0 };
    saveDB(db);

    res.json({ success: true, msg: "Signup successful" });
  } catch {
    res.json({ success: false, msg: "Signup failed" });
  }
});


// ---------------- Login ----------------
app.post("/login", (req, res) => {
  const { mobile, password } = req.body;
  let db = loadDB();

  if (!db.users[mobile] || db.users[mobile].password !== password)
    return res.json({ success: false, msg: "Invalid login" });

  const token = jwt.sign({ mobile }, SECRET);

  res.json({
    success: true,
    msg: "Login successful",
    token,
    user: { mobile, name: db.users[mobile].name }
  });
});


// ---------------- Get User (Wallet) ----------------
app.post("/get-user", auth, (req, res) => {
  let db = loadDB();
  const user = db.users[req.user.mobile];

  res.json({
    success: true,
    wallet: user.wallet,
    counter: db.counter
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
app.post('/verify', auth, async (req, res) => {
    const { orderId, paymentId, signature, captchaStatus } = req.body;

    try {
        // 1. Verify signature
        const expected_signature = crypto.createHmac("sha256", razor.key_secret)
            .update(orderId + "|" + paymentId)
            .digest("hex");

        if (expected_signature !== signature) {
            return res.json({ success: false, msg: "Invalid signature" });
        }

        // 2. Fetch payment status from Razorpay
        const payment = await razor.payments.fetch(paymentId);
        if (!payment || payment.status !== "captured") {
            return res.json({ success: false, msg: "Payment not captured" });
        }

        // 3. Update DB & apply reward
        let db = loadDB();
        db.counter = db.counter ? db.counter + 1 : 1;

        const couponResult = calculateCoupon(db.counter, captchaStatus);
        db.users[req.user.mobile].wallet += couponResult.coupon;

        if (couponResult.reset) db.counter = 0; // reset counter if milestone reached
        saveDB(db);

        res.json({
            success: true,
            msg: "Payment verified successfully",
            prize: couponResult.coupon,
            wallet: db.users[req.user.mobile].wallet
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
    let db = loadDB();
    const user = db.users[req.user.mobile];
    const amount = Number(user.wallet);

    if (Number(amount) < 10.00)
      return res.json({ success: false, msg: "Minimum withdraw ₹10.00 required" });

    if (!upi)
      return res.json({ success: false, msg: "UPI ID required" });

    // Withdraw (RazorpayX)
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
        account_number: "YOUR_RAZORPAYX_VIRTUAL_ACCOUNT",
        fund_account_id: fundAcc.data.id,
        amount: amount * 100,
        currency: "INR",
        mode: "UPI",
        purpose: "withdrawal"
      },
      { auth: { username: razor.key_id, password: razor.key_secret } }
    );

    user.wallet = 0;
    saveDB(db);

    res.json({ success: true, msg: "Withdrawal initiated!", payout_id: payout.data.id });

  } catch (err) {
    console.log(err.response?.data || err);
    res.json({ success: false, msg: "Withdrawal failed" });
  }
});


// ---------------- Start Server ----------------
app.listen(5000, () => console.log("Server running on 5000"));
