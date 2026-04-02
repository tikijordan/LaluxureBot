/**
 * @file        index.js
 * @project     WhatsApp Bot (Full Render Stable Version)
 */

import http from 'http';
import axios from 'axios';
import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import makeWASocket, { 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    DisconnectReason,
    getContentType
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeterminal from 'qrcode-terminal';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_PATH = path.join(__dirname, '../auth_info');
const OWNER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const SESSION_STRING = process.env.SESSION_STRING;
const PREFIX = process.env.PREFIX || '/';

// --- NETTOYAGE DES LOGS ---
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (data, ...a) => {
    const s = data.toString();
    if (s.includes('Bad MAC') || s.includes('Session error') || s.includes('Failed to decrypt')) return true;
    return _stderrWrite(data, ...a);
};

// --- RESTAURATION DE LA SESSION (INDISPENSABLE SUR RENDER) ---
if (SESSION_STRING && !fs.existsSync(AUTH_PATH)) {
    console.log("📂 Restauration de la session depuis SESSION_STRING...");
    fse.ensureDirSync(AUTH_PATH);
    try {
        const sessionData = JSON.parse(Buffer.from(SESSION_STRING, 'base64').toString('utf-8'));
        for (const [fileName, content] of Object.entries(sessionData)) {
            fs.writeFileSync(path.join(AUTH_PATH, fileName), content);
        }
        console.log("✅ Session restaurée.");
    } catch (e) {
        console.error("❌ Erreur restauration SESSION_STRING:", e.message);
    }
}

// Imports des modules locaux (assure-toi que les chemins sont bons)
import { handleCommand } from './handler.js';
import { trackMessage as trackGroupMsg } from './utils/groupstats.js';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
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
    });

    // --- LOGIQUE PAIRING CODE ---
    if (!sock.authState.creds.registered) {
        if (OWNER) {
            console.log(`\n🔑 Génération du code pour : ${OWNER}...`);
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(OWNER);
                    console.log('\n╔════════════════════════════════════╗');
                    console.log(`║  CODE DE JUMELAGE : ${code}`);
                    console.log('╚════════════════════════════════════╝\n');
                } catch (e) {
                    console.error("Erreur pairing code:", e.message);
                }
            }, 5000);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && !sock.authState.creds.registered) {
            console.log('\n📱 SCANNEZ LE QR CODE (SI PAS DE CODE) :\n');
            qrcodeterminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('\n✅ BOT CONNECTÉ !');
            
            // Génération automatique de la String si elle n'existe pas
            if (!SESSION_STRING) {
                const files = fs.readdirSync(AUTH_PATH);
                const sessionData = {};
                files.forEach(f => { 
                    if(f.endsWith('.json')) sessionData[f] = fs.readFileSync(path.join(AUTH_PATH, f), 'utf-8');
                });
                const sString = Buffer.from(JSON.stringify(sessionData)).toString('base64');
                console.log('\n⚠️ COPIEZ CECI DANS VOS VARIABLES RENDER (SESSION_STRING) :\n');
                console.log(sString);
                console.log('\n--------------------------------------------------\n');
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) {
                console.log('🔄 Reconnexion...');
                setTimeout(connectToWhatsApp, 3000);
            }
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
                           (ct === 'extendedTextMessage') ? msg.message.extendedTextMessage?.text : '';

                if (isGroup) trackGroupMsg(from, senderJid);
                await handleCommand(sock, msg, {}, { body, from, isGroup, isOwner, senderNumber, sender: senderJid });
            } catch (err) {
                console.error('❌ Erreur:', err.message);
            }
        }
    });

    return sock;
}

// --- SERVEUR & AUTO-PING (2 MIN) ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online' }));
}).listen(PORT, () => {
    console.log(`🌐 Serveur sur port ${PORT}`);
    setInterval(async () => {
        const url = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
        if (url && !url.includes('undefined')) {
            try { await axios.get(url); } catch (e) {}
        }
    }, 2 * 60 * 1000);
});

connectToWhatsApp().catch(console.error);