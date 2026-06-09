#!/bin/bash
# Solo — Setup complet sur Hetzner Ubuntu 24.04
# À exécuter en root : bash setup.sh

set -e
echo "=== Solo — Installation Hetzner ==="

# Mise à jour système
apt update && apt upgrade -y

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# PostgreSQL
apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE USER solo WITH PASSWORD 'solo_secure_2024';"
sudo -u postgres psql -c "CREATE DATABASE solo OWNER solo;"
sudo -u postgres psql -c "ALTER USER solo CREATEDB;"

# nginx
apt install -y nginx

# PM2
npm install -g pm2

# Certbot (SSL Let's Encrypt)
apt install -y certbot python3-certbot-nginx

# Clone le repo
cd /opt
git clone https://github.com/intersidibe2-cell/solo-desir.git solo
cd solo/backend
npm install

# Config env
cat > .env << 'EOF'
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://solo:solo_secure_2024@localhost:5432/solo
JWT_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)
BASE_URL=https://solodesir.com
EOF

# PM2
pm2 start /opt/solo/backend/server.js --name solo
pm2 save
pm2 startup systemd -u root --hp /root

# nginx config
cat > /etc/nginx/sites-available/solo << 'NGX'
server {
    listen 80;
    server_name solodesir.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 5m;
    }
}
NGX

ln -sf /etc/nginx/sites-available/solo /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== Installation terminée ==="
echo "IP: $(curl -s ifconfig.me)"
echo "N'oublie pas : certbot --nginx -d solodesir.com (pour SSL)"
