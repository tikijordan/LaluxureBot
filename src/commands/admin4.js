/**
 * ============================================================
 * @file        admin4.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes admin avancees — Notes, memberinfo, birthday, rules, nightmode, autoreply
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES ADMIN AVANCÉES — PARTIE 4
// noted, memberinfo, birthday, rules, announce,
// groupstats, autoreply, antivideo, antiimage,
// antivoice, nightmode, warnspam
// ============================================================

import { addNote, getNotes, clearNotes } from '../utils/membernotes.js';
import { setBirthday, getBirthday, getAllBirthdays } from '../utils/birthday.js';
import { setRules, getRules, clearRules } from '../utils/rules.js';
import { addReply, removeReply, getReplies, findReply } from '../utils/autoreply.js';
import { getGroupStats, resetGroupStats } from '../utils/groupstats.js';
import { setFilter, isFiltered, getFilters } from '../utils/mediafilter.js';
import { getWarns, addWarn, resetWarns } from '../utils/warns.js';
import { getHistory } from '../utils/history.js';
import { isVip } from '../utils/vip.js';

// Timers nightmode actifs
const nightmodeTimers = new Map();

function getMentionedJid(msg, args) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned?.length > 0) return mentioned[0];
  if (args[0]) { const n = args[0].replace(/[^0-9]/g, ''); if (n.length > 4) return `${n}@s.whatsapp.net`; }
  return null;
}
function checkGroup(sock, from, isGroup) {
  if (!isGroup) { sock.sendMessage(from, { text: '❌ Uniquement dans les groupes.' }).catch(() => {}); return false; }
  return true;
}

export default {

  // ════════════════════════════════════════
  // MEMBRES — AVANCÉ
  // ════════════════════════════════════════

  noted: {
    description: 'Ajouter une note privée sur un membre (admin)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args, senderNumber }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'list') {
        const target = getMentionedJid(msg, args.slice(1)) || (args[1] && `${args[1].replace(/\D/g,'')}@s.whatsapp.net`);
        if (!target) { await sock.sendMessage(from, { text: '❌ Usage: !noted list @membre' }); return; }
        const number = target.split('@')[0];
        const notes = getNotes(from, number);
        if (notes.length === 0) { await sock.sendMessage(from, { text: `📋 Aucune note pour ${number}.` }); return; }
        let text = `📋 *Notes sur ${number} (${notes.length})*\n\n`;
        notes.forEach((n, i) => { text += `${i+1}. ${n.note}\n   _Par: ${n.by} • ${new Date(n.date).toLocaleDateString('fr-FR')}_\n\n`; });
        text += `_!noted clear @membre pour effacer_`;
        await sock.sendMessage(from, { text });
        return;
      }
      if (action === 'clear') {
        const target = getMentionedJid(msg, args.slice(1));
        if (!target) { await sock.sendMessage(from, { text: '❌ Usage: !noted clear @membre' }); return; }
        clearNotes(from, target.split('@')[0]);
        await sock.sendMessage(from, { text: `✅ Notes effacées pour ${target.split('@')[0]}.` });
        return;
      }

      // Ajouter une note: !noted @membre [note]
      const target = getMentionedJid(msg, args);
      const note = args.slice(1).join(' ');
      if (!target || !note) {
        await sock.sendMessage(from, { text: '❌ Usage:\n• !noted @membre [note] → Ajouter\n• !noted list @membre → Voir\n• !noted clear @membre → Effacer' });
        return;
      }
      addNote(from, target.split('@')[0], note, senderNumber);
      await sock.sendMessage(from, { text: `📋 Note ajoutée pour *${target.split('@')[0]}*:\n"${note}"` });
    },
  },

  memberinfo: {
    description: 'Fiche complète d\'un membre du groupe',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) { await sock.sendMessage(from, { text: '❌ Usage: !memberinfo @membre' }); return; }
      const number = target.split('@')[0];

      try {
        const meta = await sock.groupMetadata(from);
        const member = meta.participants.find(p => p.id === target);
        if (!member) { await sock.sendMessage(from, { text: `❌ ${number} n'est pas dans le groupe.` }); return; }

        const warns = getWarns(from, number);
        const hist = getHistory(from, number);
        const notes = getNotes(from, number);
        const bday = getBirthday(from, number);
        const vip = isVip(from, number);
        const isAdmin = !!member.admin;
        const stats = getGroupStats(from);
        const msgCount = stats?.members?.[target] || 0;

        // Photo de profil
        let ppUrl = null;
        try { ppUrl = await sock.profilePictureUrl(target, 'image'); } catch {}

        const text =
          `👤 *Fiche Membre*\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `📱 Numéro: *${number}*\n` +
          `👑 Rôle: ${isAdmin ? '*Admin*' : 'Membre'}\n` +
          `⭐ VIP: ${vip ? 'Oui' : 'Non'}\n` +
          `🎂 Anniversaire: ${bday || 'Non enregistré'}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `📊 *Activité:*\n` +
          `   💬 Messages envoyés: ${msgCount}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🚨 *Sanctions:*\n` +
          `   ⚠️ Warns: ${warns.count || 0}/${process.env.MAX_WARNS || 3}\n` +
          `   📋 Historique: ${hist.length} action(s)\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `📝 *Notes admin:* ${notes.length}\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `_!history @${number} pour voir les sanctions_\n` +
          `_!noted @${number} pour les notes_`;

        if (ppUrl) {
          await sock.sendMessage(from, { image: { url: ppUrl }, caption: text, mentions: [target] });
        } else {
          await sock.sendMessage(from, { text, mentions: [target] });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },

  birthday: {
    description: 'Enregistrer l\'anniversaire d\'un membre',
    adminOnly: false,
    execute: async ({ sock, msg, from, isGroup, args, sender }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'list') {
        const all = getAllBirthdays(from);
        const entries = Object.entries(all);
        if (entries.length === 0) { await sock.sendMessage(from, { text: '🎂 Aucun anniversaire enregistré.\n\n!birthday @membre JJ/MM pour en ajouter.' }); return; }
        const today = new Date(); const mm = String(today.getMonth()+1).padStart(2,'0'); const dd = String(today.getDate()).padStart(2,'0');
        entries.sort((a,b) => a[1].localeCompare(b[1]));
        let text = `🎂 *Anniversaires du groupe (${entries.length})*\n\n`;
        entries.forEach(([num, date]) => { const isToday = date.startsWith(`${dd}/${mm}`); text += `${isToday ? '🎉 ' : ''}${num}: *${date}*${isToday ? ' ← Aujourd\'hui!' : ''}\n`; });
        await sock.sendMessage(from, { text });
        return;
      }

      // !birthday @membre JJ/MM ou JJ/MM/AAAA
      const target = getMentionedJid(msg, args);
      const dateStr = args.find(a => /^\d{1,2}\/\d{1,2}/.test(a));
      if (!target || !dateStr) {
        await sock.sendMessage(from, { text: '🎂 Usage:\n• !birthday @membre JJ/MM → Enregistrer\n• !birthday list → Voir tous\n\nExemple: !birthday @Jean 15/03' });
        return;
      }
      const number = target.split('@')[0];
      setBirthday(from, number, dateStr);
      await sock.sendMessage(from, { text: `🎂 Anniversaire de *${number}* enregistré: *${dateStr}*\n\nLe bot souhaitera automatiquement à minuit ! 🎉`, mentions: [target] });
    },
  },

  // ════════════════════════════════════════
  // GROUPE — AVANCÉ
  // ════════════════════════════════════════

  rules: {
    description: 'Afficher ou définir le règlement du groupe',
    adminOnly: false,
    execute: async ({ sock, from, isGroup, isOwner, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (!action || action === 'show') {
        const rules = getRules(from);
        if (!rules) {
          await sock.sendMessage(from, { text: `📜 Aucun règlement défini.\n\nAdmin: utilise *!rules set [règlement]* pour en définir un.` });
          return;
        }
        await sock.sendMessage(from, { text: `📜 *RÈGLEMENT DU GROUPE*\n${'━'.repeat(25)}\n\n${rules}\n\n${'━'.repeat(25)}\n_Respectez ces règles ou des sanctions seront appliquées._` });
        return;
      }

      if (!isOwner) { await sock.sendMessage(from, { text: '🔒 Seul l\'admin peut modifier le règlement.' }); return; }

      if (action === 'set') {
        const rulesText = args.slice(1).join(' ');
        if (!rulesText) { await sock.sendMessage(from, { text: '❌ Usage: !rules set [règlement complet]' }); return; }
        setRules(from, rulesText);
        await sock.sendMessage(from, { text: `✅ Règlement défini!\n\n!rules pour l'afficher.` });
      } else if (action === 'clear') {
        clearRules(from);
        await sock.sendMessage(from, { text: '✅ Règlement effacé.' });
      }
    },
  },

  announce: {
    description: 'Envoyer une annonce officielle formatée',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, text, sender }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      if (!text) { await sock.sendMessage(from, { text: '❌ Usage: !announce [message]' }); return; }
      const now = new Date().toLocaleString('fr-FR');
      const announce =
        `📢 *ANNONCE OFFICIELLE*\n` +
        `${'═'.repeat(28)}\n\n` +
        `${text}\n\n` +
        `${'═'.repeat(28)}\n` +
        `📅 ${now}\n` +
        `👤 Par: @${sender.split('@')[0]}`;
      await sock.sendMessage(from, { text: announce, mentions: [sender] });
    },
  },

  groupstats: {
    description: 'Statistiques d\'activité du groupe',
    adminOnly: false,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'reset') {
        resetGroupStats(from);
        await sock.sendMessage(from, { text: '✅ Statistiques du groupe réinitialisées.' });
        return;
      }

      const stats = getGroupStats(from);
      if (!stats || stats.total === 0) {
        await sock.sendMessage(from, { text: '📊 Pas encore de statistiques.\n\nLes stats s\'accumulent automatiquement dès que les membres envoient des messages.' });
        return;
      }

      // Top 10 membres les plus actifs
      const top = Object.entries(stats.members)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
      const since = new Date(stats.startDate).toLocaleDateString('fr-FR');

      let text = `📊 *Statistiques du Groupe*\n`;
      text += `${'━'.repeat(25)}\n`;
      text += `💬 Total messages: *${stats.total}*\n`;
      text += `👥 Membres actifs: *${Object.keys(stats.members).length}*\n`;
      text += `📅 Depuis: ${since}\n`;
      text += `${'━'.repeat(25)}\n`;
      text += `🏆 *Top 10 membres actifs:*\n\n`;
      top.forEach(([jid, count], i) => {
        const num = jid.split('@')[0];
        const pct = Math.round((count / stats.total) * 100);
        text += `${medals[i]} ${num}: *${count}* msgs (${pct}%)\n`;
      });
      text += `\n_!groupstats reset pour réinitialiser_`;
      await sock.sendMessage(from, { text });
    },
  },

  autoreply: {
    description: 'Configurer des réponses automatiques aux mots-clés',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (!action || action === 'list') {
        const replies = getReplies(from);
        const entries = Object.entries(replies);
        if (entries.length === 0) {
          await sock.sendMessage(from, {
            text: `🤖 *Auto-Reply*\n\nAucune réponse automatique.\n\n*Commandes:*\n• !autoreply add [mot] | [réponse]\n• !autoreply del [mot]\n• !autoreply list\n• !autoreply clear\n\nExemple:\n!autoreply add bonjour | Bonjour! Comment puis-je vous aider? 😊`,
          });
          return;
        }
        let text = `🤖 *Auto-Reply (${entries.length})*\n\n`;
        entries.forEach(([trigger, response]) => { text += `• *"${trigger}"* → ${response.slice(0,40)}${response.length>40?'...':''}\n`; });
        text += `\n_!autoreply del [mot] pour supprimer_`;
        await sock.sendMessage(from, { text });
        return;
      }

      if (action === 'add') {
        const rest = args.slice(1).join(' ');
        const [trigger, ...responseParts] = rest.split('|');
        const response = responseParts.join('|').trim();
        if (!trigger?.trim() || !response) {
          await sock.sendMessage(from, { text: '❌ Usage: !autoreply add [mot-clé] | [réponse]' });
          return;
        }
        addReply(from, trigger.trim(), response);
        await sock.sendMessage(from, { text: `✅ Auto-reply ajouté:\n*"${trigger.trim()}"* → ${response}` });
      } else if (action === 'del') {
        const trigger = args.slice(1).join(' ');
        if (!trigger) { await sock.sendMessage(from, { text: '❌ Usage: !autoreply del [mot-clé]' }); return; }
        removeReply(from, trigger);
        await sock.sendMessage(from, { text: `✅ Auto-reply *"${trigger}"* supprimé.` });
      } else if (action === 'clear') {
        const replies = getReplies(from);
        for (const trigger of Object.keys(replies)) removeReply(from, trigger);
        await sock.sendMessage(from, { text: '✅ Tous les auto-replies supprimés.' });
      }
    },
  },

  // ════════════════════════════════════════
  // MODÉRATION MEDIA & NIGHTMODE
  // ════════════════════════════════════════

  antivideo: {
    description: 'Bloquer les vidéos dans le groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();
      if (!action) {
        const on = isFiltered(from, 'video');
        await sock.sendMessage(from, { text: `🎥 Anti-Vidéo: ${on ? '✅ Activé' : '❌ Désactivé'}\n\n• !antivideo on\n• !antivideo off` });
        return;
      }
      setFilter(from, 'video', action === 'on');
      await sock.sendMessage(from, { text: `🎥 Anti-Vidéo *${action === 'on' ? 'activé' : 'désactivé'}*.${action === 'on' ? '\nToutes les vidéos seront supprimées automatiquement.' : ''}` });
    },
  },

  antiimage: {
    description: 'Bloquer les images dans le groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();
      if (!action) {
        const on = isFiltered(from, 'image');
        await sock.sendMessage(from, { text: `🖼️ Anti-Image: ${on ? '✅ Activé' : '❌ Désactivé'}\n\n• !antiimage on\n• !antiimage off` });
        return;
      }
      setFilter(from, 'image', action === 'on');
      await sock.sendMessage(from, { text: `🖼️ Anti-Image *${action === 'on' ? 'activé' : 'désactivé'}*.` });
    },
  },

  antivoice: {
    description: 'Bloquer les messages vocaux dans le groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();
      if (!action) {
        const on = isFiltered(from, 'audio');
        await sock.sendMessage(from, { text: `🎙️ Anti-Vocal: ${on ? '✅ Activé' : '❌ Désactivé'}\n\n• !antivoice on\n• !antivoice off` });
        return;
      }
      setFilter(from, 'audio', action === 'on');
      await sock.sendMessage(from, { text: `🎙️ Anti-Vocal *${action === 'on' ? 'activé' : 'désactivé'}*.` });
    },
  },

  mediafilters: {
    description: 'Voir tous les filtres média actifs',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const filters = getFilters(from);
      const text =
        `🎛️ *Filtres Média*\n\n` +
        `🖼️ Images: ${filters.image ? '🚫 Bloquées' : '✅ Autorisées'}\n` +
        `🎥 Vidéos: ${filters.video ? '🚫 Bloquées' : '✅ Autorisées'}\n` +
        `🎙️ Vocaux: ${filters.audio ? '🚫 Bloqués' : '✅ Autorisés'}\n\n` +
        `_Commandes: !antiimage | !antivideo | !antivoice_`;
      await sock.sendMessage(from, { text });
    },
  },

  nightmode: {
    description: 'Fermer le groupe automatiquement la nuit',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'off') {
        const timers = nightmodeTimers.get(from);
        if (timers) { clearTimeout(timers.close); clearTimeout(timers.open); nightmodeTimers.delete(from); }
        await sock.sendMessage(from, { text: '✅ Night Mode désactivé.' });
        return;
      }

      // Format: !nightmode 22:00 06:00
      const closeTime = args[0]; // ex: 22:00
      const openTime = args[1] || '06:00';  // ex: 06:00

      if (!closeTime || !/^\d{1,2}:\d{2}$/.test(closeTime)) {
        const current = nightmodeTimers.has(from);
        await sock.sendMessage(from, {
          text: `🌙 *Night Mode*\n\nStatut: ${current ? '✅ Activé' : '❌ Désactivé'}\n\n*Usage:* !nightmode [fermeture] [ouverture]\nExemple: !nightmode 22:00 06:00\n\n• !nightmode off → Désactiver`,
        });
        return;
      }

      const msUntil = (timeStr) => {
        const [hh, mm] = timeStr.split(':').map(Number);
        const now = new Date();
        const target = new Date(); target.setHours(hh, mm, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return target - now;
      };

      // Programmer la fermeture
      const scheduleNightmode = () => {
        const closeMs = msUntil(closeTime);
        const closeTimer = setTimeout(async () => {
          try {
            await sock.groupSettingUpdate(from, 'announcement');
            await sock.sendMessage(from, { text: `🌙 *Night Mode activé*\nLe groupe est fermé jusqu'à *${openTime}*.\nBonne nuit ! 😴` });
          } catch {}

          // Programmer l'ouverture
          const openMs = msUntil(openTime);
          const openTimer = setTimeout(async () => {
            try {
              await sock.groupSettingUpdate(from, 'not_announcement');
              await sock.sendMessage(from, { text: `☀️ *Night Mode désactivé*\nBonjour ! Le groupe est de nouveau ouvert. 😊` });
            } catch {}
            scheduleNightmode(); // reprogrammer pour le lendemain
          }, openMs);

          const existing = nightmodeTimers.get(from) || {};
          nightmodeTimers.set(from, { ...existing, open: openTimer });
        }, closeMs);

        nightmodeTimers.set(from, { close: closeTimer });
      };

      scheduleNightmode();

      await sock.sendMessage(from, {
        text: `🌙 *Night Mode configuré !*\n\n🔒 Fermeture: *${closeTime}*\n🔓 Ouverture: *${openTime}*\n\n_Le groupe sera fermé automatiquement chaque nuit._\n_!nightmode off pour désactiver._`,
      });
    },
  },

  warnspam: {
    description: 'Activer warn automatique pour les spammeurs',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      if (!global.warnSpamGroups) global.warnSpamGroups = new Set();
      const action = args[0]?.toLowerCase();

      if (!action) {
        const on = global.warnSpamGroups.has(from);
        await sock.sendMessage(from, { text: `⚡ *Warn-Spam Auto*\n\nStatut: ${on ? '✅ Activé' : '❌ Désactivé'}\n\n• !warnspam on → Activer\n• !warnspam off → Désactiver\n\n_Si anti-spam détecte un spam → warn auto attribué_` });
        return;
      }
      if (action === 'on') {
        global.warnSpamGroups.add(from);
        await sock.sendMessage(from, { text: `⚡ *Warn-Spam Auto activé !*\nLes spammeurs recevront un warn automatique.\n${process.env.MAX_WARNS || 3} warns = expulsion.` });
      } else {
        global.warnSpamGroups.delete(from);
        await sock.sendMessage(from, { text: '✅ Warn-Spam Auto désactivé.' });
      }
    },
  },
};
