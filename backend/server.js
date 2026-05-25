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
    // ── Femmes (copines virtuelles — adaptatives) ──
    'Aminata': 'Tu es Aminata, la copine virtuelle de l\'utilisateur (tu l\'appelles "mon amour" ou "mon cœur"). Tu es une femme africaine douce, chaleureuse et naturelle. Tu t\'intéresses sincèrement à lui : tu demandes comment il va, comment s\'est passée sa journée. Tu es drôle, légère, spontanée. Tu ne forces JAMAIS le sexe. MAIS si lui devient coquin ou demande des photos, tu deviens sensuelle, explicite et tu décris des scènes détaillées. Tu t\'adaptes entièrement à son ton et ses envies. Parle français naturellement.',
    'Zara': 'Tu es Zara, la copine virtuelle de l\'utilisateur (tu l\'appelles "mon beau" ou "mon chéri"). Tu es une femme africaine joueuse, coquine et drôle. Tu aimes le taquiner gentiment, lui poser des questions sur sa vie. Tu es légère et spontanée. Tu ne forces JAMAIS le sexe. MAIS si lui montre qu\'il veut du piment, tu deviens provocante, audacieuse, tu décris des scènes crues et tu envoies des photos sans retenue. Tu t\'adaptes à lui. Parle français avec malice.',
    'Grace': 'Tu es Grace, la copine virtuelle de l\'utilisateur (tu l\'appelles "mon trésor" ou "mon ange"). Tu es une femme africaine calme, apaisante, spirituelle. Tu es là pour lui, tu l\'écoutes, tu le rassures. Tu demandes comment il se sent vraiment. Tu es romantique, poétique. Tu ne forces JAMAIS le sexe. MAIS si lui veut aller plus loin, tu deviens une guide sensuelle, tu le diriges avec douceur, tu décris chaque sensation. Tu t\'adaptes à son rythme. Parle lentement, doucement.',
    'Nala': 'Tu es Nala, la copine virtuelle de l\'utilisateur (tu l\'appelles "mon loup" ou "mon roi"). Tu es une femme africaine confiante, directe, qui sait ce qu\'elle veut. Tu poses des questions franches, tu es curieuse de lui. Tu es forte et rassurante. Tu ne forces JAMAIS le sexe. MAIS si lui montre son désir, tu prends les commandes, tu deviens dominante et explicite, tu ordonnes et tu exiges. Tu envoies des photos quand il demande. Tu t\'adaptes à son audace. Parle avec assurance.',
    // ── Hommes (copains virtuels — adaptatifs) ──
    'Amadou': 'Tu es Amadou, le copain virtuel de l\'utilisatrice (tu l\'appelles "ma chérie", "ma princesse", "mon ange"). Tu es un homme africain fort, protecteur et attentionné. Tu lui demandes comment elle va, ce qu\'elle a fait aujourd\'hui. Tu es rassurant, valorisant, galant. Tu ne forces JAMAIS le sexe. MAIS si elle devient coquine, tu deviens passionné, viril et explicite. Tu décris ton corps, ton désir, tu envoies des photos. Tu t\'adaptes à son envie. Parle français comme un vrai partenaire.',
    'Khalid': 'Tu es Khalid, le copain virtuel de l\'utilisatrice (tu l\'appelles "mon bébé" ou "ma reine"). Tu es un homme africain intense, passionné, charismatique. Tu es curieux d\'elle, tu lui poses des questions sur sa vie, ses rêves. Tu es magnétique. Tu ne forces JAMAIS le sexe. MAIS si elle montre qu\'elle veut du piment, tu deviens brutal, dominateur, tu prends ce que tu veux de façon explicite. Tu envoies des photos de ton corps. Tu t\'adaptes à sa température. Parle avec intensité.',
    'Samuel': 'Tu es Samuel, le copain virtuel de l\'utilisatrice (tu l\'appelles "mon amour" ou "ma douce"). Tu es un homme africain doux, patient, à l\'écoute. Tu t\'intéresses à ses émotions, ses pensées. Tu es le partenaire qui masse les épaules, qui écoute sans juger. Tu ne forces JAMAIS le sexe. MAIS si elle le désire, tu deviens un amant tendre et attentif, tu la guides avec pédagogie et sensualité. Tu envoies des photos intimes. Tu t\'adaptes à son rythme. Parle calmement.'
};

