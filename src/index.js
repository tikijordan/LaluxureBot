/**
 * @file        index.js
 * @project     WhatsApp Bot — Multi-Session
 * @description Connexion QR Code uniquement, sessions multiples, numéro auto-détecté
 * @license     MIT
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

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, '../sessions');
const DASH_DIR     = path.join(__dirname, '../dashboard');
const PORT         = parseInt(process.env.PORT || '3000');
const DASH_TOKEN   = process.env.DASHBOARD_TOKEN || 'admin';
const DEFAULT_PREFIX = process.env.PREFIX || '/';
const startTime    = Date.now();

// ── Filtre anti-bruit Baileys ─────────────────────────────────
const NOISE_PATTERNS = [
    'Bad MAC', 'Session error', 'Failed to decrypt', 'libsignal',
    'MessageCounterError', 'Closing open session', 'Closing session:',
    'registrationId', '_chains', 'currentRatchet', 'indexInfo',
    'ephemeralKeyPair', 'SessionEntry', 'chainKey', 'chainType',
    'rootKey', 'baseKey', 'RemoteIdentity',
];
const isNoise = s => NOISE_PATTERNS.some(p => s.includes(p));
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (data, ...a) => { if (isNoise(data.toString())) return true; return _stderrWrite(data, ...a); };
const _consoleError = console.error.bind(console);
console.error = (...a) => { if (isNoise(a.join(' '))) return; _consoleError(...a); };

// ── Dossiers essentiels ───────────────────────────────────────
[SESSIONS_DIR, DASH_DIR,
 path.join(__dirname, '../data'),
 path.join(__dirname, '../data/notes'),
 path.join(__dirname, '../data/stats'),
 path.join(__dirname, '../data/banned'),
].forEach(d => fse.ensureDirSync(d));

import { handleCommand } from './handler.js';
import { trackMessage as trackGroupMsg } from './utils/groupstats.js';
import { addStat } from './utils/stats.js';

// ── Map globale des sessions ──────────────────────────────────
const sessions = new Map();

// ── SSE — push temps réel vers le dashboard ───────────────────
const sseClients = new Set();

function ssePush(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
        try { res.write(payload); } catch { sseClients.delete(res); }
    }
}

// ── Charger les stats historiques d'un owner depuis stats.json ─
function loadOwnerStats(ownerNum) {
    if (!ownerNum) return { commandsCount: 0, messagesCount: 0 };
    try {
        const data = JSON.parse(fs.readFileSync(
            path.join(__dirname, '../data/stats/stats.json'), 'utf8'));
        const u = data[ownerNum] || {};
        return { commandsCount: u.total || 0, messagesCount: u.total || 0 };
    } catch { return { commandsCount: 0, messagesCount: 0 }; }
}

// ── Config par session ────────────────────────────────────────
function loadConfig(sessionId) {
    try { return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, sessionId, 'config.json'), 'utf-8')); }
    catch { return {}; }
}

function saveConfig(sessionId, data) {
    const p = path.join(SESSIONS_DIR, sessionId, 'config.json');
    fse.ensureDirSync(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function genSessionId() {
    return 'sess_' + Math.random().toString(36).slice(2, 8);
}

// ── Auto-save vues uniques ────────────────────────────────────
async function autoSaveViewOnce(sock, msg, { senderNumber, senderJid, isGroup, rawJid, owner }) {
    if (!owner) return;
    const ownerJid = owner + '@s.whatsapp.net';

    let innerMsg = msg.message?.viewOnceMessage?.message
                || msg.message?.viewOnceMessageV2?.message
                || msg.message?.viewOnceMessageV2Extension?.message;

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

        const source  = isGroup ? ('Groupe ' + rawJid.split('@')[0]) : ('Privé @' + senderNumber);
        const caption = ['*Vue unique interceptée*', 'De : @' + senderNumber, 'Source : ' + source,
                         mediaObj?.caption ? 'Légende : ' + mediaObj.caption : null]
                        .filter(Boolean).join('\n');

        if (mediaType === 'image') {
            await sock.sendMessage(ownerJid, { image: buffer, caption }, { mentions: [senderJid] });
        } else if (mediaType === 'video') {
            await sock.sendMessage(ownerJid, { video: buffer, caption }, { mentions: [senderJid] });
        } else {
            await sock.sendMessage(ownerJid, { text: caption });
            await sock.sendMessage(ownerJid, { audio: buffer, mimetype: 'audio/mp4', ptt: false });
        }
        console.log(`[AutoVO] ${senderNumber} → owner (${mediaType})`);
    } catch (e) {
        console.error('[AutoVO] Erreur:', e.message);
    }
}

// ── Démarrer / redémarrer une session ─────────────────────────
async function startSession(sessionId, sessionName) {
    const authDir = path.join(SESSIONS_DIR, sessionId, 'auth');
    fse.ensureDirSync(authDir);

    const cfg    = loadConfig(sessionId);
    const name   = sessionName || cfg.name || sessionId;
    const prefix = cfg.prefix || DEFAULT_PREFIX;
    const owner  = cfg.owner  || null;

    // Charger les compteurs historiques depuis stats.json
    const hist = loadOwnerStats(owner);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version }          = await fetchLatestBaileysVersion();
    const logger               = pino({ level: 'silent' });

    // État de la session
    const ss = {
        id: sessionId, name, connection: 'connecting',
        qrCode: null, owner, prefix,
        messagesCount:  hist.messagesCount,
        commandsCount:  hist.commandsCount,
        recentCommands: cfg.recentCommands || [],  // restaurés depuis config.json
        lastPing: null,
        noTagGroups: new Set(),
        sock: null,
        _pingTimer: null,
    };
    sessions.set(sessionId, ss);

    const sock = makeWASocket({
        version, logger,
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
    ss.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

        // ── QR Code ──────────────────────────────────────────
        if (qr) {
            console.log(`\n╔══════════════════════════════════════╗`);
            console.log(`║  [${name}] — SCANNEZ CE QR CODE`);
            console.log(`╚══════════════════════════════════════╝\n`);
            qrcodeterminal.generate(qr, { small: true });
            ss.qrCode     = qr;
            ss.connection = 'connecting';
            ssePush('session', sessionSummary(ss));
        }

        // ── Connecté ─────────────────────────────────────────
        if (connection === 'open') {
            const num = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0] || '';
            ss.owner      = num;
            ss.connection = 'open';
            ss.qrCode     = null;
            ss.lastPing   = new Date().toISOString();

            // Recharger les compteurs historiques avec le vrai numéro
            const hist = loadOwnerStats(num);
            ss.commandsCount  = hist.commandsCount;
            ss.messagesCount  = hist.messagesCount;

            console.log(`\n✅ [${name}] Connecté → ${num}  (préfixe: ${ss.prefix})\n`);
            saveConfig(sessionId, { owner: num, prefix: ss.prefix, name,
                recentCommands: ss.recentCommands.slice(-20) });
            ssePush('session', sessionSummary(ss));

            // Ping WhatsApp toutes les 3 min
            if (ss._pingTimer) clearInterval(ss._pingTimer);
            ss._pingTimer = setInterval(async () => {
                try {
                    await sock.sendPresenceUpdate('available');
                    ss.lastPing = new Date().toISOString();
                    ssePush('ping', { id: sessionId, lastPing: ss.lastPing });
                }
                catch { /* déconnexion gérée par connection.update */ }
            }, parseInt(process.env.WA_PING_INTERVAL_MS || '180000'));
        }

        // ── Déconnecté ────────────────────────────────────────
        if (connection === 'close') {
            ss.connection = 'close';
            ss.qrCode     = null;
            if (ss._pingTimer) { clearInterval(ss._pingTimer); ss._pingTimer = null; }
            ssePush('session', sessionSummary(ss));

            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                console.log(`⛔ [${name}] Déconnexion définitive (loggedOut). Supprimez la session ou rescannez.`);
            } else {
                console.log(`🔄 [${name}] Reconnexion dans 3s... (code: ${code})`);
                setTimeout(() => startSession(sessionId, name).catch(console.error), 3000);
            }
        }
    });

    // ── Traitement des messages ───────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
            try {
                const rawJid  = msg.key.remoteJid;
                const fromMe  = msg.key.fromMe;
                const isGroup = rawJid.endsWith('@g.us');
                const isLid   = rawJid.endsWith('@lid');
                const ownerNum = ss.owner || '';

                const from = isGroup
                    ? rawJid
                    : ((isLid || fromMe) ? ownerNum + '@s.whatsapp.net' : rawJid);

                // ── Résolution expéditeur ─────────────────────────────────
                let senderJid, senderNumber;
                if (isGroup) {
                    // Fallback chaîné pour compatibilité toutes versions Baileys
                    senderJid    = msg.key.participant || msg.participant || '';
                    if (!senderJid && fromMe) senderJid = ownerNum + '@s.whatsapp.net';
                    senderNumber = senderJid.split('@')[0].replace(/\D/g, '');
                } else {
                    senderNumber = fromMe ? ownerNum : rawJid.split('@')[0].replace(/\D/g, '');
                    senderJid    = senderNumber + '@s.whatsapp.net';
                }
                const isOwner = (ownerNum && senderNumber === ownerNum) || fromMe;

                // ── Extraction du body — couverture maximale ───────────────
                // Déplie les messages wrappés (reply, forward, ephemeral...)
                const m    = msg.message;
                const ct   = getContentType(m);
                const inner = m?.ephemeralMessage?.message
                           || m?.viewOnceMessage?.message
                           || m?.documentWithCaptionMessage?.message
                           || m;

                let body =
                    inner?.conversation                                        ||
                    inner?.extendedTextMessage?.text                           ||
                    inner?.imageMessage?.caption                               ||
                    inner?.videoMessage?.caption                               ||
                    inner?.documentMessage?.caption                            ||
                    inner?.buttonsResponseMessage?.selectedDisplayText         ||
                    inner?.listResponseMessage?.title                          ||
                    inner?.templateButtonReplyMessage?.selectedDisplayText     ||
                    '';

                // Vue unique
                const isViewOnce = !fromMe && (
                    /^viewOnceMessage/.test(ct) ||
                    m?.imageMessage?.viewOnce === true ||
                    m?.videoMessage?.viewOnce === true ||
                    m?.audioMessage?.viewOnce === true
                );
                if (isViewOnce) {
                    autoSaveViewOnce(sock, msg, { senderNumber, senderJid, isGroup, rawJid, owner: ownerNum }).catch(() => {});
                }

                // ── Anti-boucle : uniquement hors groupe, sans préfixe ────
                if (fromMe && !isGroup && !body.startsWith(ss.prefix)) continue;

                if (isGroup) trackGroupMsg(from, senderJid);

                ss.messagesCount++;

                await handleCommand(sock, msg, {}, {
                    body, from, isGroup, isOwner,
                    senderNumber, sender: senderJid,
                    prefix: ss.prefix,
                    owner: ownerNum,
                    noTagGroups: ss.noTagGroups,
                    onCommand: (cmd, user) => {
                        ss.commandsCount++;
                        ss.recentCommands.push({ cmd, user, time: new Date().toISOString() });
                        if (ss.recentCommands.length > 50) ss.recentCommands.shift();
                        // Sauvegarder les 20 dernières commandes dans config.json
                        saveConfig(sessionId, {
                            owner: ss.owner, prefix: ss.prefix, name: ss.name,
                            recentCommands: ss.recentCommands.slice(-20),
                        });
                        // Push immédiat vers le dashboard
                        ssePush('command', {
                            sessionId, cmd, user,
                            time: ss.recentCommands[ss.recentCommands.length - 1].time,
                            commandsCount: ss.commandsCount,
                            messagesCount: ss.messagesCount,
                        });
                    },
                });

            } catch (err) {
                console.error(`[${name}] Erreur message:`, err.message);
            }
        }
    });

    return sock;
}

