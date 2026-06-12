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
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? [/\.solodesir\.com$/, /167\.233\.105\.13$/]
        : [/localhost:/],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Upload photo ───────────────────────────────────
app.post('/api/solo/upload-photo', authMiddleware, async (req, res) => {
    const { image } = req.body;
    if (!image || typeof image !== 'string') return res.status(400).json({ success: false, message: 'Image requise' });
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    const matches = image.match(/^data:(\w+\/\w+);base64,(.+)$/);
    if (!matches || !allowedMime.includes(matches[1])) return res.status(400).json({ success: false, message: 'Format non autorisé (JPG, PNG, WebP)' });
    const ext = matches[1].split('/')[1].replace('jpeg', 'jpg');
    const data = matches[2];
    const buf = Buffer.from(data, 'base64');
    if (buf.length > 15 * 1024 * 1024) return res.status(400).json({ success: false, message: 'Image trop lourde (max 15MB)' });
    const filename = 'solo_' + crypto.randomBytes(8).toString('hex') + '.' + ext;
    const dir = path.join(__dirname, '..', 'uploads');
    try { await fs.mkdir(dir, { recursive: true }); } catch (e) {}
    await fs.writeFile(path.join(dir, filename), buf);
    res.json({ success: true, url: '/uploads/' + filename });
});

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, message: { success: false, message: 'Trop de requêtes' } });
app.use('/api/', globalLimiter);
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { success: false, message: 'Trop de tentatives, réessaie dans 1 minute' } });
app.use('/api/solo/login', authLimiter);
app.use('/api/solo/register', authLimiter);

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
                phone TEXT DEFAULT '', photos JSONB DEFAULT '[]', profession TEXT DEFAULT '',
                looking_for TEXT DEFAULT '', interests JSONB DEFAULT '[]', bio TEXT DEFAULT '', plan TEXT DEFAULT 'free',
                status TEXT DEFAULT '', religion TEXT DEFAULT '', children TEXT DEFAULT '',
                verified BOOLEAN DEFAULT false, lat DOUBLE PRECISION DEFAULT 0, lng DOUBLE PRECISION DEFAULT 0,
                messages_today INTEGER DEFAULT 0, likes_today INTEGER DEFAULT 0, last_like_date TEXT DEFAULT '', matches_today INTEGER DEFAULT 0, last_message_date TEXT DEFAULT '',
                push_sub TEXT DEFAULT '',
                referral_code TEXT DEFAULT '', referred_by TEXT DEFAULT '', referrals_count INTEGER DEFAULT 0,
                plan_expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_solo_users_geo ON solo_users(lat, lng);
            CREATE TABLE IF NOT EXISTS solo_likes (
                id SERIAL PRIMARY KEY, from_user TEXT, to_user TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(from_user, to_user)
            );
            CREATE TABLE IF NOT EXISTS solo_matches (
                id SERIAL PRIMARY KEY, user1 TEXT, user2 TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user1, user2)
            );
            CREATE TABLE IF NOT EXISTS solo_messages (
                id SERIAL PRIMARY KEY, match_id INTEGER, sender TEXT, content TEXT NOT NULL, read_at TIMESTAMPTZ DEFAULT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS solo_reports (
                id SERIAL PRIMARY KEY, reporter TEXT NOT NULL, reported TEXT NOT NULL, reason TEXT NOT NULL, details TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS solo_boosts (
                id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('✅ PostgreSQL tables created');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_likes_from ON solo_likes(from_user)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_likes_to ON solo_likes(to_user)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_user1 ON solo_matches(user1)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_user2 ON solo_matches(user2)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_match ON solo_messages(match_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_phone ON solo_users(phone)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_country_gender ON solo_users(country, gender)`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW()`);
        await client.query(`ALTER TABLE solo_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ DEFAULT NULL`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS profession TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS looking_for TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS interests JSONB DEFAULT '[]'`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS referral_code TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS referred_by TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS referrals_count INTEGER DEFAULT 0`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS religion TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS children TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS likes_today INTEGER DEFAULT 0`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS last_like_date TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION DEFAULT 0`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION DEFAULT 0`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS push_sub TEXT DEFAULT ''`);
        await client.query(`ALTER TABLE solo_users ADD COLUMN IF NOT EXISTS incognito BOOLEAN DEFAULT false`);
        console.log('✅ PostgreSQL migrations done');
        await client.query(`
            CREATE TABLE IF NOT EXISTS solo_annonces (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                pseudo TEXT NOT NULL,
                gender TEXT DEFAULT '',
                age INTEGER DEFAULT 0,
                country TEXT DEFAULT '',
                city TEXT DEFAULT '',
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                looking_for TEXT DEFAULT '',
                photos JSONB DEFAULT '[]',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
            );
            CREATE INDEX IF NOT EXISTS idx_annonces_country ON solo_annonces(country);
            CREATE INDEX IF NOT EXISTS idx_annonces_expires ON solo_annonces(expires_at);
            CREATE INDEX IF NOT EXISTS idx_annonces_user ON solo_annonces(user_id);
        `);
        await client.query('DELETE FROM solo_annonces WHERE expires_at < NOW()');
        console.log('✅ PostgreSQL connected');
        return true;
    } finally { client.release(); }
}

// ─── Auth ────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Token requis' });
    try { 
        req.user = jwt.verify(token, JWT_SECRET); 
        if (pool) pool.query('UPDATE solo_users SET last_seen = NOW() WHERE email = $1', [req.user.email]).catch(() => {});
        next(); 
    }
    catch (e) { return res.status(401).json({ success: false, message: 'Token invalide ou expiré' }); }
}

function generateTokens(user) {
    const payload = { id: user.id, pseudo: user.pseudo, email: user.email, plan: user.plan };
    return {
        accessToken: jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' }),
        refreshToken: jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: '90d' })
    };
}

