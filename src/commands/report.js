/**
 * ============================================================
 * @file        report.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commande de signalement WhatsApp — Rapports de compte
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */

// ============================================================
// SUPPORT WHATSAPP - EMAILS DE SIGNALMENT
// ============================================================

// Adresses email officiels WhatsApp pour le signalement de comptes
const WHATSAPP_SUPPORT_EMAILS = [
  { email: 'android@whatsapp.com', label: 'Support Android' },
  { email: 'android@support.whatsapp.com', label: 'Support Android (alternative)' },
  { email: 'android_web@support.whatsapp.com', label: 'Support Web' },
  { email: 'support@support.whatsapp.com', label: 'Support général' },
  { email: 'jan@whatsapp.com', label: 'Contact direct (fondateur)' },
  { email: 'press@whatsapp.com', label: 'Presse et médias' },
  { email: 'smb@support.whatsapp.com', label: 'Petites et moyennes entreprises' },
];

// Message type pour le signalement
const REPORT_TEMPLATE = `
🚨 *Signalement de compte WhatsApp*

👤 Compte signalé : ${number}@s.whatsapp.net
📝 Raison : ${reason || 'Non spécifiée'}
⏰ Date : ${new Date().toLocaleString('fr-FR')}

__________________________

*Instructions :*
Copiez l'une des adresses ci-dessous et envoyez un email à WhatsApp Support en incluant le numéro ci-dessus comme sujet ou dans le corps du message.

*À inclure dans l'email :*
• Numéro de la victime (en international, sans +)
• Description du problème (arnaque, spam, contenu violent, etc.)
• Preuves si disponibles (captures d'écran, extraits de messages)
`;

export default {

  // ═══════════════════════════════════════
  // SIGNALEMENT WHATSAPP
  // ═══════════════════════════════════════

  report: {
    description: 'Signaler un compte à WhatsApp Support',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!isGroup) {
        await sock.sendMessage(from, { text: ' Cette commande fonctionne uniquement dans les groupes.' }).catch(() => {});
        return;
      }

      // Extraire le numéro ciblé
      let target = null;
      if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid && msg.message.extendedTextMessage.contextInfo.mentionedJid.length > 0) {
        target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
      } else if (args[0]) {
        const num = args[0].replace(/[^0-9]/g, '');
        if (num) target = `${num}@s.whatsapp.net`;
      }

      if (!target) {
        // Afficher l'aide avec les emails
        let text = ` *Signalement WhatsApp* 📧\n\n`;
        text += `Usage: !report @membre [raison]\n`;
        text += `ou: !report [numéro] [raison]\n\n`;
        text += `📋 *Adresses email WhatsApp Support* :\n\n`;
        WHATSAPP_SUPPORT_EMAILS.forEach(({ email, label }) => {
          text += `• ${email} — ${label}\n`;
        });
        text += `\n${REPORT_TEMPLATE}`;
        text += `_Le numéro doit être au format international (ex: 22890000000 sans le +)_`;
        await sock.sendMessage(from, { text });
        return;
      }

      // Extraire le numéro et la raison
      const number = target.split('@')[0];
      const reason = args.slice(1).join(' ') || 'Non spécifiée';

      // Générer le message de rapport
      const reportMessage = REPORT_TEMPLATE.replace('${number}@s.whatsapp.net', `${number}@s.whatsapp.net`).replace('${reason || 'Non spécifiée'}', reason);

      await sock.sendMessage(from, {
        text: `🚨 *Compte signalé !*\n\n👤 *${number}* a été signalé à WhatsApp Support.\n\n` +
          `📝 *Raison* : ${reason}\n\n` +
          `📧 *Utilisez l'une de ces adresses pour envoyer le rapport* :\n` +
          WHATSAPP_SUPPORT_EMAILS.map(e => `• ${e.email}`).join('\n') +
          `\n\n${reportMessage}`,
      });
    },
  },

};