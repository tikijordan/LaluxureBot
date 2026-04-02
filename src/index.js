/**
 * @file        index.js
 * @project     WhatsApp Bot
 * @license     MIT
 */

import http from 'http';
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

dotenv.config();

// Supprimer les erreurs Bad MAC / session du terminal
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (data, ...a) => {
  const s = data.toString();
  if (s.includes('Bad MAC') || s.includes('Session error') || s.includes('Failed to decrypt') ||
      s.includes('libsignal') || s.includes('Closing open session') || s.includes('Closing session:') ||
      s.includes('registrationId') || s.includes('_chains') || s.includes('currentRatchet') ||
      s.includes('indexInfo') || s.includes('ephemeralKeyPair')) return true;
  return _stderrWrite(data, ...a);
};
const _consoleError = console.error.bind(console);
console.error = (...a) => {
  const s = a.join(' ');
  if (s.includes('Bad MAC') || s.includes('Session error') || s.includes('Failed to decrypt') ||
      s.includes('libsignal') || s.includes('MessageCounterError')) return;
  _consoleError(...a);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = process.env.PREFIX || '/';
const OWNER  = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');

['../auth_info','../data','../data/notes','../data/stats','../data/banned']
  .forEach(d => fse.ensureDirSync(path.join(__dirname, d)));

global.botMessages  = new Map();
global.mutedMembers = new Set();

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

const store = {
  contacts: {},
  bind: (ev) => {
    ev.on('contacts.upsert', (list) => { for (const c of list) store.contacts[c.id] = c; });
    ev.on('contacts.update', (list) => { for (const c of list) if (c.id) store.contacts[c.id] = { ...store.contacts[c.id], ...c }; });
  },
};

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '../auth_info'));
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: ['Ubuntu', 'Chrome', '20.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    emitOwnEvents: true,
    retryRequestDelayMs: 2000,
    maxMsgRetryCount: 2,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
  });

  store.bind(sock.ev);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 SCANNEZ CE QR CODE:\n');
      qrcodeterminal.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Session expirée. Supprimez auth_info/ et relancez.');
      } else {
        setTimeout(connectToWhatsApp, code === DisconnectReason.restartRequired ? 2000 : 5000);
      }
    }
    if (connection === 'open') {
      const num = sock.user?.id?.split(':')[0] || sock.user?.id;
      console.log('\n╔══════════════════════════════════╗');
      console.log(`║  ✅ CONNECTÉ : ${num}`);
      console.log(`║  PREFIX      : ${PREFIX}`);
      console.log(`║  OWNER       : ${OWNER}`);
      console.log('╚══════════════════════════════════╝\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.remoteJid === 'status@broadcast') continue;

      try {
        if (!msg.message) continue;

        const rawJid  = msg.key.remoteJid;
        const fromMe  = msg.key.fromMe;
        const isGroup = rawJid.endsWith('@g.us');
        const isLid   = rawJid.endsWith('@lid');

        // Destination réelle pour sock.sendMessage
        let from;
        if (isGroup) {
          from = rawJid;
        } else if (isLid || fromMe) {
          from = `${OWNER}@s.whatsapp.net`;
        } else {
          from = rawJid;
        }

        // Qui a envoyé
        let senderJid, senderNumber;
        if (isGroup) {
          senderJid    = msg.key.participant || '';
          senderNumber = senderJid.split('@')[0].replace(/\D/g, '');
        } else {
          senderNumber = fromMe ? OWNER : rawJid.split('@')[0].replace(/\D/g, '');
          senderJid    = `${senderNumber}@s.whatsapp.net`;
        }

        const isOwner = senderNumber === OWNER || fromMe;

        // Extraction du texte
        const ct = getContentType(msg.message);
        let body = '';
        if (ct === 'conversation')        body = msg.message.conversation || '';
        else if (ct === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || '';
        else if (ct === 'imageMessage')   body = msg.message.imageMessage?.caption || '';
        else if (ct === 'videoMessage')   body = msg.message.videoMessage?.caption || '';

        const isCmd = body.startsWith(PREFIX);

        // Anti-boucle
        if (fromMe && !isCmd) continue;

        console.log(`📩 [${isGroup ? 'GRP' : 'PV'}] ${senderNumber}: ${body.substring(0, 40)}`);

        // Modération groupe
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

        // Stats & auto-reply
        if (isGroup) trackGroupMsg(from, senderJid);
        if (isGroup && !isCmd) {
          const rep = findReply(from, body);
          if (rep) await sock.sendMessage(from, { text: rep });
        }

        // Exécution commande — on passe tout le contexte déjà calculé
        await handleCommand(sock, msg, store, { body, from, isGroup, isOwner, senderNumber, sender: senderJid });

      } catch (err) {
        console.error('❌ Erreur:', err.message);
      }
    }
  });

  return sock;
}

// Serveur HTTP pour les hébergeurs
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'online', bot: process.env.BOT_NAME || 'WhatsApp Bot' }));
}).listen(PORT, () => console.log(`🌐 Serveur HTTP actif sur port ${PORT}`));

connectToWhatsApp().catch(console.error);