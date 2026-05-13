/**
 * @file        index.js
 * @description Multi-sessions WhatsApp Bot — Dashboard intégré, sans .env obligatoire
 */

import http from 'http';
import axios from 'axios';
import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import os from 'os';
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

// ══════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLERS — Évite que le process crash sur les 
// exceptions non catchées de Baileys (Connection Closed, etc)
// ══════════════════════════════════════════════════════════════
process.on('uncaughtException', (err) => {
    console.error('❌ [Process] Uncaught Exception:', err.message);
    if (err.message.includes('Connection Closed') || err.message.includes('Precondition Required')) {
        console.error('   → Baileys connection error (expected during reconnect)');
        // Don't crash, let watchdog handle reconnection
    } else {
        console.error('   → Stack:', err.stack);
    }
});

// Throttle pour éviter de spammer la console sur les erreurs de reconnexion
let _lastIgnoredRejectionLogAt = 0;
const _IGNORED_REJECTION_LOG_COOLDOWN_MS = 10_000;

function rejectionToString(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return `${err.message || ''}\n${err.stack || ''}`;
    if (typeof err === 'object') {
        const msg = err?.message || err?.reason || '';
        const stack = err?.stack || '';
        return `${msg}\n${stack}`;
    }
    return String(err);
}

function isExpectedConnectionCloseRejection(err) {
    // Baileys/WS peuvent remonter sous formes diverses (Error, string, Boom, {cause}, etc.)
    const combined = rejectionToString(err);
    if (!combined) return false;

    // Français + Anglais + cas fréquents
    const needles = [
        'Connexion Fermée',
        'Connection Closed',
        'close',
        'WebSocket was closed',
        'socket hang up',
        'ECONNRESET',
        'EPIPE',
    ];

    if (needles.some(n => combined.includes(n))) return true;

    // Explorer récursivement cause/originalError si présent
    const cause = err?.cause || err?.originalError || err?.error;
    if (cause && cause !== err) return isExpectedConnectionCloseRejection(cause);
    return false;
}

process.on('unhandledRejection', (err) => {
    if (isExpectedConnectionCloseRejection(err)) {
        const now = Date.now();
        if (now - _lastIgnoredRejectionLogAt > _IGNORED_REJECTION_LOG_COOLDOWN_MS) {
            _lastIgnoredRejectionLogAt = now;
            console.warn('[Baileys] Connexion fermée (reconnexion attendue)');
        }
        return;
    }

    console.error('❌ [Processus] Rejet Non Manipulé:', err?.message || err);
    if (err && err.stack) console.error(err.stack);
});

process.on('warning', (w) => {
    if (!w.message.includes('ExperimentalWarning')) {
        console.warn('⚠️  [Process] Warning:', w.message);
    }
});

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
// SESSIONS_ROOT utilise /tmp pour ne rien persister sur le disque — tout va sur MongoDB
const SESSIONS_ROOT = path.join(os.tmpdir(), 'wa-bot-sessions');
const DATA_ROOT     = path.join(__dirname, '../data');
const DASH_DIR      = path.join(__dirname, '../dashboard');
const PREFIX        = process.env.PREFIX || '!';
const PORT          = parseInt(process.env.PORT || '3000');
const BIND_HOST     = process.env.BIND_HOST || '0.0.0.0';
const startTime     = Date.now();

fse.ensureDirSync(SESSIONS_ROOT);

// Forcer le mode public au démarrage si botmode.json absent ou corrompu
// (le filesystem Railway est éphémère — botmode.json est perdu au redéploiement)
try {
    const botmodeFile = path.join(__dirname, '../data/botmode.json');
    if (!fs.existsSync(botmodeFile)) {
        fse.ensureDirSync(path.dirname(botmodeFile));
        fs.writeFileSync(botmodeFile, JSON.stringify({ mode: 'public' }, null, 2));
        console.log('[Boot] botmode.json absent — mode public par défaut');
    }
} catch {}
fse.ensureDirSync(DATA_ROOT);
['stats','notes','banned'].forEach(d => fse.ensureDirSync(path.join(DATA_ROOT, d)));

// État global partagé avec les commandes
if (!global.noTagGroups)  global.noTagGroups  = new Set();
if (!global.mutedMembers) global.mutedMembers  = new Set();
if (!global.botMessages)  global.botMessages   = new Map();

// ══════════════════════════════════════════════════════════════
// NETTOYAGE TEMP SESSIONS — Tout va sur MongoDB, rien ne persiste
// ══════════════════════════════════════════════════════════════
function cleanupTempSessions() {
    try {
        if (fs.existsSync(SESSIONS_ROOT)) {
            fse.removeSync(SESSIONS_ROOT);
            console.log('[Cleanup] 🗑️ Dossier TEMP des sessions supprimé');
        }
    } catch (e) {
        console.warn('[Cleanup] ⚠️  Erreur suppression TEMP:', e.message);
    }
}

// Nettoyer le TEMP au démarrage (ne garder que ce qui est en MongoDB)
cleanupTempSessions();

// Et aussi à l'arrêt gracieux
async function gracefulShutdown(signal) {
    console.log(`[Process] 🛑 ${signal} reçu — arrêt gracieux...`);
    // Attendre que toutes les sauvegardes MongoDB en cours finissent (max 8s)
    // avant de supprimer /tmp — sinon les creds mis à jour sont perdus
    try {
        console.log('[Process] ⏳ Flush des sauvegardes en cours...');
        await Promise.race([
            flushAllPendingSaves(),
            new Promise(r => setTimeout(r, 8000))
        ]);
    } catch {}
    cleanupTempSessions();
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ══════════════════════════════════════════════════════════════
// DÉDUPLICATION GLOBALE — empêche de traiter deux fois le même message
// Clé : msg.key.id (identifiant unique Baileys)
// ══════════════════════════════════════════════════════════════
// DÉDUPLICATION MESSAGES — Map avec TTL par message (10 min)
// Évite le clear() global qui causait des doubles réponses
// ══════════════════════════════════════════════════════════════
const processedMsgIds = new Map(); // msgId → timestamp
const MSG_TTL = 10 * 60 * 1000;   // 10 minutes par message

// Nettoyage ciblé : seuls les messages expirés sont supprimés
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of processedMsgIds) {
        if (now - ts > MSG_TTL) processedMsgIds.delete(id);
    }
}, 60 * 1000); // check toutes les minutes

// Filtre anti-logs Baileys
const NOISE = ['Bad MAC','Session error','Failed to decrypt','libsignal',
    'MessageCounterError','Closing open session','Closing session:',
    'registrationId','_chains','currentRatchet','indexInfo',
    'ephemeralKeyPair','SessionEntry','chainKey','chainType',
    'rootKey','baseKey','RemoteIdentity'];
const _sw = process.stderr.write.bind(process.stderr);
process.stderr.write = (d, ...a) => { const s=d.toString(); if(NOISE.some(n=>s.includes(n))) return true; return _sw(d,...a); };
const _ce = console.error.bind(console);
console.error = (...a) => { const s=a.join(' '); if(NOISE.some(n=>s.includes(n))) return; _ce(...a); };

import { handleCommand } from './handler.js';
import { trackMessage as trackGroupMsg } from './utils/groupstats.js';
import { getBotMode } from './commands/security.js';
import { connectMongo, saveSessionMongo, restoreAllSessions, deleteSessionMongo, scheduleSave, getMongoDb, flushAllPendingSaves } from './utils/mongostore.js';
import { buildOwnerId, tryAcquireLock, startLockHeartbeat, releaseLock } from './utils/instancelock.js';

