/**
 * @file        index.js
 * @project     WhatsApp Bot
 * @description Pairing Code fiable + Session String + Auto-ping + AutoSaveViewOnce
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
    downloadContentFromMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeterminal from 'qrcode-terminal';

dotenv.config();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const AUTH_PATH   = path.join(__dirname, '../auth_info');
const OWNER       = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const PREFIX      = process.env.PREFIX || '/';
const SESSION_STR = process.env.SESSION_STRING;

// Filtre anti-logs Baileys inutiles (session crypto, ratchet, clés Signal)
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (data, ...a) => {
    const s = data.toString();
    if (s.includes('Bad MAC') || s.includes('Session error') || s.includes('Failed to decrypt') ||
        s.includes('libsignal') || s.includes('MessageCounterError') ||
        s.includes('Closing open session') || s.includes('Closing session:') ||
        s.includes('registrationId') || s.includes('_chains') || s.includes('currentRatchet') ||
        s.includes('indexInfo') || s.includes('ephemeralKeyPair') ||
        s.includes('SessionEntry') || s.includes('chainKey') || s.includes('chainType') ||
        s.includes('rootKey') || s.includes('baseKey') || s.includes('RemoteIdentity')) return true;
    return _stderrWrite(data, ...a);
};
// Filtre console.error pour les mêmes patterns
const _consoleError = console.error.bind(console);
console.error = (...a) => {
    const s = a.join(' ');
    if (s.includes('Bad MAC') || s.includes('Session error') || s.includes('Failed to decrypt') ||
        s.includes('libsignal') || s.includes('MessageCounterError') ||
        s.includes('Closing session') || s.includes('registrationId') ||
        s.includes('_chains') || s.includes('currentRatchet') || s.includes('ephemeralKeyPair')) return;
    _consoleError(...a);
};

// Restauration session depuis SESSION_STRING (Render / VPS)
if (SESSION_STR && !fs.existsSync(path.join(AUTH_PATH, 'creds.json'))) {
    console.log('Restauration de la session depuis SESSION_STRING...');
    fse.ensureDirSync(AUTH_PATH);
    try {
        const sessionData = JSON.parse(Buffer.from(SESSION_STR, 'base64').toString('utf-8'));
        for (const [fileName, content] of Object.entries(sessionData)) {
            fs.writeFileSync(path.join(AUTH_PATH, fileName), content);
        }
        console.log('Session restauree.');
    } catch {
        console.error('SESSION_STRING invalide ou corrompue.');
    }
}

['../auth_info', '../data', '../data/notes', '../data/stats', '../data/banned']
    .forEach(d => fse.ensureDirSync(path.join(__dirname, d)));

import { handleCommand } from './handler.js';
import { trackMessage as trackGroupMsg } from './utils/groupstats.js';

// AUTO-SAUVEGARDE DES MESSAGES A VUE UNIQUE
async function autoSaveViewOnce(sock, msg, { senderNumber, senderJid, isGroup, rawJid }) {
    if (!OWNER) return;
    const ownerJid = OWNER + '@s.whatsapp.net';

    // Format 1 : wrapper viewOnceMessage / V2 / V2Extension
    let innerMsg = msg.message?.viewOnceMessage?.message
                || msg.message?.viewOnceMessageV2?.message
                || msg.message?.viewOnceMessageV2Extension?.message;

    // Format 2 : imageMessage / videoMessage / audioMessage avec viewOnce:true
    if (!innerMsg) {
        const ct2 = getContentType(msg.message);
        if (ct2 && /^(image|video|audio)Message$/.test(ct2) && msg.message[ct2]?.viewOnce === true) {
            innerMsg = msg.message;
        }
    }

    if (!innerMsg) return;

    const type = getContentType(innerMsg);
    if (!type || !/^(image|video|audio)Message$/.test(type)) return;

    const mediaObj  = innerMsg[type];
    const mediaType = type.replace('Message', '');

    try {
        const stream = await downloadContentFromMessage(mediaObj, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        const sourceName = isGroup ? ('Groupe ' + rawJid.split('@')[0]) : ('Prive @' + senderNumber);
        const lines = [
            '*Vue unique interceptee*',
            'De : @' + senderNumber,
            'Source : ' + sourceName,
        ];
        if (mediaObj?.caption) lines.push('Legende : ' + mediaObj.caption);
        const caption = lines.join('\n');

        if (mediaType === 'image') {
            await sock.sendMessage(ownerJid, { image: buffer, caption }, { mentions: [senderJid] });
        } else if (mediaType === 'video') {
            await sock.sendMessage(ownerJid, { video: buffer, caption }, { mentions: [senderJid] });
        } else {
            await sock.sendMessage(ownerJid, { text: caption });
            await sock.sendMessage(ownerJid, { audio: buffer, mimetype: 'audio/mp4', ptt: false });
        }
        console.log('[AutoVO] ' + senderNumber + ' -> owner (' + mediaType + ')');
    } catch (e) {
        console.error('[AutoVO] Erreur:', e.message);
    }
}

// CONNEXION PRINCIPALE
async function connectToWhatsApp() {
    fse.ensureDirSync(AUTH_PATH);
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });

    // Verifier si deja enregistre AVANT de creer le socket
    const alreadyRegistered = !!state.creds.registered;

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
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        retryRequestDelayMs: 2000,
        maxMsgRetryCount: 2,
        keepAliveIntervalMs: 25000,
    });

    // PAIRING CODE — demande apres 5s pour laisser le WS s'etablir
    let pairingRequested = false;
    if (!alreadyRegistered && OWNER) {
        setTimeout(async () => {
            if (pairingRequested) return;
            pairingRequested = true;
            try {
                const code = await sock.requestPairingCode(OWNER);
                const codeFmt = (code?.match(/.{1,4}/g) || [code]).join('-');
                console.log('\n========================================');
                console.log('  CODE DE LIAISON : ' + codeFmt.toUpperCase());
                console.log('========================================');
                console.log('  WhatsApp > Appareils connectes');
                console.log('  > Lier avec numero de telephone');
                console.log('========================================\n');
            } catch (e) {
                console.error('Erreur Pairing Code:', e.message);
                console.error('  Numero utilise : "' + OWNER + '"');
                console.error('  Verif OWNER_NUMBER dans .env (ex: 237612345678)');
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && !alreadyRegistered && !pairingRequested) {
            console.log('\n SCANNEZ CE QR CODE :\n');
            qrcodeterminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
            const num = sock.user?.id?.split(':')[0] || sock.user?.id;
            console.log('\n==============================');
            console.log('  CONNECTE : ' + num);
            console.log('  PREFIX   : ' + PREFIX);
            console.log('  OWNER    : ' + OWNER);
            console.log('==============================\n');

            // Generer SESSION_STRING si absente
            if (!SESSION_STR) {
                try {
                    const files = fs.readdirSync(AUTH_PATH).filter(f => f.endsWith('.json'));
                    const sessionData = {};
                    files.forEach(f => { sessionData[f] = fs.readFileSync(path.join(AUTH_PATH, f), 'utf-8'); });
                    const sStr = Buffer.from(JSON.stringify(sessionData)).toString('base64');
                    console.log('COPIEZ DANS SESSION_STRING (Render/VPS):\n');
                    console.log(sStr);
                    console.log('\n');
                } catch {}
            }
        }

        if (connection === 'close') {
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                console.log('Session deconnectee. Supprimez auth_info/ et relancez.');
            } else {
                setTimeout(connectToWhatsApp, code === DisconnectReason.restartRequired ? 2000 : 3000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
            try {
                const rawJid  = msg.key.remoteJid;
                const fromMe  = msg.key.fromMe;
                const isGroup = rawJid.endsWith('@g.us');
                const isLid   = rawJid.endsWith('@lid');

                const from = isGroup ? rawJid : ((isLid || fromMe) ? OWNER + '@s.whatsapp.net' : rawJid);

                let senderJid, senderNumber;
                if (isGroup) {
                    senderJid    = msg.key.participant || '';
                    senderNumber = senderJid.split('@')[0].replace(/\D/g, '');
                } else {
                    senderNumber = fromMe ? OWNER : rawJid.split('@')[0].replace(/\D/g, '');
                    senderJid    = senderNumber + '@s.whatsapp.net';
                }
                const isOwner = senderNumber === OWNER || fromMe;

                const ct = getContentType(msg.message);
                let body = '';
                if (ct === 'conversation')             body = msg.message.conversation || '';
                else if (ct === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || '';
                else if (ct === 'imageMessage')        body = msg.message.imageMessage?.caption || '';
                else if (ct === 'videoMessage')        body = msg.message.videoMessage?.caption || '';

                // Auto-interception vues uniques (format 1 wrapper + format 2 viewOnce:true)
                const isViewOnce = !fromMe && (
                    /^viewOnceMessage/.test(ct) ||
                    msg.message?.imageMessage?.viewOnce === true ||
                    msg.message?.videoMessage?.viewOnce === true ||
                    msg.message?.audioMessage?.viewOnce === true
                );
                if (isViewOnce) {
                    autoSaveViewOnce(sock, msg, { senderNumber, senderJid, isGroup, rawJid }).catch(() => {});
                }

                // Anti-boucle
                const isCmd = body.startsWith(PREFIX);
                if (fromMe && !isCmd) continue;

                if (isGroup) trackGroupMsg(from, senderJid);

                await handleCommand(sock, msg, {}, { body, from, isGroup, isOwner, senderNumber, sender: senderJid });

            } catch (err) {
                console.error('Erreur traitement message:', err.message);
            }
        }
    });

    return sock;
}

// Serveur HTTP + Auto-ping Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', bot: process.env.BOT_NAME || 'WhatsApp Bot' }));
}).listen(PORT, () => {
    console.log('Serveur HTTP actif sur port ' + PORT);

    // ── Auto-ping HTTP (anti-sleep Render) ──────────────────────────
    setInterval(async () => {
        const url = process.env.RENDER_EXTERNAL_URL
                 || (process.env.RENDER_SERVICE_NAME ? 'https://' + process.env.RENDER_SERVICE_NAME + '.onrender.com' : null);
        if (url) {
            try { await axios.get(url); } catch { /* ignore */ }
        }
    }, 2 * 60 * 1000);
});

// ── Auto-ping WhatsApp (maintien de la connexion WA) ────────────────
// Envoie une présence "available" toutes les 1 minute pour éviter
// que le socket se déconnecte silencieusement sur les hébergeurs.
let _waSock = null;
const WA_PING_INTERVAL = parseInt(process.env.WA_PING_INTERVAL_MS || '60000'); // 1 min 

function startWaPing(sock) {
    _waSock = sock;
    setInterval(async () => {
        if (!_waSock) return;
        try {
            await _waSock.sendPresenceUpdate('available');
        } catch { /* connexion coupée — reconnexion gérée par connection.update */ }
    }, WA_PING_INTERVAL);
}

async function connectToWhatsAppWithPing() {
    const sock = await connectToWhatsApp();
    startWaPing(sock);
    // Reattacher le ping après chaque reconnexion
    sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open') _waSock = sock;
        if (connection === 'close') _waSock = null;
    });
}

connectToWhatsAppWithPing().catch(console.error);