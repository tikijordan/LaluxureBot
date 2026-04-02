/**
 * @file        handler.js
 * @description Gestionnaire de commandes
 * @license     MIT
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
import { fileURLToPath } from 'url';
import { getContentType } from '@whiskeysockets/baileys';
import { isSpam, trackMessage } from './utils/antispam.js';
import { loadCommands } from './loader.js';
import { addStat } from './utils/stats.js';
import { canUseBot } from './utils/botmode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let commands = {};
(async () => {
  commands = await loadCommands();
  console.log(`📦 ${Object.keys(commands).length} commandes prêtes.`);
})();

const noTagGroups = new Set();

export async function handleCommand(sock, msg, store, ctx = {}) {
  const PREFIX = process.env.PREFIX || '/';
  const OWNER  = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');

  // Utiliser le contexte passé par index.js (déjà calculé correctement)
  let body         = ctx.body;
  let from         = ctx.from;
  let isGroup      = ctx.isGroup;
  let isOwner      = ctx.isOwner;
  let senderNumber = ctx.senderNumber;
  let sender       = ctx.sender;

  // Fallback si appelé sans contexte
  if (body === undefined) {
    const ct = getContentType(msg.message);
    if (ct === 'conversation')             body = msg.message.conversation || '';
    else if (ct === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || '';
    else if (ct === 'imageMessage')        body = msg.message.imageMessage?.caption || '';
    else if (ct === 'videoMessage')        body = msg.message.videoMessage?.caption || '';
    else body = '';

    const rawJid = msg.key.remoteJid;
    const fromMe = msg.key.fromMe;
    isGroup = rawJid.endsWith('@g.us');
    const isLid = rawJid.endsWith('@lid');

    if (isGroup) {
      from = rawJid;
      sender = msg.key.participant || '';
      senderNumber = sender.split('@')[0].replace(/\D/g, '');
    } else {
      from = (isLid || fromMe) ? `${OWNER}@s.whatsapp.net` : rawJid;
      senderNumber = fromMe ? OWNER : rawJid.split('@')[0].replace(/\D/g, '');
      sender = `${senderNumber}@s.whatsapp.net`;
    }
    isOwner = senderNumber === OWNER || fromMe;
  }

  if (!body || !body.startsWith(PREFIX)) return;

  // Anti-spam
  if (!isOwner) {
    if (isSpam(senderNumber)) {
      return await sock.sendMessage(from, { text: '⚠️ Calme-toi ! Trop de messages.' });
    }
    trackMessage(senderNumber);
  }

  const parts   = body.slice(PREFIX.length).trim().split(/\s+/);
  const cmdName = parts[0]?.toLowerCase();
  const args    = parts.slice(1);
  const text    = args.join(' ');

  if (!cmdName) return;

  if (!canUseBot(isOwner) && !['public', 'self', 'owner'].includes(cmdName)) return;

  const command = commands[cmdName];
  if (!command) return;

  // Vérification admin
  if (command.adminOnly && !isOwner) {
    let isUserAdmin = false;
    if (isGroup) {
      const metadata = await sock.groupMetadata(from).catch(() => null);
      if (metadata) {
        isUserAdmin = !!metadata.participants.find(p => p.id === sender && (p.admin || p.isSuperAdmin));
      }
    }
    if (!isUserAdmin) {
      return await sock.sendMessage(from, { text: '🔒 Cette commande est réservée aux administrateurs.' });
    }
  }

  try {
    console.log(`⚡ [${cmdName}] par ${senderNumber} (Owner: ${isOwner})`);
    addStat(senderNumber, cmdName);
    await command.execute({ sock, msg, from, sender, senderNumber, isOwner, isGroup, args, text, store, noTagGroups, prefix: PREFIX });
  } catch (err) {
    console.error(`❌ Erreur ${cmdName}:`, err.message);
    await sock.sendMessage(from, { text: `❌ Erreur : ${err.message}` }).catch(() => {});
  }
}