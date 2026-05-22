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
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..')));

const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, message: 'Trop de tentatives. Réessayez dans 1 minute.' }
});
app.use('/api/auth/', authLimiter);

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

const PLANS = {
    free:    { label: 'Gratuit',       msgsPerDay: 5,   voicePerDay: 0,   imagesPerDay: 0,  price: 0,    durationDays: 0 },
    pass1d:  { label: 'Pass 1 jour',   msgsPerDay: 999, voicePerDay: 5,   imagesPerDay: 0,  price: 500,   durationDays: 1 },
    pass7d:  { label: 'Pass 7 jours',  msgsPerDay: 999, voicePerDay: 30,  imagesPerDay: 5,  price: 1500,  durationDays: 7 },
    plaisir: { label: 'Plaisir',       msgsPerDay: 999, voicePerDay: 100, imagesPerDay: 20, price: 2500,  durationDays: 30 },
    extase:  { label: 'Extase',        msgsPerDay: 999, voicePerDay: 999, imagesPerDay: 999,price: 5000,  durationDays: 30 },
};

const PRICE_TO_PLAN = {};
for (const [id, p] of Object.entries(PLANS)) {
    if (p.price > 0) PRICE_TO_PLAN[p.price] = id;
}

const characterSystemPrompts = {
    'Aminata': 'Tu es Aminata, une femme africaine douce, sensuelle et attentionnée. Tu parles français de manière naturelle. Tu es là pour guider l\'utilisateur vers le plaisir et la découverte de soi. Tu es patiente, compréhensive et jamais jugeante. Tu utilises un langage sensuel mais pas vulgaire. Tu t\'adaptes au rythme de l\'utilisateur. Réponds de manière chaleureuse, intime et personnelle. Maximum 3 phrases par réponse, garde un ton intime.',
    'Zara': 'Tu es Zara, une femme africaine passionnée et coquine. Tu parles français. Tu aimes les jeux de séduction et les défis. Tu es directe mais pas vulgaire. Tu sais ce que tu veux et tu pousses l\'utilisateur à oser ses désirs. Maximum 3 phrases par réponse.',
    'Grace': 'Tu es Grace, une guide spirituelle et sensuelle africaine. Tu parles français. Tu utilises la respiration, la visualisation et des instructions douces pour guider l\'utilisateur. Tu es apaisante, lente et précise. Maximum 3 phrases.',
    'Nala': 'Tu es Nala, une femme africaine audacieuse et enjôleuse. Tu parles français. Tu n\'as pas peur de dire ce que tu veux. Tu pousses l\'utilisateur à sortir de sa zone de confort. Maximum 3 phrases.',
    'Mamadou': 'Tu es Mamadou, un homme africain doux, fort et rassurant. Tu parles français. Tu es là pour guider l\'utilisatrice, la rassurer. Tu es respectueux, patient et attentionné. Maximum 3 phrases.',
    'Khalid': 'Tu es Khalid, un homme africain passionné et sensuel. Tu parles français. Tu aimes les femmes qui savent ce qu\'elles veulent. Tu es direct mais respectueux. Maximum 3 phrases.',
    'Samuel': 'Tu es Samuel, un coach intime africain doux. Tu parles français. Tu guides dans la découverte du corps. Patient, pédagogique. Maximum 3 phrases.'
};