// Sessions Map + logs circulaires
const sessions = new Map();
global.sessions = sessions; // exposé pour que les commandes accèdent aux sockets de toutes les sessions
const logs = [];

// ══════════════════════════════════════════════════════════════
// GARDE-FOUS RUNTIME — éviter les multi-sockets / reconnect storms
// ══════════════════════════════════════════════════════════════
// 1) Un seul socket actif par "numéro connecté".
// 2) Un seul timer de reconnexion par sessionId.
const activeSocketByNumber = new Map(); // number -> { sessionId, sock }
const reconnectTimerBySessionId = new Map(); // sessionId -> timeout

// Backoff par session pour éviter les storms (408/440)
const reconnectBackoffBySessionId = new Map(); // sessionId -> { delayMs }

// 440 counter (si ça persiste: pause longue)
const recent440BySessionId = new Map(); // sessionId -> { count, firstAt }

function note440(sessionId) {
    const windowMs = 2 * 60 * 1000; // 2 minutes
    const now = Date.now();
    const e = recent440BySessionId.get(sessionId) || { count: 0, firstAt: now };
    if (now - e.firstAt > windowMs) {
        e.count = 0;
        e.firstAt = now;
    }
    e.count++;
    recent440BySessionId.set(sessionId, e);
    return e;
}

function getCooldownAfterRepeated440Ms(sessionId) {
    const e = recent440BySessionId.get(sessionId);
    if (!e) return 0;
    // 3 fois en 2 min => cooldown 5 min
    if (e.count >= 3) return 5 * 60 * 1000;
    return 0;
}

function getNextBackoffMs(sessionId, reasonCode) {
    // Base : 3s. En cas de 440/408, on augmente jusqu'à 60s.
    const base = 3000;
    const max = 60_000;
    const entry = reconnectBackoffBySessionId.get(sessionId) || { delayMs: base };

    if (reasonCode === 440 || reasonCode === 408) {
        entry.delayMs = Math.min(max, Math.max(base, entry.delayMs * 2));
    } else {
        entry.delayMs = base;
    }

    reconnectBackoffBySessionId.set(sessionId, entry);
    return entry.delayMs;
}

function clearReconnectTimer(sessionId) {
    const t = reconnectTimerBySessionId.get(sessionId);
    if (t) {
        clearTimeout(t);
        reconnectTimerBySessionId.delete(sessionId);
    }
}

function scheduleReconnect(sessionId, delayMs = 3000) {
    clearReconnectTimer(sessionId);
    const t = setTimeout(() => {
        reconnectTimerBySessionId.delete(sessionId);
        startSession(sessionId);
    }, delayMs);
    reconnectTimerBySessionId.set(sessionId, t);
}

function ensureSingleActiveSocketForNumber(number, currentSessionId, currentSock) {
    if (!number) return;
    const prev = activeSocketByNumber.get(number);
    if (prev && prev.sock && prev.sock !== currentSock) {
        addLog('warn', `[${currentSessionId}] Un autre socket est déjà actif pour ${number} — fermeture de l'ancien (${prev.sessionId})`);
        try { prev.sock.ws?.close(); } catch {}
        try { prev.sock.end(); } catch {}
    }
    activeSocketByNumber.set(number, { sessionId: currentSessionId, sock: currentSock });
}

function addLog(level, msg) {
    const entry = { level, msg, time: new Date().toISOString() };
    logs.push(entry);
    if (logs.length > 200) logs.shift();
    const icon = { error:'❌', warn:'⚠️', success:'✅', info:'ℹ️' }[level] || 'ℹ️';
    console.log(`[${entry.time.slice(11,19)}] ${icon} ${msg}`);
}

// AutoSaveViewOnce
async function autoSaveViewOnce(sock, msg, OWNER, ctx) {
    if (!OWNER) return;
    const ownerJid = OWNER + '@s.whatsapp.net';
    let inner = msg.message?.viewOnceMessage?.message
             || msg.message?.viewOnceMessageV2?.message
             || msg.message?.viewOnceMessageV2Extension?.message;
    if (!inner) {
        const ct2 = getContentType(msg.message);
        if (ct2 && /^(image|video|audio)Message$/.test(ct2) && msg.message[ct2]?.viewOnce === true) inner = msg.message;
    }
    if (!inner) return;
    const type = getContentType(inner);
    if (!type || !/^(image|video|audio)Message$/.test(type)) return;
    const obj  = inner[type];
    const kind = type.replace('Message','');
    try {
        const stream = await downloadContentFromMessage(obj, kind);
        let buf = Buffer.from([]);
        for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
        const cap = `*Vue unique interceptée*\nDe: @${ctx.senderNumber}\n${obj?.caption?'Légende: '+obj.caption:''}`;
        if (kind==='image') await sock.sendMessage(ownerJid, { image:buf, caption:cap }, { mentions:[ctx.senderJid] });
        else if (kind==='video') await sock.sendMessage(ownerJid, { video:buf, caption:cap }, { mentions:[ctx.senderJid] });
        else { await sock.sendMessage(ownerJid, { text:cap }); await sock.sendMessage(ownerJid, { audio:buf, mimetype:'audio/mp4', ptt:false }); }
    } catch(e) { addLog('error', 'AutoVO: '+e.message); }
}

