/**
 * ============================================================
 * @file        media2.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes medias avancees — RemoveBG, caption sur image
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES MÉDIAS AVANCÉES
// removebg, caption, collage
// ============================================================

import axios from 'axios';
import { downloadContentFromMessage, getContentType } from '@whiskeysockets/baileys';

let _canvas = null;
async function getCanvas() {
  if (_canvas) return _canvas;
  try {
    _canvas = await import('canvas');
    return _canvas;
  } catch (err) {
    throw new Error(`Module canvas indisponible (${err.message}). Installe les dépendances système (libcairo, libpango) puis npm rebuild canvas.`, { cause: err });
  }
}

async function getImageBuffer(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const target = quoted || msg.message;
  const type = getContentType(target);
  if (!type?.includes('image') && !type?.includes('Image')) return null;
  const stream = await downloadContentFromMessage(target[type], 'image');
  let buf = Buffer.from([]);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

export default {

  removebg: {
    description: 'Supprimer le fond d\'une image (cite ou envoie une image)',
    execute: async ({ sock, from, msg }) => {
      await sock.sendMessage(from, { text: '🖼️ Suppression du fond en cours...' });

      const buf = await getImageBuffer(msg).catch(() => null);
      if (!buf) {
        await sock.sendMessage(from, { text: '❌ Envoie ou cite une image avec !removebg' });
        return;
      }

      const apiKey = process.env.REMOVEBG_API_KEY;
      if (!apiKey) {
        // Fallback: utiliser remove.bg gratuitement (limite 50/mois)
        await sock.sendMessage(from, {
          text: `⚠️ *API remove.bg non configurée.*\n\nPour activer:\n1. Va sur https://www.remove.bg/api\n2. Crée un compte gratuit (50 images/mois)\n3. Ajoute dans .env:\nREMOVEBG_API_KEY=ta_cle\n\n_Alternative gratuite: Télécharge l'image et utilise https://www.remove.bg_`,
        });
        return;
      }

      try {
        const form = new globalThis.FormData();
        form.append('image_file', new globalThis.Blob([buf]), 'image.png');
        form.append('size', 'auto');

        const res = await axios.post('https://api.remove.bg/v1.0/removebg', form, {
          headers: { 'X-Api-Key': apiKey },
          responseType: 'arraybuffer',
          timeout: 30000,
        });

        await sock.sendMessage(from, {
          image: Buffer.from(res.data),
          caption: '✅ Fond supprimé avec succès !',
        });
      } catch (err) {
        const msg2 = err.response?.status === 402
          ? 'Crédits remove.bg épuisés. Recharge sur https://www.remove.bg'
          : `Erreur: ${err.message}`;
        await sock.sendMessage(from, { text: `❌ ${msg2}` });
      }
    },
  },

  caption: {
    description: 'Ajouter un texte stylisé sur une image',
    execute: async ({ sock, from, msg, text, args }) => {
      if (!text) {
        await sock.sendMessage(from, { text: '✍️ Usage: !caption [texte]\nEnvoie ou cite une image avec la commande.\n\nEx: !caption Bonne journée à tous! 😊' });
        return;
      }

      await sock.sendMessage(from, { text: '✍️ Ajout du texte en cours...' });
      const imgBuf = await getImageBuffer(msg).catch(() => null);
      if (!imgBuf) {
        await sock.sendMessage(from, { text: '❌ Envoie ou cite une image avec !caption [texte]' });
        return;
      }

      try {
        const { createCanvas, loadImage } = await getCanvas();
        const img = await loadImage(imgBuf);
        const padding = 60;
        const canvas = createCanvas(img.width, img.height + padding);
        const ctx = canvas.getContext('2d');

        // Fond noir en bas
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Image
        ctx.drawImage(img, 0, 0);

        // Bande noire en bas
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(0, img.height, canvas.width, padding);

        // Texte blanc centré
        const fontSize = Math.min(36, Math.floor(canvas.width / (text.length * 0.6)));
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Ombre portée
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(text, canvas.width / 2, img.height + padding / 2);

        const output = canvas.toBuffer('image/jpeg', { quality: 0.92 });
        await sock.sendMessage(from, {
          image: output,
          caption: `✍️ *"${text}"*`,
        });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur lors de la création: ${err.message}` });
      }
    },
  },

  collage: {
    description: 'Créer un collage avec plusieurs images (envoie 2-4 images)',
    execute: async ({ sock, from, msg }) => {
      await sock.sendMessage(from, {
        text: '🖼️ *Collage*\n\nPour créer un collage:\n1. Envoie 2 à 4 images une par une\n2. Cite la dernière image avec !collage\n\n_Fonctionnalité en cours de développement — pour l\'instant, utilise !sticker sur chaque image._',
      });
    },
  },

};
