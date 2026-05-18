#!/usr/bin/env bash
set -euo pipefail

# Démarrer Tor si activé
if [[ "${TOR_PROXY:-}" =~ ^(1|true|yes)$ ]]; then
  echo "[Tor] Démarrage du service Tor..."
  tor -f /etc/tor/torrc &
  # petite pause pour laisser Tor initialiser les circuits
  sleep 3
fi

exec node src/index.js
