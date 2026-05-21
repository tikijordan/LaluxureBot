#!/usr/bin/env bash
set -euo pipefail

# Démarrer Tor si activé
if [[ "${TOR_PROXY:-}" =~ ^(1|true|yes)$ ]]; then
  echo "[Tor] Démarrage du service Tor..."
  tor -f /etc/tor/torrc &
  TOR_PID=$!

  # Attendre que Tor bootstrappe à 100% (max 60s)
  echo "[Tor] En attente du bootstrap..."
  for i in $(seq 1 60); do
    if grep -q "Bootstrapped 100%" /var/log/tor/log 2>/dev/null || \
       grep -q "Bootstrapped 100%" /tmp/tor_log 2>/dev/null; then
      echo "[Tor] ✅ Bootstrap complet"
      break
    fi
    # Fallback : vérifier via le port de contrôle si disponible
    if kill -0 "$TOR_PID" 2>/dev/null && [ "$i" -eq 60 ]; then
      echo "[Tor] ⚠️  Bootstrap non confirmé après 60s — on continue quand même"
    fi
    sleep 1
  done
fi

exec node src/index.js