// Démarrer une session
// phoneNumber optionnel → active le pairing code au lieu du QR
async function startSession(sessionId, phoneNumber = null) {
    const existing = sessions.get(sessionId);
    if (existing && (existing.connection === 'open' || existing.connection === 'connecting')) { 
        addLog('warn',`Session ${sessionId} ignorée : ${existing.connection}`); 
        return; 
    }

    // Si une reconnexion est en file d'attente pour cette session, on la remplace par cet appel
    clearReconnectTimer(sessionId);

    const authPath = path.join(SESSIONS_ROOT, sessionId);
    fse.ensureDirSync(authPath); // ← crée le dossier AVANT useMultiFileAuthState

    let state = sessions.get(sessionId);
    if (!state) {
        state = {
            id: sessionId, connection: 'connecting', qrCode: null, pairingCode: null,
            connectedNumber: null, sock: null, pingInterval: null, healthCheckInterval: null,
            commandsCount: 0, messagesCount: 0, recentCommands: [],
            lastPing: null, createdAt: new Date().toISOString(),
            authPath, // ← on stocke le chemin courant dans le state
        };
        sessions.set(sessionId, state);
    }
    state.connection = 'connecting';
    state.qrCode = null;
    state.pairingCode = null;
    state.authPath = authPath;
    addLog('info', `Démarrage session [${sessionId}]${phoneNumber ? ' (pairing: '+phoneNumber+')' : ''}...`);

    const { state: auth, saveCreds: _saveCreds } = await useMultiFileAuthState(authPath);

    // ── FIX ENOENT : on s'assure que le dossier existe avant chaque écriture ──
    // Après un renommage de session, authPath peut changer → on lit state.authPath
    const saveCreds = async () => {
        try { fse.ensureDirSync(state.authPath); } catch {}
        return _saveCreds();
    };

    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
        version, logger, printQRInTerminal: false,
        auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
        browser: ['Ubuntu','Chrome','20.0.0'],
        syncFullHistory: false, markOnlineOnConnect: true,
        connectTimeoutMs: 60000, defaultQueryTimeoutMs: 0,
        retryRequestDelayMs: 2000, maxMsgRetryCount: 2, keepAliveIntervalMs: 25000,
    });

    state.sock = sock;

    // ── SAFE EVENT WRAPPER — capture les erreurs non catchées dans les handlers ──
    function wrapHandler(name, handler) {
        return async (...args) => {
            try {
                return await handler(...args);
            } catch (err) {
                if (err.message.includes('Connection Closed') || err.message.includes('Precondition Required')) {
                    // Erreur réseau courante, log silencieux
                    console.error(`[${name}] Connection error (expected):`, err.message);
                } else {
                    console.error(`[${name}] Unhandled error:`, err.message);
                    console.error(err.stack);
                }
            }
        };
    }

    // ── Sauvegarde sur disque d'abord, PUIS MongoDB + SESSION_STRING ──
    sock.ev.on('creds.update', wrapHandler('creds.update', async () => {
        await saveCreds(); // Attendre que l'écriture sur le disque local soit terminée
        
        // ── Sauvegarde synchrone/immédiate forcée ──
        saveSessionMongo(state.id, state.connectedNumber || state.id, state.authPath).catch(() => {});

        // Sauvegarde MongoDB avec debounce
        scheduleSave(state.id, state.connectedNumber || state.id, state.authPath);
        
        // Mettre à jour la SESSION_STRING en mémoire
        try {
            const aPath = state.authPath;
            const files = fs.readdirSync(aPath).filter(f => f.endsWith('.json'));
            const sessionData = {};
            files.forEach(f => { sessionData[f] = fs.readFileSync(path.join(aPath,f),'utf-8'); });
            state.sessionString = Buffer.from(JSON.stringify(sessionData)).toString('base64');
        } catch {}
    }));

    // ── Pairing code : demander le code après connexion WS
    if (phoneNumber && !auth.creds.registered) {
        setTimeout(async () => {
            try {
                const num = phoneNumber.replace(/\D/g, '');
                const code = await sock.requestPairingCode(num);
                state.pairingCode = code;
                addLog('success', `[${sessionId}] Pairing code: ${code}`);
            } catch (e) {
                addLog('error', `[${sessionId}] Erreur pairing code: ${e.message}`);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && !phoneNumber) {
            state.qrCode = qr;
            state.connection = 'connecting';
            qrcodeterminal.generate(qr, { small: true });
            addLog('info', `[${sessionId}] QR prêt — scannez avec WhatsApp`);
        }

        if (connection === 'open') {
            const num = sock.user?.id?.split(':')[0] || sock.user?.id || sessionId;
            // Stocker aussi le LID du bot (format @lid utilisé par WhatsApp Business)
            // pour que isOwner fonctionne même avec les JIDs LID
            state.ownerLid = sock.user?.lid?.split('@')[0] || null;
            state.connection = 'open';
            state.qrCode = null;
            state.pairingCode = null;
            state.connectedNumber = num;
            state.lastActivity    = Date.now();
            state.lastConnectedAt = Date.now(); // pour la reconnexion périodique

            // Reset backoff sur connexion OK
            reconnectBackoffBySessionId.set(state.id, { delayMs: 3000 });

            // Anti multi-socket (souvent la cause des 440 / "session remplacée")
            ensureSingleActiveSocketForNumber(num, state.id, sock);

            // Renommer la session avec le numéro réel si différent
            if (sessionId !== num && !sessions.has(num)) {
                sessions.set(num, state);
                sessions.delete(sessionId);
                state.id = num;
                const newPath = path.join(SESSIONS_ROOT, num);
                try {
                    fse.ensureDirSync(newPath);
                    if (authPath !== newPath) fse.copySync(authPath, newPath, { overwrite: true });
                    state.authPath = newPath;
                } catch (e) { addLog('warn', `Renommage session: ${e.message}`); }

                addLog('success', `Session renommée [${sessionId}] → [${num}]`);

                // ── Relancer proprement pour rebrancher tous les handlers ──
                // Le messages.upsert actuel est lié à l'ancien sessionId/socket.
                // On ferme et on repart proprement sur le bon numéro.
                addLog('info', `[${num}] Redémarrage automatique des handlers...`);
                try { sock.end(); } catch {}
                setTimeout(() => {
                    try { if (authPath !== newPath) fse.removeSync(authPath); } catch {}
                    startSession(num);
                }, 1500);
                return; // stop — ce socket est mort, le nouveau prendra le relais
            }

            addLog('success', `[${state.id}]  Connecté — Numéro: ${num} | Préfixe: ${PREFIX}`);

            // SESSION_STRING — affichée complète pour copier dans Railway env vars
            try {
                const aPath = state.authPath;
                const files = fs.readdirSync(aPath).filter(f => f.endsWith('.json'));
                const sessionData = {};
                files.forEach(f => { sessionData[f] = fs.readFileSync(path.join(aPath,f),'utf-8'); });
                const sStr = Buffer.from(JSON.stringify(sessionData)).toString('base64');
                // Par défaut on NE log PAS la SESSION_STRING complète (énorme + sensible).
                // Pour debug volontaire : DEBUG_SESSION_STRING=1
                if (process.env.DEBUG_SESSION_STRING === '1') {
                    console.log(`\n========== SESSION_STRING [${state.id}] ==========\n${sStr}\n==================================================\n`);
                    addLog('info', `[${state.id}] SESSION_STRING loggée (DEBUG_SESSION_STRING=1)`);
                } else {
                    addLog('info', `[${state.id}] SESSION_STRING prête (masquée) — active DEBUG_SESSION_STRING=1 pour l'afficher`);
                }
                state.sessionString = sStr; // stocké dans le state pour l'API
            } catch {}

            // ── MONGODB — sauvegarde immédiate après connexion ──
            try { await saveSessionMongo(state.id, num, state.authPath); } catch(e) { addLog('warn', `[MongoDB] saveSession: ${e.message}`); }

            if (state.pingInterval) clearInterval(state.pingInterval);
            // Ping toutes les 30 secondes — maintient la connexion sans surcharger le socket
            state.pingInterval = setInterval(async () => {
                try { await sock.sendPresenceUpdate('available'); state.lastPing = new Date().toISOString(); } catch {}
            }, 30_000);

            // ── HEALTH CHECK TOUTES LES 5 MIN — force reconnexion si inactif longtemps ──
            if (state.healthCheckInterval) clearInterval(state.healthCheckInterval);
            // FIX: healthCheck simplifié — le watchdog gère déjà la détection socket mort.
            // On ne ferme plus la connexion ici pour éviter les doubles reconnexions.
            state.healthCheckInterval = setInterval(async () => {
                const wsState = sock.ws?.readyState;
                // readyState: 0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED
                if (wsState === 3) {
                    // Socket définitivement fermé sans que connection.update ne soit émis
                    addLog('warn', `[${state.id}] Health check: socket CLOSED sans événement — reconnexion`);
                    state.connection = 'close';
                    scheduleReconnect(state.id, 3000);
                }
                // Sinon : le watchdog s'en occupe via le ping toutes les 60s
            }, 2 * 60 * 1000); // check toutes les 2 minutes
        }

        if (connection === 'close') {
            state.connection = 'close';
            if (state.pingInterval) { clearInterval(state.pingInterval); state.pingInterval = null; }
            if (state.healthCheckInterval) { clearInterval(state.healthCheckInterval); state.healthCheckInterval = null; }
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            addLog('warn', `[${state.id}] Déconnecté (code: ${code})`);

            // Nettoyer le mapping number->socket si c'est ce socket
            try {
                const n = state.connectedNumber;
                const prev = n ? activeSocketByNumber.get(n) : null;
                if (prev?.sock === sock) activeSocketByNumber.delete(n);
            } catch {}

            if (code === DisconnectReason.loggedOut) {
                // FIX: WhatsApp envoie loggedOut (401) après rotation de clés ou reconnexion serveur.
                // On tente une reconnexion — si la session est vraiment révoquée, le QR/pairing
                // sera affiché dans le dashboard. On ne tue plus le bot définitivement.
                addLog('warn', `[${state.id}] Session loggedOut (401) — tentative de reconnexion dans 10s`);
                // Nettoyer les fichiers temp pour forcer un nouveau QR si les creds sont invalides
                try { fse.removeSync(path.join(SESSIONS_ROOT, state.id)); } catch {}
                scheduleReconnect(state.id, 10000);
            } else {
                // Anti-loop: si 440 se répète, appliquer un cooldown long
                let extraCooldown = 0;
                if (code === 440) {
                    const stat = note440(state.id);
                    extraCooldown = getCooldownAfterRepeated440Ms(state.id);
                    if (extraCooldown > 0) {
                        addLog('warn', `[${state.id}] 440 répété (${stat.count}x) — pause ${Math.round(extraCooldown/60000)}min pour éviter le storm`);
                    }
                }

                const delay = Math.max(getNextBackoffMs(state.id, code), extraCooldown);
                addLog('info', `[${state.id}] Reconnexion dans ${Math.round(delay/1000)}s...`);
                scheduleReconnect(state.id, delay);
            }
        }
    });

    sock.ev.on('messages.upsert', wrapHandler('messages.upsert', async ({ messages, type }) => {
        // ── FIX DOUBLE RÉPONSE #1 : ignorer tout sauf les vrais nouveaux messages ──
        // 'notify' = message reçu en temps réel
        // 'append' = sync historique (au démarrage) → NE PAS traiter
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

            // ── Mise à jour activité (anti-zombie watchdog) ──
            state.lastActivity = Date.now();

            // ── FIX DOUBLE RÉPONSE #2 : déduplication par ID de message ──
            // Plusieurs sessions ou événements Baileys peuvent rejouer le même message
            const msgId = msg.key.id;
            if (!msgId || processedMsgIds.has(msgId)) continue;
            processedMsgIds.set(msgId, Date.now());

            state.messagesCount++;
            try {
                const rawJid  = msg.key.remoteJid;
                const fromMe  = msg.key.fromMe;
                const isGroup = rawJid.endsWith('@g.us');
                const isLid   = rawJid.endsWith('@lid');
                // OWNER = numéro du compte connecté, chargé depuis sock.user.id à connection='open'
                const OWNER = (state.connectedNumber || '').replace(/\D/g, '');
                if (!OWNER) continue; // session pas encore pleinement connectée
                const from  = isGroup ? rawJid : ((isLid||fromMe) ? OWNER+'@s.whatsapp.net' : rawJid);

                let senderJid, senderNumber;
                // strip device suffix (:15) avant extraction du numéro
                // ex: 237691234567:15@s.whatsapp.net → 237691234567
                const stripSuffix = jid => (jid||'').replace(/:[0-9]+@/, '@').split('@')[0].replace(/\D/g,'');

                if (isGroup) {
                    senderJid    = msg.key.participant || '';
                    // Dans les groupes, participant peut être @lid (LID WhatsApp)
                    // ou @s.whatsapp.net (numéro normal)
                    const isParticipantLid = senderJid.endsWith('@lid');
                    if (isParticipantLid) {
                        // LID → on garde le JID brut pour comparaison directe avec ownerLid
                        senderNumber = senderJid.split('@')[0];
                    } else {
                        senderNumber = stripSuffix(senderJid);
                    }
                } else {
                    senderNumber = fromMe ? OWNER : stripSuffix(rawJid);
                    senderJid    = senderNumber + '@s.whatsapp.net';
                }

                // isOwner : fromMe OU numéro normal OU LID direct
                // FIX LID: dans les groupes, comparer le JID LID du participant
                // directement au LID du owner stocké à connection='open'
                const normalize = n => (n || '').replace(/\D/g, '').replace(/^0+/, '');
                const OWNER_LID = state.ownerLid || null;
                const senderRawLid = senderJid.endsWith('@lid') ? senderJid.split('@')[0] : null;

                const isOwner = fromMe
                    || (OWNER && normalize(senderNumber) === normalize(OWNER))
                    || (OWNER_LID && senderRawLid && senderRawLid === OWNER_LID)
                    || (OWNER_LID && normalize(senderNumber) === normalize(OWNER_LID));

                const ct = getContentType(msg.message);
                let body = '';
                if (ct==='conversation') body=msg.message.conversation||'';
                else if (ct==='extendedTextMessage') body=msg.message.extendedTextMessage?.text||'';
                else if (ct==='imageMessage') body=msg.message.imageMessage?.caption||'';
                else if (ct==='videoMessage') body=msg.message.videoMessage?.caption||'';

                const isViewOnce = !fromMe && (
                    /^viewOnceMessage/.test(ct) || msg.message?.imageMessage?.viewOnce===true ||
                    msg.message?.videoMessage?.viewOnce===true || msg.message?.audioMessage?.viewOnce===true
                );
                if (isViewOnce) autoSaveViewOnce(sock, msg, OWNER, { senderNumber, senderJid, isGroup, rawJid }).catch(()=>{});

                const isCmd = body.startsWith(PREFIX);
                if (fromMe && !isCmd) continue;
                if (isGroup) trackGroupMsg(from, senderJid);

                if (isCmd) {
                    const cmd = body.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase()||'';
                    state.commandsCount++;
                    state.recentCommands.push({ cmd, user: senderNumber, time: new Date().toISOString() });
                    if (state.recentCommands.length > 50) state.recentCommands.shift();
                    addLog('info', `[${state.id}] CMD !${cmd} par ${senderNumber}`);
                }

                // ── Mode privé : bloquer les non-owners ──────────────────
                const currentBotMode = getBotMode();
                if (isCmd && currentBotMode === 'private') {
                    // isOwner = fromMe || senderNumber === OWNER
                    // On bloque uniquement si ce n'est PAS l'owner
                    if (!isOwner) {
                        const cmdCheck = body.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase() || '';
                        if (!['public', 'botmode'].includes(cmdCheck)) {
                            await sock.sendMessage(from, {
                                text: `🔴 *Bot en mode privé*\nSeul l'administrateur peut utiliser le bot pour le moment.`,
                            });
                            continue;
                        }
                    }
                }

                // ── Anti-mute : supprimer messages des mutés ─────────────
                if (isGroup && global.mutedMembers?.has(`${from}__${senderJid}`) && !isOwner) {
                    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
                    continue;
                }

                // FIX: n'appeler handleCommand que si c'est une commande
                if (!isCmd) continue;

                await handleCommand(sock, msg, {}, {
                    body, from, isGroup, isOwner, senderNumber, sender: senderJid,
                    noTagGroups: global.noTagGroups,
                    botMode: currentBotMode,
                    prefix: PREFIX,
                    owner: OWNER,
                    ownerLid: state.ownerLid || null,
                    onCommand: (cmd, user) => {
                        if (typeof global.__trackDashboardCommand === 'function')
                            global.__trackDashboardCommand(cmd, user);
                    },
                });
            } catch(err) { addLog('error', `[${state.id}] ${err.message}`); }
        }
    }));
}

