/**
 * ============================================================
 * @file        admin2.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes admin avancees — Kickall, ban, listmembers, backup, filter, slowmode
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES ADMIN AVANCÉES — PARTIE 2
// kickall, ban, unban, listmembers, revoke, getlink,
// backup, filter, slowmode, cleanbot
// ============================================================

import { addFilter, removeFilter, getFilters, clearFilters } from '../utils/filter.js';
import { setSlowmode, disableSlowmode, getSlowmode } from '../utils/slowmode.js';
import { banUser, unbanUser, isBanned, getBanList } from '../utils/banned.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Stockage temporaire des messages du bot pour cleanbot
if (!global.botMessages) global.botMessages = new Map();

function checkGroup(sock, from, isGroup) {
  if (!isGroup) { sock.sendMessage(from, { text: ' Uniquement dans les groupes.' }).catch(() => {}); return false; }
  return true;
}
function getMentionedJid(msg, args) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned?.length > 0) return mentioned[0];
  if (args[0]) { const n = args[0].replace(/[^0-9]/g, ''); if (n) return `${n}@s.whatsapp.net`; }
  return null;
}

export default {

  // ════════════════════════════════════════
  // GESTION DES MEMBRES — AVANCÉ
  // ════════════════════════════════════════

  kickall: {
    description: 'Expulser tous les non-admins du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      try {
        const meta = await sock.groupMetadata(from);
        const nonAdmins = meta.participants.filter(p => !p.admin).map(p => p.id);
        if (nonAdmins.length === 0) {
          await sock.sendMessage(from, { text: ' Tous les membres sont déjà admins.' });
          return;
        }
        await sock.sendMessage(from, {
          text: ` *Expulsion en cours...*\n ${nonAdmins.length} membre(s) vont être expulsés.\n\n_Cela peut prendre quelques secondes._`,
        });
        let count = 0;
        for (const jid of nonAdmins) {
          try {
            await sock.groupParticipantsUpdate(from, [jid], 'remove');
            count++;
            await new Promise(r => setTimeout(r, 500)); // éviter le rate limit
          } catch {}
        }
        await sock.sendMessage(from, { text: ` *Expulsion terminée !*\n ${count}/${nonAdmins.length} membres expulsés.` });
      } catch (err) {
        await sock.sendMessage(from, { text: ` Erreur: ${err.message}` });
      }
    },
  },

  ban: {
    description: 'Bannir un membre (kick + liste noire)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) {
        await sock.sendMessage(from, { text: ' Usage: !ban @membre [raison]' });
        return;
      }
      const number = target.split('@')[0];
      const reason = args.slice(1).join(' ') || 'Aucune raison';
      banUser(from, number, reason);
      try {
        await sock.groupParticipantsUpdate(from, [target], 'remove');
      } catch {}
      await sock.sendMessage(from, {
        text: ` *${number}* a été *banni* du groupe.\n Raison: ${reason}\n\n_Il sera re-expulsé automatiquement s'il tente de rejoindre._`,
        mentions: [target],
      });
    },
  },

  unbangroup: {
    description: 'Débannir un membre du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      if (!args[0]) {
        await sock.sendMessage(from, { text: ' Usage: !unbangroup [numéro]' });
        return;
      }
      const number = args[0].replace(/[^0-9]/g, '');
      unbanUser(from, number);
      await sock.sendMessage(from, { text: ` *${number}* a été débanni. Il peut rejoindre le groupe.` });
    },
  },

  banlist: {
    description: 'Voir la liste des bannis du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const list = getBanList(from);
      const entries = Object.entries(list);
      if (entries.length === 0) {
        await sock.sendMessage(from, { text: ' Aucun membre banni dans ce groupe.' });
        return;
      }
      let text = ` *Liste des bannis (${entries.length})*\n\n`;
      entries.forEach(([num, data]) => {
        text += `• ${num}\n   ${data.reason}\n   ${new Date(data.date).toLocaleDateString('fr-FR')}\n\n`;
      });
      text += `_!unbangroup [numéro] pour débannir_`;
      await sock.sendMessage(from, { text });
    },
  },

  listmembers: {
    description: 'Exporter la liste de tous les membres',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      try {
        const meta = await sock.groupMetadata(from);
        const members = meta.participants;
        const admins = members.filter(m => m.admin);
        const normal = members.filter(m => !m.admin);

        let text = ` *Membres de "${meta.subject}" (${members.length})*\n\n`;
        text += ` *Admins (${admins.length}):*\n`;
        admins.forEach((m, i) => { text += `${i + 1}. ${m.id.split('@')[0]}\n`; });
        text += `\n *Membres (${normal.length}):*\n`;
        normal.forEach((m, i) => { text += `${i + 1}. ${m.id.split('@')[0]}\n`; });

        // Sauvegarder dans un fichier
        const filename = `membres_${Date.now()}.txt`;
        const filepath = path.join(__dirname, '../../data/', filename);
        fs.writeFileSync(filepath, text);

        await sock.sendMessage(from, { text });
      } catch (err) {
        await sock.sendMessage(from, { text: ` Erreur: ${err.message}` });
      }
    },
  },

  // ════════════════════════════════════════
  // GESTION DU GROUPE — AVANCÉ
  // ════════════════════════════════════════

  getlink: {
    description: 'Obtenir le lien d\'invitation du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      try {
        const code = await sock.groupInviteCode(from);
        const link = `https://chat.whatsapp.com/${code}`;
        await sock.sendMessage(from, {
          text: ` *Lien d'invitation du groupe*\n\n${link}\n\n_ Partage ce lien avec précaution.\nUtilise !revoke pour révoquer l'ancien lien._`,
        });
      } catch {
        await sock.sendMessage(from, { text: ' Impossible d\'obtenir le lien (bot doit être admin).' });
      }
    },
  },

  revoke: {
    description: 'Révoquer et regénérer le lien d\'invitation',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      try {
        await sock.groupRevokeInvite(from);
        const newCode = await sock.groupInviteCode(from);
        const newLink = `https://chat.whatsapp.com/${newCode}`;
        await sock.sendMessage(from, {
          text: ` *Lien révoqué avec succès !*\n\n🔗 Nouveau lien:\n${newLink}\n\n_L'ancien lien ne fonctionne plus._`,
        });
      } catch {
        await sock.sendMessage(from, { text: ' Impossible de révoquer le lien.' });
      }
    },
  },

  backup: {
    description: 'Sauvegarder les infos et membres du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      try {
        await sock.sendMessage(from, { text: ' Sauvegarde en cours...' });
        const meta = await sock.groupMetadata(from);
        const backup = {
          date: new Date().toISOString(),
          name: meta.subject,
          description: meta.desc || '',
          creation: new Date(meta.creation * 1000).toISOString(),
          totalMembers: meta.participants.length,
          admins: meta.participants.filter(p => p.admin).map(p => p.id.split('@')[0]),
          members: meta.participants.map(p => ({
            number: p.id.split('@')[0],
            isAdmin: !!p.admin,
          })),
        };
        const filename = `backup_${meta.subject.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
        const filepath = path.join(__dirname, '../../data/', filename);
        fs.writeFileSync(filepath, JSON.stringify(backup, null, 2));

        let summary = ` *Backup du groupe sauvegardé !*\n\n`;
        summary += ` *Nom:* ${backup.name}\n`;
        summary += ` *Membres:* ${backup.totalMembers}\n`;
        summary += ` *Admins:* ${backup.admins.length}\n`;
        summary += ` *Date backup:* ${new Date().toLocaleDateString('fr-FR')}\n\n`;
        summary += `*Numéros des membres:*\n`;
        backup.members.forEach(m => {
          summary += `• ${m.number}${m.isAdmin ? ' ' : ''}\n`;
        });
        await sock.sendMessage(from, { text: summary });
      } catch (err) {
        await sock.sendMessage(from, { text: ` Erreur backup: ${err.message}` });
      }
    },
  },

  // ════════════════════════════════════════
  // MODÉRATION — AVANCÉ
  // ════════════════════════════════════════

  filter: {
    description: 'Gérer les mots interdits dans le groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();
      const word = args.slice(1).join(' ') || args[1];

      if (!action || action === 'list') {
        const words = getFilters(from);
        if (words.length === 0) {
          await sock.sendMessage(from, {
            text: ` *Filtre de mots*\n\nAucun mot interdit configuré.\n\n*Commandes:*\n• !filter add [mot] → Ajouter\n• !filter del [mot] → Supprimer\n• !filter list → Voir la liste\n• !filter clear → Tout effacer`,
          });
        } else {
          await sock.sendMessage(from, {
            text: ` *Mots interdits (${words.length}):*\n\n${words.map(w => `• ${w}`).join('\n')}\n\n_!filter del [mot] pour supprimer_`,
          });
        }
        return;
      }
      if (action === 'add' && word) {
        addFilter(from, word);
        await sock.sendMessage(from, { text: ` Mot *"${word}"* ajouté aux mots interdits.` });
      } else if (action === 'del' && word) {
        removeFilter(from, word);
        await sock.sendMessage(from, { text: ` Mot *"${word}"* supprimé des mots interdits.` });
      } else if (action === 'clear') {
        clearFilters(from);
        await sock.sendMessage(from, { text: ' Liste des mots interdits effacée.' });
      } else {
        await sock.sendMessage(from, { text: ' Usage: !filter add/del/list/clear [mot]' });
      }
    },
  },

  slowmode: {
    description: 'Activer le mode lent (limiter la fréquence des messages)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'off') {
        disableSlowmode(from);
        await sock.sendMessage(from, { text: ' *Slow mode désactivé.* Les membres peuvent écrire librement.' });
        return;
      }

      const seconds = parseInt(args[0]);
      if (isNaN(seconds) || seconds < 1) {
        const current = getSlowmode(from);
        await sock.sendMessage(from, {
          text: ` *Slow Mode*\n\nStatut actuel: ${current ? ` Activé (${current}s)` : ' Désactivé'}\n\n• !slowmode [secondes] → Activer\n• !slowmode off → Désactiver\n\nExemple: !slowmode 30 → 1 message toutes les 30s`,
        });
        return;
      }

      setSlowmode(from, seconds);
      await sock.sendMessage(from, {
        text: ` *Slow Mode activé !*\n\n⏱ Délai: *${seconds} seconde(s)* entre chaque message\n\n_Les admins ne sont pas affectés._\n_!slowmode off pour désactiver._`,
      });
    },
  },

  cleanbot: {
    description: 'Supprimer les derniers messages du bot dans le groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const count = parseInt(args[0]) || 5;
      const messages = global.botMessages?.get(from) || [];
      const toDelete = messages.slice(-Math.min(count, 20));

      if (toDelete.length === 0) {
        await sock.sendMessage(from, { text: ' Aucun message récent du bot à supprimer.' });
        return;
      }

      await sock.sendMessage(from, { text: ` Suppression de ${toDelete.length} message(s)...` });
      let deleted = 0;
      for (const key of toDelete) {
        try {
          await sock.sendMessage(from, { delete: key });
          deleted++;
          await new Promise(r => setTimeout(r, 300));
        } catch {}
      }
      // Vider le cache après suppression
      global.botMessages.set(from, []);
    },
  },

};
