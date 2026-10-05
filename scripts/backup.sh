#!/usr/bin/env bash
set -e

cd /home/superuser/hspc-erp
mkdir -p backups

STAMP=$(date +%Y%m%d-%H%M%S)
sqlite3 prisma/hspc_prod.db ".backup 'backups/hspc-${STAMP}.db'"

echo "Backup created: backups/hspc-${STAMP}.db"
