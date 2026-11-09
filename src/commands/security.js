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

// ── Anti-delete : réglage global (data/antidelete.json) ──
const ANTIDELETE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/antidelete.json');
function readAntidelete() {
  try { return JSON.parse(fs.readFileSync(ANTIDELETE_FILE, 'utf-8')); } catch { return {}; }
}
// FIX : antidelete doit être actif PAR DÉFAUT et EN PERMANENCE — avant,
// l'absence de fichier (ou l'absence du champ enabled) faisait défaut à
// false, donc une installation neuve ne récupérait aucun message supprimé
// tant que personne n'avait tapé !antidelete on. Il n'y a plus de bascule :
// la fonction retourne toujours true, quoi que contienne le fichier.
export function isAntideleteEnabled() {
  return true;
}
// Conservé uniquement pour écrire un fichier initial lisible par !antidelete
// (affichage du statut) ; n'a plus d'effet sur isAntideleteEnabled().
function setAntidelete(on) {
  const data = readAntidelete();
  data.enabled = on;
  fs.mkdirSync(path.dirname(ANTIDELETE_FILE), { recursive: true });
  fs.writeFileSync(ANTIDELETE_FILE, JSON.stringify(data, null, 2));
}


const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mode du bot : géré uniquement par utils/botmode.js
import { getBotMode, setBotMode } from '../utils/botmode.js';

export default {

  // ── ANTI-SPAM ───────────────────────────────────────────────
  antidelete: {
    description: 'Statut de la récupération des messages supprimés (toujours activée)',
    adminOnly: true,
    execute: async ({ sock, from }) => {
      // FIX : l'anti-delete est désormais permanent — plus de on/off, pour
      // qu'une installation neuve récupère les messages supprimés sans
      // configuration manuelle, et qu'il ne puisse plus être désactivé par
      // erreur (ou volontairement par un admin du groupe) ailleurs dans le code.
      await sock.sendMessage(from, {
        text: `🗑️ *Anti-delete* (toutes les conversations)\n\n✅ Toujours activé — ne peut pas être désactivé.\n\n_Quand quelqu'un supprime un message, il est renvoyé dans ta conversation personnelle._`,
      });
    },
  },

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
      const mode = getBotMode();
      await sock.sendMessage(from, {
        text: mode === 'public'
          ? `⚙️ *Accès au bot*\n\n🌐 *Mode public*\n\nTout le monde peut utiliser les commandes.\nL'owner conserve ses privilèges étendus.\n\n_Pour restreindre : !private_`
          : `⚙️ *Accès au bot*\n\n🔒 *Mode privé (owner-only)*\n\nSeul le numéro connecté au bot peut utiliser les commandes, en DM comme en groupe.\n\n_Pour ouvrir à tous : !public_`,
      });
    },
  },

  private: {
    description: 'Passer le bot en mode owner-only',
    private: true,
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
    description: 'Activer le mode public — tous les membres peuvent utiliser les commandes',
    private: true,
    execute: async ({ sock, from }) => {
      setBotMode('public');
      await sock.sendMessage(from, {
        text: `🌐 *Mode public activé*\n\n` +
          `Tous les membres du groupe peuvent désormais utiliser les commandes.\n` +
          `L'owner conserve ses privilèges étendus.\n` +
          `Utilisez !botmode pour voir le statut actuel.`,
      });
    },
  },
};

// ── EXPORT des helpers pour le handler principal ──────────────
// Importe ces fonctions dans index.js pour lire le mode bot
export { getBotMode, setBotMode };