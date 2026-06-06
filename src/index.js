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
let _dashboardHtml  = null;
try {
    const _dashPath = path.join(DASH_DIR, 'index.html');
    if (fs.existsSync(_dashPath)) _dashboardHtml = fs.readFileSync(_dashPath);
} catch {}
const PREFIX        = process.env.PREFIX || '!';
const PORT          = parseInt(process.env.PORT || '3000');
const BIND_HOST     = process.env.BIND_HOST || '0.0.0.0';
const startTime     = Date.now();

fse.ensureDirSync(SESSIONS_ROOT);

// botmode.json — owner-only permanent (seul le numéro connecté peut utiliser le bot)
try {
    const botmodeFile = path.join(__dirname, '../data/botmode.json');
    if (!fs.existsSync(botmodeFile)) {
        fse.ensureDirSync(path.dirname(botmodeFile));
        fs.writeFileSync(botmodeFile, JSON.stringify({ mode: 'private', ownerOnly: true }, null, 2));
        console.log('[Boot] botmode.json absent — accès owner-only par défaut');
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

// SIGTERM/SIGINT gérés dans loadExistingSessions (avec lock release + flush)

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
import { getAggregatedStats } from './utils/stats.js';
import { getBotMode } from './commands/security.js';
import { connectMongo, saveSessionMongo, restoreAllSessions, deleteSessionMongo, scheduleSave, getMongoDb, flushAllPendingSaves, saveAllActiveSessions, migrateSessionId } from './utils/mongostore.js';
import { buildOwnerId, tryAcquireLock, startLockHeartbeat, releaseLock } from './utils/instancelock.js';
import { autoSaveViewOnce, isViewOnceMessage } from './utils/viewonce.js';
import { extractMessageBody, resolveIsOwner } from './utils/message.js';

// Cache des métadonnées de groupe (TTL 5 min) — évite un appel réseau par message
const _groupMetaCache = new Map(); // jid -> { data, ts }
const GROUP_META_TTL = 5 * 60 * 1000;
async function getGroupMetaCached(sock, jid) {
    const hit = _groupMetaCache.get(jid);
    if (hit && Date.now() - hit.ts < GROUP_META_TTL) return hit.data;
    const data = await sock.groupMetadata(jid).catch(() => null);
    if (data) _groupMetaCache.set(jid, { data, ts: Date.now() });
    return data;
}

// Résout un LID → numéro via les métadonnées du groupe et peuple le cache de la session.
// Détecte aussi le LID de l'owner (participant dont le numéro == compte connecté).
async function resolveLidViaGroupMeta(sock, groupJid, state, OWNER) {
    const meta = await getGroupMetaCached(sock, groupJid);
    if (!meta?.participants) return;
    if (!state.lidCache) state.lidCache = {};
    for (const p of meta.participants) {
        // Selon la version Baileys : p.id (PN ou LID), p.lid, p.jid
        const ids = [p.id, p.lid, p.jid].filter(Boolean);
        let lid = ids.find(x => x.endsWith('@lid'))?.split('@')[0] || null;
        let pn  = ids.find(x => x.endsWith('@s.whatsapp.net'))?.split(':')[0].split('@')[0].replace(/\D/g, '') || null;
        // Si le LID est connu mais pas le PN, tenter la résolution Baileys
        if (lid && !pn) {
            try {
                const r = await sock.signalRepository.lidMapping.getPNForLID(lid + '@lid');
                if (r) pn = r.split(':')[0].split('@')[0].replace(/\D/g, '');
            } catch {}
        }
        if (lid && pn) {
            state.lidCache[lid] = pn;
            state.lidCache[pn]  = lid;
            if (pn === OWNER && state.ownerLid !== lid) {
                state.ownerLid = lid;
                addLog('info', `[${state.id}] ownerLid détecté via groupe: ${lid}`);
            }
        }
    }
}

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

function scheduleReconnect(sessionId, delayMs = 3000, force = true) {
    clearReconnectTimer(sessionId);
    const t = setTimeout(() => {
        reconnectTimerBySessionId.delete(sessionId);
        startSession(sessionId, null, { force });
    }, delayMs);
    reconnectTimerBySessionId.set(sessionId, t);
}

/** Ferme proprement une session avant reconnexion */
function teardownSession(state) {
    if (!state) return;
    if (state.pingInterval) { clearInterval(state.pingInterval); state.pingInterval = null; }
    if (state.healthCheckInterval) { clearInterval(state.healthCheckInterval); state.healthCheckInterval = null; }
    if (state.connectingTimeout) { clearTimeout(state.connectingTimeout); state.connectingTimeout = null; }
    if (state.sock) {
        try { state.sock.ws?.close(); } catch {}
        try { state.sock.end(); } catch {}
        state.sock = null;
    }
}

/** Supervise les sessions — relance si fermée ou bloquée */
function superviseSessions() {
    const now = Date.now();
    for (const [id, state] of sessions) {
        if (reconnectTimerBySessionId.has(id)) continue;

        if (state.connection === 'close' || !state.sock) {
            addLog('info', `[Supervisor] Session [${id}] hors ligne — reconnexion`);
            scheduleReconnect(id, 3000, true);
            continue;
        }

        if (state.connection === 'connecting') {
            const since = now - (state.connectingSince || now);
            if (since > 3 * 60 * 1000) {
                addLog('warn', `[Supervisor] Session [${id}] bloquée en connecting (${Math.round(since / 1000)}s) — reset`);
                state.connection = 'close';
                teardownSession(state);
                scheduleReconnect(id, 3000, true);
            }
        }
    }
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

// ══════════════════════════════════════════════════════════════
// RÉSOLUTION DU LID OWNER — par session, automatique
// Le mapping PN↔LID de WhatsApp se synchronise progressivement après la
// connexion : on réessaie plusieurs fois jusqu'à trouver le LID du compte.
// ══════════════════════════════════════════════════════════════
async function tryResolveOwnerLid(sock, state) {
    if (state.ownerLid) return state.ownerLid;
    const num = (state.connectedNumber || '').replace(/\D/g, '');
    if (!num) return null;

    let lid = sock.user?.lid?.split('@')[0]
        || sock.authState?.creds?.me?.lid?.split('@')[0]
        || null;

    if (!lid) {
        try {
            const pairs = await sock.signalRepository?.lidMapping?.getLIDsForPNs([num + '@s.whatsapp.net']);
            if (pairs && pairs.length > 0 && pairs[0]?.lid) lid = pairs[0].lid.split('@')[0];
        } catch {}
    }

    if (lid) {
        state.ownerLid = lid;
        if (!state.lidCache) state.lidCache = {};
        state.lidCache[num] = lid;
        state.lidCache[lid] = num;
        addLog('info', `[${state.id}] ownerLid résolu: ${lid}`);
    }
    return lid;
}

function scheduleOwnerLidResolution(sock, state) {
    const delays = [3000, 10000, 30000, 90000, 180000];
    for (const d of delays) {
        setTimeout(() => {
            if (state.connection === 'open' && !state.ownerLid) {
                tryResolveOwnerLid(sock, state).catch(() => {});
            }
        }, d);
    }
}


// Démarrer une session
// phoneNumber optionnel → active le pairing code au lieu du QR
async function startSession(sessionId, phoneNumber = null, { force = false } = {}) {
    const existing = sessions.get(sessionId);
    if (existing && !force && (existing.connection === 'open' || existing.connection === 'connecting')) {
        addLog('warn', `Session ${sessionId} ignorée : ${existing.connection}`);
        return;
    }

    if (existing && force) teardownSession(existing);

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
    state.connectingSince = Date.now();
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

    // Timeout si la connexion reste bloquée en "connecting"
    if (state.connectingTimeout) clearTimeout(state.connectingTimeout);
    state.connectingTimeout = setTimeout(() => {
        if (state.connection === 'connecting') {
            addLog('warn', `[${sessionId}] Timeout connexion (90s) — nouvelle tentative`);
            state.connection = 'close';
            teardownSession(state);
            scheduleReconnect(sessionId, 5000, true);
        }
    }, 90_000);

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
        await saveCreds(); // Écriture disque local

        // Sauvegarde MongoDB immédiate ET avec debounce (double filet)
        // await ici pour que SIGTERM ne coupe pas la sauvegarde en cours
        await saveSessionMongo(state.id, state.connectedNumber || state.id, state.authPath).catch(() => {});
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

    // Écouter les mappings LID→PN émis par Baileys
    // { pn: "237693552769@s.whatsapp.net", lid: "34347558133923@lid" }
    sock.ev.on('lid-mapping.update', ({ pn, lid }) => {
        if (!pn || !lid) return;
        const pnNum  = pn.split(':')[0].split('@')[0].replace(/\D/g, '');
        const lidNum = lid.split('@')[0];
        if (!state.lidCache) state.lidCache = {};
        state.lidCache[lidNum] = pnNum;   // LID → numéro
        state.lidCache[pnNum]  = lidNum;  // numéro → LID (pour lookup inverse)
    });

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && !phoneNumber) {
            state.qrCode = qr;
            state.connection = 'connecting';
            qrcodeterminal.generate(qr, { small: true });
            addLog('info', `[${sessionId}] QR prêt — scannez avec WhatsApp`);
        }

        if (connection === 'open') {
            if (state.connectingTimeout) { clearTimeout(state.connectingTimeout); state.connectingTimeout = null; }
            state.connectingSince = null;
            const num = sock.user?.id?.split(':')[0] || sock.user?.id || sessionId;
            state.connectedNumber = num.replace(/\D/g, '');

            // LID du compte connecté — reconnaître l'owner en groupe (résolution auto par session)
            await tryResolveOwnerLid(sock, state);
            // Si pas encore résolu, on réessaie en arrière-plan (le mapping se synchronise)
            if (!state.ownerLid) {
                addLog('info', `[${sessionId}] ownerLid en cours de résolution (auto, sera appris au 1er message en groupe)`);
                scheduleOwnerLidResolution(sock, state);
            }

            // Pas de suppression automatique de doublons ici —
            // l'utilisateur gère ses sessions manuellement depuis le dashboard

            state.connection = 'open';
            state.qrCode = null;
            state.pairingCode = null;
            state.connectedNumber = num;
            state.lastActivity    = Date.now();
            state.lastConnectedAt = Date.now(); // pour la reconnexion périodique

            if (state.ownerLid && num) {
                if (!state.lidCache) state.lidCache = {};
                const pn = (num || '').replace(/\D/g, '');
                state.lidCache[pn] = state.ownerLid;
                state.lidCache[state.ownerLid] = pn;
            }

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

                // Migrer MongoDB : supprimer l'ancien ID (sess_xxx) → garder le numéro
                migrateSessionId(sessionId, num, num, newPath)
                    .catch(e => addLog('warn', `[MongoDB] Migration session: ${e.message}`));

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

            addLog('success', `[${state.id}] Connecté — Owner auto: ${num}${state.ownerLid ? ` (LID: ${state.ownerLid})` : ''} | Préfixe: ${PREFIX}`);

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
            }, 60_000);

            // ── HEALTH CHECK TOUTES LES 2 MIN ──
            // Vérifie readyState=3 (CLOSED sans événement) ET zombie silencieux
            if (state.healthCheckInterval) clearInterval(state.healthCheckInterval);
            state.healthCheckInterval = setInterval(async () => {
                const wsState = sock.ws?.readyState;
                if (wsState === 3) {
                    addLog('warn', `[${state.id}] Health check: socket CLOSED sans événement — reconnexion`);
                    state.connection = 'close';
                    scheduleReconnect(state.id, 3000);
                    return;
                }
                // Zombie check : si lastActivity est vieille de > 25min ET pong échoue
                const inactiveSince = Date.now() - (state.lastActivity || state.lastConnectedAt || 0);
                if (wsState === 1 && inactiveSince > 25 * 60 * 1000) {
                    const alive = await wsPingCheck(sock);
                    if (!alive) {
                        addLog('warn', `[${state.id}] Health check: zombie confirmé — reconnexion`);
                        state.connection = 'close';
                        try { sock.ws?.close(); } catch {}
                        try { sock.end(); } catch {}
                        scheduleReconnect(state.id, 5000);
                    }
                }
            }, 2 * 60 * 1000);
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
                // WhatsApp envoie loggedOut (401) après rotation de clés, redéploiement, etc.
                // On tente une reconnexion avec les creds existants (MongoDB les a).
                // NE PAS supprimer /tmp — les creds sont encore valides dans la plupart des cas.
                addLog('warn', `[${state.id}] Session loggedOut (401) — reconnexion dans 10s`);
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
        // 'notify' = message reçu en temps réel
        // 'append' = messages ajoutés au chat — inclut TES propres commandes envoyées
        //            depuis ton téléphone (appareil principal) vers l'appareil lié (bot).
        //            On les accepte si récents (<2 min) pour ne pas rejouer l'historique.
        //            La déduplication (processedMsgIds) évite tout double traitement.
        if (type !== 'notify' && type !== 'append') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

            // Pour 'append', ne traiter que les messages récents (évite le rejeu d'historique au boot)
            if (type === 'append') {
                const msgTsMs = Number(msg.messageTimestamp || 0) * 1000;
                if (!msgTsMs || (Date.now() - msgTsMs) > 2 * 60 * 1000) continue;
            }

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
                // OWNER = numéro du compte connecté (auto après QR/pairing), une session = un owner
                const rawConnected = state.connectedNumber || sock.user?.id?.split(':')[0] || '';
                const connectedNum = rawConnected.includes(':') ? rawConnected.split(':')[0].replace(/\D/g, '') : rawConnected.replace(/\D/g, '');

                const OWNER = connectedNum;
                if (!OWNER) continue; // session pas encore connectée (QR/pairing en attente)
                const from  = isGroup ? rawJid : ((isLid||fromMe) ? OWNER+'@s.whatsapp.net' : rawJid);

                let senderJid, senderNumber;
                // Extraction robuste du numéro, en ignorant le suffixe d'appareil et le domaine
                const cleanPhone = jid => (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

                if (fromMe) {
                    senderNumber = OWNER;
                    senderJid    = isGroup ? (msg.key.participant || OWNER + '@s.whatsapp.net') : OWNER + '@s.whatsapp.net';
                    // Auto-apprentissage : si mon propre message en groupe porte un LID,
                    // c'est mon LID d'owner → on le mémorise pour les futurs messages
                    if (isGroup && msg.key.participant?.endsWith('@lid')) {
                        const myLid = msg.key.participant.split('@')[0];
                        if (myLid && state.ownerLid !== myLid) {
                            state.ownerLid = myLid;
                            if (!state.lidCache) state.lidCache = {};
                            state.lidCache[OWNER] = myLid;
                            state.lidCache[myLid] = OWNER;
                            addLog('info', `[${state.id}] ownerLid auto-appris: ${myLid}`);
                        }
                    }
                } else if (isGroup) {
                    senderJid = msg.key.participant || '';
                    const isParticipantLid = senderJid.endsWith('@lid');

                    if (isParticipantLid) {
                        const lidNum = senderJid.split('@')[0];

                        // 1. Cache lidCache peuplé via lid-mapping.update
                        if (state.lidCache?.[lidNum]) {
                            senderNumber = state.lidCache[lidNum];
                            senderJid    = senderNumber + '@s.whatsapp.net';

                        // 2. participantAlt fourni directement par WhatsApp dans la stanza
                        } else if (msg.key.participantAlt && !msg.key.participantAlt.endsWith('@lid')) {
                            senderNumber = msg.key.participantAlt.split(':')[0].split('@')[0].replace(/\D/g, '');
                            senderJid    = senderNumber + '@s.whatsapp.net';
                            if (!state.lidCache) state.lidCache = {};
                            state.lidCache[lidNum] = senderNumber;

                        // 3. getPNForLID Baileys (mapping persisté sur disque)
                        } else {
                            try {
                                let pn = await sock.signalRepository.lidMapping.getPNForLID(senderJid);
                                // 4. Fallback : métadonnées du groupe (peuple lidCache + ownerLid)
                                if (!pn) {
                                    await resolveLidViaGroupMeta(sock, from, state, OWNER);
                                    if (state.lidCache?.[lidNum]) pn = state.lidCache[lidNum] + '@s.whatsapp.net';
                                }
                                if (pn) {
                                    senderNumber = pn.split(':')[0].split('@')[0].replace(/\D/g, '');
                                    senderJid    = senderNumber + '@s.whatsapp.net';
                                    if (!state.lidCache) state.lidCache = {};
                                    state.lidCache[lidNum] = senderNumber;
                                } else {
                                    // LID non résolu — garder le LID brut
                                    // isOwner sera vérifié via OWNER_LID plus bas
                                    senderNumber = lidNum;
                                }
                            } catch {
                                senderNumber = lidNum;
                            }
                        }
                    } else {
                        senderNumber = cleanPhone(senderJid);
                    }
                } else {
                    senderNumber = cleanPhone(rawJid);
                    senderJid    = senderNumber + '@s.whatsapp.net';
                }

                const OWNER_LID = state.ownerLid || null;
                const isOwner = resolveIsOwner({
                    fromMe, senderNumber, senderJid, OWNER, OWNER_LID, lidCache: state.lidCache,
                });

                const body = extractMessageBody(msg);

                if (isViewOnceMessage(msg)) {
                    autoSaveViewOnce(sock, msg, OWNER, {
                        senderNumber, senderJid, isGroup, from, rawJid,
                    }).catch(e => addLog('error', `[${state.id}] AutoVO: ${e.message}`));
                }

                const isCmd = body.startsWith(PREFIX);
                if (fromMe && !isCmd) continue;
                if (isGroup) setImmediate(() => trackGroupMsg(from, senderJid));

                if (isCmd) {
                    const cmd = body.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase()||'';
                    state.commandsCount++;
                    state.recentCommands.push({ cmd, user: senderNumber, time: new Date().toISOString() });
                    if (state.recentCommands.length > 50) state.recentCommands.shift();
                    addLog('info', `[${state.id}] CMD !${cmd} par ${senderNumber}`);
                }

                const currentBotMode = getBotMode();

                // ── Anti-mute : supprimer messages des mutés ─────────────
                if (isGroup && global.mutedMembers?.has(`${from}__${senderJid}`) && !isOwner) {
                    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
                    continue;
                }

                // FIX: n'appeler handleCommand que si c'est une commande
                if (!isCmd) continue;

                // Owner-only permanent — DM et groupes
                if (!isOwner) continue;

                await handleCommand(sock, msg, {}, {
                    body, from, isGroup, isOwner, senderNumber, sender: senderJid,
                    noTagGroups: global.noTagGroups,
                    botMode: currentBotMode,
                    prefix: PREFIX,
                    owner: OWNER,
                    ownerLid: state.ownerLid || null,
                    lidCache: state.lidCache,
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
// WATCHDOG — détection socket mort + zombies silencieux
//
// Problème sur Railway : après ~24h, le WebSocket reste readyState=1 (OPEN)
// mais WhatsApp ne délivre plus de messages (connexion fantôme/zombie).
// sendPresenceUpdate() peut encore "réussir" côté WS sans que WA ack le paquet.
//
// Solution : double critère
//   1. readyState !== 1 → mort certain → reconnexion immédiate
//   2. lastActivity > ZOMBIE_THRESHOLD → SUSPECT → on envoie un ping WS bas niveau
//      via sock.ws.ping() avec timeout de 10s. Si pas de pong → zombie → reconnexion.
// ══════════════════════════════════════════════════════════════
const WATCHDOG_INTERVAL   = 60 * 1000;       // check toutes les 60s
const ZOMBIE_THRESHOLD_MS = 20 * 60 * 1000;  // 20 min sans aucun message reçu = suspect
const PING_TIMEOUT_MS     = 10 * 1000;        // 10s pour recevoir le pong WS

function wsPingCheck(sock) {
    return new Promise((resolve) => {
        const ws = sock.ws;
        if (!ws || typeof ws.ping !== 'function') { resolve(true); return; } // pas de support ping → on laisse passer
        const t = setTimeout(() => resolve(false), PING_TIMEOUT_MS); // timeout = zombie
        try {
            ws.ping(undefined, false, (err) => {
                clearTimeout(t);
                resolve(!err); // err = pas de pong ou WS fermé
            });
        } catch {
            clearTimeout(t);
            resolve(false);
        }
    });
}

setInterval(async () => {
    const now = Date.now();
    for (const [id, state] of sessions) {
        if (state.connection !== 'open' || !state.sock) continue;

        // ── 1. Socket clairement fermé (readyState !== OPEN) ──
        const wsState = state.sock.ws?.readyState;
        if (wsState !== undefined && wsState !== 1) {
            addLog('warn', `[Watchdog] [${id}] WebSocket fermé (readyState=${wsState}) — reconnexion`);
            state.connection = 'close';
            teardownSession(state);
            scheduleReconnect(id, 3000, true);
            continue;
        }

        // ── 2. Détection zombie : inactif depuis ZOMBIE_THRESHOLD ──
        const lastActivity = state.lastActivity || state.lastConnectedAt || 0;
        const inactiveSince = now - lastActivity;
        if (inactiveSince > ZOMBIE_THRESHOLD_MS) {
            addLog('info', `[Watchdog] [${id}] Inactif depuis ${Math.round(inactiveSince/60000)}min — vérification WS ping...`);
            const alive = await wsPingCheck(state.sock);
            if (!alive) {
                addLog('warn', `[Watchdog] [${id}] Zombie détecté (pas de pong après ${PING_TIMEOUT_MS/1000}s) — reconnexion forcée`);
                state.connection = 'close';
                teardownSession(state);
                scheduleReconnect(id, 5000, true);
                continue;
            }
            // Pong OK mais inactif > 2h : reconnexion préventive (zombie silencieux fréquent)
            if (inactiveSince > 2 * 60 * 60 * 1000) {
                addLog('warn', `[Watchdog] [${id}] Inactif >2h malgré pong — reconnexion préventive`);
                state.connection = 'close';
                teardownSession(state);
                scheduleReconnect(id, 5000, true);
                continue;
            }
            addLog('info', `[Watchdog] [${id}] Pong reçu — connexion OK`);
        }

    }
}, WATCHDOG_INTERVAL);

// Superviseur — vérifie toutes les 3 min que chaque session est bien connectée
setInterval(superviseSessions, 3 * 60 * 1000);

// Reconnexion préventive optionnelle (PROACTIVE_RECONNECT_HOURS=0 désactivé par défaut)
const PROACTIVE_RECONNECT_HOURS = parseInt(process.env.PROACTIVE_RECONNECT_HOURS || '0', 10);
if (PROACTIVE_RECONNECT_HOURS > 0) {
    const PROACTIVE_RECONNECT_MS = PROACTIVE_RECONNECT_HOURS * 60 * 60 * 1000;
    setInterval(() => {
        for (const [id, state] of sessions) {
            if (state.connection !== 'open' || !state.sock) continue;
            addLog('info', `[Maintenance] Reconnexion préventive [${id}] (toutes les ${PROACTIVE_RECONNECT_HOURS}h)`);
            state.connection = 'close';
            teardownSession(state);
            scheduleReconnect(id, 2000, true);
        }
    }, PROACTIVE_RECONNECT_MS);
}

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

        let lockRes = await tryAcquireLock({ db, lockName, ownerId, ttlMs });
        if (!lockRes.ok) {
            addLog('warn', `[Lock] Lock détenu par ${lockRes.holder} — nouvelle tentative (redéploiement Render)...`);
            const lockDeadline = Date.now() + 90_000;
            while (!lockRes.ok && Date.now() < lockDeadline) {
                await new Promise(r => setTimeout(r, 5000));
                lockRes = await tryAcquireLock({ db, lockName, ownerId, ttlMs });
            }
        }
        if (!lockRes.ok) {
            addLog('warn', `[Lock] Impossible d'acquérir le lock (${lockRes.holder}) — restauration Mongo sans WhatsApp`);
        } else {
            addLog('success', `[Lock] Instance active (${lockName}) — WhatsApp autorisé`);
        }

        const hb = lockRes.ok ? startLockHeartbeat({
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
        }) : { stop: () => {} };

        const shutdown = async (signal) => {
            console.log(`[Process] 🛑 ${signal} reçu — arrêt gracieux...`);
            try { hb.stop(); } catch {}
            // Sauvegarder toutes les sessions actives + flush debounce (max 20s)
            try {
                await Promise.race([
                    (async () => {
                        await saveAllActiveSessions(sessions);
                        await flushAllPendingSaves();
                    })(),
                    new Promise(r => setTimeout(r, 20_000))
                ]);
                console.log('[Process] ✅ Sessions MongoDB sauvegardées');
            } catch {}
            // Relâcher le lock distribué
            try { await releaseLock({ db, lockName, ownerId }); } catch {}
            // Nettoyer /tmp APRÈS le flush
            cleanupTempSessions();
            process.exit(0);
        };
        process.on('SIGINT',  () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

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
        addLog('warn', '[MongoDB] ❌ Non connecté — vérifie MONGODB_URI sur Render + IP 0.0.0.0/0 sur Atlas');
        // ── Fallback SESSION_STRING env si MongoDB indisponible ──
        addLog('warn', '[MongoDB] Fallback SESSION_STRING si défini');
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
        const startAll = process.env.START_ALL_SESSIONS === '1'; // désactivé par défaut — évite les 440 storm au démarrage
        const list = [...sessionsToStart].sort();
        const selected = startAll ? list : [list[list.length - 1]];
        addLog('info', `${selected.length}/${list.length} session(s) lancée(s): ${selected.join(', ')}${startAll ? '' : ' (START_ALL_SESSIONS=1 pour tout lancer)'}`);

        // Démarrage séquentiel (petit délai) pour éviter un burst de connexions
        for (const [i, id] of selected.entries()) {
            setTimeout(() => startSession(id), i * 1500);
        }
    }
}

// Helpers internes (usage non-HTTP)
function readBody(req) {
    return new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{r(JSON.parse(b));}catch{r({});} }); });
}
function buildSessionDetail(s) {
    const agg = getAggregatedStats();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    return {
        id: s.id,
        connection: s.connection,
        connectedNumber: s.connectedNumber,
        ownerLid: s.ownerLid || null,
        qrCode: s.qrCode,
        pairingCode: s.pairingCode,
        commandsCount: s.commandsCount,
        messagesCount: s.messagesCount,
        createdAt: s.createdAt,
        lastPing: s.lastPing,
        recentCommands: (s.recentCommands || []).slice(-20),
        uptime,
        uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        totalUsers: agg.totalUsers,
        totalCommands: agg.totalCmds,
        topCommands: agg.topCmds,
        users: agg.users,
        prefix: PREFIX,
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        node: process.version,
    };
}

