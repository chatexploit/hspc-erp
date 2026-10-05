#!/usr/bin/env bash
set -e

cd /home/superuser/hspc-erp

git pull --ff-only

npm ci

npx prisma generate
npx tsc

pm2 restart hspc-erp --update-env
pm2 save

curl -fsS http://127.0.0.1:5000/api/health

echo
echo "HSPC ERP deployment complete."
