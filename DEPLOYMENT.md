# Solo — Deployment Guide

## Déploiement sur Hetzner CX23 (production)

### Prérequis

- Serveur Hetzner CX23 (4GB RAM, 2 vCPUs, 40GB SSD)
- Ubuntu 24.04
- Node.js 22+
- PostgreSQL 16
- Nginx
- PM2
- Git

### Variables d'environnement (.env)

Le fichier `.env` doit être placé à `/opt/solo/.env` :

```env
DATABASE_URL=postgresql://solo:solo2025@localhost:5432/solo
JWT_SECRET=solo_jwt_secret_2025
JWT_REFRESH_SECRET=solo_refresh_secret_2025
NODE_ENV=production
PORT=3000
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1234567890
VAPID_PUBLIC_KEY=   # Optionnel pour push notifications
VAPID_PRIVATE_KEY=  # Optionnel pour push notifications
```

### Première installation

```bash
# 1. Cloner le repo
cd /opt
git clone https://github.com/intersidibe2-cell/solo-desir.git solo

# 2. Installer les dépendances
cd /opt/solo/backend
npm install

# 3. Configurer PostgreSQL
sudo -u postgres psql -c "CREATE USER solo WITH PASSWORD 'solo2025';"
sudo -u postgres psql -c "CREATE DATABASE solo OWNER solo;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE solo TO solo;"

# 4. Créer le fichier .env
cat > /opt/solo/.env << 'EOF'
DATABASE_URL=postgresql://solo:solo2025@localhost:5432/solo
JWT_SECRET=solo_jwt_secret_2025
JWT_REFRESH_SECRET=solo_refresh_secret_2025
NODE_ENV=production
EOF

# 5. Démarrer avec PM2
pm2 start backend/server.js --name solo
pm2 save
pm2 startup

# 6. Configurer Nginx
cat > /etc/nginx/sites-enabled/default << 'EOF'
server {
    server_name solodesir.com 167.233.105.13;
    location / {
        proxy_pass http://localhost:3000;
        client_max_body_size 50m;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/solodesir.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/solodesir.com/privkey.pem;
}
server {
    listen 80;
    server_name solodesir.com 167.233.105.13;
    return 301 https://$host$request_uri;
}
EOF

nginx -t && systemctl reload nginx

# 7. Backups automatiques (cron)
cat > /opt/solo/scripts/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR=/opt/solo/backups
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
pg_dump -U solo solo > $BACKUP_DIR/solo_$DATE.sql
if [ -f $BACKUP_DIR/solo_$DATE.sql ]; then
    gzip $BACKUP_DIR/solo_$DATE.sql
    echo "Backup OK: solo_$DATE.sql.gz"
fi
ls -t $BACKUP_DIR/*.gz 2>/dev/null | tail -n +8 | xargs rm -f
EOF
chmod +x /opt/solo/scripts/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/solo/scripts/backup.sh >> /var/log/solo-backup.log 2>&1") | crontab -
```

### Déploiement quotidien

```bash
ssh root@167.233.105.13
cd /opt/solo
git pull origin master
cd backend && npm install
pm2 restart solo
```

### Déploiement via Python (depuis PC Windows)

```bash
python -c "
import paramiko, time
c=paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('167.233.105.13',22,'root','rwKbXfd9cAXA',timeout=10,allow_agent=False,look_for_keys=False)
c.exec_command('cd /opt/solo && git pull origin master && cd backend && npm install && pm2 restart solo',timeout=30)
time.sleep(5)
c.close()
print('Deployed')
"
```

### Rollback

```bash
cd /opt/solo
git log --oneline -10        # Voir les derniers commits
git reset --hard <commit_id> # Revenir à un commit précédent
pm2 restart solo
```

### Vérification

```bash
# Vérifier le serveur
curl -s http://localhost:3000/health
# Réponse attendue: {"success":true,"status":"ok","db":"postgres","version":"2.0"}

# Vérifier PM2
pm2 status
# Réponse attendue: solo | online

# Vérifier PostgreSQL
pg_isready
# Réponse attendue: /var/run/postgresql:5432 - accepting connections

# Vérifier les logs
pm2 logs solo --lines 20

# Vérifier l'espace disque
df -h /
# Doit avoir >10GB libre

# Vérifier la RAM
free -h
# Doit avoir >1GB disponible
```

### Résolution des problèmes courants

| Problème | Solution |
|----------|----------|
| **502 Bad Gateway** | `pm2 restart solo` |
| **Port 3000 déjà utilisé** | `lsof -i :3000; kill -9 <PID>; pm2 start backend/server.js --name solo` |
| **PostgreSQL ne démarre pas** | `systemctl restart postgresql` |
| **Disque plein** | `ls -la /opt/solo/backups/; rm -f /opt/solo/backups/*.gz` |
| **Mémoire insuffisante** | `pm2 restart solo --max-memory-restart 500M` |
| **Twilio ne répond pas** | Le circuit breaker bascule en mode test automatiquement |