// ─── Haversine distance ────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Push Notification Helper ─────────────────────────
let webPush = null;
try { webPush = require('web-push'); } catch (e) { console.log('web-push not installed, push notifications disabled'); }
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
if (webPush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails('mailto:contact@solodesir.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function sendPushNotification(email, title, body, url) {
    if (!webPush || !VAPID_PUBLIC_KEY) return;
    try {
        const user = pool ? (await pool.query('SELECT push_sub FROM solo_users WHERE email = $1', [email])).rows[0] : USERS_MEM[email];
        if (!user || !user.push_sub) return;
        const sub = typeof user.push_sub === 'string' ? JSON.parse(user.push_sub) : user.push_sub;
        await webPush.sendNotification(sub, JSON.stringify({ title, body, url: url || '/solo.html', icon: '/manifest-icon-192.png' }));
    } catch (e) { console.error('Push error:', e.message); }
}

// ─── VAPID Key endpoint ───────────────────────────────
app.get('/api/solo/vapid-key', (req, res) => {
    res.json({ success: true, key: VAPID_PUBLIC_KEY });
});

// ─── Solo API ────────────────────────────────────────
app.post('/api/solo/register', async (req, res) => {
    try {
        const { pseudo, email, password, gender, age, phone, country: formCountry, ref } = req.body;
        if (!pseudo || !password || !gender || !phone) return res.status(400).json({ success: false, message: 'Téléphone, pseudo, mot de passe et genre requis' });
        const userEmail = email || ('phone_' + phone.replace(/[^0-9+]/g, '') + '@solo.local');
        let country = formCountry || 'ML';
        if (!formCountry) {
            const p = phone.replace(/[^0-9+]/g, '');
            const prefixMap = { '+223':'ML','+225':'CI','+221':'SN','+226':'BF','+224':'GN','+237':'CM','+229':'BJ','+228':'TG','+234':'NG','+233':'GH','+227':'NE','+235':'TD','+243':'CD','+242':'CG','+241':'GA' };
            for (const [pref, c] of Object.entries(prefixMap)) { if (p.startsWith(pref)) { country = c; break; } }
        }
        const existing = pool
            ? (await pool.query('SELECT * FROM solo_users WHERE email = $1 OR phone = $2 OR pseudo = $3', [userEmail.toLowerCase(), phone, pseudo])).rows[0]
            : Object.values(USERS_MEM).find(u => u.email === userEmail.toLowerCase() || u.phone === phone || u.pseudo === pseudo);
        if (existing) return res.status(409).json({ success: false, message: 'Téléphone, email ou pseudo déjà utilisé' });
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        const referralCode = crypto.randomBytes(4).toString('hex');
        const user = {
            id: crypto.randomUUID(), pseudo, email: userEmail.toLowerCase(), password: hash, gender, age: age || 25,
            country: country, city: '', phone: phone || '', photos: [], profession: '', looking_for: '', interests: [], bio: '', plan: 'free',
            status: '', religion: '', children: '', verified: false, lat: 0, lng: 0,
            messages_today: 0, likes_today: 0, last_like_date: '', matches_today: 0, last_message_date: '', referral_code: referralCode, referred_by: ref || '', referrals_count: 0, created_at: new Date().toISOString()
        };
        if (pool) {
            await pool.query(
                `INSERT INTO solo_users (id, pseudo, email, password, gender, age, country, city, phone, photos, profession, looking_for, interests, bio, plan, status, religion, children, verified, messages_today, likes_today, last_like_date, matches_today, last_message_date, lat, lng, referral_code, referred_by, referrals_count, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)`,
                [user.id, user.pseudo, user.email, user.password, user.gender, user.age, user.country, user.city, user.phone, JSON.stringify(user.photos), user.profession, user.looking_for, JSON.stringify(user.interests), user.bio, user.plan, user.status, user.religion, user.children, user.verified, user.messages_today, user.likes_today, user.last_like_date, user.matches_today, user.last_message_date, user.lat, user.lng, user.referral_code, ref || '', 0, user.created_at]
            );
        } else { USERS_MEM[user.email] = user; }
        if (ref && ref !== referralCode) {
            if (pool) {
                await pool.query('UPDATE solo_users SET referrals_count = referrals_count + 1 WHERE referral_code = $1', [ref]);
            } else {
                const refUser = Object.values(USERS_MEM).find(u => u.referral_code === ref);
                if (refUser) refUser.referrals_count = (refUser.referrals_count || 0) + 1;
            }
        }
        const tokens = generateTokens(user);
        res.json({ success: true, token: tokens.accessToken, user: { pseudo, email: user.email, phone, gender, plan: 'free' } });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur, réessaie dans quelques secondes' });
    }
});

app.post('/api/solo/login', async (req, res) => {
    try {
        const { login, password } = req.body;
        if (!login || !password) return res.status(400).json({ success: false, message: 'Identifiant et mot de passe requis' });
        const isEmail = login.includes('@');
        const user = pool
            ? (await pool.query(isEmail ? 'SELECT * FROM solo_users WHERE email = $1' : 'SELECT * FROM solo_users WHERE phone = $1 OR email = $1 OR pseudo = $1', [login.trim()])).rows[0]
            : (isEmail ? USERS_MEM[login.trim()] : Object.values(USERS_MEM).find(u => u.phone === login.trim() || u.pseudo === login.trim()));
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ success: false, message: 'Identifiant ou mot de passe incorrect' });
        const tokens = generateTokens(user);
        res.json({ success: true, token: tokens.accessToken, user: { pseudo: user.pseudo, email: user.email, phone: user.phone, gender: user.gender, plan: user.plan } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur, réessaie' });
    }
});

app.get('/api/solo/me', authMiddleware, async (req, res) => {
    const user = pool ? (await pool.query('SELECT * FROM solo_users WHERE email = $1', [req.user.email])).rows[0] : USERS_MEM[req.user.email];
    if (!user) return res.status(404).json({ success: false });
    const today = new Date().toDateString();
    const msgsLeft = user.plan === 'free' ? Math.max(0, 5 - (user.last_message_date === today ? user.messages_today : 0)) : 999;
    const matchesLeft = user.plan === 'free' ? Math.max(0, 3 - (user.last_message_date === today ? user.matches_today : 0)) : 999;
    res.json({ success: true, user: { pseudo: user.pseudo, email: user.email, gender: user.gender, age: user.age, country: user.country, city: user.city, phone: user.phone, photos: user.photos, profession: user.profession, looking_for: user.looking_for, interests: user.interests, bio: user.bio, plan: user.plan, status: user.status, religion: user.religion, children: user.children, verified: user.verified, lat: user.lat, lng: user.lng, referralCode: user.referral_code, referralsCount: user.referrals_count || 0, messagesLeft: msgsLeft, matchesLeft, incognito: user.incognito || false } });
});

app.put('/api/solo/me', authMiddleware, async (req, res) => {
    const { pseudo, age, country, city, phone, photos, profession, looking_for, interests, bio, status, religion, children, lat, lng, incognito } = req.body;
    const updates = {};
    if (pseudo !== undefined) updates.pseudo = pseudo;
    if (age !== undefined) updates.age = parseInt(age);
    if (country !== undefined) updates.country = country;
    if (city !== undefined) updates.city = city;
    if (phone !== undefined) updates.phone = phone;
    if (photos !== undefined) updates.photos = Array.isArray(photos) ? photos : photos.split(',').map(s => s.trim()).filter(s => s);
    if (lat !== undefined) updates.lat = parseFloat(lat);
    if (lng !== undefined) updates.lng = parseFloat(lng);
    if (profession !== undefined) updates.profession = profession;
    if (looking_for !== undefined) updates.looking_for = looking_for;
    if (interests !== undefined) updates.interests = Array.isArray(interests) ? interests : (typeof interests === 'string' ? interests.split(',').map(s => s.trim()).filter(s => s) : []);
    if (bio !== undefined) updates.bio = bio;
    if (status !== undefined) updates.status = status;
    if (religion !== undefined) updates.religion = religion;
    if (children !== undefined) updates.children = children;
    if (incognito !== undefined) updates.incognito = !!incognito;
    if (pool) {
        const keys = Object.keys(updates);
        if (keys.length > 0) {
            const setClause = keys.map((k, i) => {
                const map = { photos: `photos = $${i + 2}::jsonb`, interests: `interests = $${i + 2}::jsonb` };
                return map[k] || `${k} = $${i + 2}`;
            }).join(', ');
            await pool.query(`UPDATE solo_users SET ${setClause} WHERE email = $1`, [req.user.email, ...keys.map(k => (k === 'photos' || k === 'interests') ? JSON.stringify(updates[k]) : updates[k])]);
        }
    } else {
        Object.assign(USERS_MEM[req.user.email], updates);
    }
    res.json({ success: true, message: 'Profil mis à jour' });
});

app.delete('/api/solo/me', authMiddleware, async (req, res) => {
    const email = req.user.email;
    if (pool) {
        await pool.query('DELETE FROM solo_messages WHERE match_id IN (SELECT id FROM solo_matches WHERE user1 = $1 OR user2 = $1)', [email]);
        await pool.query('DELETE FROM solo_matches WHERE user1 = $1 OR user2 = $1', [email]);
        await pool.query('DELETE FROM solo_likes WHERE from_user = $1 OR to_user = $1', [email]);
        await pool.query('DELETE FROM solo_users WHERE email = $1', [email]);
    } else {
        delete USERS_MEM[email];
        for (let i = LIKES_MEM.length - 1; i >= 0; i--) { if (LIKES_MEM[i].from === email || LIKES_MEM[i].to === email) LIKES_MEM.splice(i, 1); }
        for (let i = MATCHES_MEM.length - 1; i >= 0; i--) { if (MATCHES_MEM[i].user1 === email || MATCHES_MEM[i].user2 === email) MATCHES_MEM.splice(i, 1); }
    }
    res.json({ success: true, message: 'Compte et toutes les données supprimés' });
});

app.delete('/api/solo/conversation/:matchId', authMiddleware, async (req, res) => {
    const matchId = req.params.matchId;
    const email = req.user.email;
    if (pool) {
        const match = (await pool.query('SELECT * FROM solo_matches WHERE id = $1 AND (user1 = $2 OR user2 = $2)', [matchId, email])).rows[0];
        if (!match) return res.status(403).json({ success: false });
        await pool.query('DELETE FROM solo_messages WHERE match_id = $1', [matchId]);
    } else {
        if (MSGS_MEM[matchId]) delete MSGS_MEM[matchId];
    }
    res.json({ success: true, message: 'Conversation effacée' });
});

app.put('/api/solo/location', authMiddleware, async (req, res) => {
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'Coordonnées requises' });
    if (pool) await pool.query('UPDATE solo_users SET lat = $1, lng = $2 WHERE email = $3', [lat, lng, req.user.email]);
    else if (USERS_MEM[req.user.email]) { USERS_MEM[req.user.email].lat = lat; USERS_MEM[req.user.email].lng = lng; }
    res.json({ success: true });
});