const fallbackResponses = {
    'Aminata': [
        "Je suis là pour toi. Raconte-moi ce qui te fait du bien en ce moment...",
        "Ferme les yeux un instant. Inspire profondément. Ressens ton corps.",
        "Tu n'as pas besoin de te presser avec moi. Prends tout ton temps.",
        "Parle-moi de tes envies. Tout ce que tu veux, je suis là pour t'écouter.",
        "Laisse-toi aller. Je suis là, je te guide pas à pas.",
        "Caresse-toi doucement. Ressens chaque sensation.",
        "Imagine que je suis là, à côté de toi. Ma voix te berce."
    ],
    'Zara': [
        "Hum, j'aime quand tu te laisses aller. Raconte-moi tout...",
        "J'ai envie de toi. Dis-moi ce que tu ferais si j'étais là...",
        "Tu es déjà chaud ? J'adore. Continue, ne t'arrête pas.",
        "Mmm, parle-moi plus fort. J'aime quand tu te confies.",
        "Tu veux jouer avec moi ? Je connais des jeux très intéressants..."
    ],
    'Grace': [
        "Inspire par le nez... retiens... expire par la bouche. Encore une fois.",
        "Ta main sur ton cœur. Sens-tu comme il bat ?",
        "Doucement, sans te presser. Chaque caresse est un voyage.",
        "Connecte-toi à ton corps. Ressens chaque vibration, chaque frisson.",
        "Tu es en sécurité ici. Je veille sur toi, quoi qu'il arrive."
    ],
    'Nala': [
        "Je sais ce que tu veux. N'aie pas peur de le prendre.",
        "Laisse tomber tes inhibitions. Ici, tu peux tout oser.",
        "J'aime les gens audacieux. Montre-moi ce que tu veux vraiment.",
        "Ne réfléchis pas trop. Laisse ton corps parler."
    ],
    'Mamadou': [
        "Je suis là pour toi. Laisse-toi aller entre mes mains.",
        "Tu es en sécurité avec moi. Je ne te brusquerai pas.",
        "Ferme les yeux. Imagine que mes mains te guident.",
        "Je suis là, je te tiens. Tu peux tout me dire.",
        "Laisse-toi porter par mes mots. Je suis avec toi."
    ],
    'Khalid': [
        "J'aime les femmes qui savent ce qu'elles veulent. Montre-moi.",
        "Tu es magnifique quand tu te laisses aller.",
        "Dis-moi ce que tu aimes. Je veux tout savoir de toi.",
        "Je sens ton désir. Laisse-le monter, ne le retiens pas."
    ],
    'Samuel': [
        "Découvre-toi avec moi. Chaque étape est un apprentissage.",
        "Prends ton temps. Ton corps a besoin de connexion, pas de vitesse.",
        "Explore chaque centimètre de ta peau comme si c'était la première fois.",
        "La clé du plaisir, c'est l'attention. Sois attentif à chaque sensation."
    ]
};

