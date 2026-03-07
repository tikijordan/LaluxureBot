/**
 * @file        index.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  getContentType,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fse from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import qrcodeterminal from 'qrcode-terminal';

// --- AJOUT : IMPORT RELAIS TELEGRAM ---
import { loadSessionFromTelegram, saveSessionToTelegram } from './telegramRelay.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = process.env.PREFIX || '/';
const OWNER  = process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER.replace(/\D/g, '') : '';

// Dossiers requis
['../auth_info','../data','../data/notes','../data/stats','../data/banned']
  .forEach(d => fse.ensureDirSync(path.join(__dirname, d)));

global.botMessages  = new Map();
global.mutedMembers = new Set();
// --- AJOUT : VARIABLE POUR ÉVITER LE SPAM TELEGRAM ---
global.lastTelegramSave = 0; 

// ── Imports utilitaires ────────────────────────────────────────
import { handleCommand } from './handler.js';
import { isAntilinkEnabled, containsLink } from './utils/antilink.js';
import { getWelcomeConfig } from './utils/welcome.js';
import { isBanned } from './utils/banned.js';
import { containsBadWord } from './utils/filter.js';
import { isTooFast } from './utils/slowmode.js';
import { isVip } from './utils/vip.js';
import { isWhitelisted } from './utils/whitelist.js';
import { trackMessage as trackGroupMsg } from './utils/groupstats.js';
import { findReply } from './utils/autoreply.js';

// ── Store léger ────────────────────────────────────────────────
const store = {
  contacts: {},
  bind: (ev) => {
    ev.on('contacts.upsert', (list) => { for (const c of list) store.contacts[c.id] = c; });
    ev.on('contacts.update', (list) => { for (const c of list) if (c.id) store.contacts[c.id] = { ...store.contacts[c.id], ...c }; });
  },
};

async function connectToWhatsApp() {
  // --- AJOUT : RESTAURATION DEPUIS TELEGRAM AU DÉMARRAGE ---
  await loadSessionFromTelegram();

  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '../auth_info'));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    browser: ['Ubuntu', 'Chrome', '20.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    emitOwnEvents: true,
  });

  store.bind(sock.ev);

  // --- MODIFICATION : SAUVEGARDE CREDS + TELEGRAM ---
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    
    // Sauvegarde sur Telegram toutes les 10 minutes max pour la stabilité
    const now = Date.now();
    if (now - global.lastTelegramSave > 600000) { 
        await saveSessionToTelegram();
        global.lastTelegramSave = now;
    }
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 SCANNEZ CE QR CODE:\n');
      qrcodeterminal.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(connectToWhatsApp, 3000);
      }
    }
    if (connection === 'open') {
      const num = sock.user?.id?.split(':')[0] || sock.user?.id;
      console.log('\n╔══════════════════════════════════════╗');
      console.log(`║  ✅ CONNECTÉ : ${num}`);
      console.log(`║  PREFIX     : ${PREFIX}`);
      console.log(`║  OWNER      : ${OWNER}`);
      console.log('║  HÉBERGEMENT : RELAIS TELEGRAM ACTIF ║');
      console.log('╚══════════════════════════════════════╝\n');
      
      // Sauvegarde immédiate à la connexion
      await saveSessionToTelegram();
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    const { messages } = upsert;

    for (const msg of messages) {
        // 1. IGNORER STRICTEMENT LES STATUTS
        if (msg.key.remoteJid === 'status@broadcast') {
            continue; 
        }

      try {
        if (!msg.message) continue;

        const from = msg.key.remoteJid;
        const fromMe = msg.key.fromMe;
        const isGroup = from.endsWith('@g.us');
        
        // --- EXTRACTION DU BODY ---
        const ct = getContentType(msg.message);
        let body = '';
        if (ct === 'conversation') body = msg.message.conversation || '';
        else if (ct === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || '';
        else if (ct === 'imageMessage') body = msg.message.imageMessage?.caption || '';
        else if (ct === 'videoMessage') body = msg.message.videoMessage?.caption || '';

        const isCmd = body.startsWith(PREFIX);

        // Anti-boucle : ignorer les messages du bot qui ne sont pas des commandes
        if (fromMe && !isCmd) continue;

        // --- DÉTERMINATION DU SENDER ---
        // En groupe : le sender est le participant, pas le bot
        // En privé fromMe : c'est l'owner qui écrit
        let senderJid, senderNumber;
        if (isGroup) {
          senderJid = msg.key.participant || '';
          senderNumber = senderJid.split('@')[0].replace(/\D/g, '');
        } else {
          senderNumber = fromMe ? OWNER : from.split('@')[0].replace(/\D/g, '');
          senderJid = senderNumber + '@s.whatsapp.net';
        }

        const isOwner = senderNumber === OWNER || fromMe;

        // Log
        console.log(`📩 [${isGroup ? 'GRP' : 'PV'}] ${senderNumber}: ${body.substring(0, 30)}`);

        // --- MODÉRATION GROUPE ---
        if (isGroup && !isOwner) {
            if (isBanned(from, senderNumber)) {
                await sock.groupParticipantsUpdate(from, [senderJid], 'remove').catch(() => {});
                continue;
            }
            if (isAntilinkEnabled(from) && containsLink(body)) {
                await sock.sendMessage(from, { delete: msg.key });
                continue;
            }
        }

        // --- STATS & AUTO-REPLY ---
        if (isGroup) trackGroupMsg(from, senderJid);
        if (isGroup && !isCmd) {
            const rep = findReply(from, body);
            if (rep) await sock.sendMessage(from, { text: rep });
        }

        // --- EXÉCUTION COMMANDE ---
        await handleCommand(sock, msg, store);

      } catch (err) {
        console.error('❌ Erreur:', err.message);
      }
    }
  });

  return sock;
}

connectToWhatsApp().catch(console.error);