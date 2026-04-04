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

// ── GESTION DU BOTMODE (persistant) ──────────────────────────
function getBotMode() {
  try {
    if (fs.existsSync(BOTMODE_FILE)) {
      const data = JSON.parse(fs.readFileSync(BOTMODE_FILE, 'utf-8'));
      return data.mode || 'public';
    }
  } catch {}
  return 'public';
}

function setBotMode(mode) {
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
    description: 'Voir le mode actuel du bot (admin)',
    adminOnly: true,
    execute: async ({ sock, from }) => {
      const mode = getBotMode();
      await sock.sendMessage(from, {
        text: `⚙️ *Mode du Bot*\n\n` +
          `Statut actuel: ${mode === 'private' ? '🔴 *Privé* (admin seulement)' : '🟢 *Public* (tout le monde)'}\n\n` +
          `*Changer le mode:*\n` +
          `• !private → Réserver le bot à l'admin\n` +
          `• !public  → Ouvrir le bot à tout le monde`,
      });
    },
  },

  private: {
    description: 'Passer le bot en mode privé (admin seulement)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      const current = getBotMode();

      if (current === 'private') {
        await sock.sendMessage(from, {
          text: `⚠️ Le bot est *déjà en mode privé*.\n\nUtilise *!public* pour l'ouvrir à tout le monde.`,
        });
        return;
      }

      setBotMode('private');

      await sock.sendMessage(from, {
        text: `🔴 *Mode Privé Activé*\n\n` +
          `Le bot répond désormais *uniquement à l'administrateur*.\n\n` +
          `Les autres utilisateurs verront un message de restriction.\n\n` +
          `➡️ Pour revenir en mode public: *!public*`,
      });

      if (isGroup) {
        await sock.sendMessage(from, {
          text: `🔴 *[BOT]* Ce bot est passé en *mode privé*.\nSeul l'administrateur peut l'utiliser pour le moment.`,
        });
      }

      console.log('🔴 Bot passé en MODE PRIVÉ');
    },
  },

  public: {
    description: 'Passer le bot en mode public (tout le monde)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      const current = getBotMode();

      if (current === 'public') {
        await sock.sendMessage(from, {
          text: `⚠️ Le bot est *déjà en mode public*.\n\nUtilise *!private* pour le réserver à l'admin.`,
        });
        return;
      }

      setBotMode('public');

      await sock.sendMessage(from, {
        text: `🟢 *Mode Public Activé*\n\n` +
          `Le bot répond désormais à *tout le monde*.\n\n` +
          `Les commandes réservées à l'admin restent protégées.\n\n` +
          `➡️ Pour repasser en mode privé: *!private*`,
      });

      if (isGroup) {
        await sock.sendMessage(from, {
          text: `🟢 *[BOT]* Ce bot est de retour en *mode public*.\nTout le monde peut l'utiliser à nouveau !`,
        });
      }

      console.log('🟢 Bot passé en MODE PUBLIC');
    },
  },
};

// ── EXPORT des helpers pour le handler principal ──────────────
// Importe ces fonctions dans index.js pour lire le mode bot
export { getBotMode };