// ════════════════════════════════════════════════════════════════════
// SÉCURITÉ DASHBOARD — Protection maximale
// ════════════════════════════════════════════════════════════════════
import { randomBytes, timingSafeEqual, createHash } from 'crypto';

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
    const now = Date.now();
    const e = loginTracker.get(ip) || { attempts:0, lockedUntil:0, windowStart:now };
    if (e.lockedUntil > now) return; // déjà bloqué
    if (now - e.windowStart > LOGIN_WINDOW) { e.attempts=0; e.windowStart=now; }
    e.attempts++;
    if (e.attempts >= LOGIN_MAX) {
        e.lockedUntil = now + LOCKOUT_TIME;
        addLog('warn', `[Auth] IP ${ip} bloquée 30 min (${LOGIN_MAX} tentatives)`);
    }
    loginTracker.set(ip, e);
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
        if (_dashboardHtml) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=300', ...SEC_HEADERS });
            return res.end(_dashboardHtml);
        }
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
        if (!checkPassword(pwd)) {
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
    // Par défaut on renvoie 200 même si 0 session connectée (évite alertes auto).
    // Pour un check strict: ?strict=1 ou STRICT_HEALTH_CHECK=1 → 503 si 0 connectée.
    if (pathname==='/api/health' && method==='GET') {
        const sessionsList = [...sessions.values()].map(s => ({
            id: s.id,
            status: s.connection,
            messagesCount: s.messagesCount,
            lastActivity: s.lastActivity
        }));
        const connectedCount = sessionsList.filter(s => s.status === 'open').length;
        const strict = url.searchParams.get('strict') === '1' || process.env.STRICT_HEALTH_CHECK === '1';
        // Retourner 503 seulement si strict activé et aucune session connectée
        const httpStatus = (strict && connectedCount === 0) ? 503 : 200;
        return sendJson(res, {
            status: connectedCount > 0 ? 'ok' : 'degraded',
            uptime: Math.round((Date.now() - startTime) / 1000),
            sessions: sessionsList.length,
            connected: connectedCount,
            timestamp: new Date().toISOString()
        }, httpStatus);
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
            ownerNumber:s.connectedNumber, ownerLid:s.ownerLid||null,
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
        return sendJson(res, buildSessionDetail(s));
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
        addLog('warn', 'SÉCURITÉ: Changez DASHBOARD_PASSWORD dans les variables d\'environnement !');
    }
});

