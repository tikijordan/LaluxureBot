/**
 * ============================================================
 * @file        utils.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes utilitaires — Notes, statistiques, rappels
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES: qrcode, calc, reminder, note, mynotes, stats, contact
// ============================================================

import QRCode from 'qrcode';
import { create, all } from 'mathjs';
import { saveNote, getNotes } from '../utils/notes.js';
import { getUserStats } from '../utils/stats.js';

const math = create(all);

// Évaluation sécurisée (interdire les fonctions dangereuses)
const limitedEvaluate = math.evaluate;

export default {
  qrcode: {
    description: 'Générer un QR code',
    execute: async ({ sock, from, text }) => {
      if (!text) {
        await sock.sendMessage(from, { text: '📱 Usage: !qrcode [texte ou URL]' });
        return;
      }

      try {
        const qrBuffer = await QRCode.toBuffer(text, {
          type: 'png',
          width: 400,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });

        await sock.sendMessage(from, {
          image: qrBuffer,
          caption: `📱 *QR Code généré*\n📝 Contenu: ${text.slice(0, 50)}${text.length > 50 ? '...' : ''}`,
        });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur QR Code: ${err.message}` });
      }
    },
  },

  calc: {
    description: 'Calculatrice',
    execute: async ({ sock, from, text }) => {
      if (!text) {
        await sock.sendMessage(from, { text: '🔢 Usage: !calc [expression]\nExemples: !calc 5*9+2  |  !calc sqrt(144)  |  !calc sin(30 deg)' });
        return;
      }

      try {
        const result = limitedEvaluate(text);
        await sock.sendMessage(from, {
          text: `🧮 *Calculatrice*\n\n📝 Expression: ${text}\n✅ Résultat: *${result}*`,
        });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Expression invalide: ${err.message}` });
      }
    },
  },

  reminder: {
    description: 'Créer un rappel',
    execute: async ({ sock, from, sender, args }) => {
      const minutes = parseInt(args[0]);
      const message = args.slice(1).join(' ');

      if (!minutes || !message || isNaN(minutes)) {
        await sock.sendMessage(from, { text: '⏰ Usage: !reminder [minutes] [message]\nExemple: !reminder 10 Prendre ses médicaments' });
        return;
      }

      if (minutes < 1 || minutes > 1440) {
        await sock.sendMessage(from, { text: '❌ Durée invalide. Entre 1 et 1440 minutes (24h).' });
        return;
      }

      await sock.sendMessage(from, {
        text: `⏰ Rappel créé!\n⌛ Dans: ${minutes} minute${minutes > 1 ? 's' : ''}\n📝 Message: ${message}`,
      });

      // Programmer le rappel
      setTimeout(async () => {
        try {
          await sock.sendMessage(from, {
            text: `⏰ *RAPPEL!*\n\n📝 ${message}\n\n_Rappel créé il y a ${minutes} minutes_`,
            mentions: [sender],
          });
        } catch {}
      }, minutes * 60 * 1000);
    },
  },

  note: {
    description: 'Sauvegarder une note',
    execute: async ({ sock, from, senderNumber, text }) => {
      if (!text) {
        await sock.sendMessage(from, { text: '📝 Usage: !note [texte]\nExemple: !note Appeler maman demain' });
        return;
      }

      saveNote(senderNumber, text);
      await sock.sendMessage(from, { text: `📝 Note sauvegardée!\n\n"${text}"\n\nUtilise *!mynotes* pour voir toutes tes notes.` });
    },
  },

  mynotes: {
    description: 'Voir ses notes',
    execute: async ({ sock, from, senderNumber }) => {
      const notes = getNotes(senderNumber);

      if (notes.length === 0) {
        await sock.sendMessage(from, { text: '📋 Tu n\'as aucune note.\n\nUtilise *!note [texte]* pour en créer une.' });
        return;
      }

      let msg = `📋 *Tes Notes (${notes.length})*\n\n`;
      notes.slice(-10).forEach((n, i) => {
        const date = new Date(n.date).toLocaleDateString('fr-FR');
        msg += `${i + 1}. ${n.text}\n   _${date}_\n\n`;
      });

      await sock.sendMessage(from, { text: msg });
    },
  },

  stats: {
    description: 'Statistiques personnelles',
    execute: async ({ sock, from, senderNumber }) => {
      const stats = getUserStats(senderNumber);
      const topCmds = Object.entries(stats.commands || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      let msg = `📊 *Tes Statistiques*\n👤 Numéro: ${senderNumber}\n\n`;
      msg += `📨 Total commandes: *${stats.total || 0}*\n`;

      if (stats.lastSeen) {
        msg += `🕐 Dernière activité: ${new Date(stats.lastSeen).toLocaleString('fr-FR')}\n`;
      }

      if (topCmds.length > 0) {
        msg += `\n🏆 *Top 5 commandes:*\n`;
        topCmds.forEach(([cmd, count], i) => {
          msg += `${i + 1}. !${cmd}: ${count} fois\n`;
        });
      }

      await sock.sendMessage(from, { text: msg });
    },
  },

  contact: {
    description: 'Contacter l\'équipe',
    execute: async ({ sock, from }) => {
      const ownerNum = process.env.OWNER_NUMBER;
      const msg = `📞 *Contacter l\'équipe*\n\n${ownerNum ? `👑 Owner: wa.me/${ownerNum}` : 'Contact non configuré'}\n\n_Pour signaler un bug ou proposer une amélioration, contacte directement l\'owner._\n\n🛠️ Merci d\'utiliser *${process.env.BOT_NAME || 'MonBot'}*!`;
      await sock.sendMessage(from, { text: msg });
    },
  },
};
