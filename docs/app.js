import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, onSnapshot, runTransaction, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(initializeApp({
  apiKey: "AIzaSyCORdO0x7H9MBHJzcpn-yQdnY9PIbF5crI",
  authDomain: "chaoscube-7617a.firebaseapp.com",
  projectId: "chaoscube-7617a",
  storageBucket: "chaoscube-7617a.firebasestorage.app",
  messagingSenderId: "805471643934",
  appId: "1:805471643934:web:feebc0f0190ed586f9810f"
}));
const ref = (c) => doc(db, 'rooms', c);

const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const COLORS = ['#6c3ce9','#ff8a2b','#22d3ee','#ec4899','#22c55e','#eab308','#ef4444','#3b82f6','#14b8a6','#a855f7','#f97316','#64748b'];
const MIN = 2, MAX = 12, LIVE = 25000, DROP = 60000, CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const rand = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
const me = Object.assign({ id: rand(), name: '', avatar: 0 }, store.get('cc.profile', {}));
me.id = String(me.id).replace(/[^a-zA-Z0-9]/g, '');
const prefs = Object.assign({ sound: true, vol: 60, calm: false }, store.get('cc.prefs', {}));
store.set('cc.profile', me);

let state = null, currentCode = sessionStorage.getItem('cc.room'), unsub = null, hb = null, cdTimer = null, joined = false, lastLaunch = null, lastCd = null;
const cleanName = (s) => String(s).replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16);
const isLive = (p) => Date.now() - p.seen < LIVE;

function cube(i, size) { const e = document.createElement('div'); e.className = 'cube'; e.style.setProperty('--c', COLORS[i]); e.style.setProperty('--s', size + 'px'); e.innerHTML = '<i class="eye l"></i><i class="eye r"></i><i class="mouth"></i>'; return e; }
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
function show(id) { $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id)); window.scrollTo(0, 0); }

// Sound
let ac; function beep(f = 520, d = .08) {
  if (!prefs.sound) return;
  try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f; g.gain.value = prefs.vol / 100 * .25; o.connect(g); g.connect(ac.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + d); o.stop(ac.currentTime + d); } catch {}
}
document.addEventListener('click', (e) => { if (e.target.closest('button')) beep(); });

// Profile
function paintProfile() {
  $('#chipName').textContent = me.name || 'Player'; $('#chipCube').style.setProperty('--c', COLORS[me.avatar]);
  $('#heroCube').style.setProperty('--c', COLORS[me.avatar]); $('#inName').value = me.name;
  $$('.av').forEach((a) => a.setAttribute('aria-checked', a.dataset.i == me.avatar));
}
let pick = me.avatar;
COLORS.forEach((_, i) => { const b = document.createElement('button'); b.className = 'av'; b.dataset.i = i; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', 'Cube ' + (i + 1));
  b.append(cube(i, 42)); b.onclick = () => { pick = i; $$('.av').forEach((a) => a.setAttribute('aria-checked', a.dataset.i == i)); }; $('#avatars').append(b); });
$('#saveProfile').onclick = () => {
  const n = cleanName($('#inName').value);
  if (!n) return toast('Pick a name first.');
  me.name = n; me.avatar = pick; store.set('cc.profile', me); paintProfile(); show('menu'); toast('Profile saved.');
};
function needProfile() { if (me.name) return false; show('profile'); toast('Pick a name before playing.'); return true; }

// Settings
$('#sndOn').checked = prefs.sound; $('#vol').value = prefs.vol; $('#redMotion').checked = prefs.calm; document.body.classList.toggle('calm', prefs.calm);
$('#sndOn').onchange = (e) => { prefs.sound = e.target.checked; store.set('cc.prefs', prefs); };
$('#vol').oninput = (e) => { prefs.vol = +e.target.value; store.set('cc.prefs', prefs); };
$('#vol').onchange = () => beep(660);
$('#redMotion').onchange = (e) => { prefs.calm = e.target.checked; document.body.classList.toggle('calm', prefs.calm); store.set('cc.prefs', prefs); };

// Navigation
$$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
$$('[data-lock]').forEach((b) => b.addEventListener('click', () => toast(b.dataset.lock)));
$('#heroCube').onclick = (e) => { e.currentTarget.classList.remove('wiggle'); void e.currentTarget.offsetWidth; e.currentTarget.classList.add('wiggle'); beep(780, .12); };

// Rooms (Firestore)
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const mePlayer = (joinedAt) => ({ name: me.name, avatar: me.avatar, seen: Date.now(), joined: joinedAt ?? Date.now() });

