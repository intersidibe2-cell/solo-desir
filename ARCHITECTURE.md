# Solo — Architecture Documentation

## 1. Vue d'ensemble

Solo est une plateforme de rencontres africaines (10 pays, mobile-first) avec inscription par téléphone, swipe/like/match, chat temps réel, et petites annonces.

## 2. Stack technique

| Élément | Technologie |
|---------|-------------|
| **Backend** | Node.js 22 + Express.js |
| **Base de données** | PostgreSQL 16 |
| **Frontend** | Vanilla JS + CSS (pas de framework) |
| **Temps réel** | Server-Sent Events (SSE) |
| **Cache** | In-memory Map (TTL 30s) |
| **Auth** | JWT (90 jours) + bcrypt (8 rounds) |
| **SMS** | Twilio (avec circuit breaker) |
| **PWA** | Service Worker (network-first) |
| **Hébergement** | Hetzner CX23 (4GB RAM, 2 vCPUs) |
| **Monitoring** | Sentry (browser) |
| **Compression** | gzip (Express) |

## 3. Structure des fichiers

```
/
├── solo.html              # Application principale (SPA)
├── index.html             # Landing page
├── admin.html             # Dashboard administration
├── offline.html           # Page hors-ligne PWA
├── mentions-legales.html  # Mentions légales
├── confidentialite.html   # Politique de confidentialité
├── manifest.json          # PWA manifest
├── sw.js                  # Service worker (cache v33)
├── opencode.json          # Configuration opencode
├── ecosystem.config.json  # PM2 configuration
├── css/
│   ├── solo.css           # Styles application (405 lignes)
│   └── landing.css        # Styles landing page
├── js/
│   ├── solo.js            # Logique client (1490 lignes)
│   └── i18n.js            # Internationalisation (FR/EN/AR)
├── lang/
│   ├── fr.json            # Traductions françaises
│   ├── en.json            # Traductions anglaises
│   └── ar.json            # Traductions arabes
├── backend/
│   ├── server.js          # Serveur Express (1285 lignes)
│   ├── package.json       # Dépendances
│   └── .env.example       # Variables d'environnement
└── scripts/
    └── setup-hetzner.sh   # Configuration serveur
```

## 4. Base de données

### Tables principales

| Table | Description | Clés |
|-------|-------------|------|
| `solo_users` | Utilisateurs | id (PK), email (UNIQUE), phone (INDEX) |
| `solo_likes` | Likes | from_user + to_user (UNIQUE) |
| `solo_matches` | Matchs | user1 + user2 (UNIQUE) |
| `solo_messages` | Messages | match_id (INDEX), sender |
| `solo_annonces` | Petites annonces | user_id (INDEX), country (INDEX) |
| `solo_annonce_responses` | Réponses aux annonces | annonce_id (INDEX), to_user (INDEX) |
| `solo_reports` | Signalements | - |
| `solo_boosts` | Boosts profil | user_id |
| `solo_notifications` | Notifications utilisateur | user_id (INDEX), read |

### Colonnes principales de solo_users

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | TEXT PK | UUID |
| `pseudo` | TEXT | Identifiant public |
| `prenom` | TEXT | Prénom (optionnel) |
| `email` | TEXT UNIQUE | Auto-généré si non fourni |
| `password` | TEXT | Hash bcrypt |
| `phone` | TEXT | Numéro vérifié par SMS |
| `gender` | TEXT | homme/femme/couple |
| `country` | TEXT | Code ISO 2 lettres |
| `photos` | JSONB | Array d'URLs |
| `plan` | TEXT | free/vip/banned |
| `verified` | BOOLEAN | Vérifié par SMS ou selfie |
| `lat/lng` | DOUBLE | Coordonnées GPS |
| `last_seen` | TIMESTAMPTZ | Dernière activité |

### Indexes

- `idx_users_geo` (lat, lng) — Pour la recherche géographique
- `idx_users_phone` (phone) — Pour la vérification SMS
- `idx_users_country_gender` (country, gender) — Pour les filtres
- `idx_likes_from/to` — Pour les likes
- `idx_matches_user1/user2` — Pour les matchs
- `idx_messages_match` — Pour les messages par match

## 5. Flux d'inscription

```
1. Utilisateur entre son téléphone (+223 70 00 00 00)
2. Clique "Recevoir le code"
3. POST /api/solo/verify/sms-send → Twilio envoie SMS (ou mode test)
4. Code à 4 chiffres affiché/sms envoyé
5. Utilisateur entre le code
6. POST /api/solo/verify/sms-confirm → vérifie le code
7. POST /api/solo/register → crée le compte avec verified=true
8. JWT token généré → redirection vers l'app
```

## 6. Flux de match/chat

```
1. Profils chargés via GET /api/solo/profiles (paginé, filtré)
2. Utilisateur like un profil via POST /api/solo/like
3. Si like réciproque → match créé → POST /api/solo/chat/stream/:matchId (SSE)
4. Messages envoyés via POST /api/solo/message
5. SSE maintient la connexion pour le temps réel
6. Polling (3s) en fallback si SSE échoue
```

## 7. Flux annonces

```
Création :
1. POST /api/solo/annonces → statut "pending"
2. Admin approuve → status "approved"

Réponse :
3. GET /api/solo/annonces → liste publique (approved uniquement)
4. POST /api/solo/annonces/:id/respond → message personnalisé
5. Propriétaire voit les réponses → accepte/ignore
6. Accepté → match créé → chat

## 8. Sécurité

| Protection | Implémentation |
|------------|----------------|
| **XSS** | helmet CSP + esc() + sanitize() |
| **CSRF** | CORS restreint (solodesir.com + IP) |
| **Injection SQL** | Requêtes parametrized (pg $1, $2) |
| **Brute force** | Rate limiting (10/min auth) |
| **Spam messages** | Rate limiting (5/min/msg) |
| **Mots de passe** | bcrypt 8 rounds + salt |
| **Tokens** | JWT 90 jours |
| **HTTPS** | Let's Encrypt + HSTS |

## 9. PWA

| Critère | Configuration |
|---------|---------------|
| **Cache** | Network-first pour HTML/CSS/JS |
| **Cache** | Cache-first pour images/fonts |
| **Offline** | Page offline.html fallback |
| **Install** | beforeinstallprompt + bannière personnalisée |
| **Manifest** | Icônes DiceBear, display standalone |

## 10. Monitoring

| Outil | Usage |
|-------|-------|
| **Sentry** | Tracking erreurs JS en production |
| **PM2** | Healthcheck auto-restart (500MB max, backoff) |
| **/health** | Status serveur + DB + utilisateurs |
| **Circuit breaker** | Twilio (3 échecs → mode mock) |
| **Cron** | Backup quotidien (3h) + monitoring (5min) |
