import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import helmet from 'helmet';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import path from 'path';
import db from './db.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: 'lax', httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }
  })
);

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = await bcrypt.hash(
  process.env.ADMIN_PASSWORD || 'changeMe',
  10
);

const isAuthed = (req, _res, next) => {
  req.session.isAuthed ? next() : next('route');
};

const hashToken = (t) =>
  crypto.createHash('sha256').update(t, 'utf8').digest('hex');

// Helpers
function getEventWithCounts(id) {
  const ev = db.prepare(
    `SELECT e.*,
      (SELECT COUNT(*) FROM signups s WHERE s.event_id = e.id) AS count
     FROM events e WHERE e.id = ?`
  ).get(id);
  if (!ev) return null;
  const positions = db.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM signups s WHERE s.position_id = p.id) AS count
     FROM positions p WHERE p.event_id = ? ORDER BY p.id`
  ).all(id);
  ev.positions = positions;
  return ev;
}

// --- AUTH ---
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USERNAME) return res.status(401).json({ ok: false });
  const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!ok) return res.status(401).json({ ok: false });
  req.session.isAuthed = true;
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  res.json({ isAuthed: !!req.session.isAuthed });
});

// --- PUBLIC EVENTS ---
app.get('/api/events', (_req, res) => {
  const events = db.prepare(
    `SELECT e.*,
      (SELECT COUNT(*) FROM signups s WHERE s.event_id = e.id) AS count
     FROM events e ORDER BY datetime(e.starts_at)`
  ).all();
  const positionsByEvent = db.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM signups s WHERE s.position_id = p.id) AS count
     FROM positions p WHERE p.event_id = ? ORDER BY p.id`
  );
  for (const ev of events) {
    ev.positions = positionsByEvent.all(ev.id);
  }
  res.json(events);
});

app.get('/api/events/:id', (req, res) => {
  const ev = getEventWithCounts(Number(req.params.id));
  if (!ev) return res.sendStatus(404);
  res.json(ev);
});

// --- PUBLIC SIGNUP / SELF-REMOVE ---
app.post('/api/events/:id/signup', (req, res) => {
  const id = Number(req.params.id);
  const { name, email, phone, position_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) return res.sendStatus(404);

  // If positions exist for the event, a valid position is required.
  const positions = db.prepare('SELECT * FROM positions WHERE event_id = ?').all(id);
  if (positions.length > 0) {
    const pos = positions.find(p => p.id === Number(position_id));
    if (!pos) return res.status(400).json({ error: 'Position is required' });
    // Capacity per-position
    const posCount = db.prepare('SELECT COUNT(*) AS c FROM signups WHERE position_id = ?').get(pos.id).c;
    if (posCount >= pos.capacity) return res.status(409).json({ error: 'That position is full' });
  } else {
    // No positions => check overall capacity
    if (ev.capacity != null) {
      const count = db.prepare('SELECT COUNT(*) AS c FROM signups WHERE event_id = ?').get(id).c;
      if (count >= ev.capacity) return res.status(409).json({ error: 'Event is full' });
    }
  }

  // Uniqueness by email or phone per event
  if (email) {
    const exists = db.prepare('SELECT 1 FROM signups WHERE event_id = ? AND email = ?').get(id, email);
    if (exists) return res.status(409).json({ error: 'This email is already signed up for this event' });
  }
  if (phone) {
    const exists = db.prepare('SELECT 1 FROM signups WHERE event_id = ? AND phone = ?').get(id, phone);
    if (exists) return res.status(409).json({ error: 'This phone number is already signed up for this event' });
  }

  const cancelToken = uuid();
  const cancel_token_hash = hashToken(cancelToken);

  const info = db.prepare(
    `INSERT INTO signups (event_id, position_id, name, email, phone, cancel_token_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, position_id ?? null, name.trim(), email || null, phone || null, cancel_token_hash);

  res.json({
    ok: true,
    signupId: info.lastInsertRowid,
    cancelToken
  });
});

app.delete('/api/events/:eventId/signup/:signupId', (req, res) => {
  const { eventId, signupId } = req.params;
  const token = (req.query.token || '').toString();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const row = db.prepare(
    'SELECT cancel_token_hash FROM signups WHERE id = ? AND event_id = ?'
  ).get(Number(signupId), Number(eventId));
  if (!row) return res.sendStatus(404);

  if (row.cancel_token_hash !== hashToken(token))
    return res.status(403).json({ error: 'Invalid token' });

  db.prepare('DELETE FROM signups WHERE id = ?').run(Number(signupId));
  res.json({ ok: true });
});

// --- ADMIN: EVENT CRUD ---
app.post('/api/events', isAuthed, (req, res) => {
  const { title, description, location, starts_at, ends_at, capacity } =
    req.body || {};
  if (!title || !starts_at)
    return res.status(400).json({ error: 'title and starts_at required' });
  const info = db.prepare(
    `INSERT INTO events (title, description, location, starts_at, ends_at, capacity)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    title.trim(),
    description || null,
    location || null,
    starts_at,
    ends_at || null,
    capacity != null ? Number(capacity) : null
  );
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/events/:id', isAuthed, (req, res) => {
  const id = Number(req.params.id);
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) return res.sendStatus(404);
  const {
    title = ev.title,
    description = ev.description,
    location = ev.location,
    starts_at = ev.starts_at,
    ends_at = ev.ends_at,
    capacity = ev.capacity
  } = req.body || {};

  db.prepare(
    `UPDATE events SET title=?, description=?, location=?, starts_at=?, ends_at=?, capacity=? WHERE id=?`
  ).run(
    title,
    description,
    location,
    starts_at,
    ends_at,
    capacity != null ? Number(capacity) : null,
    id
  );
  res.json({ ok: true });
});

