/**
 * @file        index.js
 * @project     WhatsApp Bot
 * @license     MIT
 */

import http from 'http';
import axios from 'axios';
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

// Configuration des constantes
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = process.env.PREFIX || '/';
const OWNER  = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;

// Supprimer les erreurs de session du terminal pour plus de clarté
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (data, ...a) => {
  const s = data.toString();
  if (s.includes('Bad MAC') || s.includes('Session error') || s.includes('Failed to decrypt')) return true;
  return _stderrWrite(data, ...a);
};

// Création des dossiers nécessaires
['../auth_info','../data','../data/notes','../data/stats','../data/banned']
  .forEach(d => fse.ensureDirSync(path.join(__dirname, d)));

global.botMessages  = new Map();
global.mutedMembers = new Set();

import { handleCommand } from './handler.js';
import { trackMessage as trackGroupMsg } from './utils/groupstats.js';

const store = {
  contacts: {},
  bind: (ev) => {
    ev.on('contacts.upsert', (list) => { for (const c of list) store.contacts[c.id] = c; });
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
    browser: ["Ubuntu", "Chrome", "20.0.0"],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
  });

  // --- LOGIQUE DE CONNEXION (PAIRING CODE) ---
  if (!sock.authState.creds.registered) {
    if (OWNER) {
      console.log(`\n🔑 Génération du code de jumelage pour : ${OWNER}...`);
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(OWNER);
          console.log('\n╔════════════════════════════════════╗');
          console.log(`║  VOTRE CODE DE JUMELAGE : ${code}`);
          console.log('╚════════════════════════════════════╝\n');
        } catch (e) {
          console.error("Erreur pairing code:", e.message);
        }
      }, 5000);
    } else {
      console.log("\n⚠️ Aucun OWNER_NUMBER détecté dans le .env.");
    }
  }

  store.bind(sock.ev);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !sock.authState.creds.registered) {
      console.log('\n📱 OU SCANNEZ CE QR CODE :\n');
      qrcodeterminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Session expirée. Supprimez auth_info/ et relancez.');
      } else {
        setTimeout(connectToWhatsApp, 3000);
      }
    }

    if (connection === 'open') {
      console.log('\n✅ BOT CONNECTÉ AVEC SUCCÈS !');
    }
  });

  // --- GESTION DES MESSAGES ---
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

      try {
        const rawJid = msg.key.remoteJid;
        const fromMe = msg.key.fromMe;
        const isGroup = rawJid.endsWith('@g.us');
        const from = isGroup ? rawJid : (fromMe ? `${OWNER}@s.whatsapp.net` : rawJid);
        
        let senderJid = isGroup ? (msg.key.participant || '') : (fromMe ? `${OWNER}@s.whatsapp.net` : rawJid);
        let senderNumber = senderJid.split('@')[0].replace(/\D/g, '');
        const isOwner = senderNumber === OWNER || fromMe;

        const ct = getContentType(msg.message);
        let body = (ct === 'conversation') ? msg.message.conversation : 
                   (ct === 'extendedTextMessage') ? msg.message.extendedTextMessage?.text :
                   (ct === 'imageMessage') ? msg.message.imageMessage?.caption :
                   (ct === 'videoMessage') ? msg.message.videoMessage?.caption : '';

        if (!body) body = '';
        console.log(`📩 [${isGroup ? 'GRP' : 'PV'}] ${senderNumber}: ${body.substring(0, 30)}`);

        if (isGroup) trackGroupMsg(from, senderJid);
        await handleCommand(sock, msg, store, { body, from, isGroup, isOwner, senderNumber, sender: senderJid });

      } catch (err) {
        console.error('❌ Erreur message:', err.message);
      }
    }
  });

  return sock;
}

// --- SERVEUR HTTP & AUTO-PING POUR RENDER ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'online', timestamp: new Date() }));
}).listen(PORT, () => {
  console.log(`🌐 Serveur HTTP actif sur port ${PORT}`);
  
  // Auto-ping interne toutes les 10 minutes
  setInterval(async () => {
    try {
      if (RENDER_URL && !RENDER_URL.includes('undefined')) {
        await axios.get(RENDER_URL);
        console.log('📡 Auto-ping : Bot maintenu éveillé.');
      }
    } catch (e) {
      console.log('📡 Auto-ping en attente de l\'URL finale...');
    }
  }, 2 * 60 * 1000);
});

connectToWhatsApp().catch(console.error);