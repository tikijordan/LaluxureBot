/**
 * ============================================================
 * @file        admin3.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes admin avancees — Tempkick, VIP, broadcast, poll, schedule, report
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES ADMIN AVANCÉES — PARTIE 3
// tempkick, vip, broadcast, poll, schedule,
// report, history, purge, antifake
// ============================================================

import { addVip, removeVip, isVip, getVipList } from '../utils/vip.js';
import { logAction, getHistory, clearHistory } from '../utils/history.js';
import { addSchedule, getPendingSchedules, cancelSchedule } from '../utils/schedule.js';
import { getAggregateVotesInPollMessage } from '@whiskeysockets/baileys';

// Sondages natifs : message envoyé (pour le déchiffrement des votes) + votes reçus
if (!global.pollStore) global.pollStore = new Map();   // pollMsgId → { msg, updates: [], closed }
if (!global.pollByGroup) global.pollByGroup = new Map(); // groupJid → pollMsgId
// Statut réel des actions sur les membres (intégré — aucun fichier séparé)
const GROUP_STATUS_MESSAGES = {
  '400': 'Requête invalide.',
  '401': 'Non autorisé — vérifiez que le bot est bien administrateur.',
  '403': 'Action refusée (confidentialité du membre ou droits insuffisants).',
  '404': 'Membre introuvable ou déjà absent du groupe.',
  '408': 'Délai dépassé (timeout WhatsApp).',
  '409': 'Conflit — action déjà effectuée.',
  '500': 'Erreur interne WhatsApp.',
};

/**
 * Exécute groupParticipantsUpdate pour UN participant et retourne
 * un résultat structuré et fiable.
 *
 * @returns {Promise<{ok: boolean, status: string|null, reason: string|null}>}
 */
export async function updateGroupParticipant(sock, from, jid, action) {
  try {
    const result = await sock.groupParticipantsUpdate(from, [jid], action);
    const status = result?.[0]?.status != null ? String(result[0].status) : null;

    // Certaines versions de Baileys ne renvoient pas de status du tout
    // (tableau vide/undefined) : dans ce cas on considère l'appel comme
    // ayant réussi UNIQUEMENT s'il n'a pas levé d'exception, mais on le
    // signale comme "non confirmé" plutôt que "confirmé".
    if (status === null) {
      return { ok: true, status: null, reason: null, unconfirmed: true };
    }

    if (status === '200') {
      return { ok: true, status, reason: null };
    }

    return { ok: false, status, reason: GROUP_STATUS_MESSAGES[status] || `Statut ${status} (échec).` };
  } catch (err) {
    return { ok: false, status: null, reason: err?.message || 'Erreur inconnue.' };
  }
}


// Timers pour les expulsions temporaires
const tempKickTimers = new Map();


function currentPoll(groupJid) {
  const id = global.pollByGroup.get(groupJid);
  return id ? global.pollStore.get(id) : null;
}

async function createNativePoll({ sock, from, isGroup, text, sender }, selectableCount) {
  if (!checkGroup(sock, from, isGroup)) return;
  const parts = (text || '').split('|').map(p => p.trim()).filter(Boolean);
  if (parts.length < 3) {
    await sock.sendMessage(from, { text: '*Usage:* !poll Question | Option1 | Option2 ...\nExemple: !poll Opencode est bien ? | Oui | Non' });
    return;
  }
  const question = parts[0];
  const options = [...new Set(parts.slice(1))].slice(0, 12);
  if (options.length < 2) { await sock.sendMessage(from, { text: 'Il faut au moins 2 options différentes.' }); return; }

  const sent = await sock.sendMessage(from, { poll: { name: question, values: options, selectableCount } });
  if (!sent?.key?.id) return;
  global.pollStore.set(sent.key.id, { msg: sent, updates: [], closed: false, createdBy: sender, multi: selectableCount === 0 });
  global.pollByGroup.set(from, sent.key.id);
}

function pollResults(sock, entry) {
  const meId = (sock.user?.id || '').split(':')[0] + '@s.whatsapp.net';
  return getAggregateVotesInPollMessage({ message: entry.msg.message, pollUpdates: entry.updates }, meId);
}

