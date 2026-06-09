# Migration Render → Hetzner

## Étape 1 — Créer le VPS (toi)
- Va sur https://hetzner.cloud → crée un compte
- "Create Server" → CX22 (€4/mois, 4 GB RAM, 2 CPU)
- Ubuntu 24.04, Falkenstein (Allemagne)
- Reçois l'IP par email

## Étape 2 — Se connecter en SSH (toi)
```bash
ssh root@TON_IP_HETZNER
# Mot de passe reçu par email, à changer au premier login
```

## Étape 3 — Exécuter le script d'installation
```bash
# Copie le script setup-hetzner.sh sur le serveur, ou exécute directement :
curl -o setup.sh https://raw.githubusercontent.com/intersidibe2-cell/solo-desir/master/setup-hetzner.sh
bash setup.sh
```
Le script installe tout : Node.js, PostgreSQL, nginx, PM2, SSL, clone le repo, démarre l'app.

## Étape 4 — SSL (toi)
```bash
certbot --nginx -d solodesir.com
# Suis les instructions, choisis "redirect HTTP to HTTPS"
```

## Étape 5 — DNS (toi)
```
1. Retire l'IP Render du DNS Porkbun
2. Ajoute un enregistrement A → IP Hetzner
3. Attends 10-30 min → solodesir.com pointe vers Hetzner
```

## Étape 6 — Arrêter Render (toi)
```
Dashboard Render → supprimer le service solo-desir
```

## Déploiements futurs
```bash
cd /opt/solo && bash deploy.sh
# Pull GitHub + redémarre l'app — 10 secondes
```

## Coût
| Service | Prix |
|---------|------|
| Hetzner CX22 | €4/mois (~$4.50) |
| Domaine solodesir.com | ~$10/an |
| **Total** | **~$5/mois** |