app.post('/api/solo/like', authMiddleware, async (req, res) => {
    const { targetEmail } = req.body;
    if (!targetEmail) return res.status(400).json({ success: false, message: 'Cible requise' });
    const likeUser = pool ? (await pool.query('SELECT plan, likes_today, last_like_date FROM solo_users WHERE email = $1', [req.user.email])).rows[0] : USERS_MEM[req.user.email];
    if (likeUser) {
        const today = new Date().toDateString();
        const likeCount = likeUser.last_like_date === today ? (likeUser.likes_today || 0) : 0;
        if (likeUser.plan === 'free' && likeCount >= 10) return res.status(429).json({ success: false, message: 'Limite de 10 likes/jour. Passe VIP !' });
        if (pool) await pool.query('UPDATE solo_users SET likes_today = likes_today + 1, last_like_date = $2 WHERE email = $1', [req.user.email, today]);
        else { likeUser.likes_today = (likeUser.likes_today || 0) + 1; likeUser.last_like_date = today; }
    }
    if (pool) {
        await pool.query('INSERT INTO solo_likes (from_user, to_user) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.email, targetEmail]);
        const rev = (await pool.query('SELECT * FROM solo_likes WHERE from_user = $1 AND to_user = $2', [targetEmail, req.user.email])).rows[0];
        LAST_SWIPE[req.user.email] = { target: targetEmail, time: Date.now() };
        const likerPseudo = pool ? (await pool.query('SELECT pseudo FROM solo_users WHERE email = $1', [req.user.email])).rows[0]?.pseudo : req.user.email;
        sendPushNotification(targetEmail, '❤️ Nouveau like !', likerPseudo + ' t\'a liké(e) !', '/solo.html');
        if (rev) {
            await pool.query('INSERT INTO solo_matches (user1, user2) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.email, targetEmail]);
            const m = (await pool.query('SELECT * FROM solo_matches WHERE user1 = $1 AND user2 = $2', [req.user.email, targetEmail])).rows[0];
            sendPushNotification(targetEmail, '💘 Match !', 'Vous vous plaisez mutuellement !', '/solo.html');
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
    const email = req.user.email;
    const rawMatches = pool
        ? (await pool.query(`SELECT m.id, m.user1, m.user2, m.created_at, COALESCE(u.pseudo, CASE WHEN m.user1 != $1 THEN m.user1 ELSE m.user2 END) as pseudo
             FROM solo_matches m LEFT JOIN solo_users u ON (CASE WHEN m.user1 = $1 THEN u.email = m.user2 ELSE u.email = m.user1 END)
             WHERE m.user1 = $1 OR m.user2 = $1 ORDER BY m.created_at DESC`, [email])).rows
        : MATCHES_MEM.filter(m => m.user1 === email || m.user2 === email);
    const result = rawMatches.map(m => ({
        id: m.id, with: m.user1 === email ? m.user2 : m.user1,
        pseudo: m.pseudo || (m.user1 === email ? m.user2 : m.user1), created_at: m.created_at
    }));
    res.json({ success: true, matches: result });
});

// ─── Verification ────────────────────────────────────
const VERIFICATION_CODES = {};

app.post('/api/solo/verify/send', authMiddleware, async (req, res) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    VERIFICATION_CODES[req.user.email] = { code, time: Date.now() };
    console.log('📱 Verification code for', req.user.email, ':', code);
    res.json({ success: true, message: 'Code de vérification envoyé par SMS' });
});

app.post('/api/solo/verify/confirm', authMiddleware, async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Code requis' });
    const stored = VERIFICATION_CODES[req.user.email];
    if (!stored || stored.code !== code) return res.status(400).json({ success: false, message: 'Code incorrect ou expiré' });
    if (Date.now() - stored.time > 300000) return res.status(400).json({ success: false, message: 'Code expiré' });
    delete VERIFICATION_CODES[req.user.email];
    if (pool) await pool.query('UPDATE solo_users SET verified = true WHERE email = $1', [req.user.email]);
    else if (USERS_MEM[req.user.email]) USERS_MEM[req.user.email].verified = true;
    res.json({ success: true, message: '✅ Compte vérifié', verified: true });
});

app.post('/api/solo/verify/selfie', authMiddleware, async (req, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).json({ success: false, message: 'Image requise' });
    const matches = image.match(/^data:(\w+\/\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ success: false, message: 'Format invalide' });
    const buf = Buffer.from(matches[2], 'base64');
    if (buf.length > 15 * 1024 * 1024) return res.status(400).json({ success: false, message: 'Image trop lourde (max 15MB)' });
    const filename = 'selfie_' + crypto.randomBytes(8).toString('hex') + '.jpg';
    const dir = path.join(__dirname, '..', 'uploads', 'selfies');
    try { await fs.mkdir(dir, { recursive: true }); } catch (e) {}
    await fs.writeFile(path.join(dir, filename), buf);
    if (pool) await pool.query('UPDATE solo_users SET verified = true WHERE email = $1', [req.user.email]);
    else if (USERS_MEM[req.user.email]) USERS_MEM[req.user.email].verified = true;
    res.json({ success: true, message: '✅ Selfie vérifié ! Badge activé.', verified: true });
});

// ─── Géolocalisation ────────────────────────────────
app.post('/api/solo/location', authMiddleware, async (req, res) => {
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'Coordonnées requises' });
    if (pool) await pool.query('UPDATE solo_users SET lat = $1, lng = $2 WHERE email = $3', [lat, lng, req.user.email]);
    else if (USERS_MEM[req.user.email]) { USERS_MEM[req.user.email].lat = lat; USERS_MEM[req.user.email].lng = lng; }
    res.json({ success: true });
});

