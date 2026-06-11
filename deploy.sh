#!/bin/bash
# Deploy — Met à jour Solo depuis GitHub
set -e
echo "=== Solo Deploy ==="
cd /opt/solo
git pull origin master
cd backend && npm install
pm2 restart solo
nginx -t && systemctl reload nginx 2>/dev/null || true
pm2 status
echo "=== Done ==="
