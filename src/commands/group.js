/**
 * ============================================================
 * @file        group.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes de groupe — Tagall, groupinfo, admins
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES: tagall, everyone, tagadmins, groupinfo
// ============================================================

export default {
  tagall: {
    description: 'Taguer tous les membres du groupe',
    execute: async ({ sock, msg, from, text, isGroup }) => {
      if (!isGroup) {
        await sock.sendMessage(from, { text: '❌ Cette commande fonctionne uniquement dans les groupes.' });
        return;
      }

      try {
        const groupMeta = await sock.groupMetadata(from);
        const members = groupMeta.participants;
        const mentions = members.map(m => m.id);
        const message = text || `📢 *Attention tout le monde !*\n\n@${mentions.map(m => m.split('@')[0]).join('\n@')}`;

        await sock.sendMessage(from, {
          text: message,
          mentions,
        });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },

  everyone: {
    description: 'Alias pour tagall',
    execute: async (ctx) => {
      const tagallCmd = (await import('./group.js')).default.tagall;
      await tagallCmd.execute(ctx);
    },
  },

  tagadmins: {
    description: 'Taguer les admins du groupe',
    execute: async ({ sock, from, isGroup }) => {
      if (!isGroup) {
        await sock.sendMessage(from, { text: '❌ Cette commande fonctionne uniquement dans les groupes.' });
        return;
      }

      try {
        const groupMeta = await sock.groupMetadata(from);
        const admins = groupMeta.participants.filter(m => m.admin);

        if (admins.length === 0) {
          await sock.sendMessage(from, { text: '❌ Aucun admin trouvé.' });
          return;
        }

        const mentions = admins.map(m => m.id);
        const text = `👑 *Admins du groupe:*\n\n@${mentions.map(m => m.split('@')[0]).join('\n@')}`;

        await sock.sendMessage(from, { text, mentions });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },

  groupinfo: {
    description: 'Informations du groupe',
    execute: async ({ sock, from, isGroup }) => {
      if (!isGroup) {
        await sock.sendMessage(from, { text: '❌ Cette commande fonctionne uniquement dans les groupes.' });
        return;
      }

      try {
        const meta = await sock.groupMetadata(from);
        const admins = meta.participants.filter(m => m.admin);
        const created = new Date(meta.creation * 1000).toLocaleDateString('fr-FR');
        const desc = meta.desc || 'Aucune description';

        const info = `👥 *Informations du Groupe*\n\n📌 *Nom:* ${meta.subject}\n👤 *Membres:* ${meta.participants.length}\n👑 *Admins:* ${admins.length}\n📅 *Créé le:* ${created}\n📝 *Description:*\n${desc}\n🆔 *ID:* ${from}`;

        await sock.sendMessage(from, { text: info });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },
};
