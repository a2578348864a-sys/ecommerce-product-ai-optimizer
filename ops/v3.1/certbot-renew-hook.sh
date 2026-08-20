#!/bin/bash
# V3.1 Phase 3 — Certbot deploy hook (deployed at /etc/letsencrypt/renewal-hooks/deploy/30-v31-nginx-reload)
# Renew success -> nginx -t -> reload. Fails closed on nginx -t failure (no reload).
set -e
if nginx -t > /tmp/v31-deploy-hook-nginx-t.log 2>&1; then
  systemctl reload nginx
else
  exit 1
fi