// ══════════════════════════════════════════════════════════════
// SESSION_STRING — Restauration depuis variable d'environnement
// Permet de survivre aux redéploiements sans volume persistant
// Usage Railway : coller la SESSION_STRING dans les variables d'env
// Format : SESSION_STRING=<base64> ou SESSION_STRING_<NUM>=<base64>
// ══════════════════════════════════════════════════════════════
function restoreFromEnvSessionString() {
    // Cherche SESSION_STRING, SESSION_STRING_1, SESSION_STRING_2, ...
    const vars = Object.entries(process.env)
        .filter(([k]) => k === 'SESSION_STRING' || /^SESSION_STRING_\d+$/.test(k))
        .sort(([a], [b]) => a.localeCompare(b));

    if (vars.length === 0) return;

    addLog('info', `[ENV] ${vars.length} SESSION_STRING trouvée(s) — restauration...`);

    for (const [envKey, b64] of vars) {
        try {
            const sessionData = JSON.parse(Buffer.from(b64.trim(), 'base64').toString('utf-8'));
            // Déduire l'ID depuis creds.json si possible
            let sessionId = 'env_session';
            try {
                const creds = JSON.parse(sessionData['creds.json'] || '{}');
                const num = creds?.me?.id?.split(':')[0] || creds?.me?.id;
                if (num) sessionId = num;
            } catch {}
            // Si plusieurs SESSION_STRING, distinguer par suffixe
            if (vars.length > 1) {
                const suffix = envKey.replace('SESSION_STRING', '').replace('_', '');
                if (suffix && sessionId === 'env_session') sessionId = `env_session_${suffix}`;
            }

            const authPath = path.join(SESSIONS_ROOT, sessionId);
            // Ne pas écraser une session déjà présente sur le disque
            if (fs.existsSync(path.join(authPath, 'creds.json'))) {
                addLog('info', `[ENV] Session [${sessionId}] déjà sur disque — skip`);
                continue;
            }
            fse.ensureDirSync(authPath);
            for (const [filename, content] of Object.entries(sessionData)) {
                fs.writeFileSync(path.join(authPath, filename), content, 'utf-8');
            }
            addLog('success', `[ENV] Session [${sessionId}] restaurée depuis ${envKey}`);
        } catch (e) {
            addLog('warn', `[ENV] Erreur restauration ${envKey}: ${e.message}`);
        }
    }
}