// ─── Push Notification Subscription ──────────────────
app.post('/api/solo/subscribe-push', authMiddleware, async (req, res) => {
    const { subscription } = req.body;
    if (!subscription) return res.status(400).json({ success: false });
    if (pool) await pool.query('UPDATE solo_users SET push_sub = $1 WHERE email = $2', [JSON.stringify(subscription), req.user.email]);
    else if (USERS_MEM[req.user.email]) USERS_MEM[req.user.email].push_sub = JSON.stringify(subscription);
    res.json({ success: true });
});

app.post('/api/solo/message', authMiddleware, async (req, res) => {
    const { matchId, content } = req.body;
    if (!matchId || !content) return res.status(400).json({ success: false, message: 'Match ID et contenu requis' });
    const user = pool ? (await pool.query('SELECT * FROM solo_users WHERE email = $1', [req.user.email])).rows[0] : USERS_MEM[req.user.email];
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    const accountAge = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const today = new Date().toDateString();
    const msgsToday = user.last_message_date === today ? (user.messages_today || 0) : 0;
    const maxMsgs = user.plan === 'free' ? 5 : 999;
    if (msgsToday >= maxMsgs) return res.status(429).json({ success: false, message: 'Limite de messages atteinte. Passe VIP !' });
    const suspiciousKeywords = /(envoie.*argent|OM.*code|moMo.*code|wester.*union|money.*gram|envoie.*ton.*code|donne.*code|num[eé]ro.*carte)/i;
    const hasSuspicious = suspiciousKeywords.test(content);
    if (pool) {
        await pool.query('UPDATE solo_users SET messages_today = messages_today + 1, last_message_date = $2 WHERE email = $1', [req.user.email, today]);
        await pool.query('INSERT INTO solo_messages (match_id, sender, content) VALUES ($1,$2,$3)', [matchId, req.user.email, content]);
        const match = (await pool.query('SELECT user1, user2 FROM solo_matches WHERE id = $1', [matchId])).rows[0];
        if (match) {
            const recipient = match.user1 === req.user.email ? match.user2 : match.user1;
            sendPushNotification(recipient, '💬 Nouveau message', user.pseudo + ': ' + content.substring(0, 50), '/solo.html');
        }
    } else {
        USERS_MEM[req.user.email].messages_today = msgsToday + 1;
        USERS_MEM[req.user.email].last_message_date = today;
        if (!MSGS_MEM[matchId]) MSGS_MEM[matchId] = [];
        MSGS_MEM[matchId].push({ sender: req.user.email, content, time: new Date().toISOString() });
    }
    res.json({ success: true, warning: hasSuspicious ? '⚠️ Message suspect détecté. Ne partage jamais tes informations bancaires.' : null });
});

app.get('/api/solo/likes-received', authMiddleware, async (req, res) => {
    const email = req.user.email;
    const likes = pool
        ? (await pool.query(`SELECT l.from_user, l.created_at, u.pseudo, u.age, u.country, u.city, u.photos
             FROM solo_likes l JOIN solo_users u ON l.from_user = u.email
             WHERE l.to_user = $1 AND l.from_user NOT IN
             (SELECT user2 FROM solo_matches WHERE user1 = $1 UNION SELECT user1 FROM solo_matches WHERE user2 = $1)
             ORDER BY l.created_at DESC LIMIT 20`, [email])).rows
        : LIKES_MEM.filter(l => l.to === email && !MATCHES_MEM.find(m => (m.user1 === email && m.user2 === l.from) || (m.user2 === email && m.user1 === l.from)));
    const profiles = likes.map(l => ({
        email: l.from_user || l.from, pseudo: l.pseudo, age: l.age,
        country: l.country, city: l.city, photos: (l.photos || [])[0] || null
    }));
    res.json({ success: true, likes: profiles });
});

// ─── Annonces ────────────────────────────────────────
const ANNONCES_MEM = [];

app.get('/api/solo/annonces', async (req, res) => {
    const { country, gender, limit } = req.query;
    const lim = Math.min(parseInt(limit) || 30, 50);
    if (pool) {
        await pool.query('DELETE FROM solo_annonces WHERE expires_at < NOW()');
        const conditions = ['expires_at > NOW()'];
        const params = [];
        let idx = 1;
        if (country) { conditions.push(`country = $${idx++}`); params.push(country); }
        if (gender) { conditions.push(`gender = $${idx++}`); params.push(gender); }
        const where = conditions.join(' AND ');
        const annonces = (await pool.query(`SELECT * FROM solo_annonces WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`, [...params, lim])).rows;
        res.json({ success: true, annonces });
    } else {
        const now = Date.now();
        let filtered = ANNONCES_MEM.filter(a => new Date(a.expires_at).getTime() > now);
        if (country) filtered = filtered.filter(a => a.country === country);
        if (gender) filtered = filtered.filter(a => a.gender === gender);
        res.json({ success: true, annonces: filtered.slice(0, lim) });
    }
});