app.delete('/api/events/:id', isAuthed, (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- ADMIN: view signups for an event ---
app.get('/api/events/:id/signups', isAuthed, (req, res) => {
  const rows = db.prepare(
    `SELECT s.id, s.name, s.email, s.phone, s.created_at, p.name AS position
     FROM signups s
     LEFT JOIN positions p ON p.id = s.position_id
     WHERE s.event_id = ?
     ORDER BY datetime(s.created_at)`
  ).all(Number(req.params.id));
  res.json(rows);
});

// --- ADMIN: positions management ---
app.get('/api/events/:id/positions', isAuthed, (req, res) => {
  const rows = db.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM signups s WHERE s.position_id = p.id) AS count
     FROM positions p WHERE p.event_id = ? ORDER BY p.id`
  ).all(Number(req.params.id));
  res.json(rows);
});

app.post('/api/events/:id/positions', isAuthed, (req, res) => {
  const id = Number(req.params.id);
  const { name, capacity } = req.body || {};
  if (!name || capacity == null) return res.status(400).json({ error: 'name and capacity required' });
  const info = db.prepare(
    `INSERT INTO positions (event_id, name, capacity) VALUES (?, ?, ?)`
  ).run(id, name.trim(), Number(capacity));
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/positions/:id', isAuthed, (req, res) => {
  const id = Number(req.params.id);
  const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(id);
  if (!pos) return res.sendStatus(404);
  const { name = pos.name, capacity = pos.capacity } = req.body || {};
  db.prepare('UPDATE positions SET name=?, capacity=? WHERE id=?').run(name, Number(capacity), id);
  res.json({ ok: true });
});

app.delete('/api/positions/:id', isAuthed, (req, res) => {
  db.prepare('DELETE FROM positions WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// static
app.use(express.static('public'));

// SPA routes
app.get('/', (_r, res) => res.sendFile(path.resolve('public/index.html')));
app.get('/admin', (_r, res) => res.sendFile(path.resolve('public/admin.html')));

app.listen(PORT, () =>
  console.log(`WVFC signup server running on http://localhost:${PORT}`)
);