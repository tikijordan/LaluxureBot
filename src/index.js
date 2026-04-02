/**
 * @file        index.js
 * @project     LaluxureBot - Stabilité 24h/24
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
    getContentType,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeterminal from 'qrcode-terminal';

dotenv.config();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const AUTH_PATH   = path.join(__dirname, '../auth_info');
const OWNER       = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const SESSION_STR = process.env.SESSION_STRING;

// --- FILTRE ANTI-LOGS (Nettoyage console) ---
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (data, ...a) => {
    const s = data.toString();
    if (s.includes('Bad MAC') || s.includes('Session error') || s.includes('libsignal')) return true;
    return _stderrWrite(data, ...a);
};

// --- RESTAURATION DE SESSION ---
if (SESSION_STR) {
    fse.ensureDirSync(AUTH_PATH);
    try {
        const sessionData = JSON.parse(Buffer.from(SESSION_STR, 'base64').toString('utf-8'));
        for (const [fileName, content] of Object.entries(sessionData)) {
            fs.writeFileSync(path.join(AUTH_PATH, fileName), content);
        }
        console.log('✅ Session restauree.');
    } catch (e) { console.error('❌ Erreur SESSION_STRING'); }
}

import { handleCommand } from './handler.js';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
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
        markOnlineOnConnect: false, // Évite le crash au démarrage
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 20000, // Ping toutes les 20s
    });

    // Pairing Code
    if (!state.creds.registered && OWNER) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(OWNER);
                console.log(`\n🔹 CODE DE LIAISON : ${code.toUpperCase()}\n`);
            } catch (e) { console.log(e); }
        }, 8000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && !state.creds.registered) qrcodeterminal.generate(qr, { small: true });

        if (connection === 'open') {
            console.log('🚀 LaluxureBot est en ligne 24h/24');
            
            // Génération de la string de secours
            const files = fs.readdirSync(AUTH_PATH).filter(f => f.endsWith('.json'));
            const sessionData = {};
            files.forEach(f => { sessionData[f] = fs.readFileSync(path.join(AUTH_PATH, f), 'utf-8'); });
            console.log('\n⚠️ TA SESSION_STRING :\n' + Buffer.from(JSON.stringify(sessionData)).toString('base64') + '\n');
            
            // Maintenance de la présence
            setInterval(async () => {
                try { await sock.sendPresenceUpdate('available'); } catch (e) {}
            }, 50000);
        }

        if (connection === 'close') {
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 3000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        const from = msg.key.remoteJid;
        const ct = getContentType(msg.message);
        const body = (ct === 'conversation') ? msg.message.conversation : (ct === 'extendedTextMessage') ? msg.message.extendedTextMessage?.text : '';
        
        await handleCommand(sock, msg, {}, { body, from, isOwner: msg.key.fromMe || msg.key.remoteJid.includes(OWNER) });
    });
}

// Serveur HTTP pour Railway/Render
http.createServer((req, res) => { res.end('Bot Online'); }).listen(process.env.PORT || 3000);

connectToWhatsApp();