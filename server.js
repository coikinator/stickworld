const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const JWT_SECRET = 'stickworld_secret_key_2024';
const MONGO_URI = process.env.MONGO_URI;

/* DB */
mongoose.connect(MONGO_URI);

/* USER MODEL */
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});
const User = mongoose.model('User', UserSchema);

/* STATIC */
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* REGISTER */
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);

    const user = new User({ username, password: hashed });
    await user.save();

    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token, username });

  } catch (e) {
    res.status(400).json({ error: 'Username already taken' });
  }
});

/* LOGIN */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Wrong password' });

    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token, username });

  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* =========================
   GAME STATE
========================= */
const players = {};

/* =========================
   SOCKET
========================= */
io.on('connection', (socket) => {

  /* JOIN (FIXED SPAWN + SAFE INIT) */
  socket.on('join', (data) => {

    players[socket.id] = {
      id: socket.id,
      username: data.username,

      x: 300,
      y: 500,
      tx: 300,

      vy: 0,
      onGround: true,

      anim: 0,

      coins: 0,

      lastReward: Date.now(),
      timeLeft: 600000
    };

    io.emit('players', players);
  });

  /* MOVE (ONLY X CONTROL) */
  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p) return;

    if (typeof data.x === "number") {
      p.tx = data.x;
    }
  });

  /* JUMP */
  socket.on('jump', () => {
    const p = players[socket.id];
    if (!p) return;

    if (p.onGround) {
      p.vy = -12;
      p.onGround = false;
    }
  });

  /* CHAT */
  socket.on('chat', (data) => {
    const p = players[socket.id];
    if (!p) return;

    io.emit('chat', {
      id: socket.id,
      username: p.username,
      text: data.text
    });
  });

  /* DISCONNECT */
  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('players', players);
  });
});

/* =========================
   GAME LOOP (FIXED PHYSICS + TIMER + COINS)
========================= */
setInterval(() => {

  const now = Date.now();
  const ground = 500;

  for (let id in players) {
    const p = players[id];
    if (!p) continue;

    /* SMOOTH MOVEMENT */
    p.x += (p.tx - p.x) * 0.25;

    /* GRAVITY */
    p.vy += 0.6;
    p.y += p.vy;

    /* GROUND FIX */
    if (p.y >= ground) {
      p.y = ground;
      p.vy = 0;
      p.onGround = true;
    }

    /* ANIMATION */
    p.anim += 0.2;

    /* TIMER FIX (NO RESET BUG) */
    if (!p.lastReward) p.lastReward = now;

    const timeLeft = 600000 - (now - p.lastReward);
    p.timeLeft = Math.max(0, timeLeft);

    /* COINS */
    if (timeLeft <= 0) {
      p.coins += 50;
      p.lastReward = now;
    }
  }

  io.emit('players', players);

}, 1000 / 30);

/* START */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('StickWorld running on port ' + PORT);
});
