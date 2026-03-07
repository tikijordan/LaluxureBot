/**
 * ============================================================
 * @file        admin5.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes admin avancees — Captcha, whitelist, lockdown, grouplogs, challenge
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES ADMIN — PARTIE 5
// automod, captcha, floodprotect, autobackup,
// agenda, vote, leaderboard, challenge,
// lockdown, whitelist, maxmembers, grouplogs
// ============================================================

import { addEvent, getEvents, removeEvent } from '../utils/agenda.js';
import { addToWhitelist, removeFromWhitelist, isWhitelisted, getWhitelist } from '../utils/whitelist.js';
import { log, getLogs, clearLogs } from '../utils/grouplogs.js';
import { enableCaptcha, disableCaptcha, isCaptchaEnabled, createChallenge } from '../utils/captcha.js';
import { getGroupStats } from '../utils/groupstats.js';

// État en mémoire
if (!global.automodGroups)    global.automodGroups    = new Set();
if (!global.floodGroups)      global.floodGroups      = new Map(); // groupId → { count, window }
if (!global.floodTracker)     global.floodTracker     = new Map(); // groupId__sender → [timestamps]
if (!global.maxMembersGroups) global.maxMembersGroups = new Map(); // groupId → max
if (!global.activeVotes)      global.activeVotes      = new Map(); // groupId → voteObj
if (!global.autobackupTimers) global.autobackupTimers = new Map();
if (!global.lockdownGroups)   global.lockdownGroups   = new Set();

function getMentionedJid(msg, args) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned?.length > 0) return mentioned[0];
  if (args[0]) { const n = args[0].replace(/[^0-9]/g, ''); if (n.length > 4) return `${n}@s.whatsapp.net`; }
  return null;
}
function checkGroup(sock, from, isGroup) {
  if (!isGroup) { sock.sendMessage(from, { text: '❌ Uniquement dans les groupes.' }); return false; }
  return true;
}

export default {

  // ════════════════════════════════════════
  // MODÉRATION AUTOMATIQUE
  // ════════════════════════════════════════

  automod: {
    description: 'Modération automatique complète (IA)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();
      if (!action) {
        const on = global.automodGroups.has(from);
        await sock.sendMessage(from, {
          text: `🤖 *AutoMod*\n\nStatut: ${on ? '✅ Activé' : '❌ Désactivé'}\n\n*Ce que fait AutoMod:*\n• 🔗 Supprime les liens\n• 🤬 Filtre les gros mots\n• 📨 Bloque le spam/flood\n• ⚠️ Warn auto (3 warns = kick)\n• 🔇 Mute temporaire si récidive\n\n• !automod on → Activer\n• !automod off → Désactiver`,
        });
        return;
      }
      if (action === 'on') {
        global.automodGroups.add(from);
        log(from, 'automod_on', 'system');
        await sock.sendMessage(from, {
          text: `🤖 *AutoMod activé !*\n\nLe bot gère maintenant automatiquement:\n✅ Anti-lien | ✅ Anti-gros mots\n✅ Anti-spam | ✅ Warns auto\n\n_!automod off pour désactiver_`,
        });
      } else {
        global.automodGroups.delete(from);
        await sock.sendMessage(from, { text: '✅ AutoMod désactivé.' });
      }
    },
  },

  captcha: {
    description: 'Vérification anti-bot à l\'entrée du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();
      if (!action) {
        const on = isCaptchaEnabled(from);
        await sock.sendMessage(from, {
          text: `🔐 *Captcha Anti-Bot*\n\nStatut: ${on ? '✅ Activé' : '❌ Désactivé'}\n\n_Quand activé: chaque nouveau membre reçoit un calcul mathématique en privé. S'il ne répond pas correctement en 2 min → expulsion automatique._\n\n• !captcha on\n• !captcha off`,
        });
        return;
      }
      if (action === 'on') {
        enableCaptcha(from);
        log(from, 'captcha_on', 'admin');
        await sock.sendMessage(from, { text: `🔐 *Captcha activé !*\nChaque nouveau membre devra résoudre un calcul avant d'accéder au groupe.` });
      } else {
        disableCaptcha(from);
        await sock.sendMessage(from, { text: '✅ Captcha désactivé.' });
      }
    },
  },

  floodprotect: {
    description: 'Protection anti-flood avancée',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'off') {
        global.floodGroups.delete(from);
        await sock.sendMessage(from, { text: '✅ Protection anti-flood désactivée.' });
        return;
      }

      const maxMsgs = parseInt(args[0]) || 5;
      const windowSec = parseInt(args[1]) || 5;

      if (isNaN(maxMsgs)) {
        const current = global.floodGroups.get(from);
        await sock.sendMessage(from, {
          text: `🌊 *Anti-Flood*\n\nStatut: ${current ? `✅ Activé (max ${current.max} msgs/${current.window}s)` : '❌ Désactivé'}\n\n*Usage:* !floodprotect [max_msgs] [fenêtre_sec]\nExemple: !floodprotect 5 10 → max 5 msgs en 10s\n\n• !floodprotect off → Désactiver`,
        });
        return;
      }

      global.floodGroups.set(from, { max: maxMsgs, window: windowSec });
      log(from, 'floodprotect_on', 'admin', '', `${maxMsgs}/${windowSec}s`);
      await sock.sendMessage(from, {
        text: `🌊 *Anti-Flood activé !*\n\n📊 Max: *${maxMsgs} messages* en *${windowSec} secondes*\n\nSi dépassé → suppression + warn automatique.\n\n_!floodprotect off pour désactiver_`,
      });
    },
  },

  autobackup: {
    description: 'Sauvegarde automatique périodique du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args, senderNumber }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'off') {
        const timer = global.autobackupTimers.get(from);
        if (timer) { clearInterval(timer); global.autobackupTimers.delete(from); }
        await sock.sendMessage(from, { text: '✅ Sauvegarde automatique désactivée.' });
        return;
      }

      const intervalH = parseInt(args[0]) || 24;
      if (global.autobackupTimers.has(from)) {
        clearInterval(global.autobackupTimers.get(from));
      }

      const doBackup = async () => {
        try {
          const meta = await sock.groupMetadata(from);
          const backup = {
            date: new Date().toISOString(),
            name: meta.subject,
            members: meta.participants.map(p => ({ number: p.id.split('@')[0], isAdmin: !!p.admin })),
          };
          // Envoyer résumé à l'admin
          await sock.sendMessage(`${senderNumber}@s.whatsapp.net`, {
            text: `💾 *Backup Auto — ${meta.subject}*\n📅 ${new Date().toLocaleString('fr-FR')}\n👥 ${backup.members.length} membres\n👑 ${backup.members.filter(m=>m.isAdmin).length} admins`,
          });
        } catch {}
      };

      const timer = setInterval(doBackup, intervalH * 60 * 60 * 1000);
      global.autobackupTimers.set(from, timer);
      await doBackup(); // Backup immédiat

      await sock.sendMessage(from, {
        text: `💾 *Backup automatique activé !*\n\n⏰ Fréquence: toutes les *${intervalH} heure(s)*\n📬 Envoyé à: ${senderNumber}\n\n_!autobackup off pour désactiver_`,
      });
    },
  },

  // ════════════════════════════════════════
  // COMMUNICATION & ENGAGEMENT
  // ════════════════════════════════════════

  agenda: {
    description: 'Calendrier d\'événements du groupe',
    adminOnly: false,
    execute: async ({ sock, from, isGroup, isOwner, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (!action || action === 'list') {
        const events = getEvents(from);
        if (events.length === 0) {
          await sock.sendMessage(from, {
            text: `📅 *Agenda du Groupe*\n\nAucun événement à venir.\n\n*Ajouter un événement (admin):*\n!agenda add [JJ/MM/AAAA] [HH:MM] [titre] | [description]\n\nExemple:\n!agenda add 15/03/2025 20:00 Réunion | Discussion hebdomadaire`,
          });
          return;
        }
        let msg = `📅 *Agenda — ${events.length} événement(s) à venir*\n\n`;
        events.forEach((e, i) => {
          const d = new Date(e.date);
          msg += `${i+1}. 📌 *${e.title}*\n`;
          msg += `   📅 ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}\n`;
          if (e.desc) msg += `   📝 ${e.desc}\n`;
          msg += `   _ID: ${e.id}_\n\n`;
        });
        msg += `_!agenda del [ID] pour supprimer_`;
        await sock.sendMessage(from, { text: msg });
        return;
      }

      if (!isOwner) { await sock.sendMessage(from, { text: '🔒 Seul l\'admin peut gérer l\'agenda.' }); return; }

      if (action === 'add') {
        // Format: !agenda add JJ/MM/AAAA HH:MM Titre | Description
        const rest = args.slice(1);
        const dateStr = rest[0]; const timeStr = rest[1];
        const titleAndDesc = rest.slice(2).join(' ');
        const [title, ...descParts] = titleAndDesc.split('|');
        const desc = descParts.join('|').trim();

        if (!dateStr || !timeStr || !title?.trim()) {
          await sock.sendMessage(from, { text: '❌ Usage: !agenda add [JJ/MM/AAAA] [HH:MM] [titre] | [description]' });
          return;
        }

        const [dd,mm,yyyy] = dateStr.split('/').map(Number);
        const [hh,min] = timeStr.split(':').map(Number);
        const eventDate = new Date(yyyy, mm-1, dd, hh, min);

        if (isNaN(eventDate.getTime())) { await sock.sendMessage(from, { text: '❌ Date invalide.' }); return; }

        const event = addEvent(from, { title: title.trim(), desc, date: eventDate.toISOString() });
        log(from, 'agenda_add', 'admin', '', title.trim());

        // Rappel automatique 1h avant
        const msUntil = eventDate - new Date() - 3600000;
        if (msUntil > 0) {
          setTimeout(async () => {
            await sock.sendMessage(from, {
              text: `⏰ *Rappel — Dans 1 heure !*\n\n📌 *${event.title}*\n📅 ${eventDate.toLocaleString('fr-FR')}\n${event.desc ? `📝 ${event.desc}` : ''}`,
            }).catch(() => {});
          }, msUntil);
        }

        await sock.sendMessage(from, {
          text: `✅ *Événement ajouté !*\n\n📌 ${event.title}\n📅 ${eventDate.toLocaleString('fr-FR')}\n${desc ? `📝 ${desc}` : ''}\n\n_Rappel automatique 1h avant_ ⏰`,
        });

      } else if (action === 'del') {
        const id = args[1];
        if (!id) { await sock.sendMessage(from, { text: '❌ Usage: !agenda del [ID]' }); return; }
        removeEvent(from, id);
        await sock.sendMessage(from, { text: `✅ Événement supprimé.` });
      }
    },
  },

  vote: {
    description: 'Créer un vote rapide Oui/Non',
    adminOnly: false,
    execute: async ({ sock, from, isGroup, sender, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;

      if (global.activeVotes.has(from)) {
        const v = global.activeVotes.get(from);
        const oui = Object.values(v.votes).filter(x=>x===1).length;
        const non = Object.values(v.votes).filter(x=>x===0).length;
        const total = oui + non;
        const ouiPct = total > 0 ? Math.round(oui/total*100) : 0;
        const nonPct = total > 0 ? Math.round(non/total*100) : 0;
        await sock.sendMessage(from, {
          text: `📊 *Vote en cours:*\n❓ ${v.question}\n\n✅ Oui: ${oui} (${ouiPct}%)\n❌ Non: ${non} (${nonPct}%)\n👥 Total: ${total}\n\n_Réponds avec* ✅ *ou* ❌ *pour voter_\n_!vote close pour fermer (admin)_`,
        });
        return;
      }

      if (!text) { await sock.sendMessage(from, { text: '❌ Usage: !vote [question]\nExemple: !vote Doit-on organiser une réunion ce week-end?' }); return; }

      global.activeVotes.set(from, { question: text, votes: {}, creator: sender });
      await sock.sendMessage(from, {
        text: `🗳️ *VOTE OUVERT*\n\n❓ *${text}*\n\n✅ Réponds avec ✅ pour *OUI*\n❌ Réponds avec ❌ pour *NON*\n\n_!vote pour voir les résultats_\n_!vote close pour fermer (admin)_`,
      });

      // Auto-fermeture après 1h
      setTimeout(async () => {
        if (!global.activeVotes.has(from)) return;
        const v = global.activeVotes.get(from);
        const oui = Object.values(v.votes).filter(x=>x===1).length;
        const non = Object.values(v.votes).filter(x=>x===0).length;
        await sock.sendMessage(from, {
          text: `🗳️ *Vote fermé (1h écoulée)*\n\n❓ ${v.question}\n\n✅ Oui: *${oui}*\n❌ Non: *${non}*\n\n🏆 Résultat: *${oui>non?'OUI l\'emporte':'NON l\'emporte'}*`,
        }).catch(()=>{});
        global.activeVotes.delete(from);
      }, 3600000);
    },
  },

  leaderboard: {
    description: 'Classement des membres les plus actifs',
    adminOnly: false,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const stats = getGroupStats(from);
      if (!stats || !stats.members || Object.keys(stats.members).length === 0) {
        await sock.sendMessage(from, { text: '📊 Pas encore assez de données.\n\nLe classement se met à jour automatiquement!' });
        return;
      }
      const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
      const top = Object.entries(stats.members).sort((a,b)=>b[1]-a[1]).slice(0,10);
      const total = stats.total;
      let text = `🏆 *LEADERBOARD — Top ${top.length}*\n${'━'.repeat(28)}\n\n`;
      top.forEach(([jid, count], i) => {
        const num = jid.split('@')[0];
        const pct = Math.round(count/total*100);
        const bar = '█'.repeat(Math.round(pct/10))+'░'.repeat(10-Math.round(pct/10));
        text += `${medals[i]} *${num}*\n   ${bar} ${count} msgs (${pct}%)\n\n`;
      });
      text += `${'━'.repeat(28)}\n💬 Total groupe: *${total}* messages\n_Mis à jour en temps réel_`;
      await sock.sendMessage(from, { text });
    },
  },

  challenge: {
    description: 'Défi quotidien automatisé pour le groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();
      const CHALLENGES = [
        '🎯 Défi du jour: Partagez une citation qui vous inspire !',
        '🧠 Défi: Quel est votre plus grand apprentissage cette semaine ?',
        '💪 Défi: Faites 20 pompes et revenez nous dire que vous l\'avez fait !',
        '📚 Défi: Recommandez un livre que vous avez aimé.',
        '🌟 Défi: Complimentez quelqu\'un dans le groupe aujourd\'hui !',
        '🎨 Défi: Partagez une photo de votre journée.',
        '🤔 Défi: Donnez un conseil de vie en une phrase.',
        '🎵 Défi: Partagez votre chanson préférée du moment.',
        '🌍 Défi: Partagez un fait intéressant que peu de gens connaissent.',
        '😂 Défi: Faites rire le groupe avec une blague !',
      ];

      if (action === 'now') {
        // Défi immédiat
        const challenge = text.split(' ').slice(1).join(' ') || CHALLENGES[Math.floor(Math.random()*CHALLENGES.length)];
        await sock.sendMessage(from, { text: `🎯 *DÉFI DU JOUR*\n${'━'.repeat(25)}\n\n${challenge}\n\n${'━'.repeat(25)}\n_Participez en répondant à ce message!_` });
        return;
      }

      if (action === 'auto') {
        if (!global.challengeTimers) global.challengeTimers = new Map();
        if (global.challengeTimers.has(from)) {
          clearInterval(global.challengeTimers.get(from));
        }
        const timer = setInterval(async () => {
          const c = CHALLENGES[Math.floor(Math.random()*CHALLENGES.length)];
          await sock.sendMessage(from, { text: `🎯 *DÉFI DU JOUR*\n${'━'.repeat(25)}\n\n${c}\n\n${'━'.repeat(25)}\n_Participez en répondant!_` }).catch(()=>{});
        }, 24*60*60*1000);
        global.challengeTimers.set(from, timer);
        const randChallenge = CHALLENGES[Math.floor(Math.random()*CHALLENGES.length)];
        await sock.sendMessage(from, { text: `✅ *Défis quotidiens activés!*\nUn défi sera posté chaque jour.\n\n🎯 Premier défi:\n\n${randChallenge}` });
        return;
      }

      if (action === 'off') {
        if (global.challengeTimers?.has(from)) { clearInterval(global.challengeTimers.get(from)); global.challengeTimers.delete(from); }
        await sock.sendMessage(from, { text: '✅ Défis quotidiens désactivés.' });
        return;
      }

      await sock.sendMessage(from, { text: '🎯 Usage:\n• !challenge now → Défi immédiat\n• !challenge now [texte] → Défi personnalisé\n• !challenge auto → Défi quotidien automatique\n• !challenge off → Désactiver' });
    },
  },

  // ════════════════════════════════════════
  // SÉCURITÉ & CONTRÔLE AVANCÉ
  // ════════════════════════════════════════

  lockdown: {
    description: 'Mode urgence: fermer le groupe + kick tous les non-admins',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'off') {
        global.lockdownGroups.delete(from);
        try { await sock.groupSettingUpdate(from, 'not_announcement'); } catch {}
        await sock.sendMessage(from, { text: '✅ *Lockdown levé.* Le groupe est de nouveau ouvert.' });
        return;
      }

      if (global.lockdownGroups.has(from)) {
        await sock.sendMessage(from, { text: '⚠️ Le groupe est déjà en lockdown.\n!lockdown off pour lever.' });
        return;
      }

      await sock.sendMessage(from, {
        text: `🚨 *LOCKDOWN ACTIVÉ*\n\nLe groupe passe en mode urgence:\n🔒 Groupe fermé\n👢 Expulsion des non-admins en cours...\n\n_!lockdown off pour lever l'urgence_`,
      });

      global.lockdownGroups.add(from);
      log(from, 'LOCKDOWN', 'admin');

      try {
        // Fermer le groupe
        await sock.groupSettingUpdate(from, 'announcement');

        // Kick tous les non-admins
        const meta = await sock.groupMetadata(from);
        const nonAdmins = meta.participants.filter(p => !p.admin);
        let kicked = 0;
        for (const member of nonAdmins) {
          try {
            await sock.groupParticipantsUpdate(from, [member.id], 'remove');
            kicked++;
            await new Promise(r => setTimeout(r, 500));
          } catch {}
        }
        await sock.sendMessage(from, { text: `🚨 *Lockdown effectué*\n✅ Groupe fermé\n👢 ${kicked} membre(s) expulsé(s)\n\n_!lockdown off pour rétablir_` });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur lockdown: ${err.message}` });
      }
    },
  },

  whitelist: {
    description: 'Gérer la liste blanche de membres de confiance',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (!action || action === 'list') {
        const list = getWhitelist(from);
        await sock.sendMessage(from, {
          text: `⭐ *Whitelist (${list.length} membre(s))*\n\n${list.length ? list.map(n=>`• ${n}`).join('\n') : 'Aucun membre en liste blanche.'}\n\n_Les membres whitelistés sont immunisés contre TOUTES les sanctions auto._\n\n• !whitelist add @membre\n• !whitelist del @membre`,
        });
        return;
      }

      const target = getMentionedJid(msg, args.slice(1));
      if (!target) { await sock.sendMessage(from, { text: '❌ Mentionne un membre.' }); return; }
      const number = target.split('@')[0];

      if (action === 'add') {
        addToWhitelist(from, number);
        log(from, 'whitelist_add', 'admin', number);
        await sock.sendMessage(from, { text: `⭐ *${number}* ajouté à la whitelist.\nIl est immunisé contre toutes les sanctions automatiques.`, mentions: [target] });
      } else if (action === 'del' || action === 'remove') {
        removeFromWhitelist(from, number);
        await sock.sendMessage(from, { text: `✅ *${number}* retiré de la whitelist.`, mentions: [target] });
      }
    },
  },

  maxmembers: {
    description: 'Limiter le nombre maximum de membres',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;

      if (args[0] === 'off') {
        global.maxMembersGroups.delete(from);
        await sock.sendMessage(from, { text: '✅ Limite de membres désactivée.' });
        return;
      }

      const max = parseInt(args[0]);
      if (isNaN(max) || max < 2) {
        const current = global.maxMembersGroups.get(from);
        await sock.sendMessage(from, {
          text: `👥 *Limite de membres*\n\nStatut: ${current ? `✅ Max ${current}` : '❌ Désactivé'}\n\n• !maxmembers [nombre] → Définir la limite\n• !maxmembers off → Désactiver\n\nExemple: !maxmembers 50`,
        });
        return;
      }

      try {
        const meta = await sock.groupMetadata(from);
        if (meta.participants.length > max) {
          await sock.sendMessage(from, { text: `⚠️ Le groupe a déjà *${meta.participants.length}* membres, qui dépasse la limite de ${max}.` });
          return;
        }
        global.maxMembersGroups.set(from, max);
        log(from, 'maxmembers', 'admin', '', `max: ${max}`);
        await sock.sendMessage(from, {
          text: `✅ *Limite définie: ${max} membres*\n\nActuellement: ${meta.participants.length}/${max}\n\nSi quelqu'un tente de rejoindre au-delà de ${max}, il sera automatiquement expulsé.`,
        });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },

  grouplogs: {
    description: 'Journal de toutes les actions admin',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'clear') {
        clearLogs(from);
        await sock.sendMessage(from, { text: '✅ Logs effacés.' });
        return;
      }

      const limit = parseInt(args[0]) || 20;
      const logs = getLogs(from, limit);

      if (logs.length === 0) {
        await sock.sendMessage(from, { text: '📋 Aucun log disponible.\n\nLes actions admin sont enregistrées automatiquement.' });
        return;
      }

      const actionEmoji = {
        kick:'👢', ban:'🚫', warn:'⚠️', mute:'🔇', promote:'⬆️', demote:'⬇️',
        lockdown:'🚨', whitelist_add:'⭐', automod_on:'🤖', captcha_on:'🔐',
        agenda_add:'📅', floodprotect_on:'🌊', maxmembers:'👥', LOCKDOWN:'🚨🚨',
      };

      let text = `📋 *Logs du Groupe (${logs.length} dernières actions)*\n${'━'.repeat(28)}\n\n`;
      logs.forEach(l => {
        const emoji = actionEmoji[l.action] || '📌';
        const date = new Date(l.date).toLocaleString('fr-FR');
        text += `${emoji} *${l.action.toUpperCase()}*\n`;
        if (l.by) text += `   👤 Par: ${l.by}\n`;
        if (l.target) text += `   🎯 Sur: ${l.target}\n`;
        if (l.detail) text += `   📝 ${l.detail}\n`;
        text += `   🕐 ${date}\n\n`;
      });
      text += `_!grouplogs clear pour effacer_\n_!grouplogs [n] pour voir n logs_`;
      await sock.sendMessage(from, { text });
    },
  },
};