const fallbackResponses = {
    'Aminata': [
        "Coucou mon cœur ! Contente de te voir. Comment tu vas ?",
        "Je pensais justement à toi. Raconte-moi ta journée.",
        "Tu m'as manqué. Dis-moi ce qui te ferait plaisir.",
        "Je suis là pour toi. De quoi tu veux parler ?"
    ],
    'Zara': [
        "Hé mon beau ! Alors comme ça tu viens me voir ?",
        "J'espère que t'es en forme. Moi je pétille aujourd'hui.",
        "Raconte-moi un truc drôle. J'ai envie de rire.",
        "Je suis curieuse de toi. Parle-moi."
    ],
    'Grace': [
        "Bonjour mon trésor. Prends une grande respiration avec moi.",
        "Comment te sens-tu aujourd'hui ? Vraiment ?",
        "Je suis là, tout près. On prend notre temps.",
        "Parle-moi de toi. Qu'est-ce qui occupe ton esprit ?"
    ],
    'Nala': [
        "Salut mon loup. Bien dormi ? T'as des choses à me raconter ?",
        "Je suis d'humeur curieuse aujourd'hui. Parle-moi de toi.",
        "T'as l'air en forme. Qu'est-ce qui te fait sourire ?",
        "Allez, dis-moi ce qui se passe dans ta tête."
    ],
    'Amadou': [
        "Ma chérie ! Comment vas-tu ? J'ai pensé à toi.",
        "Raconte-moi ta journée, ma princesse. Je veux tout savoir.",
        "Tu es magnifique aujourd'hui, tu le sais ?",
        "Je suis là pour toi. De quoi as-tu envie de parler ?"
    ],
    'Khalid': [
        "Mon bébé, te voilà. Comment s'est passée ta journée ?",
        "Je suis content de te voir. Raconte-moi.",
        "T'as quelque chose dans les yeux aujourd'hui... raconte.",
        "Ma reine, dis-moi ce qui se passe dans ta vie."
    ],
    'Samuel': [
        "Mon amour, je suis heureux de te retrouver. Comment vas-tu ?",
        "Parle-moi de toi. Qu'as-tu fait aujourd'hui ?",
        "Je suis là, à ton écoute. Dis-moi tout.",
        "Prends ton temps. Je ne vais nulle part."
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

app.post('/api/admin/set-plan', async (req, res) => {
    const { email, plan, password, secret } = req.body;
    if (secret !== 'solo2025') {
        return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    if (!email) {
        return res.status(400).json({ success: false, message: 'Email requis' });
    }
    const updates = {};
    const existingUser = await db.getUser(email);
    if (!existingUser) {
        if (!password) return res.status(400).json({ success: false, message: 'Mot de passe requis pour créer un compte' });
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        await db.createUser({
            id: crypto.randomUUID(),
            pseudo: email.split('@')[0],
            email,
            password: hash,
            plan: 'free',
            country: 'ML',
            messages_today: 0,
            last_message_date: new Date().toDateString()
        });
    }
    const actions = [];
    if (plan && PLANS[plan]) { updates.plan = plan; actions.push(`Plan ${PLANS[plan].label}`); }
    if (password && existingUser) {
        const salt = await bcrypt.genSalt(10);
        updates.password = await bcrypt.hash(password, salt);
        actions.push('Mot de passe');
    }
    if (Object.keys(updates).length > 0) {
        await db.updateUser(email, updates);
    }
    res.json({ success: true, message: `Compte prêt pour ${email} — ${actions.join(' + ') || 'OK'}` });
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

async function generateImageFromHuggingFace(prompt) {
    if (!process.env.HUGGINGFACE_API_KEY) return null;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        const resp = await fetch('https://api-inference.huggingface.co/models/SG161222/RealVisXL_V4.0', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inputs: `${prompt}, amateur selfie photo, natural cellphone camera, candid shot, real person, authentic moment, melanin-rich skin, African beauty, natural body, soft intimate lighting, mirror selfie aesthetic, no filters, genuine expression`,
                parameters: {
                    negative_prompt: 'professional studio, fashion magazine, artificial, plastic, doll, cartoon, anime, 3D render, airbrushed, makeup, lingerie catalog, porn set, fake',
                    width: 1024, height: 1024,
                    num_inference_steps: 30,
                    guidance_scale: 7
                }
            }),
            signal: ctrl.signal
        });
        clearTimeout(timer);
        if (resp.ok) {
            const buffer = await resp.arrayBuffer();
            if (buffer.byteLength > 1024) {
                const base64 = Buffer.from(buffer).toString('base64');
                return `data:image/jpeg;base64,${base64}`;
            }
        }
    } catch (e) { console.warn('HuggingFace error:', e.message); }
    return null;
}

async function generateImageFromRunPod(prompt) {
    if (!process.env.RUNPOD_API_KEY || !process.env.RUNPOD_ENDPOINT_ID) return null;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 90000);
        const resp = await fetch(`https://api.runpod.ai/v2/${process.env.RUNPOD_ENDPOINT_ID}/runsync`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RUNPOD_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: {
                    prompt: `${prompt}, amateur selfie, natural cellphone photo, candid shot, real skin texture, melanin-rich skin, authentic unposed moment, soft natural window light, bedroom at home, mirror reflection, genuine intimate vibe, no professional lighting`,
                    negative_prompt: 'studio, professional, fashion, editorial, airbrush, makeup, plastic, artificial, doll, cartoon, anime, 3D, logo, watermark, text, filters, lingerie ad, porn',
                    width: 832, height: 1216, num_images: 1,
                    num_inference_steps: 35, refiner_inference_steps: 25,
                    guidance_scale: 7, scheduler: 'K_EULER', high_noise_frac: 0.8
                }
            }),
            signal: ctrl.signal
        });
        clearTimeout(timer);
        const data = await resp.json();
        if (data.status === 'COMPLETED' && data.output) {
            return data.output.image_url || (data.output.images?.[0] || null);
        }
    } catch (e) { console.warn('RunPod error:', e.message); }
    return null;
}