// ── Charger les sessions existantes au démarrage ──────────────
async function init() {
    let sessionDirs = [];
    if (fs.existsSync(SESSIONS_DIR)) {
        sessionDirs = fs.readdirSync(SESSIONS_DIR).filter(d =>
            fs.statSync(path.join(SESSIONS_DIR, d)).isDirectory()
        );
    }

    if (sessionDirs.length === 0) {
        // Première utilisation → créer une session par défaut
        const id = genSessionId();
        console.log(`\n🆕 Première utilisation — création de la session : ${id}`);
        console.log(`   Scannez le QR code qui va apparaître pour vous connecter.\n`);
        await startSession(id, 'Session principale').catch(console.error);
    } else {
        console.log(`\n📂 ${sessionDirs.length} session(s) trouvée(s) — démarrage...\n`);
        for (const id of sessionDirs) {
            await startSession(id).catch(console.error);
        }
    }
}

// ── HTTP Server ───────────────────────────────────────────────
function sendJson(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
}

function checkToken(req) {
    const auth   = req.headers['authorization'] || '';
    const qToken = new URL(req.url, 'http://localhost').searchParams.get('token');
    return auth === `Bearer ${DASH_TOKEN}` || qToken === DASH_TOKEN;
}

function readBody(req) {
    return new Promise(resolve => {
        let buf = '';
        req.on('data', c => buf += c);
        req.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    });
}