app.post('/api/solo/annonces', authMiddleware, async (req, res) => {
    const { title, description, looking_for, photos } = req.body;
    if (!title || !description) return res.status(400).json({ success: false, message: 'Titre et description requis' });
    const user = pool ? (await pool.query('SELECT pseudo, gender, age, country, city FROM solo_users WHERE email = $1', [req.user.email])).rows[0] : USERS_MEM[req.user.email];
    if (!user) return res.status(404).json({ success: false });
    const userAnnonces = pool ? (await pool.query('SELECT COUNT(*) FROM solo_annonces WHERE user_id = $1', [req.user.email])).rows[0].count : ANNONCES_MEM.filter(a => a.user_id === req.user.email).length;
    if (parseInt(userAnnonces) >= 3) return res.status(429).json({ success: false, message: 'Maximum 3 annonces actives' });
    const photosArr = Array.isArray(photos) ? photos.slice(0, 3) : [];
    if (pool) {
        const r = await pool.query(
            `INSERT INTO solo_annonces (user_id, pseudo, gender, age, country, city, title, description, looking_for, photos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [req.user.email, user.pseudo, user.gender, user.age, user.country, user.city, title.trim(), description.trim(), looking_for || '', JSON.stringify(photosArr)]
        );
        res.json({ success: true, annonce: r.rows[0] });
    } else {
        const annonce = { id: Date.now(), user_id: req.user.email, pseudo: user.pseudo, gender: user.gender, age: user.age, country: user.country, city: user.city, title: title.trim(), description: description.trim(), looking_for: looking_for || '', photos: photosArr, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() };
        ANNONCES_MEM.push(annonce);
        res.json({ success: true, annonce });
    }
});

app.delete('/api/solo/annonces/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (pool) {
        const r = await pool.query('DELETE FROM solo_annonces WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.email]);
        if (r.rows.length === 0) return res.status(403).json({ success: false, message: 'Non autorisé' });
    } else {
        const idx = ANNONCES_MEM.findIndex(a => a.id === id && a.user_id === req.user.email);
        if (idx === -1) return res.status(403).json({ success: false });
        ANNONCES_MEM.splice(idx, 1);
    }
    res.json({ success: true, message: 'Annonce supprimée' });
});

app.post('/api/solo/annonces/:id/respond', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    const annonce = pool ? (await pool.query('SELECT * FROM solo_annonces WHERE id = $1', [id])).rows[0] : ANNONCES_MEM.find(a => a.id === id);
    if (!annonce) return res.status(404).json({ success: false, message: 'Annonce introuvable' });
    if (annonce.user_id === req.user.email) return res.status(400).json({ success: false, message: 'Tu ne peux pas répondre à ta propre annonce' });
    const existingMatch = pool
        ? (await pool.query('SELECT * FROM solo_matches WHERE (user1 = $1 AND user2 = $2) OR (user1 = $2 AND user2 = $1)', [req.user.email, annonce.user_id])).rows[0]
        : MATCHES_MEM.find(m => (m.user1 === req.user.email && m.user2 === annonce.user_id) || (m.user1 === annonce.user_id && m.user2 === req.user.email));
    if (existingMatch) return res.json({ success: true, matched: true, matchId: existingMatch.id, message: 'Match déjà existant' });
    if (pool) {
        await pool.query('INSERT INTO solo_likes (from_user, to_user) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.email, annonce.user_id]);
        await pool.query('INSERT INTO solo_likes (from_user, to_user) VALUES ($1,$2) ON CONFLICT DO NOTHING', [annonce.user_id, req.user.email]);
        const m = (await pool.query('INSERT INTO solo_matches (user1, user2) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *', [req.user.email, annonce.user_id])).rows[0];
        if (m) {
            await pool.query('INSERT INTO solo_messages (match_id, sender, content) VALUES ($1,$2,$3)', [m.id, req.user.email, '👋 Je réponds à ton annonce : "' + annonce.title + '"']);
            return res.json({ success: true, matched: true, matchId: m.id });
        }
    } else {
        LIKES_MEM.push({ from: req.user.email, to: annonce.user_id });
        LIKES_MEM.push({ from: annonce.user_id, to: req.user.email });
        const matchId = crypto.randomBytes(8).toString('hex');
        MATCHES_MEM.push({ id: matchId, user1: req.user.email, user2: annonce.user_id, created_at: new Date().toISOString() });
        if (!MSGS_MEM[matchId]) MSGS_MEM[matchId] = [];
        MSGS_MEM[matchId].push({ sender: req.user.email, content: '👋 Je réponds à ton annonce : "' + annonce.title + '"', time: new Date().toISOString() });
        return res.json({ success: true, matched: true, matchId });
    }
    res.json({ success: true, matched: false });
});

// ─── Online Status & Last Seen ────────────────────────
app.get('/api/solo/online/:email', authMiddleware, async (req, res) => {
    const email = req.params.email;
    const user = pool ? (await pool.query('SELECT last_seen FROM solo_users WHERE email = $1', [email])).rows[0] : USERS_MEM[email];
    if (!user) return res.json({ success: false });
    const lastSeen = new Date(user.last_seen);
    const now = new Date();
    const diffMs = now - lastSeen;
    const isOnline = diffMs < 2 * 60 * 1000;
    let lastSeenText = '';
    if (!isOnline) {
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 60) lastSeenText = `Il y a ${diffMin}min`;
        else if (diffMin < 1440) lastSeenText = `Il y a ${Math.floor(diffMin / 60)}h`;
        else lastSeenText = `Il y a ${Math.floor(diffMin / 1440)}j`;
    }
    res.json({ success: true, isOnline, lastSeen: lastSeenText });
});

// ─── Typing Indicator ─────────────────────────────────
const TYPING_STATUS = {};
app.post('/api/solo/typing', authMiddleware, async (req, res) => {
    const { matchId, isTyping } = req.body;
    if (!matchId) return res.status(400).json({ success: false });
    const key = matchId + ':' + req.user.email;
    TYPING_STATUS[key] = { isTyping: !!isTyping, time: Date.now() };
    res.json({ success: true });
});
app.get('/api/solo/typing/:matchId', authMiddleware, async (req, res) => {
    const matchId = req.params.matchId;
    const match = pool ? (await pool.query('SELECT user1, user2 FROM solo_matches WHERE id = $1', [matchId])).rows[0] : MATCHES_MEM.find(m => m.id == matchId);
    if (!match) return res.json({ success: false });
    const otherEmail = match.user1 === req.user.email ? match.user2 : match.user1;
    const key = matchId + ':' + otherEmail;
    const status = TYPING_STATUS[key];
    const isTyping = status && status.isTyping && (Date.now() - status.time < 3000);
    res.json({ success: true, isTyping });
});

// ─── Read Receipts ────────────────────────────────────
app.post('/api/solo/messages/read', authMiddleware, async (req, res) => {
    const { matchId } = req.body;
    if (!matchId) return res.status(400).json({ success: false });
    const match = pool ? (await pool.query('SELECT * FROM solo_matches WHERE id = $1 AND (user1 = $2 OR user2 = $2)', [matchId, req.user.email])).rows[0] : MATCHES_MEM.find(m => m.id == matchId && (m.user1 === req.user.email || m.user2 === req.user.email));
    if (!match) return res.status(403).json({ success: false });
    if (pool) await pool.query('UPDATE solo_messages SET read_at = NOW() WHERE match_id = $1 AND sender != $2 AND read_at IS NULL', [matchId, req.user.email]);
    res.json({ success: true });
});
app.get('/api/solo/messages/unread', authMiddleware, async (req, res) => {
    const email = req.user.email;
    if (pool) {
        const result = await pool.query('SELECT COUNT(*) as count FROM solo_messages m JOIN solo_matches mt ON m.match_id = mt.id WHERE (mt.user1 = $1 OR mt.user2 = $1) AND m.sender != $1 AND m.read_at IS NULL', [email]);
        res.json({ success: true, count: parseInt(result.rows[0].count) });
    } else {
        res.json({ success: true, count: 0 });
    }
});

// ─── Report User ──────────────────────────────────────
app.post('/api/solo/report', authMiddleware, async (req, res) => {
    const { email, reason, details } = req.body;
    if (!email || !reason) return res.status(400).json({ success: false, message: 'Email et raison requis' });
    if (email === req.user.email) return res.status(400).json({ success: false, message: 'Tu ne peux pas te signaler toi-même' });
    const reasons = ['spam', 'faux_profil', 'harcelement', 'contenu_inapproprie', 'arnaque', 'autre'];
    if (!reasons.includes(reason)) return res.status(400).json({ success: false, message: 'Raison invalide' });
    if (pool) {
        await pool.query('INSERT INTO solo_reports (reporter, reported, reason, details) VALUES ($1,$2,$3,$4)', [req.user.email, email, reason, details || '']);
    }
    res.json({ success: true, message: 'Signalement envoyé. Merci pour la communauté Solo.' });
});

// ─── Undo Last Swipe ──────────────────────────────────
const LAST_SWIPE = {};
app.post('/api/solo/swipe/undo', authMiddleware, async (req, res) => {
    const email = req.user.email;
    const last = LAST_SWIPE[email];
    if (!last || Date.now() - last.time > 10000) return res.status(400).json({ success: false, message: 'Rien à annuler' });
    if (pool) {
        await pool.query('DELETE FROM solo_likes WHERE from_user = $1 AND to_user = $2', [email, last.target]);
        await pool.query('DELETE FROM solo_matches WHERE (user1 = $1 AND user2 = $2) OR (user1 = $2 AND user2 = $1)', [email, last.target]);
    }
    delete LAST_SWIPE[email];
    res.json({ success: true, message: 'Swipe annulé' });
});

// ─── Distance Filter + Pagination ─────────────────────
app.get('/api/solo/profiles', authMiddleware, async (req, res) => {
    const { country, gender, ageMin, ageMax, maxDistance, offset, limit } = req.query;
    const lim = Math.min(parseInt(limit) || 20, 50);
    const off = parseInt(offset) || 0;
    const me = pool ? (await pool.query('SELECT lat, lng FROM solo_users WHERE email = $1', [req.user.email])).rows[0] : USERS_MEM[req.user.email];
    const myLat = me?.lat || 0;
    const myLng = me?.lng || 0;
    if (pool) {
        const conditions = ['email != $1', 'incognito = false'];
        const params = [req.user.email];
        let idx = 2;
        if (gender) { conditions.push(`gender = $${idx++}`); params.push(gender); }
        if (country) { conditions.push(`country = $${idx++}`); params.push(country); }
        if (ageMin) { conditions.push(`age >= $${idx++}`); params.push(parseInt(ageMin)); }
        if (ageMax) { conditions.push(`age <= $${idx++}`); params.push(parseInt(ageMax)); }
        const where = conditions.join(' AND ');
        let profiles = (await pool.query(`SELECT pseudo, email, gender, age, country, city, photos, bio, verified, lat, lng, last_seen, created_at FROM solo_users WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`, [...params, lim, off])).rows;
        const enriched = profiles.map(p => {
            let distanceKm = null;
            if (myLat && myLng && p.lat && p.lng) distanceKm = Math.round(haversineKm(myLat, myLng, p.lat, p.lng));
            const lastSeen = p.last_seen ? new Date(p.last_seen) : null;
            const isOnline = lastSeen && (Date.now() - lastSeen.getTime() < 2 * 60 * 1000);
            return { ...p, distanceKm, isOnline, lastSeen: isOnline ? null : lastSeen };
        }).filter(p => !maxDistance || p.distanceKm === null || p.distanceKm <= parseInt(maxDistance));
        res.json({ success: true, profiles: enriched, hasMore: profiles.length === lim });
    } else {
        let filtered = Object.values(USERS_MEM).filter(u => u.email !== req.user.email && !u.incognito).map(p => ({ pseudo: p.pseudo, email: p.email, gender: p.gender, age: p.age, country: p.country, city: p.city, photos: p.photos, bio: p.bio, verified: p.verified, lat: p.lat, lng: p.lng, last_seen: p.last_seen, created_at: p.created_at }));
        if (gender) filtered = filtered.filter(p => p.gender === gender);
        if (country) filtered = filtered.filter(p => p.country === country);
        if (ageMin) filtered = filtered.filter(p => p.age >= parseInt(ageMin));
        if (ageMax) filtered = filtered.filter(p => p.age <= parseInt(ageMax));
        const enriched = filtered.slice(off, off + lim).map(p => {
            let distanceKm = null;
            if (myLat && myLng && p.lat && p.lng) distanceKm = Math.round(haversineKm(myLat, myLng, p.lat, p.lng));
            const lastSeen = p.last_seen ? new Date(p.last_seen) : null;
            const isOnline = lastSeen && (Date.now() - lastSeen.getTime() < 2 * 60 * 1000);
            return { ...p, distanceKm, isOnline, lastSeen: isOnline ? null : lastSeen };
        }).filter(p => !maxDistance || p.distanceKm === null || p.distanceKm <= parseInt(maxDistance));
        res.json({ success: true, profiles: enriched, hasMore: off + lim < filtered.length });
    }
});

// ─── Boost Profile ────────────────────────────────────
app.post('/api/solo/boost', authMiddleware, async (req, res) => {
    const email = req.user.email;
    const user = pool ? (await pool.query('SELECT plan FROM solo_users WHERE email = $1', [email])).rows[0] : USERS_MEM[email];
    if (!user || user.plan === 'free') return res.status(403).json({ success: false, message: 'Boost réservé aux VIP' });
    const activeBoost = pool ? (await pool.query('SELECT * FROM solo_boosts WHERE user_id = $1 AND expires_at > NOW()', [email])).rows[0] : null;
    if (activeBoost) return res.status(400).json({ success: false, message: 'Boost déjà actif' });
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    if (pool) await pool.query('INSERT INTO solo_boosts (user_id, expires_at) VALUES ($1,$2)', [email, expiresAt]);
    res.json({ success: true, message: '🚀 Boost activé pendant 30 min !', expiresAt });
});

// ─── See Who Liked You ────────────────────────────────
app.get('/api/solo/likes-received', authMiddleware, async (req, res) => {
    const email = req.user.email;
    const user = pool ? (await pool.query('SELECT plan FROM solo_users WHERE email = $1', [email])).rows[0] : USERS_MEM[email];
    const isVip = user && user.plan !== 'free';
    const likes = pool
        ? (await pool.query(`SELECT l.from_user, l.created_at, u.pseudo, u.age, u.country, u.city, u.photos
             FROM solo_likes l JOIN solo_users u ON l.from_user = u.email
             WHERE l.to_user = $1 AND l.from_user NOT IN
             (SELECT user2 FROM solo_matches WHERE user1 = $1 UNION SELECT user1 FROM solo_matches WHERE user2 = $1)
             ORDER BY l.created_at DESC LIMIT 20`, [email])).rows
        : LIKES_MEM.filter(l => l.to === email && !MATCHES_MEM.find(m => (m.user1 === email && m.user2 === l.from) || (m.user2 === email && m.user1 === l.from)));
    const profiles = likes.map(l => ({
        email: l.from_user || l.from, pseudo: l.pseudo, age: l.age,
        country: l.country, city: l.city, photos: (l.photos || [])[0] || null,
        visible: isVip
    }));
    res.json({ success: true, likes: profiles, isVip });
});

app.get('/api/solo/referral', authMiddleware, async (req, res) => {
    const user = pool ? (await pool.query('SELECT referral_code, referrals_count, plan, plan_expires_at FROM solo_users WHERE email = $1', [req.user.email])).rows[0] : USERS_MEM[req.user.email];
    if (!user) return res.status(404).json({ success: false });
    res.json({
        success: true,
        referralCode: user.referral_code,
        referralsCount: user.referrals_count || 0,
        needed: 3,
        plan: user.plan
    });
});

app.post('/api/solo/referral/claim', authMiddleware, async (req, res) => {
    const user = pool ? (await pool.query('SELECT * FROM solo_users WHERE email = $1', [req.user.email])).rows[0] : USERS_MEM[req.user.email];
    if (!user) return res.status(404).json({ success: false });
    const count = user.referrals_count || 0;
    if (count < 3) return res.status(400).json({ success: false, message: 'Pas assez de filleuls (3 requis)' });
    if (user.plan !== 'free') return res.status(400).json({ success: false, message: 'Déjà premium' });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (pool) {
        await pool.query('UPDATE solo_users SET plan = $1, plan_expires_at = $2, referrals_count = 0 WHERE email = $3', ['vip', expiresAt, req.user.email]);
    } else {
        user.plan = 'vip';
        user.referrals_count = 0;
        USERS_MEM[req.user.email] = user;
    }
    res.json({ success: true, message: '🎉 VIP activé pour 24h ! Profites-en.', plan: 'vip' });
});

app.all('/api/solo/admin/stats', async (req, res) => {
    const adminPass = (req.method === 'POST' ? req.body.key : req.query.key);
    if (adminPass !== ADMIN_KEY) return res.json({ success: false });
    if (pool) {
        const users = (await pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as new7d, COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as new24h, COUNT(CASE WHEN plan != 'free' THEN 1 END) as premium, COUNT(CASE WHEN verified = true THEN 1 END) as verified, COUNT(CASE WHEN last_seen > NOW() - INTERVAL '5 minutes' THEN 1 END) as online FROM solo_users")).rows[0];
        const matches = (await pool.query('SELECT COUNT(*) as total FROM solo_matches')).rows[0].total;
        const messages = (await pool.query('SELECT COUNT(*) as total FROM solo_messages')).rows[0].total;
        const annonces = (await pool.query('SELECT COUNT(*) as total FROM solo_annonces WHERE expires_at > NOW()')).rows[0].total;
        const reports = (await pool.query("SELECT COUNT(*) as total FROM solo_reports WHERE status = 'pending'")).rows[0].total;
        const boosts = (await pool.query('SELECT COUNT(*) as total FROM solo_boosts WHERE expires_at > NOW()')).rows[0].total;
        const dailySignups = (await pool.query("SELECT DATE(created_at) as date, COUNT(*) as count FROM solo_users WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY date")).rows;
        const topCountries = (await pool.query("SELECT country, COUNT(*) as count FROM solo_users GROUP BY country ORDER BY count DESC LIMIT 10")).rows;
        const genderStats = (await pool.query("SELECT gender, COUNT(*) as count FROM solo_users GROUP BY gender")).rows;
        res.json({ success: true, users: { ...users, total: parseInt(users.total) }, matches, messages, annonces, reports, boosts, dailySignups, topCountries, genderStats });
    } else {
        res.json({ success: true, users: { total: Object.keys(USERS_MEM).length, new7d: 0, new24h: 0, premium: 0, verified: 0, online: 0 }, matches: MATCHES_MEM.length, messages: 0, annonces: ANNONCES_MEM.length, reports: 0, boosts: 0, dailySignups: [], topCountries: [], genderStats: [] });
    }
});

app.all('/api/solo/admin/users', async (req, res) => {
    const key = (req.method === 'POST' ? req.body.key : req.query.key);
    if (key !== ADMIN_KEY) return res.json({ success: false });
    const { search, gender, country, plan, page, limit } = req.method === 'POST' ? req.body : req.query;
    const lim = Math.min(parseInt(limit) || 50, 100);
    const off = ((parseInt(page) || 1) - 1) * lim;
    if (pool) {
        let conditions = [];
        let params = [];
        let idx = 1;
        if (search) { conditions.push(`(pseudo ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx})`); params.push('%' + search + '%'); idx++; }
        if (gender) { conditions.push(`gender = $${idx++}`); params.push(gender); }
        if (country) { conditions.push(`country = $${idx++}`); params.push(country); }
        if (plan) { conditions.push(`plan = $${idx++}`); params.push(plan); }
        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const total = (await pool.query(`SELECT COUNT(*) FROM solo_users ${where}`, params)).rows[0].count;
        const list = (await pool.query(`SELECT id, pseudo, email, phone, gender, age, country, city, plan, verified, last_seen, created_at FROM solo_users ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`, [...params, lim, off])).rows;
        res.json({ success: true, users: list, total: parseInt(total), page: parseInt(page) || 1, pages: Math.ceil(total / lim) });
    } else {
        res.json({ success: true, users: Object.values(USERS_MEM).slice(off, off + lim), total: Object.keys(USERS_MEM).length, page: 1, pages: 1 });
    }
});

app.all('/api/solo/admin/users/:email', async (req, res) => {
    const key = (req.method === 'POST' ? req.body.key : req.query.key);
    if (key !== ADMIN_KEY) return res.json({ success: false });
    const email = req.params.email;
    if (pool) {
        const user = (await pool.query('SELECT * FROM solo_users WHERE email = $1', [email])).rows[0];
        if (!user) return res.status(404).json({ success: false });
        const matches = (await pool.query('SELECT COUNT(*) FROM solo_matches WHERE user1 = $1 OR user2 = $1', [email])).rows[0].count;
        const messages = (await pool.query('SELECT COUNT(*) FROM solo_messages WHERE sender = $1', [email])).rows[0].count;
        const likes = (await pool.query('SELECT COUNT(*) FROM solo_likes WHERE from_user = $1', [email])).rows[0].count;
        res.json({ success: true, user, stats: { matches: parseInt(matches), messages: parseInt(messages), likes: parseInt(likes) } });
    } else {
        const user = USERS_MEM[email];
        if (!user) return res.status(404).json({ success: false });
        res.json({ success: true, user, stats: { matches: 0, messages: 0, likes: 0 } });
    }
});

app.post('/api/solo/admin/users/:email/ban', async (req, res) => {
    if (req.body.key !== ADMIN_KEY) return res.json({ success: false });
    const email = req.params.email;
    if (pool) {
        await pool.query("UPDATE solo_users SET plan = 'banned' WHERE email = $1", [email]);
    }
    res.json({ success: true, message: 'Utilisateur banni' });
});

app.post('/api/solo/admin/users/:email/unban', async (req, res) => {
    if (req.body.key !== ADMIN_KEY) return res.json({ success: false });
    const email = req.params.email;
    if (pool) {
        await pool.query("UPDATE solo_users SET plan = 'free' WHERE email = $1", [email]);
    }
    res.json({ success: true, message: 'Utilisateur débanni' });
});

app.all('/api/solo/admin/reports', async (req, res) => {
    const key = (req.method === 'POST' ? req.body.key : req.query.key);
    if (key !== ADMIN_KEY) return res.json({ success: false });
    const { status } = req.method === 'POST' ? req.body : req.query;
    if (pool) {
        let query = 'SELECT r.*, u.pseudo as reported_pseudo FROM solo_reports r LEFT JOIN solo_users u ON r.reported = u.email';
        const params = [];
        if (status) { query += ' WHERE r.status = $1'; params.push(status); }
        query += ' ORDER BY r.created_at DESC LIMIT 100';
        const reports = (await pool.query(query, params)).rows;
        res.json({ success: true, reports });
    } else {
        res.json({ success: true, reports: [] });
    }
});

app.post('/api/solo/admin/reports/:id/resolve', async (req, res) => {
    if (req.body.key !== ADMIN_KEY) return res.json({ success: false });
    const id = parseInt(req.params.id);
    const { action } = req.body;
    if (pool) {
        await pool.query('UPDATE solo_reports SET status = $1 WHERE id = $2', [action || 'resolved', id]);
    }
    res.json({ success: true, message: 'Report traité' });
});

app.all('/api/solo/admin/annonces', async (req, res) => {
    const key = (req.method === 'POST' ? req.body.key : req.query.key);
    if (key !== ADMIN_KEY) return res.json({ success: false });
    if (pool) {
        const annonces = (await pool.query('SELECT * FROM solo_annonces ORDER BY created_at DESC LIMIT 100')).rows;
        res.json({ success: true, annonces });
    } else {
        res.json({ success: true, annonces: ANNONCES_MEM });
    }
});

app.post('/api/solo/admin/annonces/:id/delete', async (req, res) => {
    if (req.body.key !== ADMIN_KEY) return res.json({ success: false });
    const id = parseInt(req.params.id);
    if (pool) {
        await pool.query('DELETE FROM solo_annonces WHERE id = $1', [id]);
    } else {
        const idx = ANNONCES_MEM.findIndex(a => a.id === id);
        if (idx !== -1) ANNONCES_MEM.splice(idx, 1);
    }
    res.json({ success: true, message: 'Annonce supprimée' });
});

app.all('/api/solo/admin/messages/suspicious', async (req, res) => {
    const key = (req.method === 'POST' ? req.body.key : req.query.key);
    if (key !== ADMIN_KEY) return res.json({ success: false });
    if (pool) {
        const msgs = (await pool.query("SELECT m.*, u.pseudo as sender_pseudo FROM solo_messages m LEFT JOIN solo_users u ON m.sender = u.email WHERE m.content ~* '(envoie.*argent|OM.*code|moMo.*code|wester.*union|money.*gram)' ORDER BY m.created_at DESC LIMIT 50")).rows;
        res.json({ success: true, messages: msgs });
    } else {
        res.json({ success: true, messages: [] });
    }
});

app.all('/api/solo/admin/boosts', async (req, res) => {
    const key = (req.method === 'POST' ? req.body.key : req.query.key);
    if (key !== ADMIN_KEY) return res.json({ success: false });
    if (pool) {
        const boosts = (await pool.query('SELECT b.*, u.pseudo FROM solo_boosts b LEFT JOIN solo_users u ON b.user_id = u.email WHERE b.expires_at > NOW() ORDER BY b.created_at DESC')).rows;
        res.json({ success: true, boosts });
    } else {
        res.json({ success: true, boosts: [] });
    }
});

app.post('/api/solo/admin/block', async (req, res) => {
    if (req.body.key !== ADMIN_KEY) return res.json({ success: false });
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false });
    if (pool) {
        await pool.query('DELETE FROM solo_messages WHERE match_id IN (SELECT id FROM solo_matches WHERE user1 = $1 OR user2 = $1)', [email]);
        await pool.query('DELETE FROM solo_matches WHERE user1 = $1 OR user2 = $1', [email]);
        await pool.query('DELETE FROM solo_likes WHERE from_user = $1 OR to_user = $1', [email]);
        await pool.query('DELETE FROM solo_users WHERE email = $1', [email]);
    } else {
        delete USERS_MEM[email];
        for (let i = LIKES_MEM.length - 1; i >= 0; i--) { if (LIKES_MEM[i].from === email || LIKES_MEM[i].to === email) LIKES_MEM.splice(i, 1); }
        for (let i = MATCHES_MEM.length - 1; i >= 0; i--) { if (MATCHES_MEM[i].user1 === email || MATCHES_MEM[i].user2 === email) MATCHES_MEM.splice(i, 1); }
    }
    res.json({ success: true, message: 'Utilisateur bloqué' });
});

app.get('/api/solo/messages/:matchId', authMiddleware, async (req, res) => {
    const match = pool
        ? (await pool.query('SELECT * FROM solo_matches WHERE id = $1 AND (user1 = $2 OR user2 = $2)', [req.params.matchId, req.user.email])).rows[0]
        : MATCHES_MEM.find(m => m.id === req.params.matchId && (m.user1 === req.user.email || m.user2 === req.user.email));
    if (!match) return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    const msgs = pool
        ? (await pool.query('SELECT sender, content, created_at FROM solo_messages WHERE match_id = $1 ORDER BY created_at', [req.params.matchId])).rows
        : (MSGS_MEM[req.params.matchId] || []);
    res.json({ success: true, messages: msgs });
});

// ─── SSE Chat Stream ──────────────────────────────────
app.get('/api/solo/chat/stream/:matchId', async (req, res) => {
    const token = req.query.token || req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false });
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); } catch (e) { return res.status(401).json({ success: false }); }
    const matchId = req.params.matchId;
    const email = decoded.email;
    const match = pool
        ? (await pool.query('SELECT * FROM solo_matches WHERE id = $1 AND (user1 = $2 OR user2 = $2)', [matchId, email])).rows[0]
        : MATCHES_MEM.find(m => m.id == matchId && (m.user1 === email || m.user2 === email));
    if (!match) return res.status(403).json({ success: false });
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
    });
    res.write('data: {"type":"connected"}\n\n');
    let lastCheck = new Date().toISOString();
    const interval = setInterval(async () => {
        try {
            const msgs = pool
                ? (await pool.query('SELECT sender, content, created_at FROM solo_messages WHERE match_id = $1 AND created_at > $2 ORDER BY created_at', [matchId, lastCheck])).rows
                : (MSGS_MEM[matchId] || []).filter(m => m.time > lastCheck);
            if (msgs.length > 0) {
                lastCheck = new Date().toISOString();
                res.write('data: ' + JSON.stringify({ type: 'messages', messages: msgs }) + '\n\n');
            }
        } catch (e) {}
    }, 1500);
    req.on('close', () => clearInterval(interval));
});

// ─── Health ──────────────────────────────────────────
app.get('/health', async (req, res) => {
    const users = pool ? (await pool.query('SELECT COUNT(*) FROM solo_users')).rows[0].count : Object.keys(USERS_MEM).length;
    res.json({ success: true, status: 'ok', uptime: process.uptime(), users, db: pool ? 'postgres' : 'memory', version: '2.0' });
});

// ─── SPA fallback ────────────────────────────────────
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, message: 'Endpoint API inconnu' });
    res.sendFile(path.join(__dirname, '..', req.path === '/' ? 'index.html' : req.path), (err) => {
        if (err) res.sendFile(path.join(__dirname, '..', 'index.html'));
    });
});

// ─── Global error handler ────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
});
const ADMIN_KEY = process.env.ADMIN_KEY || 'solo2025';
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));

// ─── Start ───────────────────────────────────────────
initDB().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log('━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🔥 Solo  : http://localhost:${PORT}`);
        console.log(`📊 DB    : ${pool ? 'PostgreSQL' : 'Memory'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━');
    });
}).catch(e => console.error('DB init failed:', e));