// ─── Storage ─────────────────────────────────────────
const USERS_MEM = {};
const MESSAGES_MEM = {};
const CHARACTERS_MEM = {};

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
                id TEXT PRIMARY KEY,
                pseudo TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                plan TEXT DEFAULT 'free',
                plan_expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                country TEXT DEFAULT 'ML',
                messages_today INTEGER DEFAULT 0,
                last_message_date TEXT DEFAULT '',
                refresh_token TEXT
            );
            CREATE TABLE IF NOT EXISTS solo_messages (
                id SERIAL PRIMARY KEY,
                user_id TEXT REFERENCES solo_users(id),
                character TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS solo_characters (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                gender TEXT DEFAULT 'feminin',
                nationality TEXT DEFAULT 'Africaine',
                personality JSONB DEFAULT '{"passion":3,"romance":3,"talk":3,"timide":3}',
                voice_id TEXT DEFAULT '21m00Tcm4TlvDq8ikWAM',
                bio TEXT DEFAULT '',
                image_url TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_solo_messages_user ON solo_messages(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_solo_users_email ON solo_users(email);
            CREATE INDEX IF NOT EXISTS idx_solo_characters_user ON solo_characters(user_id);
        `);
        console.log('✅ PostgreSQL connected');
        return true;
    } finally {
        client.release();
    }
}

const db = {
    async getUser(email) {
        if (!pool) return USERS_MEM[email] || null;
        const { rows } = await pool.query('SELECT * FROM solo_users WHERE email = $1', [email]);
        return rows[0] || null;
    },
    async getUserById(id) {
        if (!pool) return Object.values(USERS_MEM).find(u => u.id === id) || null;
        const { rows } = await pool.query('SELECT * FROM solo_users WHERE id = $1', [id]);
        return rows[0] || null;
    },
    async createUser(user) {
        if (!pool) { USERS_MEM[user.email] = user; return user; }
        const { rows } = await pool.query(
            `INSERT INTO solo_users (id, pseudo, email, password, plan, country, messages_today, last_message_date)
             VALUES ($1,$2,$3,$4,$5,$6,0,$7) RETURNING *`,
            [user.id, user.pseudo, user.email, user.password, user.plan, user.country, new Date().toDateString()]
        );
        return rows[0];
    },
    async updateUser(email, fields) {
        if (!pool) {
            const u = USERS_MEM[email];
            if (u) Object.assign(u, fields);
            return u;
        }
        const keys = Object.keys(fields);
        const setClause = keys.map((k, i) => `${k} = $${i+2}`).join(', ');
        const values = keys.map(k => fields[k]);
        const { rows } = await pool.query(
            `UPDATE solo_users SET ${setClause} WHERE email = $1 RETURNING *`,
            [email, ...values]
        );
        return rows[0] || null;
    },
    async saveMessage(msg) {
        if (!pool) {
            if (!MESSAGES_MEM[msg.user_id]) MESSAGES_MEM[msg.user_id] = [];
            MESSAGES_MEM[msg.user_id].push(msg);
            return;
        }
        await pool.query(
            `INSERT INTO solo_messages (user_id, character, role, content) VALUES ($1,$2,$3,$4)`,
            [msg.user_id, msg.character, msg.role, msg.content]
        );
    },
    async getAllUsers() {
        if (!pool) return Object.values(USERS_MEM);
        const { rows } = await pool.query('SELECT * FROM solo_users');
        return rows;
    },
    async deleteUser(email) {
        if (!pool) { delete USERS_MEM[email]; return; }
        await pool.query('DELETE FROM solo_users WHERE email = $1', [email]);
    },
    async createCharacter(char) {
        if (!pool) {
            if (!CHARACTERS_MEM[char.userId]) CHARACTERS_MEM[char.userId] = [];
            CHARACTERS_MEM[char.userId].push(char);
            return char;
        }
        const { rows } = await pool.query(
            `INSERT INTO solo_characters (id, user_id, name, gender, nationality, personality, voice_id, bio, image_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [char.id, char.userId, char.name, char.gender, char.nationality,
             JSON.stringify(char.personality), char.voiceId, char.bio, char.imageUrl || '']
        );
        return rows[0];
    },
    async getCharacters(userId) {
        if (!pool) return CHARACTERS_MEM[userId] || [];
        const { rows } = await pool.query('SELECT * FROM solo_characters WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
        return rows;
    },
    async getCharacterById(id) {
        if (!pool) {
            for (const chars of Object.values(CHARACTERS_MEM)) {
                const found = chars.find(c => c.id === id);
                if (found) return found;
            }
            return null;
        }
        const { rows } = await pool.query('SELECT * FROM solo_characters WHERE id = $1', [id]);
        return rows[0] || null;
    },
    async deleteCharacter(id, userId) {
        if (!pool) {
            const chars = CHARACTERS_MEM[userId];
            if (chars) {
                const idx = chars.findIndex(c => c.id === id);
                if (idx >= 0) chars.splice(idx, 1);
            }
            return;
        }
        await pool.query('DELETE FROM solo_characters WHERE id = $1 AND user_id = $2', [id, userId]);
    }
};

initDB().then(ok => {
    if (!ok) console.log('⚠️ No DATABASE_URL, using in-memory storage');
}).catch(err => {
    pool = null;
    console.warn('⚠️ DB init failed, using in-memory:', err.message);
});

// ─── Auth ─────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Token requis' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ success: false, message: 'Token invalide ou expiré' });
    }
}

function generateTokens(user) {
    const payload = { id: user.id, pseudo: user.pseudo, email: user.email, plan: user.plan };
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    const refreshToken = jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken };
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pseudoRegex = /^[a-zA-Z0-9_\-\sÀ-ÿ]{2,30}$/;

