// ================== server.js ==================
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = "sabkasathi_secret"; // Secret for JWT

// ===== MIDDLEWARE =====
app.use(cors()); // Enable cross-origin requests
app.use(express.json()); // Parse JSON bodies

// ===== MONGODB =====
// Use your Atlas connection string here
const MONGO_URI = "mongodb+srv://yadavupesh39_db_user:SHJAjSJTIUfPiWyk@cluster0.uapmdte.mongodb.net/sabka_sathi?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(()=>console.log("MongoDB connected ✅"))
  .catch(err=>console.error("MongoDB connection error:", err));

// ===== SCHEMA =====
const userSchema = new mongoose.Schema({
  name: {type: String, required: true},
  mobile: {type: String, required: true},
  password: {type: String, required: true},
  role: {type: String, required: true},
  extra: {type: Object, default: {}}
});

const User = mongoose.model('User', userSchema);

// ===== SIGNUP =====
app.post('/api/signup', async (req, res) => {
  try {
    const {name, mobile, password, role, ...rest} = req.body;

    if(!name || !mobile || !password || !role) {
      return res.status(400).json({success:false,message:"Missing required fields"});
    }

    const existingUser = await User.findOne({mobile, role});
    if(existingUser) return res.status(400).json({success:false,message:"User already exists"});

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      mobile,
      password: hashedPassword,
      role,
      extra: rest
    });

    await user.save();

    const token = jwt.sign({id:user._id, role}, JWT_SECRET, {expiresIn: '7d'});

    res.json({success:true, token, userId: user._id});
  } catch(err) {
    console.error(err);
    res.status(500).json({success:false, message:"Server error"});
  }
});

// ===== LOGIN =====
app.post('/api/login', async (req, res) => {
  try {
    const {mobile, password, role} = req.body;
    if(!mobile || !password || !role) {
      return res.status(400).json({success:false,message:"Missing required fields"});
    }

    const user = await User.findOne({mobile, role});
    if(!user) return res.status(404).json({success:false,message:"User not found"});

    const isMatch = await bcrypt.compare(password, user.password);
    if(!isMatch) return res.status(401).json({success:false,message:"Incorrect password"});

    const token = jwt.sign({id:user._id, role}, JWT_SECRET, {expiresIn:'7d'});
    res.json({success:true, token, userId: user._id});
  } catch(err) {
    console.error(err);
    res.status(500).json({success:false, message:"Server error"});
  }
});

// ===== GET USER PROFILE =====
app.get('/api/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if(!token) return res.status(401).json({success:false,message:"No token provided"});

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if(!user) return res.status(404).json({success:false,message:"User not found"});

    res.json({success:true, user});
  } catch(err) {
    console.error(err);
    res.status(401).json({success:false,message:"Invalid token"});
  }
});

// ===== START SERVER =====
app.listen(PORT, ()=>console.log(`Server running on port ${PORT} ✅`));
