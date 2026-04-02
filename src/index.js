/**
 * @file        index.js
 * @project     WhatsApp Bot (Session String Version)
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
    DisconnectReason 
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeterminal from 'qrcode-terminal';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_PATH = path.join(__dirname, '../auth_info');
const OWNER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const SESSION_STRING = process.env.SESSION_STRING;

// --- RESTAURATION DE LA SESSION ---
if (SESSION_STRING && !fs.existsSync(AUTH_PATH)) {
    console.log("📂 Restauration de la session depuis l'environnement...");
    fse.ensureDirSync(AUTH_PATH);
    const sessionData = JSON.parse(Buffer.from(SESSION_STRING, 'base64').toString('utf-8'));
    for (const [fileName, content] of Object.entries(sessionData)) {
        fs.writeFileSync(path.join(AUTH_PATH, fileName), content);
    }
    console.log("✅ Session restaurée avec succès.");
}

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
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && !state.creds.registered) {
            console.log('📱 SCANNEZ LE QR CODE :');
            qrcodeterminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('\n✅ BOT CONNECTÉ !');
            // Si c'est une nouvelle connexion, on génère la string pour toi
            if (!SESSION_STRING) {
                const files = fs.readdirSync(AUTH_PATH);
                const sessionData = {};
                files.forEach(f => { if(f.endsWith('.json')) sessionData[f] = fs.readFileSync(path.join(AUTH_PATH, f), 'utf-8')});
                const sString = Buffer.from(JSON.stringify(sessionData)).toString('base64');
                console.log('\n⚠️ COPIEZ CETTE SESSION_STRING DANS RENDER :\n' + sString + '\n');
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) connectToWhatsApp();
        }
    });

    return sock;
}

// Serveur & Auto-ping
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.end(JSON.stringify({ status: 'online' }));
}).listen(PORT, () => {
    console.log(`🌐 Port ${PORT}`);
    setInterval(() => {
        const url = process.env.RENDER_EXTERNAL_URL;
        if(url) axios.get(url).catch(() => {});
    }, 2 * 60 * 1000);
});

connectToWhatsApp();