// ══════════════════════════════════════════════════════════════
// WATCHDOG — détection socket mort uniquement
// FIX: FORCE_RECONNECT_INTERVAL supprimé — déclenchait des reconnexions toutes les 4h
// qui pouvaient aboutir à un loggedOut (401) sans retour.
// FIX: ZOMBIE_TIMEOUT supprimé — un bot peu actif n'est pas mort.
const WATCHDOG_INTERVAL = 60 * 1000; // check toutes les 60s

setInterval(async () => {
    const now = Date.now();
    for (const [id, state] of sessions) {
        if (state.connection !== 'open' || !state.sock) continue;

        // Vérifier que le WebSocket est vraiment ouvert (readyState 1 = OPEN)
        const wsState = state.sock.ws?.readyState;
        if (wsState !== undefined && wsState !== 1) {
            addLog('warn', `[Watchdog] [${id}] WebSocket fermé (readyState=${wsState}) — reconnexion`);
            if (state.pingInterval) { clearInterval(state.pingInterval); state.pingInterval = null; }
            if (state.healthCheckInterval) { clearInterval(state.healthCheckInterval); state.healthCheckInterval = null; }
            state.connection = 'close';
            try { state.sock.end(); } catch {}
            scheduleReconnect(id, 3000);
            continue;
        }

        // Ping léger pour maintenir la connexion active
        try {
            await state.sock.sendPresenceUpdate('available');
            state.lastPing = new Date().toISOString();
        } catch (e) {
            addLog('warn', `[Watchdog] [${id}] Ping échoué: ${e.message} — reconnexion`);
            if (state.pingInterval) { clearInterval(state.pingInterval); state.pingInterval = null; }
            if (state.healthCheckInterval) { clearInterval(state.healthCheckInterval); state.healthCheckInterval = null; }
            state.connection = 'close';
            try { state.sock.ws?.close(); } catch {}
            try { state.sock.end(); } catch {}
            scheduleReconnect(id, 5000);
        }
    }
}, WATCHDOG_INTERVAL);

// Initialiser MongoDB et charger les sessions existantes
async function loadExistingSessions() {
    let sessionsToStart = [];

    // ── 0. Connexion MongoDB ────────────────────────────────────
    const mongoOk = await connectMongo();
    if (mongoOk) {
        // ── LOCK DISTRIBUÉ ─────────────────────────────────────
        // Empêche plusieurs instances (Railway/PM2) de connecter WhatsApp en même temps.
        const db = getMongoDb();
        const lockName = process.env.INSTANCE_LOCK_NAME || 'wa-bot-main';
        const ttlMs = parseInt(process.env.INSTANCE_LOCK_TTL_MS || '60000'); // 60s
        const hbMs = parseInt(process.env.INSTANCE_LOCK_HEARTBEAT_MS || '20000'); // 20s
        const ownerId = buildOwnerId();

        const lockRes = await tryAcquireLock({ db, lockName, ownerId, ttlMs });
        if (!lockRes.ok) {
            addLog('warn', `[Lock] Une autre instance détient le lock (${lockRes.holder}) — WhatsApp ne sera pas démarré ici.`);
            // On laisse le dashboard/API tourner mais sans connexions WA.
            return;
        }
        addLog('success', `[Lock] Instance active (${lockName}) — WhatsApp autorisé`);

        const hb = startLockHeartbeat({
            db,
            lockName,
            ownerId,
            ttlMs,
            intervalMs: hbMs,
            onLost: (info) => {
                addLog('warn', `[Lock] Lock perdu (${info?.holder || 'unknown'}) — arrêt des sockets WhatsApp`);
                // Fermer toutes les sockets pour éviter les 440
                for (const [id, st] of sessions) {
                    try { st.sock?.ws?.close(); } catch {}
                    try { st.sock?.end?.(); } catch {}
                    st.connection = 'close';
                    clearReconnectTimer(id);
                }
            },
        });

        const shutdown = async () => {
            try { hb.stop(); } catch {}
            try { await releaseLock({ db, lockName, ownerId }); } catch {}
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        addLog('info', '[MongoDB] Restauration des sessions depuis Atlas...');
        const count = await restoreAllSessions(SESSIONS_ROOT);
        if (count > 0) {
            addLog('success', `[MongoDB] ${count} session(s) restaurée(s)`);
            // Récupérer les sessions qui viennent d'être restaurées
            if (fs.existsSync(SESSIONS_ROOT)) {
                sessionsToStart = fs.readdirSync(SESSIONS_ROOT).filter(d =>
                    fs.statSync(path.join(SESSIONS_ROOT,d)).isDirectory() &&
                    fs.existsSync(path.join(SESSIONS_ROOT,d,'creds.json'))
                );
            }
            // ✅ MongoDB a réussi → on n'en scanne PLUS le dossier local
            // sinon on re-démarre les mêmes sessions 2x
        } else {
            addLog('info', '[MongoDB] Aucune session en base — premier déploiement ?');
            // Fallback: charger depuis le dossier sessions/ si MongoDB est vide
            if (fs.existsSync(SESSIONS_ROOT)) {
                sessionsToStart = fs.readdirSync(SESSIONS_ROOT).filter(d =>
                    fs.statSync(path.join(SESSIONS_ROOT,d)).isDirectory() &&
                    fs.existsSync(path.join(SESSIONS_ROOT,d,'creds.json'))
                );
            }
        }
    } else {
        // ── Fallback SESSION_STRING env si MongoDB indisponible ──
        addLog('warn', '[MongoDB] Indisponible — fallback SESSION_STRING');
        restoreFromEnvSessionString();
        
        // Charger depuis le dossier sessions/ si MongoDB échoue
        if (fs.existsSync(SESSIONS_ROOT)) {
            sessionsToStart = fs.readdirSync(SESSIONS_ROOT).filter(d =>
                fs.statSync(path.join(SESSIONS_ROOT,d)).isDirectory() &&
                fs.existsSync(path.join(SESSIONS_ROOT,d,'creds.json'))
            );
        }
    }

    // ── Démarrer les sessions ──
    if (sessionsToStart.length === 0) addLog('info','Aucune session — créez-en une depuis le dashboard');
    else { 
        // Beaucoup de comptes connectés en même temps déclenchent souvent des 440.
        // Par défaut, on démarre une seule session (la plus récente) pour stabiliser.
        // Pour démarrer toutes les sessions: START_ALL_SESSIONS=1
        const startAll = process.env.START_ALL_SESSIONS !== '0'; // actif par défaut
        const list = [...sessionsToStart].sort();
        const selected = startAll ? list : [list[list.length - 1]];
        addLog('info', `${selected.length}/${list.length} session(s) lancée(s): ${selected.join(', ')}${startAll ? '' : ' (START_ALL_SESSIONS=1 pour tout lancer)'}`);

        // Démarrage séquentiel (petit délai) pour éviter un burst de connexions
        for (const [i, id] of selected.entries()) {
            setTimeout(() => startSession(id), i * 1500);
        }
    }
}

// Helpers
function sendJson(res, data, status=200) {
    res.writeHead(status, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify(data));
}
function readBody(req) {
    return new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{r(JSON.parse(b));}catch{r({});} }); });
}
function getStatsData() {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_ROOT,'stats','stats.json'),'utf8')); } catch { return {}; }
}

