require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const crypto = require('crypto');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? [/\.solodesir\.com$/, /\.onrender\.com$/]
        : [/localhost:/],
    credentials: true
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..')));

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, message: { success: false, message: 'Trop de requêtes' } });
app.use('/api/', globalLimiter);

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

// ─── Storage ─────────────────────────────────────────
const USERS_MEM = {};
const LIKES_MEM = [];
const MATCHES_MEM = [];
const MSGS_MEM = {};
let pool = null;

async function initDB() {
    if (!process.env.DATABASE_URL) return false;
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 10
    });
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS solo_users (
                id TEXT PRIMARY KEY, pseudo TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
                gender TEXT DEFAULT 'homme', age INTEGER DEFAULT 25, country TEXT DEFAULT 'ML', city TEXT DEFAULT '',
                phone TEXT DEFAULT '', photos JSONB DEFAULT '[]', bio TEXT DEFAULT '', plan TEXT DEFAULT 'free',
                messages_today INTEGER DEFAULT 0, matches_today INTEGER DEFAULT 0, last_message_date TEXT DEFAULT '',
                plan_expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS solo_likes (
                id SERIAL PRIMARY KEY, from_user TEXT, to_user TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(from_user, to_user)
            );
            CREATE TABLE IF NOT EXISTS solo_matches (
                id SERIAL PRIMARY KEY, user1 TEXT, user2 TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS solo_messages (
                id SERIAL PRIMARY KEY, match_id INTEGER, sender TEXT, content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('✅ PostgreSQL connected');
        return true;
    } finally { client.release(); }
}

// ─── Auth ────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Token requis' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch (e) { return res.status(401).json({ success: false, message: 'Token invalide ou expiré' }); }
}

function generateTokens(user) {
    const payload = { id: user.id, pseudo: user.pseudo, email: user.email, plan: user.plan };
    return {
        accessToken: jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' }),
        refreshToken: jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: '7d' })
    };
}

