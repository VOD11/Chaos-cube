// CHAOS CUBE – Stage 1 server: rooms, lobby, reconnects. Server is the source of truth.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || '*' } });

const MAX_PLAYERS = 12, MIN_PLAYERS = 2, GRACE_MS = 30000, AVATARS = 12;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I)
const rooms = new Map(); // code -> room

const clean = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16);
const avatarOk = (a) => Number.isInteger(a) && a >= 0 && a < AVATARS;
const newCode = () => {
  let c;
  do { c = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(c));
  return c;
};
const defaults = () => ({ mode: 'classic', rounds: 5, roundSeconds: 30, chaos: 'normal', maxPlayers: 8 });
const MODES = ['classic', 'competitive', 'social', 'custom'];
const CHAOS = ['off', 'low', 'normal', 'high'];

const publicRoom = (r) => ({
  code: r.code, phase: r.phase, host: r.host, settings: r.settings,
  players: [...r.players.values()].map(({ id, name, avatar, connected }) => ({ id, name, avatar, connected })),
});
const push = (r) => io.to(r.code).emit('room:state', publicRoom(r));

function removePlayer(r, id) {
  const p = r.players.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  r.players.delete(id);
  if (r.players.size === 0) { clearTimeout(r.countdown); rooms.delete(r.code); return; }
  if (r.host === id) {
    const next = [...r.players.values()].find((x) => x.connected) || [...r.players.values()][0];
    r.host = next.id;
  }
  if (r.phase === 'starting' && r.players.size < MIN_PLAYERS) cancelStart(r);
  push(r);
}
function cancelStart(r) { clearTimeout(r.countdown); r.phase = 'lobby'; io.to(r.code).emit('room:cancelled'); }

io.on('connection', (socket) => {
  let ctx = null; // { code, id }
  const room = () => (ctx ? rooms.get(ctx.code) : null);
  const fail = (ack, error) => typeof ack === 'function' && ack({ ok: false, error });

  function enter(r, p) {
    clearTimeout(p.timer);
    p.socketId = socket.id; p.connected = true;
    ctx = { code: r.code, id: p.id };
    socket.join(r.code);
    push(r);
  }

  socket.on('room:create', ({ id, name, avatar } = {}, ack) => {
    name = clean(name);
    if (!name || !avatarOk(avatar) || typeof id !== 'string' || id.length < 8 || id.length > 64) return fail(ack, 'Enter a name and pick a cube.');
    if (room()) removePlayer(room(), ctx.id);
    const r = { code: newCode(), phase: 'lobby', host: id, settings: defaults(), players: new Map() };
    const p = { id, name, avatar };
    r.players.set(id, p); rooms.set(r.code, r);
    enter(r, p);
    ack?.({ ok: true, code: r.code, you: id });
  });

  socket.on('room:join', ({ id, code, name, avatar } = {}, ack) => {
    code = String(code ?? '').toUpperCase().trim(); name = clean(name);
    if (!/^[A-Z0-9]{6}$/.test(code)) return fail(ack, 'Room codes have 6 characters.');
    if (!name || !avatarOk(avatar) || typeof id !== 'string' || id.length < 8 || id.length > 64) return fail(ack, 'Enter a name and pick a cube.');
    const r = rooms.get(code);
    if (!r) return fail(ack, 'No room with that code. Check it and try again.');
    const existing = r.players.get(id);
    if (!existing) {
      if (r.phase !== 'lobby') return fail(ack, 'That game already started. Ask the host to open a new room.');
      if (r.players.size >= Math.min(MAX_PLAYERS, r.settings.maxPlayers)) return fail(ack, 'That room is full.');
    }
    if (room() && ctx.code !== code) removePlayer(room(), ctx.id);
    const p = existing || { id, name, avatar };
    p.name = name; p.avatar = avatar;
    r.players.set(id, p);
    enter(r, p);
    ack?.({ ok: true, code, you: id });
  });

  // Reconnect after a dropped connection or page refresh.
  socket.on('session:resume', ({ id, code } = {}, ack) => {
    const r = rooms.get(String(code ?? '').toUpperCase());
    const p = r?.players.get(id);
    if (!p) return fail(ack, 'Room no longer exists.');
    enter(r, p);
    ack?.({ ok: true, code: r.code, you: id });
  });

  socket.on('room:settings', (s = {}, ack) => {
    const r = room();
    if (!r || r.host !== ctx.id || r.phase !== 'lobby') return fail(ack, 'Only the host can change settings.');
    const n = { ...r.settings };
    if (MODES.includes(s.mode)) n.mode = s.mode;
    if (CHAOS.includes(s.chaos)) n.chaos = s.chaos;
    if ([3, 5, 7, 10].includes(s.rounds)) n.rounds = s.rounds;
    if ([15, 30, 45, 60].includes(s.roundSeconds)) n.roundSeconds = s.roundSeconds;
    if (Number.isInteger(s.maxPlayers) && s.maxPlayers >= MIN_PLAYERS && s.maxPlayers <= MAX_PLAYERS && s.maxPlayers >= r.players.size) n.maxPlayers = s.maxPlayers;
    r.settings = n; push(r); ack?.({ ok: true });
  });

  socket.on('room:start', (_, ack) => {
    const r = room();
    if (!r || r.host !== ctx.id) return fail(ack, 'Only the host can start.');
    if (r.phase !== 'lobby') return fail(ack, 'Already starting.');
    if ([...r.players.values()].filter((p) => p.connected).length < MIN_PLAYERS) return fail(ack, 'You need at least 2 players.');
    r.phase = 'starting'; push(r);
    let n = 3;
    const tick = () => {
      io.to(r.code).emit('room:countdown', n);
      if (n-- > 0) r.countdown = setTimeout(tick, 1000);
      else { r.phase = 'lobby'; push(r); io.to(r.code).emit('room:started'); } // Stage 2 launches the first minigame here
    };
    tick(); ack?.({ ok: true });
  });

  socket.on('room:kick', ({ id } = {}) => {
    const r = room();
    if (!r || r.host !== ctx.id || id === ctx.id) return;
    const p = r.players.get(id);
    if (!p) return;
    io.to(p.socketId).emit('room:kicked');
    io.sockets.sockets.get(p.socketId)?.leave(r.code);
    removePlayer(r, id);
  });

  socket.on('room:leave', () => {
    const r = room();
    if (r) { socket.leave(r.code); removePlayer(r, ctx.id); }
    ctx = null;
  });

  socket.on('disconnect', () => {
    const r = room();
    if (!r) return;
    const p = r.players.get(ctx.id);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false; push(r);
    p.timer = setTimeout(() => removePlayer(r, p.id), GRACE_MS);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`CHAOS CUBE server on :${PORT}`));
