/**
 * @file        index.js
 * @project     WhatsApp Bot (Version Render Immortelle)
 * @description Pairing Code corrigé + Session String + Auto-ping 2min
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

// --- FILTRE ANTI-LOGS INUTILES ---
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (data, ...a) => {
    const s = data.toString();
    if (s.includes('Bad MAC') || s.includes('Session error') || s.includes('Failed to decrypt')) return true;
    return _stderrWrite(data, ...a);
};

// --- RESTAURATION AUTOMATIQUE DE LA SESSION ---
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
        console.error("❌ Erreur de lecture de la variable SESSION_STRING.");
    }
}

// Imports locaux (Assure-toi que ces fichiers existent dans ton projet)
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
        // IMPORTANT : Cette ligne fixe l'identité du bot pour valider le code
        browser: ["Chrome (Linux)", "Chrome", "110.0.5481.177"],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
    });

    // --- LOGIQUE DU PAIRING CODE (CORRIGÉE) ---
    if (!sock.authState.creds.registered) {
        if (OWNER) {
            console.log(`\n⏳ Attente de 10s pour stabiliser la connexion pour : ${OWNER}...`);
            setTimeout(async () => {
                try {
                    // Demande du code à WhatsApp
                    const code = await sock.requestPairingCode(OWNER);
                    const codeFinal = code?.match(/.{1,4}/g)?.join('-') || code;
                    
                    console.log('\n╔════════════════════════════════════╗');
                    console.log(`║  VOTRE CODE : ${codeFinal.toUpperCase()}`);
                    console.log('╚════════════════════════════════════╝\n');
                    console.log('👉 WhatsApp > Appareils connectés > Lier avec le numéro de téléphone\n');
                } catch (e) {
                    console.error("❌ Erreur Pairing Code. Vérifiez votre numéro dans le .env");
                }
            }, 10000); 
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && !sock.authState.creds.registered) {
            console.log('\n📱 OU SCANNEZ CE QR CODE :\n');
            qrcodeterminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('\n✅ BOT CONNECTÉ ET PRÊT !');
            
            // Si c'est la première connexion, générer la string pour Render
            if (!SESSION_STRING) {
                const files = fs.readdirSync(AUTH_PATH);
                const sessionData = {};
                files.forEach(f => { 
                    if(f.endsWith('.json')) sessionData[f] = fs.readFileSync(path.join(AUTH_PATH, f), 'utf-8');
                });
                const sString = Buffer.from(JSON.stringify(sessionData)).toString('base64');
                console.log('\n⚠️ SAUVEGARDEZ CETTE LIGNE DANS RENDER (SESSION_STRING) :\n');
                console.log(sString);
                console.log('\n--------------------------------------------------\n');
            }
        }

        if (connection === 'close') {
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) {
                console.log('🔄 Connexion perdue. Tentative de reconnexion...');
                setTimeout(connectToWhatsApp, 3000);
            } else {
                console.log('❌ Session déconnectée. Supprimez auth_info pour recommencer.');
            }
        }
    });

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
                console.error('❌ Erreur traitement message:', err.message);
            }
        }
    });

    return sock;
}

// --- SERVEUR & AUTO-PING (CHAQUE 2 MINUTES) ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online' }));
}).listen(PORT, () => {
    console.log(`🌐 Serveur HTTP actif sur port ${PORT}`);
    
    setInterval(async () => {
        const url = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
        if (url && !url.includes('undefined')) {
            try { 
                await axios.get(url);
                console.log('📡 Auto-ping (2min) : OK');
            } catch (e) {
                // Erreur ignorée (le serveur est peut-être juste occupé)
            }
        }
    }, 2 * 60 * 1000); 
});

connectToWhatsApp().catch(console.error);