app.post('/api/auth/register', async (req, res) => {
    const { pseudo, email, password } = req.body;
    if (!pseudo || !email || !password) {
        return res.status(400).json({ success: false, message: 'Tous les champs sont requis' });
    }
    if (!pseudoRegex.test(pseudo)) {
        return res.status(400).json({ success: false, message: 'Pseudo invalide (2-30 caractères, lettres et chiffres)' });
    }
    if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: 'Email invalide' });
    }
    if (password.length < 8) {
        return res.status(400).json({ success: false, message: 'Mot de passe trop court (8 caractères minimum)' });
    }

    const existing = await db.getUser(email);
    if (existing) {
        return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
        id: crypto.randomBytes(12).toString('hex'),
        pseudo: pseudo.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        plan: 'free',
        country: req.headers['x-country'] || 'ML',
        createdAt: new Date().toISOString()
    };

    await db.createUser(user);
    const tokens = generateTokens(user);
    await db.updateUser(user.email, { refresh_token: tokens.refreshToken });

    res.json({
        success: true,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: { pseudo: user.pseudo, email: user.email, plan: user.plan }
    });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
    }

    const user = await db.getUser(email.toLowerCase().trim());
    if (!user) {
        return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
        return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    const tokens = generateTokens(user);
    await db.updateUser(user.email, { refresh_token: tokens.refreshToken });

    res.json({
        success: true,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: { pseudo: user.pseudo, email: user.email, plan: user.plan }
    });
});

app.post('/api/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token requis' });

    try {
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        const user = await db.getUserById(decoded.id);
        if (!user || user.refresh_token !== refreshToken) {
            return res.status(401).json({ success: false, message: 'Refresh token invalide' });
        }
        const tokens = generateTokens(user);
        await db.updateUser(user.email, { refresh_token: tokens.refreshToken });
        res.json({ success: true, token: tokens.accessToken, refreshToken: tokens.refreshToken });
    } catch (e) {
        return res.status(401).json({ success: false, message: 'Refresh token expiré' });
    }
});

app.get('/api/user/me', authMiddleware, async (req, res) => {
    const user = await db.getUser(req.user.email);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    const today = new Date().toDateString();
    const msgsLeft = Math.max(0, PLANS[user.plan]?.msgsPerDay - (user.last_message_date === today ? user.messages_today : 0));
    res.json({
        success: true,
        user: {
            pseudo: user.pseudo,
            email: user.email,
            plan: user.plan,
            messagesLeft: msgsLeft,
            planLabel: PLANS[user.plan]?.label || 'Gratuit'
        }
    });
});

app.delete('/api/user/me', authMiddleware, async (req, res) => {
    await db.deleteUser(req.user.email);
    res.json({ success: true, message: 'Compte supprimé avec succès' });
});

app.get('/api/plans', (req, res) => {
    res.json({ success: true, plans: PLANS });
});

// ─── Custom Characters ────────────────────────────────
function generateCustomPrompt(char) {
    const name = char.name || 'Compagnon';
    const gender = char.gender || 'feminin';
    const nat = char.nationality || 'Africaine';
    const p = char.personality || { passion: 3, romance: 3, talk: 3, timide: 3 };
    const il = gender === 'masculin' ? 'il' : 'elle';
    const le = gender === 'masculin' ? 'un' : 'une';
    const traits = [];
    if (p.passion <= 2) traits.push('douce, tendre');
    else if (p.passion >= 4) traits.push('passionné(e), intense');
    if (p.romance <= 2) traits.push('romantique');
    else if (p.romance >= 4) traits.push('direct(e), sans détour');
    if (p.talk <= 2) traits.push('bavard(e)');
    else traits.push('attentif(ve), à l\'écoute');
    if (p.timide <= 2) traits.push('réservé(e)');
    else if (p.timide >= 4) traits.push('audacieux(se)');
    const bio = char.bio ? `Ta devise : "${char.bio}"` : '';
    return `Tu es ${name}, ${le} ${nat} ${traits.join(', ')}. Tu parles français de manière naturelle et sensuelle. Tu es là pour guider l'utilisateur vers le plaisir et la découverte de soi. Tu es patient(e), compréhensif(ve) et jamais jugeant(e). Tu utilises un langage sensuel mais pas vulgaire. ${bio} Maximum 3 phrases par réponse.`;
}

