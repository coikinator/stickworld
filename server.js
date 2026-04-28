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

/* SOCKET */
io.on('connection', (socket) => {

  /* JOIN */
  socket.on('join', (data) => {
    players[socket.id] = {
      id: socket.id,
      username: data.username,

      x: 300,
      y: 300,
      tx: 300,
      ty: 300,

      anim: 0,

      coins: 0,
      lastReward: Date.now(),
      timeLeft: 600000
    };

    io.emit('players', players);
  });

  /* MOVE */
  socket.on('move', (data) => {
    if (!players[socket.id]) return;

    players[socket.id].tx = data.x;
    players[socket.id].ty = data.y;
  });

  /* CHAT */
  socket.on('chat', (data) => {
    if (!players[socket.id]) return;

    io.emit('chat', {
      id: socket.id,
      username: players[socket.id].username,
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
   GAME LOOP (PHYSICS + COINS)
========================= */
setInterval(() => {
  const now = Date.now();

  for (let id in players) {
    let p = players[id];

    if (!p) continue;

    /* smooth movement */
    p.x += (p.tx - p.x) * 0.2;
    p.y += (p.ty - p.y) * 0.2;

    /* animation tick */
    p.anim += 0.15;

    /* coin timer */
    if (!p.lastReward) p.lastReward = now;

    let timeLeft = 600000 - (now - p.lastReward);
    p.timeLeft = Math.max(0, timeLeft);

    /* reward coins */
    if (timeLeft <= 0) {
      p.coins += 50;
      p.lastReward = now;
    }
  }

  io.emit('players', players);

}, 1000 / 30);

/* START SERVER */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('StickWorld running on port ' + PORT);
});