// ════════════════════════════════════════════════════════════════════
// SÉCURITÉ DASHBOARD — Protection maximale
// ════════════════════════════════════════════════════════════════════
import { randomBytes, timingSafeEqual, createHash } from 'crypto';
import admin from './commands/admin.js';

const DASH_PASSWORD  = process.env.DASHBOARD_PASSWORD || 'changeme';
const ALLOWED_ORIGIN = process.env.DASHBOARD_ORIGIN  || null;
const MAX_BODY_BYTES = 512 * 1024;
const RATE_WINDOW    = 60 * 1000;
const RATE_MAX       = 80;
const LOGIN_WINDOW   = 15 * 60 * 1000;
const LOGIN_MAX      = 5;
const LOCKOUT_TIME   = 30 * 60 * 1000;
const SESSION_TTL    = 8 * 3600 * 1000;
const DASH_SESSIONS_FILE = path.join(DATA_ROOT, '.dash_sessions.json');
const IS_HTTPS = process.env.DASHBOARD_HTTPS === 'true';

const PASS_HASH = createHash('sha256').update(DASH_PASSWORD).digest();

const dashSessions = new Map();
function loadDashSessions() {
    try {
        const raw = JSON.parse(fs.readFileSync(DASH_SESSIONS_FILE,'utf8'));
        const now = Date.now();
        Object.entries(raw).forEach(([t,s]) => { if (s.expires>now) dashSessions.set(t,s); });
    } catch {}
}
function saveDashSessions() {
    const obj = {};
    dashSessions.forEach((v,k) => { obj[k]=v; });
    try { fs.writeFileSync(DASH_SESSIONS_FILE, JSON.stringify(obj)); } catch {}
}
loadDashSessions();

const rateLimiter  = new Map();
const loginTracker = new Map();
setInterval(() => {
    const now = Date.now();
    rateLimiter.forEach((v,k)  => { if (now>v.reset)      rateLimiter.delete(k); });
    loginTracker.forEach((v,k) => { if (v.lockedUntil && now>v.lockedUntil) loginTracker.delete(k); });
    dashSessions.forEach((v,k) => { if (now>v.expires)    dashSessions.delete(k); });
}, 5 * 60 * 1000);

function genToken() { return randomBytes(32).toString('hex'); }

function checkPassword(input) {
    try {
        const h = createHash('sha256').update(input).digest();
        return timingSafeEqual(PASS_HASH, h);
    } catch { return false; }
}

function isRateLimited(ip) {
    const now = Date.now();
    const e = rateLimiter.get(ip);
    if (!e || now>e.reset) { rateLimiter.set(ip,{count:1,reset:now+RATE_WINDOW}); return false; }
    return ++e.count > RATE_MAX;
}

function checkLoginAttempt(ip) {
    const now = Date.now();
    const e = loginTracker.get(ip) || { attempts:0, lockedUntil:0, windowStart:0 };
    if (e.lockedUntil > now) return { blocked:true, lockoutMins:Math.ceil((e.lockedUntil-now)/60000) };
    if (now - e.windowStart > LOGIN_WINDOW) { e.attempts=0; e.windowStart=now; }
    e.attempts++;
    if (e.attempts >= LOGIN_MAX) {
        e.lockedUntil = now + LOCKOUT_TIME;
        loginTracker.set(ip, e);
        addLog('warn', `[Auth] IP ${ip} bloquée 30 min (${LOGIN_MAX} tentatives)`);
        return { blocked:true, lockoutMins:30 };
    }
    loginTracker.set(ip, e);
    return { blocked:false, remaining: LOGIN_MAX - e.attempts };
}
function recordLoginSuccess(ip) { loginTracker.delete(ip); }

function isAuthenticated(req) {
    const token = (req.headers['cookie']||'').match(/dash_token=([^;]+)/)?.[1];
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
    const s = dashSessions.get(token);
    if (!s || Date.now()>s.expires) { dashSessions.delete(token); return false; }
    return true;
}

function sanitizeId(raw) {
    const id = decodeURIComponent(raw||'');
    if (!/^[\w\-+]{1,50}$/.test(id)) return null;
    const resolved = path.resolve(SESSIONS_ROOT, id);
    if (!resolved.startsWith(path.resolve(SESSIONS_ROOT)+path.sep) &&
        resolved !== path.resolve(SESSIONS_ROOT)) return null;
    return id;
}

function readBodySafe(req) {
    return new Promise((resolve, reject) => {
        let b='', size=0;
        req.on('data', c => { size+=c.length; if(size>MAX_BODY_BYTES){req.destroy();reject(new Error('Payload trop grand'));return;} b+=c; });
        req.on('end', ()=>{ try{resolve(JSON.parse(b));}catch{resolve({});} });
        req.on('error', reject);
    });
}

function maskSensitive(msg) {
    return msg
        .replace(/(SESSION_STRING)[^\s,}]*/gi, '$1=[MASQUÉ]')
        .replace(/([A-Za-z0-9+/]{80,}={0,2})/g, m => m.slice(0,10)+'...[MASQUÉ]');
}

