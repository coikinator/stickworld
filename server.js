const express   = require('express');
const http      = require('http');
const socketio  = require('socket.io');
const mongoose  = require('mongoose');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const path      = require('path');

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1499530365843276026/DcT78M9BRoCxWt2eKSO7Wsyo05sB9cQX_r7nri97NsgxedGyRRbxGr5UFQhZFU35Be-3";

const app    = express();
const server = http.createServer(app);
const io     = socketio(server);

const JWT_SECRET = 'stickworld_secret_key_2024';
const MONGO_URI  = process.env.MONGO_URI;

mongoose.connect(MONGO_URI);

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});
const User = mongoose.model('User', UserSchema);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── AUTH
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

app.get('/api/updates', async (req, res) => {
  const logs = [];
  let i = 1;
  while (true) {
    try {
      const r = await fetch(`https://stickworld.neocities.org/updates/${i}.json`);
      if (!r.ok) break;
      const data = await r.json();
      data._num = i;
      logs.push(data);
      i++;
    } catch(e) { break; }
  }
  res.json(logs);
});

app.get('/api/emojis', async (req, res) => {
  try {
    const r = await fetch('https://stickworld.neocities.org/emojis/emojis.json');
    const list = await r.json();
    res.json(list);
  } catch(e) {
    res.json([]);
  }
});

// ── SESSION CHECK
// Map: username -> socketId (who is currently in game)
const activeSessions = {};

app.get('/api/check-session', (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { username } = jwt.verify(token, JWT_SECRET);
    const alreadyInGame = !!(activeSessions[username]);
    res.json({ alreadyInGame });
  } catch(e) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

app.post('/api/kick-session', (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { username } = jwt.verify(token, JWT_SECRET);
    const oldSocketId = activeSessions[username];
    if (oldSocketId) {
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) oldSocket.emit('kicked');
      delete activeSessions[username];
      delete players[oldSocketId];
      io.emit('players', players);
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// ── GAME
const players = {};
const GROUND   = 500;
const GRAVITY  = 0.7;
const FRICTION = 0.82;
const MOVE_SPEED = 7;
const JUMP_FORCE = -15;

io.on('connection', (socket) => {

  socket.on('join', (data) => {
    activeSessions[data.username] = socket.id;

    players[socket.id] = {
      id: socket.id,
      username: data.username,
      x: 200 + Math.random() * 400,
      y: GROUND,
      vx: 0, vy: 0,
      onGround: true,
      anim: 0, facing: 1, moving: false,
      coins: 0,
      lastReward: Date.now(),
      timeLeft: 600000
    };
    io.emit('players', players);
  });

  socket.on('input', (data) => {
    const p = players[socket.id];
    if (!p) return;
    if (data.left)  { p.vx -= MOVE_SPEED; p.facing = -1; }
    if (data.right) { p.vx += MOVE_SPEED; p.facing =  1; }
    if (data.jump && p.onGround) { p.vy = JUMP_FORCE; p.onGround = false; }
  });

socket.on('chat', (data) => {
  const p = players[socket.id];
  if (!p) return;

  io.emit('chat', {
    id: socket.id,
    username: p.username,
    text: data.text || '',
    emoji: data.emoji || null
  });
});

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p && activeSessions[p.username] === socket.id) {
      delete activeSessions[p.username];
    }
    delete players[socket.id];
    io.emit('players', players);
  });
});

// ── GAME LOOP 60fps
setInterval(() => {
  const now = Date.now();
  for (let id in players) {
    const p = players[id];
    p.vx *= FRICTION;
    if (Math.abs(p.vx) < 0.1) p.vx = 0;
    p.vy += GRAVITY;
    p.x += p.vx;
    p.y += p.vy;
    if (p.y >= GROUND) { p.y = GROUND; p.vy = 0; p.onGround = true; }
    if (p.x < 20)    { p.x = 20;    p.vx = 0; }
    if (p.x > 2000)  { p.x = 2000;  p.vx = 0; }
    if (Math.abs(p.vx) > 0.5) p.anim += 0.18 * Math.abs(p.vx) / MOVE_SPEED;
    else p.anim += 0.04;
    const timeLeft = 600000 - (now - p.lastReward);
    p.timeLeft = Math.max(0, timeLeft);
    if (timeLeft <= 0) { p.coins += 50; p.lastReward = now; }
  }
  io.emit('players', players);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('StickWorld on port ' + PORT));
