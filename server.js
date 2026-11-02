const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'ChangeMe@123';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const CATEGORIES = ['Railway', 'Public Awareness', 'Civil Sense', 'Your Rights'];

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { news: [], profile: null, banner: null };
  }
}
function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ---------- sessions (signed cookie) ----------
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}
function makeToken() {
  const exp = Date.now() + 1000 * 60 * 60 * 8; // 8 hours
  const payload = `admin.${exp}`;
  return `${payload}.${sign(payload)}`;
}
function validToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(parts[1]) > Date.now();
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function requireAdmin(req, res, next) {
  if (validToken(req.cookies.session)) return next();
  res.status(401).json({ error: 'लॉगिन ज़रूरी है' });
}

// ---------- login rate limit ----------
const attempts = new Map();
function loginLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > rec.reset) {
    rec.count = 0;
    rec.reset = now + 15 * 60 * 1000;
  }
  if (rec.count >= 8) {
    return res.status(429).json({ error: 'बहुत ज़्यादा कोशिशें। 15 मिनट बाद फिर कोशिश करें।' });
  }
  rec.count++;
  attempts.set(ip, rec);
  next();
}

// ---------- uploads ----------
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (EXT[file.mimetype]) cb(null, true);
    else cb(new Error('सिर्फ JPG, PNG या WEBP फोटो चलेगी'));
  },
});
function removeUpload(url) {
  if (!url) return;
  const file = path.join(UPLOAD_DIR, path.basename(url));
  fs.unlink(file, () => {});
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
// सिर्फ ये तीन फाइलें पब्लिक हैं (server.js और data बाहर से नहीं खुलेंगे)
['index.html', 'style.css', 'app.js'].forEach((f) => {
  const route = f === 'index.html' ? ['/', '/index.html'] : '/' + f;
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, f)));
});

// public API
app.get('/api/news', (req, res) => {
  const db = loadDb();
  const list = [...db.news].sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});
app.get('/api/site', (req, res) => {
  const db = loadDb();
  res.json({ profile: db.profile, banner: db.banner });
});

// auth
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (safeEqual(username || '', ADMIN_USER) && safeEqual(password || '', ADMIN_PASS)) {
    attempts.delete(req.ip);
    res.cookie('session', makeToken(), {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: 1000 * 60 * 60 * 8,
    });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'यूज़रनेम या पासवर्ड गलत है' });
});
app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  res.json({ admin: validToken(req.cookies.session) });
});

// admin: news
app.post('/api/news', requireAdmin, upload.single('image'), (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 180);
  const body = String(req.body.body || '').trim().slice(0, 20000);
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Railway';
  if (!title || !body) {
    if (req.file) removeUpload(req.file.filename);
    return res.status(400).json({ error: 'शीर्षक और खबर दोनों ज़रूरी हैं' });
  }
  const db = loadDb();
  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    title,
    body,
    category,
    image: req.file ? '/uploads/' + req.file.filename : null,
    createdAt: Date.now(),
  };
  db.news.push(item);
  saveDb(db);
  res.json(item);
});
app.delete('/api/news/:id', requireAdmin, (req, res) => {
  const db = loadDb();
  const idx = db.news.findIndex((n) => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'खबर नहीं मिली' });
  const [removed] = db.news.splice(idx, 1);
  removeUpload(removed.image);
  saveDb(db);
  res.json({ ok: true });
});

// admin: profile + banner
function imageRoutes(key) {
  app.post(`/api/${key}`, requireAdmin, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'फोटो चुनें' });
    const db = loadDb();
    removeUpload(db[key]);
    db[key] = '/uploads/' + req.file.filename;
    saveDb(db);
    res.json({ url: db[key] });
  });
  app.delete(`/api/${key}`, requireAdmin, (req, res) => {
    const db = loadDb();
    removeUpload(db[key]);
    db[key] = null;
    saveDb(db);
    res.json({ ok: true });
  });
}
imageRoutes('profile');
imageRoutes('banner');

// errors
app.use((err, req, res, next) => {
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'फोटो 5MB से छोटी होनी चाहिए' : err.message || 'सर्वर में गड़बड़ी';
  res.status(400).json({ error: msg });
});

app.listen(PORT, () => {
  console.log(`Golu Jonwal News चालू है: http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASS) {
    console.log('चेतावनी: डिफ़ॉल्ट पासवर्ड चल रहा है। ADMIN_USER और ADMIN_PASS सेट करें।');
  }
});