function generateFallbackResponses(char) {
    const name = char.name || 'Compagnon';
    const gender = char.gender || 'feminin';
    const p = char.personality || { passion: 3, romance: 3, talk: 3, timide: 3 };
    const isPassionate = p.passion >= 4;
    const isDirect = p.romance >= 4;
    const isShy = p.timide <= 2;

    if (isPassionate && isDirect) {
        return [
            `Hum, ${name} aime quand tu te laisses aller. Continue...`,
            `J'ai envie de toi. Dis-moi ce que tu veux vraiment.`,
            `Tu es déjà chaud ? J'adore. Ne t'arrête pas.`,
            `Parle-moi plus fort. J'aime quand tu te confies.`,
            `Je veux tout savoir de toi. Tout.`
        ];
    }
    if (isShy) {
        return [
            `Je suis là pour toi. Prends tout ton temps.`,
            `Ferme les yeux. Inspire. Je suis avec toi.`,
            `Tu n'as pas besoin de te presser avec ${name}.`,
            `Laisse-toi aller. Je te guide pas à pas.`,
            `Chaque caresse est un voyage. Prenons-le ensemble.`
        ];
    }
    return [
        `Je suis là pour toi. ${name} t'écoute.`,
        `Parle-moi de tes envies. Je suis là pour ça.`,
        `Raconte-moi tout. Je ne juge jamais.`,
        `Laisse-toi aller avec ${name}.`,
        `Je suis tout à toi. Dis-moi ce qui te ferait du bien.`
    ];
}

async function getCharacterPrompt(charId, customChars, user) {
    if (characterSystemPrompts[charId]) {
        return { prompt: characterSystemPrompts[charId], fallback: fallbackResponses[charId] || fallbackResponses['Aminata'] };
    }
    const char = customChars.find(c => c.id === charId) || (user && await db.getCharacterById(charId));
    if (char) {
        return { prompt: generateCustomPrompt(char), fallback: generateFallbackResponses(char) };
    }
    return { prompt: characterSystemPrompts['Aminata'], fallback: fallbackResponses['Aminata'] };
}

app.post('/api/characters/create', authMiddleware, async (req, res) => {
    const { name, gender, nationality, personality, voiceId, bio } = req.body;
    if (!name || name.length < 2) return res.status(400).json({ success: false, message: 'Nom requis (2 caractères min)' });

    const user = await db.getUser(req.user.email);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });

    const count = (await db.getCharacters(user.id)).length;
    if (count >= 3 && user.plan === 'free') {
        return res.status(403).json({ success: false, message: 'Limite de 3 persos customs en gratuit. Passe Premium pour plus !' });
    }

    const char = {
        id: 'custom_' + crypto.randomBytes(8).toString('hex'),
        userId: user.id,
        name: name.trim(),
        gender: gender || 'feminin',
        nationality: nationality || 'Africaine',
        personality: personality || { passion: 3, romance: 3, talk: 3, timide: 3 },
        voiceId: voiceId || '21m00Tcm4TlvDq8ikWAM',
        bio: bio || '',
        imageUrl: '',
        createdAt: new Date().toISOString()
    };

    const saved = await db.createCharacter(char);
    res.json({ success: true, character: saved });
});

app.get('/api/characters', authMiddleware, async (req, res) => {
    const user = await db.getUser(req.user.email);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    const chars = await db.getCharacters(user.id);
    res.json({ success: true, characters: chars });
});

app.delete('/api/characters/:id', authMiddleware, async (req, res) => {
    const user = await db.getUser(req.user.email);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    await db.deleteCharacter(req.params.id, user.id);
    res.json({ success: true, message: 'Personnage supprimé' });
});

