/**
 * ============================================================
 * @file        spam.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes anti-spam — Detection et blocage du spam
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES: spam, stopspam (ADMIN SEULEMENT)
// ============================================================

const activeSpams = new Map(); // jidKey → intervalId

export default {
  spam: {
    description: 'Envoyer du spam (admin)',
    adminOnly: true,
    execute: async ({ sock, from, args }) => {
      // Usage: !spam [numéro] [message] [nombre]
      if (args.length < 3) {
        await sock.sendMessage(from, {
          text: '📢 Usage: !spam [numéro] [message] [nombre]\nExemple: !spam 22890000000 Bonjour! 10\n\n_Maximum 50 messages. Utilise !stopspam pour arrêter._',
        });
        return;
      }

      const number = args[0].replace(/[^0-9]/g, '');
      const count = Math.min(parseInt(args[args.length - 1]) || 5, 50);
      const message = args.slice(1, args.length - 1).join(' ');

      if (!number || !message || isNaN(count)) {
        await sock.sendMessage(from, { text: '❌ Paramètres invalides.' });
        return;
      }

      const jid = `${number}@s.whatsapp.net`;

      await sock.sendMessage(from, {
        text: `📢 Démarrage spam vers *${number}*\n📝 Message: "${message}"\n🔢 Nombre: ${count}\n\nUtilise *!stopspam* pour arrêter.`,
      });

      let sent = 0;
      const interval = setInterval(async () => {
        if (sent >= count || !activeSpams.has(jid)) {
          clearInterval(interval);
          activeSpams.delete(jid);
          await sock.sendMessage(from, { text: `✅ Spam terminé. ${sent} messages envoyés à ${number}.` });
          return;
        }
        try {
          await sock.sendMessage(jid, { text: message });
          sent++;
        } catch {
          clearInterval(interval);
          activeSpams.delete(jid);
        }
      }, 1500); // 1 message toutes les 1.5 secondes

      activeSpams.set(jid, interval);
    },
  },

  stopspam: {
    description: 'Arrêter le spam en cours',
    adminOnly: true,
    execute: async ({ sock, from }) => {
      if (activeSpams.size === 0) {
        await sock.sendMessage(from, { text: '✅ Aucun spam en cours.' });
        return;
      }

      for (const [jid, interval] of activeSpams) {
        clearInterval(interval);
      }
      const count = activeSpams.size;
      activeSpams.clear();

      await sock.sendMessage(from, { text: `🛑 *${count}* spam(s) arrêté(s).` });
    },
  },
};