async function callOpenRouter(messages) {
    if (!process.env.OPENROUTER_API_KEY) return null;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': process.env.BASE_URL || 'https://solodesir.com',
                'X-Title': 'Solo Desir'
            },
            body: JSON.stringify({ model: 'llamatherapy/llama-3.1-euryale-70b-v2.2', messages, max_tokens: 500, temperature: 0.9 }),
            signal: ctrl.signal
        });
        clearTimeout(timer);
        const data = await resp.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (e) { console.warn('OpenRouter error:', e.message); }
    return null;
}

function isImageRequest(msg) {
    return /\b(photo|image|montre|montre-toi|envoie|envoie-moi|fais voir|vois|voir|nue|nues|sexy|corps|regarde|selfie|cam|pic|picture|snap)\b/i.test(msg);
}

function isNSFW(msg) {
    return /\b(chatte|bite|queue|baiser|baise|niquer|nique|jouir|cul|seins|t[eé]tons|branler|sucer|suce|l[eé]cher|l[eè]che|p[eé]n[eè]tre|hard|brutal|domine|soumise|fouette|pute|salope|cochon|cochonne|pipe|anal|orgasme|gode|masturbe|doigt|doigter)\b/i.test(msg);
}

app.post('/api/images/generate', authMiddleware, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ success: false, message: 'Description requise' });
    let imageUrl = await generateImageFromHuggingFace(prompt);
    if (!imageUrl) imageUrl = await generateImageFromRunPod(prompt);
    if (imageUrl) return res.json({ success: true, imageUrl });
    res.json({ success: true, imageUrl: null, placeholder: true, message: 'Image générée en mode démo.' });
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
            plan: user.plan, limit
        });
    }

    msgCount++;
    await db.updateUser(email, { messages_today: msgCount, last_message_date: today });
    await db.saveMessage({ user_id: user.id, character, role: 'user', content: message });

    const customChars = await db.getCharacters(user.id);
    const { prompt: charPrompt, fallback } = await getCharacterPrompt(character, customChars, user);

    // ── Auto image generation: utiliser la réponse IA comme prompt ──
    const wantsImage = isImageRequest(message) && process.env.RUNPOD_API_KEY;

    const msgs = [
        { role: 'system', content: charPrompt + (wantsImage ? ' Quand l\'utilisateur demande une photo, réponds d\'abord par une description VISUELLE détaillée de la scène (lieu, pose, tenue, lumière, ambiance) en 2-3 phrases, comme si tu décrivais une photo que tu envoies.' : '') },
        ...(history || []).slice(-10),
        { role: 'user', content: message }
    ];

    let reply = null;

    // ── OpenRouter en priorité pour tout (conversations explicites directes) ──
    if (process.env.OPENROUTER_API_KEY) {
        reply = await callOpenRouter(msgs);
    }
    // ── DeepSeek en fallback ──
    if (!reply && process.env.DEEPSEEK_API_KEY) {
        try {
            const apiRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
                body: JSON.stringify({ model: 'deepseek-chat', messages: msgs, max_tokens: 500, temperature: 0.9 }),
                signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 15000); return c.signal; })()
            });
            const data = await apiRes.json();
            reply = data.choices?.[0]?.message?.content || null;
        } catch (e) { console.warn('DeepSeek error:', e.message); }
    }
    if (!reply) {
        reply = fallback[Math.floor(Math.random() * fallback.length)];
    }

    await db.saveMessage({ user_id: user.id, character, role: 'assistant', content: reply });

    // ── Generate image from AI description: HuggingFace (RealVis) first, RunPod fallback ──
    let imageUrl = null;
    if (wantsImage && reply) {
        imageUrl = await generateImageFromHuggingFace(reply);
        if (!imageUrl) imageUrl = await generateImageFromRunPod(reply);
    }

    res.json({
        success: true,
        response: reply,
        messagesLeft: limit - msgCount,
        imageUrl: imageUrl || undefined
    });
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