function stopListening() {
  unsub?.(); unsub = null; clearInterval(hb); clearTimeout(cdTimer); cdTimer = null;
  currentCode = null; state = null; joined = false; lastLaunch = null; lastCd = null;
  sessionStorage.removeItem('cc.room');
}
function leaveLocal() { stopListening(); $('#countdown').classList.remove('show'); show('menu'); }

function listen(code) {
  stopListening(); currentCode = code; sessionStorage.setItem('cc.room', code);
  unsub = onSnapshot(ref(code), (snap) => {
    if (!snap.exists()) { if (currentCode === code) { leaveLocal(); toast('That room was closed.'); } return; }
    state = snap.data(); onState();
  }, () => toast('Connection problem. Retrying…'));
  beat(); hb = setInterval(beat, 10000);
  show('lobby');
}
function beat() {
  if (!currentCode) return;
  updateDoc(ref(currentCode), { [`players.${me.id}.seen`]: Date.now() }).catch(() => {});
  maintain();
}
function maintain() {
  if (!state) return;
  const now = Date.now(), ps = state.players;
  const live = Object.keys(ps).filter((id) => now - ps[id].seen < LIVE).sort();
  const hostP = ps[state.host];
  if ((!hostP || now - hostP.seen >= LIVE) && live[0] === me.id) { updateDoc(ref(currentCode), { host: me.id }).catch(() => {}); return; }
  if (state.host === me.id) {
    const up = {};
    Object.keys(ps).forEach((id) => { if (id !== me.id && now - ps[id].seen > DROP) up[`players.${id}`] = deleteField(); });
    if (state.phase === 'starting' && !cdTimer) { up.phase = 'lobby'; up.cd = null; }
    if (Object.keys(up).length) updateDoc(ref(currentCode), up).catch(() => {});
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });

async function leaveRoom() {
  const code = currentCode, r = state; if (!code) return;
  stopListening();
  try {
    const others = Object.keys(r?.players || {}).filter((id) => id !== me.id);
    if (!others.length) return await deleteDoc(ref(code));
    const up = { [`players.${me.id}`]: deleteField() };
    if (r.host === me.id) up.host = others.find((id) => isLive(r.players[id])) || others[0];
    await updateDoc(ref(code), up);
  } catch {}
}

async function createRoom() {
  if (needProfile()) return;
  try {
    if (currentCode) await leaveRoom();
    let code = null;
    for (let i = 0; i < 8 && !code; i++) { const c = newCode(); if (!(await getDoc(ref(c))).exists()) code = c; }
    if (!code) throw new Error('Could not pick a room code. Try again.');
    await setDoc(ref(code), { code, host: me.id, phase: 'lobby', cd: null, launches: 0, created: Date.now(),
      settings: { mode: 'classic', rounds: 5, roundSeconds: 30, chaos: 'normal', maxPlayers: 8 }, players: { [me.id]: mePlayer() } });
    listen(code);
  } catch (e) { toast(e.message || 'Could not create the room.'); }
}
async function joinRoom(code) {
  if (needProfile()) return;
  code = String(code).toUpperCase().trim(); $('#joinErr').textContent = '';
  const fail = (m) => { $('#joinErr').textContent = m; show('join'); };
  if (!/^[A-Z0-9]{6}$/.test(code)) return fail('Room codes have 6 characters.');
  try {
    if (currentCode && currentCode !== code) await leaveRoom();
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref(code));
      if (!snap.exists()) throw new Error('No room with that code. Check it and try again.');
      const r = snap.data(), mine = r.players[me.id];
      if (!mine) {
        if (r.phase !== 'lobby') throw new Error('That game is starting. Try again in a moment.');
        if (Object.keys(r.players).length >= r.settings.maxPlayers) throw new Error('That room is full.');
      }
      tx.update(ref(code), { [`players.${me.id}`]: mePlayer(mine?.joined) });
    });
    listen(code);
  } catch (e) { fail(e.message || 'Could not join.'); }
}
$('#btnPlay').onclick = createRoom; $('#btnCreate').onclick = createRoom;
$('#inCode').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
$('#btnJoin').onclick = () => joinRoom($('#inCode').value);
$('#inCode').onkeydown = (e) => { if (e.key === 'Enter') joinRoom(e.target.value); };
$('#btnLeave').onclick = async () => { await leaveRoom(); leaveLocal(); };
$('#btnCopy').onclick = async () => {
  const link = `${location.origin}${location.pathname}?room=${currentCode}`;
  try { if (navigator.share && /Mobi/i.test(navigator.userAgent)) await navigator.share({ title: 'CHAOS CUBE', text: 'Join my room: ' + currentCode, url: link }); else { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } }
  catch { toast('Room code: ' + currentCode); }
};