function formatPollResults(sock, entry, title) {
  const results = pollResults(sock, entry);
  const total = new Set(results.flatMap(r => r.voters)).size;
  const lines = results.map(r => {
    const n = r.voters.length;
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    return `${r.name}: *${n}* vote(s) (${pct}%)`;
  });
  const mode = entry.multi ? 'plusieurs choix possibles' : 'un seul choix';
  return `*${title}*\n\n❓ *${entry.msg.message?.pollCreationMessageV3?.name || entry.msg.message?.pollCreationMessage?.name || ''}*\n_(${mode})_\n\n${lines.join('\n')}\n\nTotal: ${total} votant(s)`;
}

// Stockage des sondages actifs
const activePolls = new Map(); // (ancien système texte — remplacé) // jid → { question, options, votes, messageKey }

// Signalements en attente
const reports = new Map(); // groupId → [{ sender, target, reason, date }]

function getMentionedJid(msg, args) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned?.length > 0) return mentioned[0];
  if (args[0]) { const n = args[0].replace(/[^0-9]/g, ''); if (n) return `${n}@s.whatsapp.net`; }
  return null;
}
function checkGroup(sock, from, isGroup) {
  if (!isGroup) { sock.sendMessage(from, { text: '❌ Uniquement dans les groupes.' }).catch(() => {}); return false; }
  return true;
}

