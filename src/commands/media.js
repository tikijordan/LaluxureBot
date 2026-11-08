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
import { execFile } from 'child_process';
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

      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const tempDir = path.join(__dirname, '../temp');
      const ext = found.mediaType === 'video' ? 'mp4' : 'jpg';
      const tempIn = path.join(tempDir, `${stamp}.${ext}`);
      const tempOut = path.join(tempDir, `${stamp}.webp`);

      try {
        const buffer = await downloadMedia(found.mediaMsg, found.mediaType);
        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(tempIn, buffer);

        // Le filtre précédent était invalide (« min'(320,ih)' ») : FFmpeg échouait
        // et, dans le catch, un message VIDE était envoyé (invisible).
        const vf = 'scale=320:320:force_original_aspect_ratio=decrease,fps=15,format=rgba,'
                 + 'pad=320:320:(ow-iw)/2:(oh-ih)/2:color=#00000000';
        const args = ['-y', '-i', tempIn, '-t', '8', '-an', '-vcodec', 'libwebp',
                      '-vf', vf, '-loop', '0', '-preset', 'default', '-q:v', '60', tempOut];

        await new Promise((resolve, reject) => {
          execFile('ffmpeg', args, { timeout: 60_000 }, (err, _so, se) =>
            err ? reject(new Error(String(se || err.message).slice(-200))) : resolve());
        });

        await sock.sendMessage(from, { sticker: fs.readFileSync(tempOut) }, { quoted: msg });
      } catch (e) {
        console.error('[sticker]', e.message);
        await sock.sendMessage(from, { text: '❌ Impossible de créer le sticker (FFmpeg indisponible ou média invalide).' }, { quoted: msg }).catch(() => {});
      } finally {
        for (const f of [tempIn, tempOut]) { try { fs.unlinkSync(f); } catch {} }
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
      const isGroup = msg.key?.remoteJid?.endsWith('@g.us');
      const target = (mentioned && mentioned[0]) || quotedSender || (isGroup?sender :from);
      const sendTo = from; // répondre dans le chat d'origine (groupe ou DM)

      try {
        const ppUrl = await sock.profilePictureUrl(target, 'image');
        await sock.sendMessage(sendTo, { 
          image: { url: ppUrl }, 
          caption: `📸 Photo de profil de @${target.split('@')[0]}`,
          mentions: [target]
        }, { quoted: msg });
      } catch {
        await sock.sendMessage(sendTo, { text: '❌ Impossible de récupérer la photo (privée ou inexistante).' });
      }
    },
  },

  // --- COMMANDE VIEWONCE (Extraction) ---
  vo: {
    description: 'Extrait un média à vue unique.',
    execute: async ({ sock, msg, from, sender, senderNumber, isGroup, owner }) => {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      // Groupe : extraction envoyée en privé à l'auteur ; DM : même chat (JID exact, PN/LID).
      const sendTo = isGroup ? sender : from;
      if (!quoted) return sock.sendMessage(sendTo, { text: '❌ Réponds à un message à vue unique.' });

      const innerMsg = extractViewOnceInner(quoted) || quoted;
      if (!getContentType(innerMsg) || !/^(image|video|audio)Message$/.test(getContentType(innerMsg))) {
        return sock.sendMessage(sendTo, { text: '❌ Ce message ne contient pas de média valide (image, vidéo ou audio).' });
      }
      

    
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

        const caption = ` Vue unique extraite\nLégende : ${obj?.caption || 'Aucune'}`;
        await sendBuffer(sock, sendTo, caption, msg);

        await notifyOwnerViewOnce(sock, ownerNum, { buffer, kind, obj }, {
          senderNumber, senderJid: sender, isGroup, from, rawJid: from,
        }, { filename });

      } catch (e) {
        console.error('[VO] Erreur extraction:', e.message);
        await sock.sendMessage(sendTo, { text: '❌ Échec : le média a peut-être expiré.' });
      }
    },
  },
};

// Ajout des alias
mediaCommands.s = mediaCommands.sticker;
mediaCommands.jolie = mediaCommands.vo;

export default mediaCommands;