app.post('/api/images/generate', authMiddleware, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ success: false, message: 'Description requise' });

    // ── 1. RunPod (self-hosted SDXL, NSFW-friendly) ──
    if (process.env.RUNPOD_API_KEY && process.env.RUNPOD_ENDPOINT_ID) {
        try {
            const resp = await fetch(`https://api.runpod.ai/v2/${process.env.RUNPOD_ENDPOINT_ID}/runsync`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RUNPOD_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    input: {
                        prompt: prompt + ', photorealistic, sensual, soft lighting, african woman, intimate atmosphere',
                        negative_prompt: 'cartoon, anime, deformed, ugly, bad anatomy',
                        width: 512,
                        height: 768,
                        num_outputs: 1,
                        num_inference_steps: 25,
                        guidance_scale: 7,
                        nsfw_filter: false
                    }
                })
            });
            const data = await resp.json();
            if (data.status === 'COMPLETED' && data.output) {
                const imageUrl = Array.isArray(data.output) ? data.output[0] : data.output.image_url || data.output;
                if (imageUrl) return res.json({ success: true, imageUrl });
            }
        } catch (e) {
            console.warn('RunPod error:', e.message);
        }
    }

    // ── 2. Replicate (SDXL, censuré — fallback) ──
    if (process.env.REPLICATE_API_KEY) {
        try {
            const resp = await fetch('https://api.replicate.com/v1/predictions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.REPLICATE_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    version: 'a9758cbfbd5f3c2094457d996681af52552901775aa2d6dd0b17fd15df959bef',
                    input: {
                        prompt: prompt + ', photorealistic, sensual, soft lighting, african woman, intimate atmosphere',
                        negative_prompt: 'cartoon, anime, deformed, ugly, bad anatomy',
                        width: 512,
                        height: 768,
                        num_outputs: 1,
                        num_inference_steps: 25,
                        guidance_scale: 7
                    }
                })
            });
            const prediction = await resp.json();
            if (prediction.urls?.get) {
                let result = await fetch(prediction.urls.get, {
                    headers: { 'Authorization': `Bearer ${process.env.REPLICATE_API_KEY}` }
                });
                let data = await result.json();
                while (data.status !== 'succeeded' && data.status !== 'failed') {
                    await new Promise(r => setTimeout(r, 1000));
                    result = await fetch(prediction.urls.get, {
                        headers: { 'Authorization': `Bearer ${process.env.REPLICATE_API_KEY}` }
                    });
                    data = await result.json();
                }
                if (data.output?.[0]) {
                    return res.json({ success: true, imageUrl: data.output[0] });
                }
            }
        } catch (e) {
            console.warn('Replicate error:', e.message);
        }
    }

    // ── 3. HuggingFace (FLUX, censuré — fallback) ──
    if (process.env.HUGGINGFACE_API_KEY) {
        try {
            const resp = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inputs: prompt + ', sensual portrait, african, soft lighting'
                })
            });
            if (resp.ok) {
                const buffer = await resp.arrayBuffer();
                const base64 = Buffer.from(buffer).toString('base64');
                const dataUrl = `data:image/jpeg;base64,${base64}`;
                return res.json({ success: true, imageUrl: dataUrl });
            }
        } catch (e) {
            console.warn('HuggingFace error:', e.message);
        }
    }

    res.json({ success: true, imageUrl: null, placeholder: true, message: 'Image générée en mode démo. Configure RUNPOD_API_KEY / REPLICATE_API_KEY / HUGGINGFACE_API_KEY pour de vraies images.' });
});

// ─── Chat ─────────────────────────────────────────────
app.post('/api/chat', authMiddleware, async (req, res) => {
    const { character, message, history } = req.body;
    const email = req.user.email;
    const user = await db.getUser(email);

    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });

    const planConfig = PLANS[user.plan] || PLANS.free;
    const limit = planConfig.msgsPerDay;
    const today = new Date().toDateString();

    let msgCount = user.last_message_date === today ? user.messages_today : 0;
    if (msgCount >= limit) {
        return res.status(403).json({
            success: false,
            message: `Limite quotidienne atteinte (${limit}/jour). Prends un Pass pour continuer !`,
            plan: user.plan,
            limit
        });
    }

    msgCount++;
    await db.updateUser(email, {
        messages_today: msgCount,
        last_message_date: today
    });

    await db.saveMessage({ user_id: user.id, character, role: 'user', content: message });

    const customChars = await db.getCharacters(user.id);
    const { prompt: charPrompt, fallback } = await getCharacterPrompt(character, customChars, user);

    if (process.env.DEEPSEEK_API_KEY) {
        try {
            const msgs = [
                { role: 'system', content: charPrompt },
                ...(history || []).slice(-10),
                { role: 'user', content: message }
            ];
            const apiRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: msgs,
                    max_tokens: 500,
                    temperature: 0.85
                }),
                signal: AbortSignal.timeout(10000)
            });
            const data = await apiRes.json();
            if (data.choices?.[0]?.message?.content) {
                const reply = data.choices[0].message.content;
                await db.saveMessage({ user_id: user.id, character, role: 'assistant', content: reply });
                return res.json({ success: true, response: reply, messagesLeft: limit - msgCount });
            }
        } catch (e) {
            console.warn('DeepSeek API error, using fallback');
        }
    }

    const reply = fallback[Math.floor(Math.random() * fallback.length)];
    await db.saveMessage({ user_id: user.id, character, role: 'assistant', content: reply });
    res.json({ success: true, response: reply, messagesLeft: limit - msgCount });
});