// ─── Solo API ────────────────────────────────────────
app.post('/api/solo/register', async (req, res) => {
    const { pseudo, email, password, gender, age, country, city, phone } = req.body;
    if (!pseudo || !email || !password || !gender) return res.status(400).json({ success: false, message: 'Pseudo, email, mot de passe et genre requis' });
    const existing = pool
        ? (await pool.query('SELECT * FROM solo_users WHERE email = $1 OR pseudo = $2', [email.toLowerCase(), pseudo])).rows[0]
        : Object.values(USERS_MEM).find(u => u.email === email.toLowerCase() || u.pseudo === pseudo);
    if (existing) return res.status(409).json({ success: false, message: 'Email ou pseudo déjà utilisé' });
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const user = {
        id: crypto.randomUUID(), pseudo, email: email.toLowerCase(), password: hash, gender, age: age || 25,
        country: country || 'ML', city: city || '', phone: phone || '', photos: [], bio: '', plan: 'free',
        messages_today: 0, matches_today: 0, last_message_date: '', created_at: new Date().toISOString()
    };
    if (pool) {
        await pool.query(
            `INSERT INTO solo_users (id, pseudo, email, password, gender, age, country, city, phone, photos, bio, plan, messages_today, matches_today, last_message_date, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [user.id, user.pseudo, user.email, user.password, user.gender, user.age, user.country, user.city, user.phone, JSON.stringify(user.photos), user.bio, user.plan, user.messages_today, user.matches_today, user.last_message_date, user.created_at]
        );
    } else { USERS_MEM[user.email] = user; }
    const tokens = generateTokens(user);
    res.json({ success: true, token: tokens.accessToken, user: { pseudo, email: user.email, gender, plan: 'free' } });
});

app.post('/api/solo/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
    const user = pool
        ? (await pool.query('SELECT * FROM solo_users WHERE email = $1', [email.toLowerCase().trim()])).rows[0]
        : USERS_MEM[email.toLowerCase().trim()];
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    const tokens = generateTokens(user);
    res.json({ success: true, token: tokens.accessToken, user: { pseudo: user.pseudo, email: user.email, gender: user.gender, plan: user.plan } });
});

app.get('/api/solo/me', authMiddleware, async (req, res) => {
    const user = pool ? (await pool.query('SELECT * FROM solo_users WHERE email = $1', [req.user.email])).rows[0] : USERS_MEM[req.user.email];
    if (!user) return res.status(404).json({ success: false });
    const today = new Date().toDateString();
    const msgsLeft = user.plan === 'free' ? Math.max(0, 5 - (user.last_message_date === today ? user.messages_today : 0)) : 999;
    const matchesLeft = user.plan === 'free' ? Math.max(0, 3 - (user.last_message_date === today ? user.matches_today : 0)) : 999;
    res.json({ success: true, user: { pseudo: user.pseudo, email: user.email, gender: user.gender, age: user.age, country: user.country, city: user.city, phone: user.phone, photos: user.photos, bio: user.bio, plan: user.plan, messagesLeft: msgsLeft, matchesLeft } });
});

app.put('/api/solo/me', authMiddleware, async (req, res) => {
    const { pseudo, age, country, city, phone, photos, bio } = req.body;
    const updates = {};
    if (pseudo !== undefined) updates.pseudo = pseudo;
    if (age !== undefined) updates.age = parseInt(age);
    if (country !== undefined) updates.country = country;
    if (city !== undefined) updates.city = city;
    if (photos !== undefined) updates.photos = Array.isArray(photos) ? photos : photos.split(',').map(s => s.trim()).filter(s => s);
    if (phone !== undefined) updates.phone = phone;
    if (bio !== undefined) updates.bio = bio;
    if (pool) {
        const keys = Object.keys(updates);
        if (keys.length > 0) {
            const setClause = keys.map((k, i) => { const map = { photos: `photos = $${i + 2}::jsonb` }; return map[k] || `${k} = $${i + 2}`; }).join(', ');
            await pool.query(`UPDATE solo_users SET ${setClause} WHERE email = $1`, [req.user.email, ...keys.map(k => k === 'photos' ? JSON.stringify(updates[k]) : updates[k])]);
        }
    } else {
        Object.assign(USERS_MEM[req.user.email], updates);
    }
    res.json({ success: true, message: 'Profil mis à jour' });
});

app.get('/api/solo/profiles', authMiddleware, async (req, res) => {
    const { country, gender, ageMin, ageMax } = req.query;
    const profiles = pool
        ? (await pool.query('SELECT pseudo, email, gender, age, country, city, photos, bio, created_at FROM solo_users WHERE email != $1', [req.user.email])).rows
        : Object.values(USERS_MEM).filter(u => u.email !== req.user.email);
    let filtered = profiles.map(p => ({ ...p, password: undefined, id: undefined }));
    if (gender) filtered = filtered.filter(p => p.gender === gender);
    if (country) filtered = filtered.filter(p => p.country === country);
    if (ageMin) filtered = filtered.filter(p => p.age >= parseInt(ageMin));
    if (ageMax) filtered = filtered.filter(p => p.age <= parseInt(ageMax));
    res.json({ success: true, profiles: filtered.slice(0, 50) });
});

app.post('/api/solo/like', authMiddleware, async (req, res) => {
    const { targetEmail } = req.body;
    if (!targetEmail) return res.status(400).json({ success: false, message: 'Cible requise' });
    if (pool) {
        await pool.query('INSERT INTO solo_likes (from_user, to_user) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.email, targetEmail]);
        const rev = (await pool.query('SELECT * FROM solo_likes WHERE from_user = $1 AND to_user = $2', [targetEmail, req.user.email])).rows[0];
        if (rev) {
            await pool.query('INSERT INTO solo_matches (user1, user2) VALUES ($1,$2)', [req.user.email, targetEmail]);
            const m = (await pool.query('SELECT * FROM solo_matches WHERE user1 = $1 AND user2 = $2', [req.user.email, targetEmail])).rows[0];
            return res.json({ success: true, matched: true, matchId: m.id });
        }
    } else {
        LIKES_MEM.push({ from: req.user.email, to: targetEmail });
        const rev = LIKES_MEM.find(l => l.from === targetEmail && l.to === req.user.email);
        if (rev) {
            const matchId = crypto.randomBytes(8).toString('hex');
            MATCHES_MEM.push({ id: matchId, user1: req.user.email, user2: targetEmail, created_at: new Date().toISOString() });
            return res.json({ success: true, matched: true, matchId });
        }
    }
    res.json({ success: true, matched: false });
});

app.get('/api/solo/matches', authMiddleware, async (req, res) => {
    const matches = pool
        ? (await pool.query('SELECT id, user1, user2, created_at FROM solo_matches WHERE user1 = $1 OR user2 = $1 ORDER BY created_at DESC', [req.user.email])).rows
        : MATCHES_MEM.filter(m => m.user1 === req.user.email || m.user2 === req.user.email);
    res.json({ success: true, matches: matches.map(m => ({ id: m.id, with: m.user1 === req.user.email ? m.user2 : m.user1, created_at: m.created_at })) });
});

app.post('/api/solo/message', authMiddleware, async (req, res) => {
    const { matchId, content } = req.body;
    if (!matchId || !content) return res.status(400).json({ success: false, message: 'Match ID et contenu requis' });
    if (pool) {
        await pool.query('INSERT INTO solo_messages (match_id, sender, content) VALUES ($1,$2,$3)', [matchId, req.user.email, content]);
    } else {
        if (!MSGS_MEM[matchId]) MSGS_MEM[matchId] = [];
        MSGS_MEM[matchId].push({ sender: req.user.email, content, time: new Date().toISOString() });
    }
    res.json({ success: true });
});

app.get('/api/solo/messages/:matchId', authMiddleware, async (req, res) => {
    const msgs = pool
        ? (await pool.query('SELECT sender, content, created_at FROM solo_messages WHERE match_id = $1 ORDER BY created_at', [req.params.matchId])).rows
        : (MSGS_MEM[req.params.matchId] || []);
    res.json({ success: true, messages: msgs });
});

// ─── Health ──────────────────────────────────────────
app.get('/health', async (req, res) => {
    const users = pool ? (await pool.query('SELECT COUNT(*) FROM solo_users')).rows[0].count : Object.keys(USERS_MEM).length;
    res.json({ success: true, status: 'ok', uptime: process.uptime(), users, db: pool ? 'postgres' : 'memory' });
});

// ─── SPA fallback ────────────────────────────────────
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, message: 'Endpoint API inconnu' });
    res.sendFile(path.join(__dirname, '..', req.path === '/' ? 'index.html' : req.path), (err) => {
        if (err) res.sendFile(path.join(__dirname, '..', 'index.html'));
    });
});

// ─── Start ───────────────────────────────────────────
initDB().then(ok => {
    if (!ok) console.log('⚠️ No DATABASE_URL, using in-memory storage');
    server.listen(PORT, '0.0.0.0', () => {
        console.log('━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🔥 Solo  : http://localhost:${PORT}`);
        console.log(`📊 DB    : ${pool ? 'PostgreSQL' : 'Memory'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━');
    });
});