export default {

  // ════════════════════════════════════════
  // GESTION MEMBRES — AVANCÉ
  // ════════════════════════════════════════

  tempkick: {
    description: 'Expulser temporairement un membre puis le réinviter',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      const minutes = parseInt(args.find(a => /^\d+$/.test(a))) || 5;

      if (!target) {
        await sock.sendMessage(from, { text: '❌ Usage: !tempkick @membre [minutes]\nExemple: !tempkick @Jean 10' });
        return;
      }

      const number = target.split('@')[0];

      // Annuler un tempkick existant
      if (tempKickTimers.has(target)) {
        clearTimeout(tempKickTimers.get(target));
        tempKickTimers.delete(target);
      }

      try {
        // Obtenir le code d'invitation avant de kick
        const inviteCode = await sock.groupInviteCode(from);
        const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;

        // Expulser — on vérifie le statut réel avant d'annoncer un succès
        const kickResult = await updateGroupParticipant(sock, from, target, 'remove');
        if (!kickResult.ok) {
          await sock.sendMessage(from, {
            text: `❌ Impossible d'expulser @${number}.\n_${kickResult.reason || 'Vérifiez que le bot est admin.'}_`,
            mentions: [target],
          });
          return;
        }

        await sock.sendMessage(from, {
          text: `⏱️ @${number} a été expulsé *temporairement* pour *${minutes} minute(s)*.\nIl sera automatiquement réinvité.\n\n_!tempkick @membre 0 pour annuler_`,
          mentions: [target],
        });

        // Envoyer le lien en message privé
        try {
          await sock.sendMessage(target, {
            text: `⏱️ Tu as été expulsé temporairement du groupe pendant *${minutes} minute(s)*.\n\nTu peux revenir ici dans ${minutes} min:\n${inviteLink}`,
          });
        } catch {}

        logAction(from, number, 'tempkick', `${minutes} minutes`);

        // Réinviter après X minutes
        const timer = setTimeout(async () => {
          const readdResult = await updateGroupParticipant(sock, from, target, 'add');
          if (readdResult.ok) {
            await sock.sendMessage(from, {
              text: `✅ @${number} peut revenir dans le groupe (expulsion temporaire terminée).`,
              mentions: [target],
            });
          } else {
            // Si l'ajout échoue (ex: confidentialité), envoyer le lien
            try {
              await sock.sendMessage(target, {
                text: `✅ Ton expulsion temporaire est terminée ! Rejoins le groupe:\n${inviteLink}`,
              });
            } catch {}
          }
          tempKickTimers.delete(target);
        }, minutes * 60 * 1000);

        tempKickTimers.set(target, timer);

      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}\n_Le bot doit être admin._` });
      }
    },
  },

  vip: {
    description: 'Gérer les membres VIP (immunisés aux sanctions auto)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (!action || action === 'list') {
        const list = getVipList(from);
        if (list.length === 0) {
          await sock.sendMessage(from, {
            text: `⭐ *Membres VIP*\n\nAucun membre VIP.\n\n*Commandes:*\n• !vip add @membre → Ajouter\n• !vip del @membre → Retirer\n• !vip list → Voir la liste\n\n_Les VIP sont immunisés contre: antilink, filtre mots, slowmode, antifake_`,
          });
          return;
        }
        await sock.sendMessage(from, {
          text: `⭐ *Membres VIP (${list.length}):*\n\n${list.map(n => `• ${n}`).join('\n')}\n\n_!vip del @membre pour retirer_`,
        });
        return;
      }

      const target = getMentionedJid(msg, args.slice(1));
      if (!target) { await sock.sendMessage(from, { text: '❌ Mentionne un membre.' }); return; }
      const number = target.split('@')[0];

      if (action === 'add') {
        addVip(from, number);
        await sock.sendMessage(from, {
          text: `⭐ @${number} est maintenant *VIP* !\nIl est immunisé contre les sanctions automatiques.`,
          mentions: [target],
        });
      } else if (action === 'del' || action === 'remove') {
        removeVip(from, number);
        await sock.sendMessage(from, {
          text: `✅ @${number} n'est plus VIP.`,
          mentions: [target],
        });
      }
    },
  },

  // ════════════════════════════════════════
  // FONCTIONNALITÉS GROUPE — AVANCÉ
  // ════════════════════════════════════════

  broadcast: {
    description: 'Envoyer un message privé à tous les membres du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      if (!text) {
        await sock.sendMessage(from, { text: ' Usage: !broadcast [message]\n\n_Envoie le message en privé à chaque membre._' });
        return;
      }

      try {
        const meta = await sock.groupMetadata(from);
        const members = meta.participants;
        await sock.sendMessage(from, {
          text: ` *Broadcast en cours...*\n ${members.length} membre(s) à contacter.\n\n_Cela peut prendre quelques minutes._`,
        });

        const ownLid = sock.user?.lid ? sock.user.lid.split(':')[0].split('@')[0] : null;
        const ownNum = (sock.user?.id || '').split(':')[0];
        let sent = 0, failed = 0;
        const failures = [];
        for (const member of members) {
          const rawNum = member.id.split('@')[0].split(':')[0];
          if (rawNum === ownNum || (ownLid && rawNum === ownLid)) continue;
          // Les membres sont souvent identifiés par LID : on envoie au vrai numéro si on le connaît
          let target = member.id;
          if (member.id.endsWith('@lid')) {
            const pn = await sock.signalRepository?.lidMapping?.getPNForLID(member.id).catch(() => null);
            if (pn) target = pn.split(':')[0].split('@')[0] + '@s.whatsapp.net';
          }
          try {
            await sock.sendMessage(target, {
              text: ` *Message du groupe "${meta.subject}":*\n\n${text}`,
            });
            sent++;
          } catch (e) {
            failed++;
            failures.push(`${rawNum}: ${e.message}`);
          }
          await new Promise(r => setTimeout(r, 1000)); // 1s entre chaque message
        }

        await sock.sendMessage(from, {
          text: ` *Broadcast terminé !*\n Envoyés: ${sent}\n Échecs: ${failed}` + (failures.length ? `\n\n_Échecs (10 premiers):_\n${failures.slice(0, 10).join('\n')}` : ''),
        });
      } catch (err) {
        await sock.sendMessage(from, { text: ` Erreur: ${err.message}` });
      }
    },
  },

  poll: {
    description: 'Créer un sondage WhatsApp (un seul choix)',
    adminOnly: false,
    execute: async (ctx) => createNativePoll(ctx, 1),
  },

  pollm: {
    description: 'Créer un sondage WhatsApp (plusieurs choix)',
    adminOnly: false,
    execute: async (ctx) => createNativePoll(ctx, 0),
  },

  pollresult: {
    description: 'Voir les résultats du sondage en cours',
    adminOnly: false,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const entry = currentPoll(from);
      if (!entry) { await sock.sendMessage(from, { text: 'Aucun sondage en cours.\nUtilise !poll pour en créer un.' }); return; }
      await sock.sendMessage(from, { text: formatPollResults(sock, entry, 'Résultats en direct') });
    },
  },

  closepoll: {
    description: 'Fermer le sondage en cours',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const entry = currentPoll(from);
      if (!entry) { await sock.sendMessage(from, { text: 'Aucun sondage en cours.' }); return; }
      entry.closed = true;
      global.pollByGroup.delete(from);
      await sock.sendMessage(from, { text: formatPollResults(sock, entry, 'Sondage fermé') });
    },
  },

  schedule: {
    description: 'Programmer un message à envoyer plus tard',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;

      // Format: !schedule [Xmin/Xh/HH:MM] [message]
      if (!args[0] || !text) {
        const pending = getPendingSchedules(from);
        await sock.sendMessage(from, {
          text: ` *Messages Programmés*\n\n*Usage:*\n• !schedule 30min [msg] → Dans 30 minutes\n• !schedule 2h [msg] → Dans 2 heures\n• !schedule 14:30 [msg] → À 14h30\n\n*En attente (${pending.length}):*\n${pending.map((s, i) => `${i + 1}. "${s.message.slice(0, 30)}..." → ${new Date(s.fireAt).toLocaleString('fr-FR')}`).join('\n') || 'Aucun'}\n\n• !schedule cancel [n°] → Annuler`,
        });
        return;
      }

      if (args[0] === 'cancel') {
        const idx = parseInt(args[1]) - 1;
        const pending = getPendingSchedules(from);
        if (isNaN(idx) || idx < 0 || idx >= pending.length) {
          await sock.sendMessage(from, { text: ' Numéro invalide. Utilise !schedule pour voir la liste.' });
          return;
        }
        cancelSchedule(pending[idx].id);
        await sock.sendMessage(from, { text: ` Message programmé n°${idx + 1} annulé.` });
        return;
      }

      const timeStr = args[0].toLowerCase();
      const message = args.slice(1).join(' ');
      let delayMs;

      if (timeStr.endsWith('min')) {
        delayMs = parseInt(timeStr) * 60 * 1000;
      } else if (timeStr.endsWith('h')) {
        delayMs = parseInt(timeStr) * 60 * 60 * 1000;
      } else if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
        const [hh, mm] = timeStr.split(':').map(Number);
        const target = new Date();
        target.setHours(hh, mm, 0, 0);
        if (target <= new Date()) target.setDate(target.getDate() + 1);
        delayMs = target - new Date();
      } else {
        await sock.sendMessage(from, { text: ' Format invalide.\nExemples: !schedule 30min [msg] | !schedule 2h [msg] | !schedule 14:30 [msg]' });
        return;
      }

      if (delayMs <= 0) {
        await sock.sendMessage(from, { text: ' L\'heure est dans le passé.' });
        return;
      }

      const entry = addSchedule(sock, from, message, delayMs);
      const fireTime = new Date(entry.fireAt).toLocaleString('fr-FR');

      await sock.sendMessage(from, {
        text: ` *Message programmé !*\n\n "${message}"\n Envoi le: *${fireTime}*\n\n_!schedule pour voir tous les messages programmés_`,
      });
    },
  },

  // ════════════════════════════════════════
  // MODÉRATION — AVANCÉ
  // ════════════════════════════════════════

  report: {
    description: 'Signaler un membre à l\'admin',
    adminOnly: false,
    execute: async ({ sock, msg, from, isGroup, sender, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) {
        await sock.sendMessage(from, { text: ' Usage: !report @membre [raison]' });
        return;
      }
      const reason = args.slice(1).join(' ') || 'Comportement inapproprié';
      const senderNum = sender.split('@')[0];
      const targetNum = target.split('@')[0];

      // Stocker le signalement
      if (!reports.has(from)) reports.set(from, []);
      reports.get(from).push({ sender: senderNum, target: targetNum, reason, date: new Date().toISOString() });

      await sock.sendMessage(from, {
        text: ` *Signalement envoyé aux admins.*\n\n Membre signalé: @${targetNum}\n Raison: ${reason}\n\n_Merci, les admins examineront ce signalement._`,
        mentions: [target],
      });

      // Notifier les admins en privé
      try {
        const meta = await sock.groupMetadata(from);
        const admins = meta.participants.filter(p => p.admin);
        for (const admin of admins) {
          await sock.sendMessage(admin.id, {
            text: ` *Nouveau Signalement dans "${meta.subject}"*\n\n👤 Signalé par: ${senderNum}\n Membre signalé: ${targetNum}\n Raison: ${reason}\n ${new Date().toLocaleString('fr-FR')}\n\nActions: !warn @${targetNum} | !kick @${targetNum} | !ban @${targetNum}`,
          }).catch(() => {});
        }
      } catch {}
    },
  },

  reports: {
    description: 'Voir tous les signalements du groupe (admin)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const list = reports.get(from) || [];
      if (list.length === 0) {
        await sock.sendMessage(from, { text: ' Aucun signalement en attente.' });
        return;
      }
      let text = ` *Signalements (${list.length})*\n\n`;
      list.slice(-10).forEach((r, i) => {
        text += `${i + 1}. *${r.target}* signalé par ${r.sender}\n    ${r.reason}\n    ${new Date(r.date).toLocaleDateString('fr-FR')}\n\n`;
      });
      text += `_!clearreports pour effacer_`;
      await sock.sendMessage(from, { text });
    },
  },

  clearreports: {
    description: 'Effacer tous les signalements (admin)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      reports.delete(from);
      await sock.sendMessage(from, { text: ' Tous les signalements ont été effacés.' });
    },
  },

  history: {
    description: 'Voir l\'historique des sanctions d\'un membre',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) { await sock.sendMessage(from, { text: ' Usage: !history @membre' }); return; }
      const number = target.split('@')[0];
      const hist = getHistory(from, number);
      if (hist.length === 0) {
        await sock.sendMessage(from, { text: ` @${number} n'a aucun historique de sanctions.`, mentions: [target] });
        return;
      }
      const actionEmoji = { warn:'', kick:'', ban:'', mute:'', tempkick:'', promote:'', demote:'' };
      let text = ` *Historique de @${number} (${hist.length} action(s))*\n\n`;
      hist.slice(-15).forEach((h, i) => {
        const emoji = actionEmoji[h.action] || '';
        text += `${i + 1}. ${emoji} *${h.action.toUpperCase()}*\n    ${h.reason || '-'}\n    ${new Date(h.date).toLocaleDateString('fr-FR')}\n\n`;
      });
      text += `_!clearhistory @membre pour effacer_`;
      await sock.sendMessage(from, { text, mentions: [target] });
    },
  },

  clearhistory: {
    description: 'Effacer l\'historique d\'un membre',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) { await sock.sendMessage(from, { text: ' Usage: !clearhistory @membre' }); return; }
      clearHistory(from, target.split('@')[0]);
      await sock.sendMessage(from, { text: ` Historique de @${target.split('@')[0]} effacé.`, mentions: [target] });
    },
  },

  purge: {
    description: 'Supprimer les N derniers messages du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const count = Math.min(parseInt(args[0]) || 5, 50);
      const msgs = global.botMessages?.get(from) || [];

      await sock.sendMessage(from, { text: ` Suppression de ${count} message(s) en cours...` });

      let deleted = 0;
      // Supprimer les messages du bot d'abord (les seuls qu'on peut supprimer)
      const toDelete = msgs.slice(-count);
      for (const key of toDelete) {
        try {
          await sock.sendMessage(from, { delete: key });
          deleted++;
          await new Promise(r => setTimeout(r, 200));
        } catch {}
      }

      // Vider le cache
      global.botMessages.set(from, msgs.slice(0, -count));
      await sock.sendMessage(from, { text: ` *${deleted} message(s) supprimé(s).*\n\n_Note: WhatsApp ne permet de supprimer que les messages du bot._` });
    },
  },

  antifake: {
    description: 'Activer la protection anti-numéros suspects',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (!global.antifakeGroups) global.antifakeGroups = new Set();

      if (!action) {
        const enabled = global.antifakeGroups.has(from);
        await sock.sendMessage(from, {
          text: `🔍 *Anti-Fake*\n\nStatut: ${enabled ? ' Activé' : ' Désactivé'}\n\n• !antifake on → Activer\n• !antifake off → Désactiver\n\n_Bloque les numéros avec des formats suspects (trop courts, préfixes inconnus, etc.)_`,
        });
        return;
      }

      if (action === 'on') {
        global.antifakeGroups.add(from);
        await sock.sendMessage(from, {
          text: ` *Anti-Fake activé !*\n\nLes nouveaux membres avec des numéros suspects seront automatiquement expulsés.\n\n_Formats acceptés: +22X, +33, +1, +44, etc._`,
        });
      } else if (action === 'off') {
        global.antifakeGroups.delete(from);
        await sock.sendMessage(from, { text: ' Anti-Fake désactivé.' });
      }
    },
  },
};