// Lobby
for (let n = 2; n <= 12; n++) $('#sMax').append(new Option(n + ' players', n));
const modeName = { classic: 'Classic Chaos', competitive: 'Competitive', social: 'Social Chaos', custom: 'Custom Party' };
function send(patch) {
  if (patch.maxPlayers && patch.maxPlayers < Object.keys(state.players).length) { toast('More players than that are in the room.'); return renderLobby(); }
  updateDoc(ref(currentCode), { settings: { ...state.settings, ...patch } }).catch(() => toast('Could not save settings.'));
}
[['#sMode', 'mode', String], ['#sRounds', 'rounds', Number], ['#sSecs', 'roundSeconds', Number], ['#sChaos', 'chaos', String], ['#sMax', 'maxPlayers', Number]]
  .forEach(([sel, key, cast]) => $(sel).onchange = (e) => send({ [key]: cast(e.target.value) }));

$('#btnStart').onclick = async () => {
  if (state.host !== me.id || state.phase !== 'lobby') return;
  if (Object.values(state.players).filter(isLive).length < MIN) return toast('You need at least 2 players.');
  try { await updateDoc(ref(currentCode), { phase: 'starting', cd: 3 }); tick(2); } catch { toast('Could not start. Try again.'); }
};
function tick(n) {
  cdTimer = setTimeout(async () => {
    cdTimer = null;
    if (!state || state.host !== me.id) return;
    try {
      if (n >= 0) { await updateDoc(ref(currentCode), { cd: n }); tick(n - 1); }
      else await updateDoc(ref(currentCode), { phase: 'lobby', cd: null, launches: increment(1) });
    } catch {}
  }, 1000);
}

function onState() {
  if (!state.players[me.id]) { const was = joined; leaveLocal(); if (was) toast('The host removed you from the room.'); return; }
  joined = true;
  const l = state.launches || 0;
  if (lastLaunch === null) lastLaunch = l; else if (l > lastLaunch) { lastLaunch = l; toast('Stage 1 complete: minigames arrive in Stage 2.'); }
  const cdEl = $('#countdown');
  if (state.phase === 'starting' && state.cd != null) {
    cdEl.classList.add('show');
    if (lastCd !== state.cd) { lastCd = state.cd; const el = $('#cdNum'); el.textContent = state.cd || 'GO'; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; beep(state.cd ? 440 : 880, .15); }
  } else { cdEl.classList.remove('show'); lastCd = null; }
  renderLobby();
}
function renderLobby() {
  if (!state) return;
  const host = state.host === me.id, s = state.settings;
  const list = Object.entries(state.players).map(([id, p]) => ({ id, ...p, connected: id === me.id || isLive(p) })).sort((a, b) => a.joined - b.joined);
  $('#roomCode').textContent = state.code; $('#count').textContent = `${list.length}/${s.maxPlayers}`;
  const ul = $('#players'); ul.replaceChildren();
  list.forEach((p) => {
    const li = document.createElement('li'); if (!p.connected) li.className = 'off';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name;
    if (p.id === me.id) { const y = document.createElement('span'); y.className = 'you'; y.textContent = ' (you)'; nm.append(y); }
    li.append(cube(p.avatar, 40), nm);
    if (p.id === state.host) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'Host'; li.append(b); }
    if (!p.connected) { const b = document.createElement('span'); b.textContent = 'reconnecting…'; li.append(b); }
    if (host && p.id !== me.id) { const k = document.createElement('button'); k.className = 'kick'; k.textContent = 'Remove'; k.onclick = () => updateDoc(ref(currentCode), { [`players.${p.id}`]: deleteField() }).catch(() => {}); li.append(k); }
    ul.append(li);
  });
  $('#hostPanel').style.display = host ? '' : 'none'; $('#guestPanel').style.display = host ? 'none' : '';
  $('#sMode').value = s.mode; $('#sRounds').value = s.rounds; $('#sSecs').value = s.roundSeconds; $('#sChaos').value = s.chaos; $('#sMax').value = s.maxPlayers;
  $('#settingsText').textContent = `${modeName[s.mode]} · ${s.rounds} rounds · ${s.roundSeconds} s · chaos ${s.chaos}`;
  const ready = list.filter((p) => p.connected).length >= MIN;
  const btn = $('#btnStart'); btn.style.display = host ? '' : 'none'; btn.disabled = !ready || state.phase !== 'lobby';
  $('#startHint').textContent = host ? (ready ? '' : 'Waiting for at least one more player.') : 'Waiting for the host to start.';
}

// Boot
paintProfile();
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom) { history.replaceState(null, '', location.pathname); $('#inCode').value = qRoom.toUpperCase().slice(0, 6); if (me.name) joinRoom(qRoom); else { show('profile'); toast('Pick a name, then join with the code.'); } }
else if (currentCode) listen(currentCode);
