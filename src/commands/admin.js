/**
 * ============================================================
 * @file        admin.js
 * @project     WhatsApp Bot
 * @author      LaLuxure Bot
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes admin groupe — Membres, kick, promote, warn, mute, antilink
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES ADMINISTRATION DE GROUPE
// kick, add, promote, demote, lock, unlock,
// setname, setdesc, setico, warn, resetwarn,
// mute, unmute, antilink, welcome, goodbye, listwarn
// ============================================================

import { addWarn, getWarns, resetWarns, getAllWarns } from '../utils/warns.js';
import { enableAntilink, disableAntilink, isAntilinkEnabled } from '../utils/antilink.js';
import { setWelcome, setGoodbye, disableWelcome, getWelcomeConfig } from '../utils/welcome.js';
import { downloadContentFromMessage, getContentType } from '@whiskeysockets/baileys';
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


const MAX_WARNS = parseInt(process.env.MAX_WARNS || '3');

// Extraire le JID d'une mention ou d'un numéro brut
function getMentionedJid(msg, args) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned && mentioned.length > 0) return mentioned[0];
  if (args[0]) {
    const num = args[0].replace(/[^0-9]/g, '');
    if (num) return `${num}@s.whatsapp.net`;
  }
  return null;
}

// Vérifier que la commande est utilisée dans un groupe
function checkGroup(sock, from, isGroup) {
  if (!isGroup) {
    sock.sendMessage(from, { text: ' Cette commande fonctionne uniquement dans les groupes.' }).catch(() => {});
    return false;
  }
  return true;
}

export default {

  // ════════════════════════════════════════
  // GESTION DES MEMBRES
  // ════════════════════════════════════════

  kick: {
    description: 'Expulser un membre du groupe (admin)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) {
        await sock.sendMessage(from, { text: ' Usage: !kick @membre\nMentionnez le membre à expulser.' });
        return;
      }
      const r = await updateGroupParticipant(sock, from, target, 'remove');
      if (r.ok) {
        await sock.sendMessage(from, {
          text: ` *${target.split('@')[0]}* a été expulsé du groupe.`,
          mentions: [target],
        });
      } else {
        await sock.sendMessage(from, { text: ` Impossible d'expulser ce membre.\n_${r.reason || 'Vérifiez que le bot est admin.'}_` });
      }
    },
  },

  add: {
    description: 'Ajouter un membre au groupe (admin)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      if (!text) {
        await sock.sendMessage(from, { text: ' Usage: !add [numéro]\nExemple: !add 22890000000' });
        return;
      }
      const number = text.replace(/[^0-9]/g, '');
      const jid = `${number}@s.whatsapp.net`;
      const r = await updateGroupParticipant(sock, from, jid, 'add');
      if (r.ok) {
        await sock.sendMessage(from, { text: ` *${number}* a été ajouté au groupe.` });
      } else if (r.status === '403') {
        await sock.sendMessage(from, { text: ` *${number}* a la confidentialité activée. Il doit être ajouté manuellement.` });
      } else {
        await sock.sendMessage(from, { text: ` Impossible d'ajouter *${number}*.\n_${r.reason}_` });
      }
    },
  },

  promote: {
    description: 'Promouvoir un membre en admin (admin)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) {
        await sock.sendMessage(from, { text: ' Usage: !promote @membre' });
        return;
      }
      const r = await updateGroupParticipant(sock, from, target, 'promote');
      if (r.ok) {
        await sock.sendMessage(from, {
          text: `⬆ @${target.split('@')[0]} est maintenant *administrateur* du groupe ! `,
          mentions: [target],
        });
      } else {
        await sock.sendMessage(from, { text: ` Impossible de promouvoir ce membre.\n_${r.reason || 'Vérifiez que le bot est admin.'}_` });
      }
    },
  },

  demote: {
    description: 'Rétrograder un admin (admin)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) {
        await sock.sendMessage(from, { text: ' Usage: !demote @membre' });
        return;
      }
      const r = await updateGroupParticipant(sock, from, target, 'demote');
      if (r.ok) {
        await sock.sendMessage(from, {
          text: `⬇ @${target.split('@')[0]} n'est plus administrateur.`,
          mentions: [target],
        });
      } else {
        await sock.sendMessage(from, { text: ` Impossible de rétrograder ce membre.\n_${r.reason || ''}_` });
      }
    },
  },

  // ════════════════════════════════════════
  // PARAMÈTRES DU GROUPE
  // ════════════════════════════════════════

  lock: {
    description: 'Fermer le groupe (seuls les admins peuvent écrire)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      try {
        await sock.groupSettingUpdate(from, 'announcement');
        await sock.sendMessage(from, {
          text: ' *Groupe fermé !*\nSeuls les administrateurs peuvent envoyer des messages.',
        });
      } catch {
        await sock.sendMessage(from, { text: ' Impossible de fermer le groupe.\n_Le bot doit être admin._' });
      }
    },
  },

  unlock: {
    description: 'Ouvrir le groupe (tout le monde peut écrire)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      try {
        await sock.groupSettingUpdate(from, 'not_announcement');
        await sock.sendMessage(from, {
          text: ' *Groupe ouvert !*\nTout le monde peut envoyer des messages.',
        });
      } catch {
        await sock.sendMessage(from, { text: ' Impossible d\'ouvrir le groupe.' });
      }
    },
  },

  setname: {
    description: 'Changer le nom du groupe (admin)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      if (!text) {
        await sock.sendMessage(from, { text: ' Usage: !setname [nouveau nom]' });
        return;
      }
      try {
        await sock.groupUpdateSubject(from, text);
        await sock.sendMessage(from, { text: ` Nom du groupe changé en *"${text}"*` });
      } catch {
        await sock.sendMessage(from, { text: ' Impossible de changer le nom du groupe.' });
      }
    },
  },

  setdesc: {
    description: 'Changer la description du groupe (admin)',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      if (!text) {
        await sock.sendMessage(from, { text: ' Usage: setdesc [nouvelle description]' });
        return;
      }
      try {
        await sock.groupUpdateDescription(from, text);
        await sock.sendMessage(from, { text: ` Description du groupe mise à jour !` });
      } catch {
        await sock.sendMessage(from, { text: ' Impossible de changer la description.' });
      }
    },
  },

  setico: {
    description: 'Changer la photo du groupe (admin)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;

      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const targetMsg = quoted || msg.message;
      const type = getContentType(targetMsg);

      if (type !== 'imageMessage') {
        await sock.sendMessage(from, { text: ' Envoie ou cite une image avec setico pour changer la photo du groupe.' });
        return;
      }

      try {
        const stream = await downloadContentFromMessage(targetMsg[type], 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        await sock.updateProfilePicture(from, buffer);
        await sock.sendMessage(from, { text: ' Photo du groupe mise à jour !' });
      } catch {
        await sock.sendMessage(from, { text: ' Impossible de changer la photo du groupe.' });
      }
    },
  },

  // ════════════════════════════════════════
  // MODÉRATION — AVERTISSEMENTS
  // ════════════════════════════════════════

  warn: {
    description: 'Avertir un membre (3 warns = kick automatique)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) {
        await sock.sendMessage(from, { text: ' Usage: !warn @membre [raison]' });
        return;
      }

      const reason = args.slice(1).join(' ') || 'Aucune raison précisée';
      const count = addWarn(from, target.split('@')[0]);

      if (count >= MAX_WARNS) {
        // Kick automatique — on tente l'expulsion AVANT d'annoncer le résultat,
        // pour ne jamais annoncer un succès qui n'a pas eu lieu.
        const r = await updateGroupParticipant(sock, from, target, 'remove');
        if (r.ok) {
          resetWarns(from, target.split('@')[0]);
          await sock.sendMessage(from, {
            text: ` @${target.split('@')[0]} a reçu *${count}/${MAX_WARNS} avertissements* et a été *expulsé automatiquement* !\n\n Raison: ${reason}`,
            mentions: [target],
          });
        } else {
          await sock.sendMessage(from, {
            text: ` @${target.split('@')[0]} a atteint ${count}/${MAX_WARNS} avertissements mais l'expulsion a échoué.\n_${r.reason || 'Vérifiez que le bot est admin.'}_`,
            mentions: [target],
          });
        }
      } else {
        await sock.sendMessage(from, {
          text: ` *Avertissement ${count}/${MAX_WARNS}* pour @${target.split('@')[0]}\n\n Raison: ${reason}\n\n_${MAX_WARNS - count} avertissement(s) avant l'expulsion._`,
          mentions: [target],
        });
      }
    },
  },

  resetwarn: {
    description: 'Réinitialiser les avertissements d\'un membre',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) {
        await sock.sendMessage(from, { text: ' Usage: !resetwarn @membre' });
        return;
      }
      resetWarns(from, target.split('@')[0]);
      await sock.sendMessage(from, {
        text: ` Les avertissements de @${target.split('@')[0]} ont été réinitialisés.`,
        mentions: [target],
      });
    },
  },

  listwarn: {
    description: 'Lister tous les membres avertis du groupe',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const warns = getAllWarns(from);
      const entries = Object.entries(warns).filter(([, v]) => v.count > 0);

      if (entries.length === 0) {
        await sock.sendMessage(from, { text: ' Aucun membre averti dans ce groupe.' });
        return;
      }

      let msg = ` *Membres avertis (${entries.length})*\n\n`;
      entries.forEach(([num, data]) => {
        msg += `• ${num}: *${data.count}/${MAX_WARNS}* avertissement(s)\n`;
      });
      msg += `\n_Utilise !resetwarn @membre pour réinitialiser_`;
      await sock.sendMessage(from, { text: msg });
    },
  },

  // ════════════════════════════════════════
  // MODÉRATION — MUTE
  // ════════════════════════════════════════

  mute: {
    description: 'Rendre muet un membre (le retirer puis le remettre sans droit d\'écriture)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) {
        await sock.sendMessage(from, { text: ' Usage: !mute @membre' });
        return;
      }

      // WhatsApp ne supporte pas le mute natif → on utilise kick + invite
      // Alternative: message d'avertissement + surveillance
      await sock.sendMessage(from, {
        text: ` @${target.split('@')[0]} est *mis en sourdine*.\nTout message de sa part sera supprimé par le bot.\n\n_Utilise !unmute @membre pour lever la sourdine._`,
        mentions: [target],
      });

      // Stocker le membre muté en mémoire (simple set)
      if (!global.mutedMembers) global.mutedMembers = new Set();
      global.mutedMembers.add(`${from}__${target}`);
    },
  },

  unmute: {
    description: 'Lever la sourdine d\'un membre',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const target = getMentionedJid(msg, args);
      if (!target) {
        await sock.sendMessage(from, { text: ' Usage: !unmute @membre' });
        return;
      }

      if (global.mutedMembers) global.mutedMembers.delete(`${from}__${target}`);
      await sock.sendMessage(from, {
        text: ` @${target.split('@')[0]} peut de nouveau envoyer des messages.`,
        mentions: [target],
      });
    },
  },

  // ════════════════════════════════════════
  // ANTI-LIEN
  // ════════════════════════════════════════

  antilink: {
    description: 'Activer/désactiver la protection anti-lien',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (!action || !['on', 'off'].includes(action)) {
        const status = isAntilinkEnabled(from);
        await sock.sendMessage(from, {
          text: ` *Anti-lien*\n\nStatut actuel: ${status ? ' Activé' : 'Désactivé'}\n\n• !antilink on → Activer\n• !antilink off → Désactiver`,
        });
        return;
      }

      if (action === 'on') {
        enableAntilink(from);
        await sock.sendMessage(from, {
          text: ` *Anti-lien activé !*\nTout lien posté par un non-admin sera supprimé et l'auteur averti.`,
        });
      } else {
        disableAntilink(from);
        await sock.sendMessage(from, { text: ' *Anti-lien désactivé.*\nLes liens sont de nouveau autorisés.' });
      }
    },
  },

  // ════════════════════════════════════════
  // MESSAGE DE BIENVENUE / AU REVOIR
  // ════════════════════════════════════════

  welcome: {
    description: 'Configurer le message de bienvenue',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'off') {
        disableWelcome(from);
        await sock.sendMessage(from, { text: ' Message de bienvenue désactivé.' });
        return;
      }

      if (action === 'show') {
        const config = getWelcomeConfig(from);
        if (!config?.welcome) {
          await sock.sendMessage(from, { text: ' Aucun message de bienvenue configuré.\nUtilise: !welcome [message]' });
          return;
        }
        await sock.sendMessage(from, {
          text: ` *Message de bienvenue actuel:*\n\n${config.welcome}\n\n_Variables: {nom} {groupe} {date}_`,
        });
        return;
      }

      const message = text || ' Bienvenue {nom} dans *{groupe}* ! \n\nNous sommes heureux de t\'avoir parmi nous.\nLis les règles du groupe et amuse-toi bien ! ';
      setWelcome(from, message);
      await sock.sendMessage(from, {
        text: ` *Message de bienvenue configuré !*\n\n${message}\n\n_Variables disponibles:_\n• {nom} → Prénom du membre\n• {groupe} → Nom du groupe\n• {date} → Date d'arrivée\n\nUtilise !welcome off pour désactiver.`,
      });
    },
  },

  goodbye: {
    description: 'Configurer le message d\'au revoir',
    adminOnly: true,
    execute: async ({ sock, from, isGroup, args, text }) => {
      if (!checkGroup(sock, from, isGroup)) return;
      const action = args[0]?.toLowerCase();

      if (action === 'off') {
        setGoodbye(from, null);
        await sock.sendMessage(from, { text: ' Message d\'au revoir désactivé.' });
        return;
      }

      const message = text || ' *{nom}* vient de quitter le groupe.\nAu revoir et bonne continuation ! ';
      setGoodbye(from, message);
      await sock.sendMessage(from, {
        text: ` *Message d'au revoir configuré !*\n\n${message}\n\n_Variables: {nom} {groupe} {date}_`,
      });
    },
  },

};