function sessionSummary(ss) {
    return {
        id:              ss.id,
        name:            ss.name,
        connection:      ss.connection,
        owner:           ss.owner,
        qrCode:          ss.qrCode,
        prefix:          ss.prefix,
        messagesCount:   ss.messagesCount,
        commandsCount:   ss.commandsCount,
        recentCommands:  ss.recentCommands.slice(-20),
        lastPing:        ss.lastPing,
    };
}

http.createServer(async (req, res) => {
    const url      = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // CORS pre-flight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' });
        return res.end();
    }

    // ── Fichiers statiques du dashboard ──────────────────────
    if (pathname === '/' || pathname === '/dashboard') {
        const htmlPath = path.join(DASH_DIR, 'index.html');
        if (fs.existsSync(htmlPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.readFileSync(htmlPath));
        }
        res.writeHead(302, { Location: '/api/status' });
        return res.end();
    }

    // ── API publique ──────────────────────────────────────────
    if (pathname === '/api/status') {
        const connected = [...sessions.values()].filter(s => s.connection === 'open').length;
        return sendJson(res, {
            status: 'online',
            bot: process.env.BOT_NAME || 'WhatsApp Bot',
            sessions: sessions.size,
            connected,
        });
    }

    // ── Auth ──────────────────────────────────────────────────
    if (!checkToken(req)) return sendJson(res, { error: 'Non autorisé' }, 401);

    // ── GET /api/events — SSE temps réel ──────────────────────
    if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        // Envoyer l'état complet en premier
        res.write(`event: init\ndata: ${JSON.stringify({
            sessions: [...sessions.values()].map(sessionSummary),
        })}\n\n`);
        // Heartbeat toutes les 20s pour maintenir la connexion
        const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); } }, 20000);
        sseClients.add(res);
        req.on('close', () => { sseClients.delete(res); clearInterval(hb); });
        return;
    }

    // ── GET /api/info — infos globales ────────────────────────
    if (pathname === '/api/info' && req.method === 'GET') {
        const uptime     = Math.floor((Date.now() - startTime) / 1000);
        const statsFile  = path.join(__dirname, '../data/stats/stats.json');
        let statsData    = {};
        try { statsData = JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch {}

        const totalCommands = Object.values(statsData).reduce((s, u) => s + (u.total || 0), 0);
        const topCommands   = {};
        Object.values(statsData).forEach(u => {
            Object.entries(u.commands || {}).forEach(([cmd, n]) => { topCommands[cmd] = (topCommands[cmd] || 0) + n; });
        });
        const topCmdSorted = Object.entries(topCommands).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([cmd, count]) => ({ cmd, count }));

        const allRecent = [...sessions.values()].flatMap(s => s.recentCommands)
            .sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 30);

        return sendJson(res, {
            uptime,
            uptimeHuman:   `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`,
            totalUsers:    Object.keys(statsData).length,
            totalCommands,
            topCommands:   topCmdSorted,
            recentCommands: allRecent,
            botName:       process.env.BOT_NAME || 'WhatsApp Bot',
            node:          process.version,
            memory:        Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            sessions:      [...sessions.values()].map(sessionSummary),
        });
    }

    // ── GET /api/sessions — liste des sessions ─────────────────
    if (pathname === '/api/sessions' && req.method === 'GET') {
        return sendJson(res, { sessions: [...sessions.values()].map(sessionSummary) });
    }

    // ── POST /api/sessions — créer une nouvelle session ────────
    if (pathname === '/api/sessions' && req.method === 'POST') {
        const body      = await readBody(req);
        const sessionId = body.id || genSessionId();
        const name      = body.name || `Session ${sessions.size + 1}`;
        if (sessions.has(sessionId)) return sendJson(res, { error: 'Session déjà existante' }, 409);
        await startSession(sessionId, name).catch(console.error);
        return sendJson(res, { ok: true, sessionId, name });
    }

    // ── Routes par session /api/sessions/:id/... ─────────────
    const sessPathMatch = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(.+))?$/);
    if (sessPathMatch) {
        const sessionId  = sessPathMatch[1];
        const subPath    = sessPathMatch[2] || '';
        const ss         = sessions.get(sessionId);

        // DELETE /api/sessions/:id — supprimer une session
        if (!subPath && req.method === 'DELETE') {
            if (!ss) return sendJson(res, { error: 'Session introuvable' }, 404);
            try { await ss.sock?.logout(); } catch {}
            if (ss._pingTimer) clearInterval(ss._pingTimer);
            fse.removeSync(path.join(SESSIONS_DIR, sessionId));
            sessions.delete(sessionId);
            return sendJson(res, { ok: true, message: 'Session supprimée.' });
        }

        // POST /api/sessions/:id/restart
        if (subPath === 'restart' && req.method === 'POST') {
            if (!ss) return sendJson(res, { error: 'Session introuvable' }, 404);
            const name = ss.name;
            if (ss._pingTimer) clearInterval(ss._pingTimer);
            try { await ss.sock?.end(); } catch {}
            sessions.delete(sessionId);
            setTimeout(() => startSession(sessionId, name).catch(console.error), 1500);
            return sendJson(res, { ok: true, message: 'Reconnexion en cours...' });
        }

        // POST /api/sessions/:id/logout — déconnecter sans supprimer
        if (subPath === 'logout' && req.method === 'POST') {
            if (!ss) return sendJson(res, { error: 'Session introuvable' }, 404);
            try { await ss.sock?.logout(); } catch {}
            if (ss._pingTimer) clearInterval(ss._pingTimer);
            fse.removeSync(path.join(SESSIONS_DIR, sessionId, 'auth'));
            ss.connection = 'close'; ss.owner = null; ss.qrCode = null;
            saveConfig(sessionId, { name: ss.name, prefix: ss.prefix });
            // Relancer pour obtenir un nouveau QR
            setTimeout(() => startSession(sessionId, ss.name).catch(console.error), 1500);
            return sendJson(res, { ok: true, message: 'Déconnecté. Nouveau QR en cours...' });
        }

        // POST /api/sessions/:id/send — envoyer un message
        if (subPath === 'send' && req.method === 'POST') {
            if (!ss || ss.connection !== 'open') return sendJson(res, { error: 'Session non connectée' }, 503);
            const body = await readBody(req);
            if (!body.to || !body.text) return sendJson(res, { error: 'to et text requis' }, 400);
            const jid = body.to.replace(/\D/g, '') + '@s.whatsapp.net';
            try {
                await ss.sock.sendMessage(jid, { text: body.text });
                return sendJson(res, { ok: true });
            } catch (e) {
                return sendJson(res, { error: e.message }, 500);
            }
        }

        // GET /api/sessions/:id — état d'une session
        if (!subPath && req.method === 'GET') {
            if (!ss) return sendJson(res, { error: 'Session introuvable' }, 404);
            return sendJson(res, sessionSummary(ss));
        }
    }

    // ── GET /api/stats ────────────────────────────────────────
    if (pathname === '/api/stats' && req.method === 'GET') {
        const statsFile = path.join(__dirname, '../data/stats/stats.json');
        let statsData = {};
        try { statsData = JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch {}
        const users = Object.entries(statsData)
            .map(([num, d]) => ({ number: num, total: d.total, lastSeen: d.lastSeen, topCmd: Object.entries(d.commands||{}).sort((a,b)=>b[1]-a[1])[0]?.[0] }))
            .sort((a, b) => b.total - a.total).slice(0, 50);
        return sendJson(res, { users });
    }

    sendJson(res, { error: 'Route inconnue' }, 404);

}).listen(PORT, () => {
    console.log(`\n🌐 Dashboard disponible sur : http://localhost:${PORT}/?token=${DASH_TOKEN}\n`);

    // Auto-ping HTTP (anti-sleep Render)
    setInterval(async () => {
        const url = process.env.RENDER_EXTERNAL_URL
                 || (process.env.RENDER_SERVICE_NAME ? `https://${process.env.RENDER_SERVICE_NAME}.onrender.com` : null);
        if (url) { try { await axios.get(url); } catch {} }
    }, 2 * 60 * 1000);
});

// Lancement
init().catch(console.error);