const SECURITY_HEADERS = {
    'X-Content-Type-Options':  'nosniff',
    'X-Frame-Options':         'DENY',
    'X-XSS-Protection':        '1; mode=block',
    'Referrer-Policy':         'strict-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: https://api.qrserver.com; font-src https://fonts.gstatic.com; connect-src 'self'",
    ...(IS_HTTPS ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
};

const SEC_HEADERS = SECURITY_HEADERS;

function getSessionToken(req) {
    return (req.headers['cookie']||'').match(/dash_token=([^;]+)/)?.[1] || null;
}
function recordFailedLogin(ip) {
    checkLoginAttempt(ip);
}
function clearLoginAttempts(ip) {
    loginTracker.delete(ip);
}

const _addLogOrig = addLog;
global.addLog = function(level, msg) { _addLogOrig(level, maskSensitive(msg)); };

http.createServer(async (req, res) => {
    const ip       = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const url      = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;
    const method   = req.method;

    if (isRateLimited(ip)) {
        res.writeHead(429, { 'Content-Type':'application/json', 'Retry-After':'60' });
        return res.end(JSON.stringify({ error:'Trop de requêtes. Réessaie dans 1 minute.' }));
    }

    const origin = req.headers['origin'] || '';
    const corsOk = !ALLOWED_ORIGIN || origin === ALLOWED_ORIGIN || origin === `http://localhost:${PORT}`;
    const corsHeaders = {
        'Access-Control-Allow-Origin':  corsOk ? (origin || '*') : 'null',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
    };
    if (method === 'OPTIONS') { res.writeHead(204, corsHeaders); return res.end(); }

    function sendJson(r, data, status=200) {
        r.writeHead(status, { ...SECURITY_HEADERS, ...corsHeaders, 'Content-Type':'application/json' });
        r.end(JSON.stringify(data));
    }
    function sendHtml(r, html, status=200) {
        r.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type':'text/html; charset=utf-8' });
        r.end(html);
    }

    // GET / — dashboard
    if ((pathname==='/'||pathname==='/dashboard') && method==='GET') {
        if (!isAuthenticated(req)) { res.writeHead(302,{Location:'/login'}); return res.end(); }
        const hp = path.join(DASH_DIR,'index.html');
        if (fs.existsSync(hp)) { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...SEC_HEADERS}); return res.end(fs.readFileSync(hp)); }
        res.writeHead(302,{Location:'/login'}); return res.end();
    }

    // GET /login
    if (pathname==='/login' && method==='GET') {
        const errCode = url.searchParams.get('error');
        const lockMin = url.searchParams.get('min') || '30';
        const errMsg  = errCode === 'locked'
            ? `Trop de tentatives. IP bloquée ${lockMin} minutes.`
            : errCode ? 'Mot de passe incorrect.' : '';
        const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connexion — Bot Dashboard</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#080b10;color:#c9d1d9;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#0d1117;border:1px solid #21262d;border-radius:14px;padding:36px;width:340px;display:flex;flex-direction:column;gap:16px}
.logo{font-size:1.1rem;font-weight:700;color:#f0f6fc;display:flex;align-items:center;gap:8px}
.dot{width:9px;height:9px;border-radius:50%;background:#25d366;box-shadow:0 0 8px #25d366}
p{font-size:.78rem;color:#484f58;font-family:monospace}
input{background:#080b10;border:1px solid #21262d;border-radius:8px;padding:11px 14px;color:#c9d1d9;font-size:.9rem;width:100%;outline:none;transition:border-color .2s}
input:focus{border-color:#25d366}
button{background:#25d366;color:#000;font-weight:700;border:none;border-radius:8px;padding:12px;cursor:pointer;font-size:.9rem;transition:background .15s;width:100%}
button:hover{background:#1fb858}
.err{background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.3);color:#f85149;font-size:.78rem;font-family:monospace;padding:9px 12px;border-radius:6px;${errMsg?'':'display:none'}}
</style></head><body><div class="box">
<div class="logo"><div class="dot"></div>Bot Dashboard</div>
<p>Accès protégé — mot de passe requis</p>
<form method="POST" action="/login">
<input type="password" name="password" placeholder="Mot de passe..." autofocus required autocomplete="current-password">
<button type="submit">Connexion</button>
</form>
<div class="err">${errMsg}</div>
</div></body></html>`;
        return sendHtml(res, html);
    }

    // POST /login
    if (pathname==='/login' && method==='POST') {
        let b = '';
        await new Promise(r => { req.on('data',c=>b+=c.slice(0,500)); req.on('end',r); });
        const pwd = new URLSearchParams(b).get('password') || '';
        if (pwd !== DASH_PASSWORD) {
            recordFailedLogin(ip);
            addLog('warn', `[Auth] Échec login depuis ${ip}`);
            res.writeHead(302,{Location:'/login?error=1'}); return res.end();
        }
        const oldToken = getSessionToken(req);
        if (oldToken) dashSessions.delete(oldToken);
        clearLoginAttempts(ip);
        const token = genToken();
        dashSessions.set(token, { ip, expires: Date.now()+SESSION_TTL });
        addLog('success', `[Auth] Connexion dashboard depuis ${ip}`);
        const cookieFlags = [`dash_token=${token}`,'HttpOnly','SameSite=Strict',`Max-Age=${Math.floor(SESSION_TTL/1000)}`,'Path=/',...(IS_HTTPS?['Secure']:[])].join('; ');
        res.writeHead(302, { Location:'/', 'Set-Cookie': cookieFlags, ...SECURITY_HEADERS });
        return res.end();
    }

    // POST /logout
    if (pathname==='/logout' && method==='POST') {
        const token = (req.headers['cookie']||'').match(/dash_token=([^;]+)/)?.[1];
        if (token) { dashSessions.delete(token); saveDashSessions(); }
        addLog('info', `[Auth] Déconnexion depuis ${ip}`);
        res.writeHead(302, { Location:'/login', 'Set-Cookie':'dash_token=; HttpOnly; Max-Age=0; Path=/', ...SECURITY_HEADERS });
        return res.end();
    }

    // GET /api/status — public
    if (pathname==='/api/status') return sendJson(res,{ status:'online', sessions:sessions.size, uptime:Math.floor((Date.now()-startTime)/1000) });

    // ──────────────────────────────────────────────────────────
    // Routes PUBLIQUES (sans authentification)
    // ──────────────────────────────────────────────────────────

    // GET /api/health — Endpoint pour cron jobs (UptimeRobot, easycron, etc.)
    if (pathname==='/api/health' && method==='GET') {
        const sessionsList = [...sessions.values()].map(s => ({
            id: s.id,
            status: s.connection,
            messagesCount: s.messagesCount,
            lastActivity: s.lastActivity
        }));
        
        return sendJson(res, {
            status: 'ok',
            uptime: Math.round((Date.now() - startTime) / 1000),
            sessions: sessionsList.length,
            timestamp: new Date().toISOString()
        });
    }

    // ──────────────────────────────────────────────────────────
    // Routes protégées (auth requise)
    // ──────────────────────────────────────────────────────────
    if (!isAuthenticated(req)) return sendJson(res,{ error:'Non autorisé — connectez-vous sur /login' },401);

    // GET /api/logs
    if (pathname==='/api/logs' && method==='GET') {
        const since = Math.max(0, parseInt(url.searchParams.get('since')||'0'));
        const safeLogs = logs.slice(since).map(l => ({ ...l, msg: maskSensitive(l.msg) }));
        return sendJson(res,{ logs: safeLogs, total:logs.length });
    }

    // GET /api/sessions
    if (pathname==='/api/sessions' && method==='GET') {
        const list = [...sessions.values()].map(s=>({
            id:s.id, connection:s.connection, connectedNumber:s.connectedNumber,
            qrCode:s.qrCode, commandsCount:s.commandsCount, messagesCount:s.messagesCount, createdAt:s.createdAt
        }));
        return sendJson(res,{ sessions:list });
    }

    // POST /api/sessions — nouvelle session (QR ou pairing code)
    if (pathname==='/api/sessions' && method==='POST') {
        if (sessions.size >= 10) return sendJson(res,{ error:'Maximum 10 sessions simultanées' },429);
        let body = {};
        try { body = await readBodySafe(req); } catch {}
        const phone = (body.phone||'').replace(/\D/g,'');
        const id = 'sess_'+Date.now();
        await startSession(id, phone || null);
        const msg = phone ? 'Session créée, pairing code en cours...' : 'Session créée, QR en cours...';
        return sendJson(res,{ ok:true, sessionId:id, message:msg });
    }

    // GET /api/sessions/:id
    const smatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (smatch && method==='GET') {
        const sid = sanitizeId(smatch[1]);
        if (!sid) return sendJson(res,{ error:'ID de session invalide' },400);
        const s = sessions.get(sid);
        if (!s) return sendJson(res,{ error:'Session introuvable' },404);
        const statsData = getStatsData();
        const totalCmds = Object.values(statsData).reduce((a,u)=>a+(u.total||0),0);
        const topMap    = {};
        Object.values(statsData).forEach(u => Object.entries(u.commands||{}).forEach(([c,n])=>{ topMap[c]=(topMap[c]||0)+n; }));
        const topCmds   = Object.entries(topMap).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([cmd,count])=>({cmd,count}));
        const users     = Object.entries(statsData).map(([n,d])=>({number:n,total:d.total,lastSeen:d.lastSeen,topCmd:Object.entries(d.commands||{}).sort((a,b)=>b[1]-a[1])[0]?.[0]})).sort((a,b)=>b.total-a.total).slice(0,50);
        const uptime    = Math.floor((Date.now()-startTime)/1000);
        return sendJson(res,{
            ...s, sock:undefined, pingInterval:undefined, healthCheckInterval:undefined,
            recentCommands:s.recentCommands.slice(-20),
            uptime, uptimeHuman:`${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`,
            totalUsers:Object.keys(statsData).length, totalCommands:totalCmds,
            topCommands:topCmds, users, prefix:PREFIX,
            memory:Math.round(process.memoryUsage().heapUsed/1024/1024), node:process.version,
            sessionString: s.sessionString || null,
        });
    }

    // POST /api/sessions/:id/pair
    const pairmatch = pathname.match(/^\/api\/sessions\/([^/]+)\/pair$/);
    if (pairmatch && method==='POST') {
        const sid = sanitizeId(pairmatch[1]);
        if (!sid) return sendJson(res,{error:'ID invalide'},400);
        let body;
        try { body = await readBodySafe(req); } catch { return sendJson(res,{error:'Payload trop grand'},413); }
        const phone = (body.phone||'').replace(/\D/g,'');
        if (!phone || phone.length < 7 || phone.length > 15) return sendJson(res,{error:'Numéro invalide'},400);
        const s = sessions.get(sid);
        if (!s) return sendJson(res,{error:'Session introuvable'},404);
        if (s.connection === 'open') return sendJson(res,{error:'Déjà connecté'},400);
        try {
            if (!s.sock) {
                await startSession(sid, phone);
                return sendJson(res,{ok:true, message:'Session démarrée, code en cours...'});
            }
            const code = await s.sock.requestPairingCode(phone);
            s.pairingCode = code;
            addLog('success',`[${sid}] Pairing code: ${code}`);
            return sendJson(res,{ok:true, code});
        } catch(e) {
            return sendJson(res,{error:e.message},500);
        }
    }

    // POST /api/sessions/:id/restart
    const rmatch = pathname.match(/^\/api\/sessions\/([^/]+)\/restart$/);
    if (rmatch && method==='POST') {
        const sid = sanitizeId(rmatch[1]);
        if (!sid) return sendJson(res,{error:'ID invalide'},400);
        const s = sessions.get(sid);
        if (!s) return sendJson(res,{error:'Session introuvable'},404);
        addLog('info',`[${sid}] Redémarrage depuis le dashboard (IP: ${ip})`);
        try { if(s.sock) await s.sock.end(); } catch {}
        setTimeout(()=>startSession(sid),1500);
        return sendJson(res,{ ok:true, message:'Reconnexion en cours...' });
    }

    // POST /api/sessions/:id/logout
    const lmatch = pathname.match(/^\/api\/sessions\/([^/]+)\/logout$/);
    if (lmatch && method==='POST') {
        const sid = sanitizeId(lmatch[1]);
        if (!sid) return sendJson(res,{error:'ID invalide'},400);
        const s = sessions.get(sid);
        if (!s) return sendJson(res,{error:'Session introuvable'},404);
        addLog('info',`[${sid}] Déconnexion depuis le dashboard (IP: ${ip})`);
        try { if(s.sock) await s.sock.logout(); } catch {}
        fse.removeSync(path.join(SESSIONS_ROOT,sid));
        sessions.delete(sid);
        deleteSessionMongo(sid).catch(() => {});
        return sendJson(res,{ ok:true, message:'Session supprimée.' });
    }

    // DELETE /api/sessions/:id
    const dmatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (dmatch && method==='DELETE') {
        const sid = sanitizeId(dmatch[1]);
        if (!sid) return sendJson(res,{error:'ID invalide'},400);
        const s = sessions.get(sid);
        try { if(s?.sock) await s.sock.end(); } catch {}
        fse.removeSync(path.join(SESSIONS_ROOT,sid));
        sessions.delete(sid);
        deleteSessionMongo(sid).catch(() => {});
        addLog('info',`Session [${sid}] supprimée (IP: ${ip})`);
        return sendJson(res,{ ok:true });
    }

    // POST /api/sessions/:id/send
    const sendmatch = pathname.match(/^\/api\/sessions\/([^/]+)\/send$/);
    if (sendmatch && method==='POST') {
        const sid  = sanitizeId(sendmatch[1]);
        if (!sid) return sendJson(res,{error:'ID invalide'},400);
        const s    = sessions.get(sid);
        let body;
        try { body = await readBodySafe(req); } catch { return sendJson(res,{error:'Payload trop grand'},413); }
        if (!s||s.connection!=='open') return sendJson(res,{error:'Session non connectée'},503);
        const toNum = (body.to||'').replace(/\D/g,'');
        if (!toNum || toNum.length < 7 || toNum.length > 15) return sendJson(res,{error:'Numéro invalide (7-15 chiffres)'},400);
        if (!body.text || typeof body.text !== 'string' || body.text.length > 4096) return sendJson(res,{error:'Message invalide (max 4096 chars)'},400);
        try {
            await s.sock.sendMessage(toNum+'@s.whatsapp.net',{ text:body.text });
            addLog('success',`[${sid}] Message → ${toNum.slice(0,-4)}**** (IP: ${ip})`);
            return sendJson(res,{ ok:true });
        } catch(e) { return sendJson(res,{error:e.message},500); }
    }

    sendJson(res,{ error:'Route inconnue' },404);

}).listen(PORT, BIND_HOST, () => {
    const railwayUrl = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : null;

    addLog('success', `Dashboard démarré sur le port ${PORT} (${BIND_HOST}) — mot de passe requis`);
    if (railwayUrl) addLog('success', `URL publique Railway: ${railwayUrl}`);

    if (DASH_PASSWORD === 'changeme') {
        addLog('warn', 'SÉCURITÉ: Changez DASHBOARD_PASSWORD dans les variables Railway !');
    }
});

loadExistingSessions().catch(e => console.error('[Boot] Erreur loadExistingSessions:', e.message));