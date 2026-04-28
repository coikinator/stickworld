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

mongoose.connect(MONGO_URI);

/* USER */
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});
const User = mongoose.model('User', UserSchema);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* AUTH */
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);

    await new User({ username, password: hashed }).save();

    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token, username });
  } catch {
    res.status(400).json({ error: 'Username already taken' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: 'User not found' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Wrong password' });

  const token = jwt.sign({ username }, JWT_SECRET);
  res.json({ token, username });
});

/* GAME STATE */
const players = {};

io.on('connection', (socket) => {

  socket.on('join', (data) => {

    /* IMPORTANT FIX: no fake reset values */
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

      /* REAL TIMER BASE (NO RESET BUG) */
      lastReward: players[socket.id]?.lastReward || Date.now()
    };

    io.emit('players', players);
  });

  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p) return;
    if (typeof data.x === "number") p.tx = data.x;
  });

  socket.on('jump', () => {
    const p = players[socket.id];
    if (!p) return;

    if (p.onGround) {
      p.vy = -12;
      p.onGround = false;
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('players', players);
  });
});

/* GAME LOOP */
setInterval(() => {

  const now = Date.now();
  const ground = 500;

  for (let id in players) {
    const p = players[id];
    if (!p) continue;

    /* movement smoothing */
    p.x += (p.tx - p.x) * 0.25;

    /* gravity */
    p.vy += 0.6;
    p.y += p.vy;

    if (p.y >= ground) {
      p.y = ground;
      p.vy = 0;
      p.onGround = true;
    }

    p.anim += 0.2;

    /* COIN TIMER FIX (NO RESET AFTER RELOAD LOGIC) */
    const elapsed = now - p.lastReward;

    if (elapsed >= 600000) {
      p.coins += 50;
      p.lastReward = now;
    }

    p.timeLeft = Math.max(0, 600000 - elapsed);
  }

  io.emit('players', players);

}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("StickWorld running"));