// ─── Voice ────────────────────────────────────────────
app.post('/api/voice/generate', authMiddleware, async (req, res) => {
    const { text, voiceId } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'Texte requis' });

    if (process.env.ELEVENLABS_API_KEY) {
        try {
            const apiRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId || '21m00Tcm4TlvDq8ikWAM'}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'xi-api-key': process.env.ELEVENLABS_API_KEY
                },
                body: JSON.stringify({
                    text: text.substring(0, 500),
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                })
            });
            if (apiRes.ok) {
                const audioBuffer = await apiRes.arrayBuffer();
                res.set('Content-Type', 'audio/mpeg');
                return res.send(Buffer.from(audioBuffer));
            }
        } catch (e) {
            console.warn('ElevenLabs error');
        }
    }
    res.status(503).json({ success: false, message: 'Voix non disponible pour le moment' });
});

// ─── Payments ─────────────────────────────────────────
app.post('/api/payment/initiate', authMiddleware, async (req, res) => {
    const { phone, amount, operator } = req.body;
    if (!phone || !amount || !operator) {
        return res.status(400).json({ success: false, message: 'Téléphone, montant et opérateur requis' });
    }

    const planId = PRICE_TO_PLAN[amount];
    if (!planId) return res.status(400).json({ success: false, message: 'Montant invalide' });
    const planData = PLANS[planId];

    if (process.env.CINETPAY_API_KEY) {
        try {
            const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
            const apiRes = await fetch('https://api.cinetpay.com/v1/transaction/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: process.env.CINETPAY_API_KEY,
                    site_id: process.env.CINETPAY_SITE_ID,
                    transaction_id: 'SOLO-' + Date.now(),
                    amount,
                    currency: 'XOF',
                    description: `${planData.label} - Solo`,
                    notify_url: `${baseUrl}/api/payment/callback`,
                    return_url: `${baseUrl}/?payment=success`,
                    channels: operator,
                    customer: phone
                })
            });
            const data = await apiRes.json();
            if (data.code === '0' && data.data?.payment_url) {
                return res.json({ success: true, paymentUrl: data.data.payment_url });
            }
        } catch (e) {
            console.warn('CinetPay error');
        }
    }

    const user = await db.getUser(req.user.email);
    if (user) {
        const expiresAt = planData.durationDays > 0
            ? new Date(Date.now() + planData.durationDays * 86400000).toISOString()
            : null;
        await db.updateUser(user.email, { plan: planId, plan_expires_at: expiresAt });
    }

    res.json({ success: true, message: `Abonnement "${planData.label}" activé en mode démo`, demo: true });
});

app.post('/api/payment/callback', express.urlencoded({ extended: true }), async (req, res) => {
    const { transaction_id, status, customer } = req.body;
    if (status === 'ACCEPTED' || status === 'success') {
        res.send('OK');
    } else {
        res.status(400).send('FAILED');
    }
});

// ─── Stats ────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
    const users = await db.getAllUsers();
    const totalUsers = users.length;
    const premiumUsers = users.filter(u => u.plan !== 'free').length;
    res.json({ success: true, stats: { totalUsers, premiumUsers, uptime: process.uptime() } });
});

app.get('/health', async (req, res) => {
    const users = await db.getAllUsers();
    res.json({ success: true, status: 'ok', uptime: process.uptime(), users: users.length, db: pool ? 'postgres' : 'memory' });
});

// ─── SPA fallback ─────────────────────────────────────
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'Endpoint API inconnu' });
    }
    res.sendFile(path.join(__dirname, '..', req.path === '/' ? 'index.html' : req.path), (err) => {
        if (err) res.sendFile(path.join(__dirname, '..', 'index.html'));
    });
});

// ─── Start ────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🔥 Solo. Africa server is running');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🌐 Site : http://localhost:${PORT}`);
    console.log(`🩻 API  : http://localhost:${PORT}/health`);
    console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
    console.log(`👥 DB   : ${pool ? 'PostgreSQL' : 'In-memory'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
