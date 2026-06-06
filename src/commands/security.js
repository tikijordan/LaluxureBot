/**
 * ============================================================
 * @file        security.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes de securite — Mode prive/public, bot admin
 * ============================================================
 */
// ============================================================
// COMMANDES: antispam, unban, notag, yestag, private, public, botmode
// ============================================================

import { getAntispamStatus, unban } from '../utils/antispam.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOTMODE_FILE = path.join(__dirname, '../../data/botmode.json');

// ── GESTION DU BOTMODE (persistant + cache mémoire) ──────────
let _botModeCache = null;

function getBotMode() {
  if (_botModeCache) return _botModeCache;
  try {
    if (fs.existsSync(BOTMODE_FILE)) {
      const data = JSON.parse(fs.readFileSync(BOTMODE_FILE, 'utf-8'));
      _botModeCache = data.mode || 'private';
      return _botModeCache;
    }
  } catch {}
  _botModeCache = 'private';
  return _botModeCache;
}

function setBotMode(mode) {
  _botModeCache = mode;
  try {
    const dir = path.dirname(BOTMODE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BOTMODE_FILE, JSON.stringify({ mode }, null, 2));
  } catch (e) {
    console.error('❌ Erreur écriture botmode:', e.message);
  }
}

// ── GESTION DU NO-TAG (global en mémoire) ────────────────────
// On utilise global.noTagGroups pour que ce soit partagé avec le handler principal
if (!global.noTagGroups) global.noTagGroups = new Set();

export default {

  // ── ANTI-SPAM ───────────────────────────────────────────────
  antispam: {
    description: 'État de l\'anti-spam',
    execute: async ({ sock, from }) => {
      const status = getAntispamStatus();
      await sock.sendMessage(from, {
        text: `🛡️ *État Anti-Spam*\n\n` +
          `✅ Statut: ${status.enabled ? 'Activé' : 'Désactivé'}\n` +
          `📊 Max messages: ${status.maxMessages} / ${status.window / 1000}s\n` +
          `⏳ Délai: ${status.delay / 1000}s\n` +
          `🚫 Bannis actuellement: ${status.currentlyBanned}\n\n` +
          `_Le ban temporaire dure 30 secondes_`,
      });
    },
  },

  unban: {
    description: 'Débannir un utilisateur (admin)',
    adminOnly: true,
    execute: async ({ sock, from, text }) => {
      if (!text) {
        await sock.sendMessage(from, { text: '🔓 Usage: !unban [numéro]\nExemple: !unban 22890000000' });
        return;
      }
      const number = text.replace(/[^0-9]/g, '');
      unban(number);
      await sock.sendMessage(from, { text: `✅ L'utilisateur *${number}* a été débanni.` });
    },
  },

  // ── ANTI-TAG ────────────────────────────────────────────────
  notag: {
    description: 'Activer protection anti-tag',
    execute: async ({ sock, from, isGroup }) => {
      if (!isGroup) {
        await sock.sendMessage(from, { text: '❌ Cette commande fonctionne uniquement dans les groupes.' });
        return;
      }
      global.noTagGroups.add(from);
      await sock.sendMessage(from, { text: '🔕 Protection anti-tag *activée*.\n\n_Les messages qui taguent @tous seront supprimés (sauf admins)._' });
    },
  },

  yestag: {
    description: 'Désactiver protection anti-tag',
    execute: async ({ sock, from, isGroup }) => {
      if (!isGroup) {
        await sock.sendMessage(from, { text: '❌ Cette commande fonctionne uniquement dans les groupes.' });
        return;
      }
      global.noTagGroups.delete(from);
      await sock.sendMessage(from, { text: '🔔 Protection anti-tag *désactivée*.' });
    },
  },

  // ── MODE BOT ─────────────────────────────────────────────────

  botmode: {
    description: 'Voir le mode actuel du bot (owner)',
    execute: async ({ sock, from }) => {
      await sock.sendMessage(from, {
        text: `⚙️ *Accès au bot*\n\n` +
          `🔒 *Owner-only* — permanent\n\n` +
          `Seul le numéro connecté au bot peut utiliser les commandes, en DM comme en groupe.\n` +
          `Les autres utilisateurs sont ignorés (aucune réponse).`,
      });
    },
  },

  private: {
    description: 'Confirmer le mode owner-only',
    execute: async ({ sock, from }) => {
      setBotMode('private');
      await sock.sendMessage(from, {
        text: `🔒 *Owner-only actif*\n\n` +
          `Seul toi (numéro connecté) peux utiliser le bot partout.\n` +
          `Les autres sont ignorés sans réponse.`,
      });
    },
  },

  public: {
    description: 'Désactivé — bot toujours owner-only',
    execute: async ({ sock, from }) => {
      setBotMode('private');
      await sock.sendMessage(from, {
        text: `🔒 *Mode public désactivé*\n\n` +
          `Ce bot est réservé à l'owner uniquement (DM + groupes).\n` +
          `La commande *!public* ne peut pas ouvrir l'accès aux autres.`,
      });
    },
  },
};

// ── EXPORT des helpers pour le handler principal ──────────────
// Importe ces fonctions dans index.js pour lire le mode bot
export { getBotMode };