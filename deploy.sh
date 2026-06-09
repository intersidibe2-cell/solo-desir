#!/bin/bash
# Deploy — Met à jour Solo depuis GitHub
# Usage : bash deploy.sh

set -e
echo "=== Solo — Deploy ==="

cd /opt/solo
git pull origin master

cd backend
npm install

pm2 restart solo
pm2 status

echo "=== Deploy terminé ==="
