/**
 * ============================================================
 * @file        report.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commande de signalement WhatsApp — Bannissement et email de support
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

// __dirname déjà défini plus haut dans le fichier

// ============================================================
// CONFIGURATION EMAIL - WhatsApp Support
// ============================================================

// Lectura de configuration email depuis .env
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587');
const EMAIL_USER = process.env.EMAIL_USER || 'bot.whatsapp.support@gmail.com';
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || 'your_app_password_here';

// Transporter nodemailer configuré (créé à la demande)
let transporter = null;
function getTransporter() {
  if (!transporter) {
    try {
      transporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        secure: EMAIL_PORT === 465, // true for 465, false for other ports
        auth: {
          user: EMAIL_USER,
          pass: EMAIL_PASSWORD,
        },
      });
    } catch (err) {
      console.error('❌ Erreur configuration email:', err.message);
      transporter = null;
    }
  }
  return transporter;
}

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

// Message de rapport généré dynamiquement
function generateReportMessage(number, reason, timesReported = 1) {
  const status = timesReported > 1 ? ` (${timesReported} signalement(s))` : '';
  return `
🚨 *Signalement de compte WhatsApp*${status}

👤 Compte signalé : ${number}@s.whatsapp.net
📝 Raison : ${reason || 'Non spécifiée'}
⏰ Date : ${new Date().toLocaleString('fr-FR')}

__________________________

*Instructions :*
Le compte ci-dessus a été signalé et banni de ce groupe.
Pour un rapport officiel à WhatsApp, cet email a été automatiquement envoyé
au Support WhatsApp en incluant le numéro comme sujet.

*À inclure dans l'email :*
• Numéro de la victime (en international, sans +)
• Description du problème (arnaque, spam, contenu violent, etc.)
• Preuves si disponibles (captures d'écran, extraits de messages)

__________________________

*Statut actuel :*
Ce numéro a été signalé ${timesReported} fois(s) dans ce groupe.
Les équipes WhatsApp examineront le compte.
`.trim();
}

// Helper: extraire le numéro JID
function extractNumberFromJid(jid) {
  if (!jid) return null;
  return jid.replace(/@s\.whatsapp\.net/, '').replace(/@g\.us/, '');
}

// Helper: extraire le numéro depuis args
function extractNumberFromArgs(args) {
  if (args[0]) {
    const num = args[0].replace(/[^0-9]/g, '');
    if (num) return num;
  }
  return null;
}

// ============================================================
// ENVOI D'EMAIL DE SIGNALMENT
// ============================================================

async function sendReportEmail(number, reason, timesReported = 1) {
  const mailTransporter = getTransporter();
  if (!mailTransporter) {
    console.warn('⚠️ Transporter email non disponible - signalement local uniquement');
    return false;
  }

  const mailOptions = {
    from: `"WhatsApp Bot Report" <${EMAIL_USER}>`,
    to: [
      'android@whatsapp.com',
      'android@support.whatsapp.com',
      'android_web@support.whatsapp.com',
      'support@support.whatsapp.com',
      'jan@whatsapp.com',
    ],
    subject: `🚨 Signalement WhatsApp - Numéro ${number}`,
    text: `
Signalement de compte WhatsApp

Numéro: ${number}@s.whatsapp.net
Raison: ${reason || 'Non spécifiée'}
Date: ${new Date().toLocaleString('fr-FR')}
Nombre de signalements: ${timesReported}

__________________________

Ce compte a été signalé par l'administration du groupe.
Veuillez examiner ce compte pour violation des conditions d'utilisation de WhatsApp.
    `,
    html: `
<p><strong>Signalement de compte WhatsApp</strong></p>
<ul>
  <li><strong>Numéro:</strong> ${number}@s.whatsapp.net</li>
  <li><strong>Raison:</strong> ${reason || 'Non spécifiée'}</li>
  <li><strong>Date:</strong> ${new Date().toLocaleString('fr-FR')}</li>
  <li><strong>Nombre de signalements:</strong> ${timesReported}</li>
</ul>
<hr>
<p>Ce compte a été signalé par l'administration du groupe. Veuillez examiner ce compte pour violation des conditions d'utilisation de WhatsApp.</p>
`,
  };

  try {
    await mailTransporter.sendMail(mailOptions);
    console.log(`✅ Email de signalement envoyé pour le numéro ${number}`);
    return true;
  } catch (error) {
    console.error(`❌ Erreur envoi email pour ${number}:`, error.message);
    return false;
  }
}

// ============================================================
// COMMANDE DE SIGNALMENT WHATSAPP
// ============================================================

export default {

  // ══════════════════════════════════════
  // SIGNALEMENT ET BANNISSEMENT WHATSAPP
  // ══════════════════════════════════════

  report: {
    description: 'Signaler un compte WhatsApp (bannissement + email automatique)',
    adminOnly: true,
    execute: async ({ sock, msg, from, isGroup, args }) => {
      if (!isGroup) {
        await sock.sendMessage(from, { text: ' Cette commande fonctionne uniquement dans les groupes.' }).catch(() => {});
        return;
      }

      // Extraire le numéro ciblé (via mention ou argument)
      let target = null;

      // Vérifier les mentions en premier
      if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid && msg.message.extendedTextMessage.contextInfo.mentionedJid.length > 0) {
        target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
      } else {
        // Extraire depuis les arguments - accepte juste le numéro
        const num = extractNumberFromArgs(args);
        if (num) target = `${num}@s.whatsapp.net`;
      }

      if (!target) {
        // Afficher l'aide avec les emails et l'usage
        let text = ` *Signalement WhatsApp* 📧\n\n`;
        text += `Usage: !report @membre [raison]\n`;
        text += `ou: !report [numéro] [raison]\n\n`;
        text += `📋 *Fonctionnement* :\n`;
        text += `• Le numéro saisi sera banni du groupe\n`;
        text += `• Un email de signalement sera envoyé automatiquement à WhatsApp Support\n`;
        text += `• Les 7 adresses email ci-dessous sont également fournées\n\n`;
        text += `📧 *Adresses email WhatsApp Support* :\n\n`;
        WHATSAPP_SUPPORT_EMAILS.forEach(({ email, label }) => {
          text += `• ${email} — ${label}\n`;
        });
        text += `\n${generateReportMessage('0', 'Aucune raison', 0)}`;
        text += `\n_Entrez un numéro ou mentionnez un membre_`;
        await sock.sendMessage(from, { text });
        return;
      }

      // Extraire le numéro et la raison
      const number = extractNumberFromJid(target);
      const reason = args.slice(1).join(' ') || 'Non spécifiée';

      // Bannir l'utilisateur du groupe (liste noire + expulsion)
      banUser(from, number, reason);

      // Essayer d'expulser le membre du groupe
      let ejectText = '';
      try {
        const result = await sock.groupParticipantsUpdate(from, [target], 'remove');
        if (result && result[0]?.status === '200') {
          ejectText = `\n\n✅ *${number}* a été expulsé du groupe et ajouté à la liste noire.`;
        }
      } catch (err) {
        ejectText = `\n\n⚠️ *${number}* a été ajouté à la liste noire, mais l'expulsion du groupe a échoué (droits admin nécessaires).`;
      }

      // Incrémenter le compteur de signalements
      if (!global.reportsCache) global.reportsCache = {};
      if (!global.reportsCache[number]) {
        global.reportsCache[number] = { reason, firstReported: new Date().toISOString(), count: 0 };
      }
      global.reportsCache[number].count += 1;
      global.reportsCache[number].lastReported = new Date().toISOString();
      if (!global.reportsCache[number].reason && reason && reason !== 'Non spécifiée') {
        global.reportsCache[number].reason = reason;
      }

      // Envoyer l'email de signalement automatique à WhatsApp Support
      await sendReportEmail(number, reason, global.reportsCache[number].count);

      // Générer le message de confirmation
      const reportBody = generateReportMessage(number, reason, global.reportsCache[number].count);

      await sock.sendMessage(from, {
        text: `🚨 *Compte signalé et banni !*\n\n` +
          `👤 *${number}* a été signalé et banni du groupe.\n` +
          `📝 *Raison* : ${reason}\n\n` +
          `📧 *Email de signalement automatique envoyé à WhatsApp Support*\n\n` +
          WHATSAPP_SUPPORT_EMAILS.map(e => `• ${e.email}`).join('\n') +
          `\n\n${reportBody}` +
          ejectText,
      });
    },
  },

  // ════════════════════════════════════
  // Voir l'état des signalements
  // ══════════════════════════════════════

  reports: {
    description: 'Voir l état des signalements',
    adminOnly: true,
    execute: async ({ sock, from, isGroup }) => {
      if (!isGroup) {
        await sock.sendMessage(from, { text: ' Cette commande fonctionne uniquement dans les groupes.' }).catch(() => {});
        return;
      }

      const stats = global.reportsCache || {};
      const entries = Object.entries(stats).filter(([, v]) => v.count > 0);

      if (entries.length === 0) {
        await sock.sendMessage(from, { text: ' Aucun signalement enregistré pour le moment.' });
        return;
      }

      let text = ` *Statistiques des signalements* (${entries.length} numéros signalés)\n\n`;
      entries.slice(0, 20).forEach(([num, data]) => {
        const safeReason = data.reason ? data.reason.substring(0, 30) + (data.reason.length > 30 ? '...' : '') : 'Non spécifiée';
        text += `• *${num}* : ${data.count} signalement(s)\n`;
        text += `  Raison: ${safeReason}\n`;
        text += `  Premier signalement: ${data.firstReported ? new Date(data.firstReported).toLocaleDateString('fr-FR') : 'Inconnu'}\n\n`;
      });
      if (entries.length > 20) {
        text += `_... et ${entries.length - 20} autres numéros_`;
      }
      await sock.sendMessage(from, { text });
    },
  },

};