loadExistingSessions()
    .then(() => setTimeout(superviseSessions, 45_000))
    .catch(e => console.error('[Boot] Erreur loadExistingSessions:', e.message));

// Backup MongoDB toutes les 5 min (sécurité si Render coupe brutalement)
setInterval(() => {
    if (sessions.size > 0) saveAllActiveSessions(sessions).catch(() => {});
}, 5 * 60 * 1000);

// ══════════════════════════════════════════════════════════════
// SELF-PING — Empêche Render (et Railway) de mettre le service en veille
//
// Render Free : s'endort après 15 min sans trafic HTTP → WhatsApp coupé.
// Activé automatiquement si RENDER_EXTERNAL_URL est présent.
//
// Variables :
//   SELF_PING=0  → désactiver (ex. UptimeRobot externe)
//   SELF_PING=1  → forcer (utile sur Fly si besoin)
//   SELF_PING_URL → URL personnalisée (sinon auto via RENDER_EXTERNAL_URL)
// ══════════════════════════════════════════════════════════════
(function startSelfPing() {
    const onRender  = !!process.env.RENDER_EXTERNAL_URL;
    const onFly     = !!process.env.FLY_APP_NAME;
    const explicit  = process.env.SELF_PING;

    if (explicit === '0') return;
    // Fly a déjà un health check externe → off sauf SELF_PING=1
    if (onFly && explicit !== '1') return;
    // Render : on par défaut (évite le sleep Free après 15 min)
    if (!onRender && !onFly && explicit !== '1' && !process.env.RAILWAY_PUBLIC_DOMAIN) return;

    const PING_INTERVAL_MS = 4 * 60 * 1000; // < 15 min (seuil sleep Render Free)

    function getPingUrl() {
        if (process.env.SELF_PING_URL) return process.env.SELF_PING_URL;
        // Fly.io
        if (process.env.FLY_APP_NAME) return `https://${process.env.FLY_APP_NAME}.fly.dev/api/health`;
        // Render
        if (process.env.RENDER_EXTERNAL_URL) return `${process.env.RENDER_EXTERNAL_URL}/api/health`;
        // Railway
        if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/health`;
        return `http://127.0.0.1:${PORT}/api/health`;
    }

    const doSelfPing = () => {
        const url = getPingUrl();
        axios.get(url, { timeout: 10000 })
            .then((res) => {
                const connected = res.data?.connected ?? 0;
                if (connected === 0) {
                    addLog('warn', '[SelfPing] Aucune session connectée — supervision');
                    superviseSessions();
                }
            })
            .catch(e => addLog('warn', `[SelfPing] Échec ping ${url}: ${e.message}`));
    };

    // Attendre 30s après le démarrage avant le premier ping
    setTimeout(() => {
        doSelfPing();
        setInterval(doSelfPing, PING_INTERVAL_MS);
    }, 30_000);

    const host = onRender ? 'Render' : onFly ? 'Fly' : 'local';
    addLog('info', `[SelfPing] Keep-alive ${host} (toutes les ${PING_INTERVAL_MS / 60000} min) → ${getPingUrl()}`);
})();