/**
 * ============================================================
 * @file        media.js
 * @project     WhatsApp Bot
 * @description Commandes médias optimisées : Sticker, PP et ViewOnce
 * ============================================================
 */

import { getContentType, downloadContentFromMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import {
  extractViewOnceInner,
  downloadViewOnceBuffer,
  persistViewOnce,
  notifyOwnerViewOnce,
  resolveSessionOwner,
} from '../utils/viewonce.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Utilitaire de téléchargement de média
async function downloadMedia(mediaMsg, mediaType) {
  const stream = await downloadContentFromMessage(mediaMsg, mediaType);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

// Utilitaire d'extraction de média (incluant les messages cités)
function extractMedia(message) {
  if (!message) return null;
  const type = getContentType(message);
  if (type === 'imageMessage') return { mediaMsg: message.imageMessage, mediaType: 'image' };
  if (type === 'videoMessage') return { mediaMsg: message.videoMessage, mediaType: 'video' };
  if (type === 'audioMessage') return { mediaMsg: message.audioMessage, mediaType: 'audio' };
  if (type === 'stickerMessage') return { mediaMsg: message.stickerMessage, mediaType: 'sticker' };
  return null;
}

const mediaCommands = {

  // --- COMMANDE STICKER (Image/Vidéo -> WebP) ---
  sticker: {
    description: 'Convertit une image ou une vidéo en sticker.',
    execute: async ({ sock, msg, from }) => {
      // Vérifier le message actuel ou le message cité
      let found = extractMedia(msg.message);
      if (!found) {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        found = extractMedia(quoted);
      }

      if (!found || !['image', 'video'].includes(found.mediaType)) {
        return sock.sendMessage(from, { text: '❌ Répondez à une image ou une vidéo pour créer un sticker.' });
      }

      try {
        const buffer = await downloadMedia(found.mediaMsg, found.mediaType);
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        const ext = found.mediaType === 'video' ? 'mp4' : 'jpg';
        const tempIn = path.join(tempDir, `${Date.now()}.${ext}`);
        const tempOut = path.join(tempDir, `${Date.now()}.webp`);

        fs.writeFileSync(tempIn, buffer);

        // Conversion via FFmpeg pour garantir la compatibilité et le format carré
        const ffmpegCmd = `ffmpeg -i "${tempIn}" -vcodec libwebp -vf "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse" "${tempOut}"`;

        exec(ffmpegCmd, async (err) => {
          if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
          if (err) return sock.sendMessage(from, { text: '❌ Erreur FFmpeg. Vérifiez l\'installation.' });

          await sock.sendMessage(from, { sticker: fs.readFileSync(tempOut) }, { quoted: msg });
          if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
        });
      } catch (e) {
        sock.sendMessage(from, { text: '' });
      }
    },
  },

  // --- COMMANDE PP (Photo de Profil) ---
  pp: {
    description: "Affiche la photo de profil d'un utilisateur.",
    execute: async ({ sock, msg, from, sender }) => {
      // Priorité : Mentions > Message cité > Expéditeur
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
      const target = (mentioned && mentioned[0]) || quotedSender || sender;

      try {
        const ppUrl = await sock.profilePictureUrl(target, 'image');
        await sock.sendMessage(from, { 
          image: { url: ppUrl }, 
          caption: `📸 Photo de profil de @${target.split('@')[0]}`,
          mentions: [target]
        }, { quoted: msg });
      } catch {
        await sock.sendMessage(from, { text: '❌ Impossible de récupérer la photo (privée ou inexistante).' });
      }
    },
  },

  // --- COMMANDE VIEWONCE (Extraction) ---
  vo: {
    description: 'Extrait un média à vue unique.',
    execute: async ({ sock, msg, from, sender, senderNumber, isGroup, owner }) => {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quoted) return sock.sendMessage(from, { text: '❌ Réponds à un message à vue unique.' });

      const innerMsg = extractViewOnceInner(quoted) || quoted;
      if (!getContentType(innerMsg) || !/^(image|video|audio)Message$/.test(getContentType(innerMsg))) {
        return sock.sendMessage(from, { text: '❌ Ce message ne contient pas de média valide (image, vidéo ou audio).' });
      }

      await sock.sendMessage(from, { text: '⏳ Extraction en cours...' });

      try {
        const ownerNum = resolveSessionOwner(owner, sock);
        const { buffer, kind, obj } = await downloadViewOnceBuffer(innerMsg);
        const { filename } = persistViewOnce(ownerNum, senderNumber, kind, buffer);

        const sendBuffer = async (targetSock, jid, cap, quotedMsg) => {
          const opts = quotedMsg ? { quoted: quotedMsg } : {};
          if (kind === 'image') await targetSock.sendMessage(jid, { image: buffer, caption: cap }, opts);
          else if (kind === 'video') await targetSock.sendMessage(jid, { video: buffer, caption: cap }, opts);
          else await targetSock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mp4' }, opts);
        };

        const caption = `✅ Vue unique extraite\nLégende : ${obj?.caption || 'Aucune'}`;
        await sendBuffer(sock, from, caption, msg);

        await notifyOwnerViewOnce(sock, ownerNum, { buffer, kind, obj }, {
          senderNumber, senderJid: sender, isGroup, from, rawJid: from,
        }, { filename });

      } catch (e) {
        console.error('[VO] Erreur extraction:', e.message);
        await sock.sendMessage(from, { text: '❌ Échec : le média a peut-être expiré.' });
      }
    },
  },
};

// Ajout des alias
mediaCommands.s = mediaCommands.sticker;
mediaCommands.jolie = mediaCommands.vo;

export default mediaCommands;