/**
 * ============================================================
 * @file        handler.js
 * @description Gestionnaire de commandes — Routage et exécution
 * ============================================================
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

// Charger les commandes
let commands = {};
(async () => {
  commands = await loadCommands();
  console.log(`📦 ${Object.keys(commands).length} commandes prêtes.`);
})();

const noTagGroups = new Set();

// ============================================================
// EXTRACTION DU CONTEXTE
// ============================================================
export function getMessageContext(msg) {
  const PREFIX = process.env.PREFIX || '/';
  const OWNER_RAW = process.env.OWNER_NUMBER || '';
  const OWNER = OWNER_RAW.replace(/\D/g, ''); // Nettoie le numéro (garde juste les chiffres)

  const contentType = getContentType(msg.message);
  let body = '';

  if (contentType === 'conversation')
    body = msg.message.conversation || '';
  else if (contentType === 'extendedTextMessage')
    body = msg.message.extendedTextMessage?.text || '';
  else if (contentType === 'imageMessage')
    body = msg.message.imageMessage?.caption || '';
  else if (contentType === 'videoMessage')
    body = msg.message.videoMessage?.caption || '';

  const rawFrom = msg.key.remoteJid;
  const isGroup = rawFrom.endsWith('@g.us');
  const isLid   = rawFrom.endsWith('@lid');
  const fromMe  = msg.key.fromMe;

  // Normaliser @lid → vrai JID numérique pour sock.sendMessage
  const from = isLid ? `${OWNER}@s.whatsapp.net` : rawFrom;

  let senderJid = isGroup ? (msg.key.participant || '') : from;
  if (fromMe && !isGroup) senderJid = `${OWNER}@s.whatsapp.net`;

  const senderNumber = isGroup
    ? senderJid.split('@')[0].replace(/\D/g, '')
    : (fromMe ? OWNER : from.split('@')[0].replace(/\D/g, ''));
  const isOwner = senderNumber === OWNER || fromMe;

  return { body, contentType, isGroup, from, sender: senderJid, senderNumber, isOwner, prefix: PREFIX };
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export async function handleCommand(sock, msg, store) {
  const { body, isGroup, from, sender, senderNumber, isOwner, prefix } = getMessageContext(msg);

  // 1. Ignorer si pas de texte ou si ce n'est pas une commande
  if (!body || !body.startsWith(prefix)) return;

  // 2. Anti-spam (sauf pour l'owner)
  if (!isOwner) {
    if (isSpam(senderNumber)) {
      return await sock.sendMessage(from, { text: '⚠️ Calme-toi ! Trop de messages.' });
    }
    trackMessage(senderNumber);
  }

  // 3. Découpage de la commande
  const parts = body.slice(prefix.length).trim().split(/\s+/);
  const cmdName = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  const text = args.join(' ');

  if (!cmdName) return;

  // 4. Vérification Mode Bot (Public/Privé)
  // Si le bot n'est pas en mode public et que tu n'es pas l'owner
  if (!canUseBot(isOwner) && !['public', 'self', 'owner'].includes(cmdName)) {
     // Optionnel : ne rien envoyer du tout pour rester discret
     return; 
  }

  // 5. Trouver la commande
  const command = commands[cmdName];
  if (!command) return; // On ne répond pas "Inconnu" pour éviter le spam si l'utilisateur se trompe

  // 6. Vérification Admin/Owner
  if (command.adminOnly && !isOwner) {
    // Vérifier si l'utilisateur est admin du groupe
    let isBotAdmin = false;
    let isUserAdmin = false;
    
    if (isGroup) {
        const metadata = await sock.groupMetadata(from);
        const participants = metadata.participants;
        const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        
        isBotAdmin = !!participants.find(p => p.id === botId && (p.admin || p.isSuperAdmin));
        isUserAdmin = !!participants.find(p => p.id === sender && (p.admin || p.isSuperAdmin));
    }

    if (!isUserAdmin) {
        return await sock.sendMessage(from, { text: '🔒 Cette commande est réservée aux administrateurs.' });
    }
  }

  // 7. Exécution
  try {
    console.log(`⚡ Exécution: [${cmdName}] par ${senderNumber} (Owner: ${isOwner})`);
    addStat(senderNumber, cmdName);
    
    await command.execute({
      sock,
      msg,
      from,
      sender,
      senderNumber,
      isOwner,
      isGroup,
      args,
      text,
      store,
      noTagGroups,
      prefix
    });
  } catch (err) {
    console.error(`❌ Erreur ${cmdName}:`, err);
    await sock.sendMessage(from, { text: `❌ Une erreur est survenue : ${err.message}` });
  }
}