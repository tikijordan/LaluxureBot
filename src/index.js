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
import NodeCache from 'node-cache';
dotenv.config();
process.on('uncaughtException', (err) => {
    console.error('❌ [Process] Uncaught Exception:', err.message);
    if (err.message.includes('Connection Closed') || err.message.includes('Precondition Required')) {
        console.error('   → Baileys connection error (expected during reconnect)');
    } else {
        console.error('   → Stack:', err.stack);
    }
});

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
    const combined = rejectionToString(err);
    if (!combined) return false;
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
const SESSIONS_ROOT = path.join(os.tmpdir(), 'wa-bot-sessions');
const DATA_ROOT     = path.join(__dirname, '../data');
const DASH_DIR      = path.join(__dirname, '../dashboard');
const PREFIX        = process.env.PREFIX || '!';
const PORT          = parseInt(process.env.PORT || '3000');
const BIND_HOST     = process.env.BIND_HOST || '0.0.0.0';
const startTime     = Date.now();
fse.ensureDirSync(SESSIONS_ROOT);
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
if (!global.noTagGroups)  global.noTagGroups  = new Set();
if (!global.mutedMembers) global.mutedMembers  = new Set();
if (!global.botMessages)  global.botMessages   = new Map();
if (!global.automodGroups)    global.automodGroups    = new Set();
if (!global.floodGroups)      global.floodGroups      = new Map();
if (!global.floodTracker)     global.floodTracker     = new Map();
if (!global.maxMembersGroups) global.maxMembersGroups = new Map();
if (!global.lockdownGroups)   global.lockdownGroups   = new Set();
if (!global.antifakeGroups)   global.antifakeGroups   = new Set();
if (!global.slowmodeLastMsg)  global.slowmodeLastMsg  = new Map();
if (!global.captchaPending)   global.captchaPending   = new Map();
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

cleanupTempSessions();
const processedMsgIds = new Map(); // msgId → timestamp
const MSG_TTL = 10 * 60 * 1000;   // 10 minutes par message
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of processedMsgIds) {
        if (now - ts > MSG_TTL) processedMsgIds.delete(id);
    }
}, 60 * 1000); // check toutes les minutes
if (typeof global.gc === 'function') {
    setInterval(() => { try { global.gc(); } catch {} }, 5 * 60 * 1000);
}

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
import { connectMongo, saveSessionMongo, restoreAllSessions, deleteSessionMongo, deleteAllSessionsMongo, scheduleSave, getMongoDb, flushAllPendingSaves, readSessionFiles, migrateSessionId } from './utils/mongostore.js';
import { buildOwnerId, tryAcquireLock, startLockHeartbeat, releaseLock, forceReleaseExpiredLock, forceStealStaleLock, forceStealOlderDeploy } from './utils/instancelock.js';
import { autoSaveViewOnce, isViewOnceMessage, extractViewOnceInner, downloadViewOnceBuffer, persistViewOnce, notifyOwnerViewOnce } from './utils/viewonce.js';
import { isAntilinkEnabled } from './utils/antilink.js';
import { getFilters as getBadWordFilters } from './utils/filter.js';
import { getSlowmode } from './utils/slowmode.js';
import { isBanned } from './utils/banned.js';
import { isFiltered as isMediaFiltered } from './utils/mediafilter.js';
import { addWarn, resetWarns } from './utils/warns.js';
import { isVip } from './utils/vip.js';
import { isWhitelisted } from './utils/whitelist.js';
import { getWelcomeConfig } from './utils/welcome.js';
import { isCaptchaEnabled, createChallenge } from './utils/captcha.js';
import { log as logGroupAction } from './utils/grouplogs.js';
const sessions = new Map();
global.sessions = sessions; // exposé pour que les commandes accèdent aux sockets de toutes les sessions
const logs = [];
const activeSocketByNumber = new Map(); // number -> { sessionId, sock }
const reconnectTimerBySessionId = new Map(); // sessionId -> timeout
const reconnectBackoffBySessionId = new Map(); // sessionId -> { delayMs }
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
    if (e.count >= 3) return 5 * 60 * 1000;
    return 0;
}

function getNextBackoffMs(sessionId, reasonCode) {
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

async function startSession(sessionId, phoneNumber = null) {
    const existing = sessions.get(sessionId);
    if (existing && (existing.connection === 'open' || existing.connection === 'connecting')) { 
        addLog('warn',`Session ${sessionId} ignorée : ${existing.connection}`); 
        return; 
    }

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
    const saveCreds = async () => {
        try { fse.ensureDirSync(state.authPath); } catch {}
        return _saveCreds();
    };

    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });
    if (!state.groupMetaCache) state.groupMetaCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });
    const groupMetaCache = state.groupMetaCache;
    const sock = makeWASocket({
        version, logger, printQRInTerminal: false,
        auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
        browser: ['Ubuntu','Chrome','20.0.0'],
        syncFullHistory: false, markOnlineOnConnect: true,
        connectTimeoutMs: 60000, defaultQueryTimeoutMs: 0,
        retryRequestDelayMs: 2000, maxMsgRetryCount: 2, keepAliveIntervalMs: 25000,
        cachedGroupMetadata: async (jid) => groupMetaCache.get(jid),
    });

    state.sock = sock;
    if (!sock.__sendMessageWrapped) {
        const _origSendMessage = sock.sendMessage.bind(sock);
        sock.sendMessage = async (jid, content, options) => {
            const result = await _origSendMessage(jid, content, options);
            try {
                if (jid && jid.endsWith('@g.us') && result?.key) {
                    if (!global.botMessages.has(jid)) global.botMessages.set(jid, []);
                    const arr = global.botMessages.get(jid);
                    arr.push(result.key);
                    if (arr.length > 100) arr.splice(0, arr.length - 100);
                }
            } catch {}
            return result;
        };

        sock.__sendMessageWrapped = true;
    }

    function wrapHandler(name, handler) {
        return async (...args) => {
            try {
                return await handler(...args);
            } catch (err) {
                if (err.message.includes('Connection Closed') || err.message.includes('Precondition Required')) {
                    console.error(`[${name}] Connection error (expected):`, err.message);
                } else {
                    console.error(`[${name}] Unhandled error:`, err.message);
                    console.error(err.stack);
                }
            }
        };
    }

    sock.ev.on('creds.update', wrapHandler('creds.update', async () => {
        await saveCreds(); // Écriture disque local
        await saveSessionMongo(state.id, state.connectedNumber || state.id, state.authPath).catch(() => {});
        scheduleSave(state.id, state.connectedNumber || state.id, state.authPath);
        try {
            const sessionData = readSessionFiles(state.authPath);
            if (Object.keys(sessionData).length > 0)
                state.sessionString = Buffer.from(JSON.stringify(sessionData)).toString('base64');
        } catch {}
    }));

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

    sock.ev.on('lid-mapping.update', ({ pn, lid }) => {
        if (!pn || !lid) return;
        const pnNum  = pn.split(':')[0].split('@')[0].replace(/\D/g, '');
        const lidNum = lid.split('@')[0].split(':')[0];
        if (!state.lidCache) state.lidCache = {};
        state.lidCache[lidNum] = pnNum;   // LID → numéro
        state.lidCache[pnNum]  = lidNum;  // numéro → LID (pour lookup inverse)
        const ownerNum = (state.connectedNumber || sock.user?.id?.split(':')[0] || '').replace(/\D/g, '');
        if (ownerNum && pnNum === ownerNum && state.ownerLid !== lidNum) {
            state.ownerLid = lidNum;
            addLog('info', `[${state.id}] ownerLid corrigé via lid-mapping.update: ${lidNum}`);
        }
    });

    sock.ev.on('messages.reaction', async (events) => {
        for (const { key, reaction } of events) {
            try {
                if (!reaction?.text) continue;          // réaction retirée → ignorer
                const reactorJid = reaction.key?.participant || reaction.key?.remoteJid || '';
                const reactorIsLid = reactorJid.endsWith('@lid');
                const reactorLidNum = reactorIsLid ? reactorJid.split('@')[0].split(':')[0] : null;
                const isOwnerReaction = !!reaction.key?.fromMe
                    || (state.ownerLid && reactorLidNum && reactorLidNum === state.ownerLid);
                if (!isOwnerReaction) continue;          // seul l'owner (toi) peut déclencher — on ignore tout le reste AVANT de logger, pour ne pas spammer les logs avec les réactions des autres membres
                addLog('info', `[${state.id}] REACTION (owner) reçue: text="${reaction?.text}" targetId=${key?.id} enCache=${!!state.voCache?.get(key?.id)}`);
                if (!key?.id) continue;
                const cached = state.voCache?.get(key.id);
                if (!cached) continue; // pas une vue unique connue (ou déjà expirée du cache)
                const inner = extractViewOnceInner(cached.msg.message);
                if (!inner) continue;
                try {
                    const { buffer, kind, obj } = await downloadViewOnceBuffer(inner);
                    const { filename } = persistViewOnce(OWNER, cached.senderNumber, kind, buffer);
                    await notifyOwnerViewOnce(sock, OWNER, { buffer, kind, obj }, {
                        senderNumber: cached.senderNumber,
                        senderJid: cached.senderJid,
                        isGroup: cached.isGroup,
                        from: cached.from,
                        rawJid: cached.rawJid,
                    }, { filename });
                    addLog('info', `[${state.id}] VO récupérée via réaction manuelle (secours)`);
                } catch (e) {
                    console.error('[VO réaction] Erreur extraction:', e.message);
                    try {
                        await sock.sendMessage(`${OWNER}@s.whatsapp.net`, {
                            text: `❌ Échec de l'extraction par réaction (média peut-être expiré).\nDe: @${cached.senderNumber}`,
                        });
                    } catch {}
                }
            } catch (e) {
                addLog('error', `[${state.id}] VO réaction: ${e.message}`);
            }
        }
    });

    setInterval(() => {
        if (!state.voCache) return;
        const now = Date.now();
        for (const [id, entry] of state.voCache) {
            if (now - entry.ts > 24 * 60 * 60 * 1000) state.voCache.delete(id);
        }
    }, 60 * 60 * 1000);
    sock.ev.on('group-participants.update', wrapHandler('group-participants.update', async ({ id: from, participants, action }) => {
        if (!from || !participants?.length) return;
        try {
            const meta = await sock.groupMetadata(from).catch(() => null);
            if (meta) state.groupMetaCache?.set(from, meta); // garder le cache à jour après un changement de membres
            const groupName = meta?.subject || '';
            if (action === 'add') {
                for (const jid of participants) {
                    const number = jid.split('@')[0];
                    const name = number;
                    if (global.antifakeGroups.has(from)) {
                        const isSuspect = !/^\d{8,15}$/.test(number) ||
                            /^(1|0)/.test(number); // formats manifestement invalides
                        if (isSuspect) {
                            try {
                                await sock.groupParticipantsUpdate(from, [jid], 'remove');
                                logGroupAction(from, 'antifake_kick', 'system', number);
                            } catch {}
                            continue;
                        }
                    }
                    const max = global.maxMembersGroups.get(from);
                    if (max && meta?.participants?.length > max) {
                        try {
                            await sock.groupParticipantsUpdate(from, [jid], 'remove');
                            await sock.sendMessage(from, { text: `👥 Groupe complet (limite: ${max}), *${number}* a été refusé.` });
                        } catch {}
                        continue;
                    }
                    if (global.lockdownGroups.has(from)) {
                        try { await sock.groupParticipantsUpdate(from, [jid], 'remove'); } catch {}
                        continue;
                    }
                    try {
                        const config = getWelcomeConfig(from);
                        if (config?.welcome) {
                            const text = config.welcome
                                .replace(/{nom}/g, name)
                                .replace(/{groupe}/g, groupName)
                                .replace(/{date}/g, new Date().toLocaleDateString('fr-FR'));
                            await sock.sendMessage(from, { text, mentions: [jid] });
                        }
                    } catch {}
                    if (isCaptchaEnabled(from)) {
                        try {
                            const challenge = createChallenge(from, jid);
                            if (challenge) {
                                await sock.sendMessage(jid, {
                                    text: `🔐 Vérification anti-bot pour rejoindre *${groupName}*\n\n${challenge.question}\n\n_Réponds en privé dans les 2 minutes, sinon tu seras expulsé._`,
                                });
                                const key = `${from}__${jid}`;
                                if (global.captchaPending.get(key)?.timer) clearTimeout(global.captchaPending.get(key).timer);
                                const timer = setTimeout(async () => {
                                    if (global.captchaPending.get(key)) {
                                        try { await sock.groupParticipantsUpdate(from, [jid], 'remove'); } catch {}
                                        global.captchaPending.delete(key);
                                    }
                                }, 2 * 60 * 1000);
                                global.captchaPending.set(key, { answer: challenge.answer, timer });
                            }
                        } catch {}
                    }
                }
            } else if (action === 'remove') {
                for (const jid of participants) {
                    const number = jid.split('@')[0];
                    try {
                        const config = getWelcomeConfig(from);
                        if (config?.goodbye) {
                            const text = config.goodbye
                                .replace(/{nom}/g, number)
                                .replace(/{groupe}/g, groupName)
                                .replace(/{date}/g, new Date().toLocaleDateString('fr-FR'));
                            await sock.sendMessage(from, { text });
                        }
                    } catch {}
                    const key = `${from}__${jid}`;
                    if (global.captchaPending.has(key)) {
                        clearTimeout(global.captchaPending.get(key).timer);
                        global.captchaPending.delete(key);
                    }
                }
            }
        } catch (err) {
            addLog('error', `[${state.id}] group-participants.update: ${err.message}`);
        }
    }));

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && !phoneNumber) {
            state.qrCode = qr;
            state.connection = 'connecting';
            qrcodeterminal.generate(qr, { small: true });
            addLog('info', `[${sessionId}] QR prêt — scannez avec WhatsApp`);
        }

        if (connection === 'open') {
            const num = sock.user?.id?.split(':')[0] || sock.user?.id || sessionId;
            state.ownerLid = sock.user?.lid ? sock.user.lid.split('@')[0].split(':')[0] : null;
            if (!state.ownerLid && num) {
                try {
                    const ownerPnJid = num + '@s.whatsapp.net';
                    const pairs = await sock.signalRepository.lidMapping.getLIDsForPNs([ownerPnJid]);
                    if (pairs && pairs.length > 0) {
                        state.ownerLid = pairs[0].lid.split('@')[0].split(':')[0];
                        addLog('info', `[${sessionId}] ownerLid résolu: ${state.ownerLid}`);
                    }
                } catch {}
            }
            if (!state.ownerLid && num) {
                [5000, 15000, 30000].forEach(delay => {
                    setTimeout(async () => {
                        if (state.ownerLid || state.connection !== 'open') return;
                        try {
                            if (sock.user?.lid) {
                                state.ownerLid = sock.user.lid.split('@')[0].split(':')[0];
                                addLog('info', `[${state.id}] ownerLid résolu (retry ${delay/1000}s, sock.user.lid): ${state.ownerLid}`);
                                return;
                            }
                            const pairs = await sock.signalRepository.lidMapping.getLIDsForPNs([`${num}@s.whatsapp.net`]);
                            if (pairs?.[0]?.lid) {
                                state.ownerLid = pairs[0].lid.split('@')[0].split(':')[0];
                                addLog('info', `[${state.id}] ownerLid résolu (retry ${delay/1000}s, getLIDsForPNs): ${state.ownerLid}`);
                            }
                        } catch {}
                    }, delay);
                });
            }
            state.connection = 'open';
            state.qrCode = null;
            state.pairingCode = null;
            state.connectedNumber = num;
            state.lastActivity    = Date.now();
            state.lastConnectedAt = Date.now(); // pour la reconnexion périodique
            reconnectBackoffBySessionId.set(state.id, { delayMs: 3000 });
            ensureSingleActiveSocketForNumber(num, state.id, sock);
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
                await migrateSessionId(sessionId, num, num, state.authPath).catch(e =>
                    addLog('warn', `[MongoDB] migrateSessionId: ${e.message}`)
                );
                addLog('success', `Session renommée [${sessionId}] → [${num}]`);
                addLog('info', `[${num}] Redémarrage automatique des handlers...`);
                try { sock.end(); } catch {}
                setTimeout(() => {
                    try { if (authPath !== newPath) fse.removeSync(authPath); } catch {}
                    startSession(num);
                }, 1500);
                return; // stop — ce socket est mort, le nouveau prendra le relais
            }
            addLog('success', `[${state.id}] Connecté — Owner auto: ${num}${state.ownerLid ? ` (LID: ${state.ownerLid})` : ''} | Préfixe: ${PREFIX}`);
            (async () => {
                try {
                    const allGroups = await sock.groupFetchAllParticipating();
                    let count = 0;
                    for (const [jid, meta] of Object.entries(allGroups || {})) {
                        state.groupMetaCache.set(jid, meta);
                        count++;
                    }
                    addLog('info', `[${state.id}] Cache métadonnées de groupe préchauffé (${count} groupe(s))`);
                } catch (e) {
                    addLog('warn', `[${state.id}] Préchauffage groupMetaCache: ${e.message}`);
                }
            })();
            try {
                const sessionData = readSessionFiles(state.authPath);
                if (Object.keys(sessionData).length > 0) {
                    const sStr = Buffer.from(JSON.stringify(sessionData)).toString('base64');
                    if (process.env.DEBUG_SESSION_STRING === '1') {
                        console.log(`\n========== SESSION_STRING [${state.id}] ==========\n${sStr}\n==================================================\n`);
                        addLog('info', `[${state.id}] SESSION_STRING loggée (DEBUG_SESSION_STRING=1)`);
                    } else {
                        addLog('info', `[${state.id}] SESSION_STRING prête (masquée) — active DEBUG_SESSION_STRING=1 pour l'afficher`);
                    }
                    state.sessionString = sStr;
                }
            } catch {}
            try { await saveSessionMongo(state.id, num, state.authPath); } catch(e) { addLog('warn', `[MongoDB] saveSession: ${e.message}`); }
            if (state.pingInterval) clearInterval(state.pingInterval);
            state.pingInterval = setInterval(async () => {
                try { await sock.sendPresenceUpdate('available'); state.lastPing = new Date().toISOString(); } catch {}
            }, 30_000);
            if (state.healthCheckInterval) clearInterval(state.healthCheckInterval);
            state.healthCheckInterval = setInterval(async () => {
                const wsState = sock.ws?.readyState;
                if (wsState === 3) {
                    addLog('warn', `[${state.id}] Health check: socket CLOSED sans événement — reconnexion`);
                    state.connection = 'close';
                    scheduleReconnect(state.id, 3000);
                    return;
                }
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
            try {
                const n = state.connectedNumber;
                const prev = n ? activeSocketByNumber.get(n) : null;
                if (prev?.sock === sock) activeSocketByNumber.delete(n);
            } catch {}
            if (code === DisconnectReason.loggedOut) {
                addLog('warn', `[${state.id}] Session loggedOut (401) — suppression complète (local + Mongo)`);
                try { await sock.end(); } catch {}
                try {
                    const n = state.connectedNumber;
                    if (n && activeSocketByNumber.get(n)?.sock === sock) activeSocketByNumber.delete(n);
                } catch {}
                try { fse.removeSync(path.join(SESSIONS_ROOT, state.id)); } catch {}
                sessions.delete(state.id);
                deleteSessionMongo(state.id).catch(() => {});
            } else {
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
        if (type !== 'notify') {
            const isRecentAppend = type === 'append' && messages.every(m => {
                const ts = Number(m.messageTimestamp) * 1000;
                return ts && (Date.now() - ts) < 20_000;
            });
            if (!isRecentAppend) return;
        }

        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
            state.lastActivity = Date.now();
            const msgId = msg.key.id;
            if (!msgId || processedMsgIds.has(msgId)) continue;
            processedMsgIds.set(msgId, Date.now());
            state.messagesCount++;
            try {
                const rawJid  = msg.key.remoteJid;
                const fromMe  = msg.key.fromMe;
                const isGroup = rawJid.endsWith('@g.us');
                const isLid   = rawJid.endsWith('@lid');
                const rawConnected = state.connectedNumber || sock.user?.id?.split(':')[0] || '';
                const connectedNum = rawConnected.includes(':') ? rawConnected.split(':')[0].replace(/\D/g, '') : rawConnected.replace(/\D/g, '');
                const OWNER = connectedNum;
                if (!OWNER) continue; // session pas encore connectée (QR/pairing en attente)
                const OWNER_PERSONAL = (process.env.OWNER_NUMBER || '').replace(/\D/g, '').replace(/^0+/, '');
                const from  = isGroup ? rawJid : rawJid;
                let senderJid, senderNumber;
                const cleanPhone = jid => (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
                if (fromMe) {
                    senderNumber = OWNER;
                    senderJid    = isGroup ? (msg.key.participant || OWNER + '@s.whatsapp.net') : OWNER + '@s.whatsapp.net';
                } else if (isGroup) {
                    senderJid = msg.key.participant || '';
                    const isParticipantLid = senderJid.endsWith('@lid');
                    if (isParticipantLid) {
                        const lidNum = senderJid.split('@')[0].split(':')[0];
                        if (state.lidCache?.[lidNum]) {
                            senderNumber = state.lidCache[lidNum];
                            senderJid    = senderNumber + '@s.whatsapp.net';
                        } else if (msg.key.participantAlt && !msg.key.participantAlt.endsWith('@lid')) {
                            senderNumber = msg.key.participantAlt.split(':')[0].split('@')[0].replace(/\D/g, '');
                            senderJid    = senderNumber + '@s.whatsapp.net';
                            if (!state.lidCache) state.lidCache = {};
                            state.lidCache[lidNum] = senderNumber;
                        } else if (state.lidFailCache?.[lidNum] && Date.now() - state.lidFailCache[lidNum] < 5 * 60_000) {
                            senderNumber = lidNum;
                        } else {
                            try {
                                const pn = await sock.signalRepository.lidMapping.getPNForLID(senderJid);
                                if (pn) {
                                    senderNumber = pn.split(':')[0].split('@')[0].replace(/\D/g, '');
                                    senderJid    = senderNumber + '@s.whatsapp.net';
                                    if (!state.lidCache) state.lidCache = {};
                                    state.lidCache[lidNum] = senderNumber;
                                } else {
                                    senderNumber = lidNum;
                                    if (!state.lidFailCache) state.lidFailCache = {};
                                    state.lidFailCache[lidNum] = Date.now();
                                }
                            } catch {
                                senderNumber = lidNum;
                                if (!state.lidFailCache) state.lidFailCache = {};
                                state.lidFailCache[lidNum] = Date.now();
                            }
                        }
                    } else {
                        senderNumber = cleanPhone(senderJid);
                    }
                } else {
                    senderNumber = cleanPhone(rawJid);
                    senderJid    = senderNumber + '@s.whatsapp.net';
                }
                const normalize = n => (n || '').replace(/\D/g, '').replace(/^0+/, '');
                let OWNER_LID = state.ownerLid || null;
                if (!OWNER_LID && isGroup && OWNER && (!state.ownerLidLastTry || Date.now() - state.ownerLidLastTry > 60_000)) {
                    state.ownerLidLastTry = Date.now();
                    try {
                        const pairs = await sock.signalRepository.lidMapping.getLIDsForPNs([`${OWNER}@s.whatsapp.net`]);
                        if (pairs && pairs.length > 0 && pairs[0]?.lid) {
                            OWNER_LID = pairs[0].lid.split('@')[0].split(':')[0];
                            state.ownerLid = OWNER_LID;
                            addLog('info', `[${state.id}] ownerLid résolu à la demande: ${OWNER_LID}`);
                        }
                    } catch {}
                }
                const senderIsLid = senderJid.endsWith('@lid');
                const isOwner = fromMe
                    || (OWNER && normalize(senderNumber) === normalize(OWNER))
                    || (OWNER_PERSONAL && normalize(senderNumber) === OWNER_PERSONAL)
                    || (OWNER_LID && senderIsLid && senderJid.split('@')[0].split(':')[0] === OWNER_LID);
                const ct = getContentType(msg.message);
                let body = '';
                if (ct==='conversation') body=msg.message.conversation||'';
                else if (ct==='extendedTextMessage') body=msg.message.extendedTextMessage?.text||'';
                else if (ct==='imageMessage') body=msg.message.imageMessage?.caption||'';
                else if (ct==='videoMessage') body=msg.message.videoMessage?.caption||'';
                const voMsgContent = msg.message?.ephemeralMessage?.message || msg.message;
                const voCt = voMsgContent === msg.message ? ct : getContentType(voMsgContent);
                const isVOraw = /^viewOnceMessage/.test(voCt)
                    || voMsgContent?.imageMessage?.viewOnce === true
                    || voMsgContent?.videoMessage?.viewOnce === true
                    || voMsgContent?.audioMessage?.viewOnce === true;
                if (isVOraw) {
                    if (isViewOnceMessage(msg)) {
                        autoSaveViewOnce(sock, msg, OWNER, {
                            senderNumber, senderJid, isGroup, from, rawJid,
                        }).catch(e => addLog('error', `[${state.id}] AutoVO: ${e.message}`));
                    }
                    if (!state.voCache) state.voCache = new Map();
                    if (msg.key?.id) {
                        state.voCache.set(msg.key.id, {
                            msg, senderNumber, senderJid, isGroup, from, rawJid, ts: Date.now(),
                        });
                    }
                }
                if (!isGroup && !fromMe && body && global.captchaPending?.size) {
                    let handledCaptcha = false;
                    for (const [key, data] of global.captchaPending) {
                        const [gJid, pJid] = key.split('__');
                        if (pJid !== rawJid && pJid.split('@')[0] !== senderNumber) continue;
                        handledCaptcha = true;
                        if (body.trim() === String(data.answer)) {
                            clearTimeout(data.timer);
                            global.captchaPending.delete(key);
                            await sock.sendMessage(rawJid, { text: '✅ Vérification réussie ! Tu as maintenant accès au groupe.' });
                        } else {
                            await sock.sendMessage(rawJid, { text: '❌ Mauvaise réponse, réessaie.' });
                        }
                        break;
                    }
                    if (handledCaptcha) continue;
                }
                const isCmd = body.startsWith(PREFIX);
                let replyTo = from;
                if (!isGroup && isCmd && isOwner && OWNER) {
                    replyTo = `${OWNER}@s.whatsapp.net`;
                }
                if (fromMe && !isCmd) continue;
                if (isGroup) trackGroupMsg(from, senderJid);
                if (isCmd) {
                    const cmd = body.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase()||'';
                    state.commandsCount++;
                    state.recentCommands.push({ cmd, user: senderNumber, time: new Date().toISOString() });
                    if (state.recentCommands.length > 50) state.recentCommands.shift();
                    addLog('info', `[${state.id}] CMD !${cmd} par ${senderNumber}`);
                }
                const currentBotMode = getBotMode();
                if (isGroup && global.mutedMembers?.has(`${from}__${senderJid}`) && !isOwner) {
                    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
                    continue;
                }
                if (isGroup && !isOwner && !fromMe) {
                    try {
                        const exempt = isVip(senderNumber) || isWhitelisted(from, senderNumber);
                        if (!exempt) {
                            if (isBanned(from, senderNumber)) {
                                try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
                                try { await sock.groupParticipantsUpdate(from, [senderJid], 'remove'); } catch {}
                                continue;
                            }
                            const automodOn = global.automodGroups.has(from);
                            let violation = null;
                            if ((isAntilinkEnabled(from) || automodOn) && /https?:\/\/|chat\.whatsapp\.com|wa\.me\//i.test(body)) {
                                violation = 'lien non autorisé';
                            }
                            if (!violation) {
                                const badWords = getBadWordFilters(from) || [];
                                if ((badWords.length > 0 || automodOn) && body) {
                                    const lower = body.toLowerCase();
                                    const hit = badWords.find(w => w && lower.includes(String(w).toLowerCase()));
                                    if (hit) violation = `mot interdit ("${hit}")`;
                                }
                            }
                            if (violation) {
                                try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
                                const count = addWarn(from, senderNumber);
                                const MAX_WARNS = parseInt(process.env.MAX_WARNS || '3');
                                if (count >= MAX_WARNS) {
                                    await sock.sendMessage(from, {
                                        text: `🚫 @${senderNumber} a été expulsé automatiquement (${violation}, ${count}/${MAX_WARNS} avertissements).`,
                                        mentions: [senderJid],
                                    });
                                    try { await sock.groupParticipantsUpdate(from, [senderJid], 'remove'); resetWarns(from, senderNumber); } catch {}
                                } else {
                                    await sock.sendMessage(from, {
                                        text: `⚠️ @${senderNumber} — message supprimé (${violation}). Avertissement ${count}/${MAX_WARNS}.`,
                                        mentions: [senderJid],
                                    });
                                }
                                continue;
                            }
                            const mediaTypeMap = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'voice', pttMessage: 'voice' };
                            const mediaType = mediaTypeMap[ct];
                            if (mediaType && isMediaFiltered(from, mediaType)) {
                                try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
                                await sock.sendMessage(from, { text: `🚫 Envoi de ${mediaType} bloqué dans ce groupe.` });
                                continue;
                            }
                            const slow = getSlowmode(from);
                            if (slow && slow > 0) {
                                const key = `${from}__${senderNumber}`;
                                const last = global.slowmodeLastMsg.get(key) || 0;
                                const now = Date.now();
                                if (now - last < slow * 1000) {
                                    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
                                    continue;
                                }
                                global.slowmodeLastMsg.set(key, now);
                            }
                            const floodCfg = global.floodGroups.get(from);
                            if (floodCfg) {
                                const fKey = `${from}__${senderNumber}`;
                                const now = Date.now();
                                const windowMs = floodCfg.window * 1000;
                                let timestamps = (global.floodTracker.get(fKey) || []).filter(t => now - t < windowMs);
                                timestamps.push(now);
                                global.floodTracker.set(fKey, timestamps);
                                if (timestamps.length > floodCfg.max) {
                                    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
                                    const count = addWarn(from, senderNumber);
                                    await sock.sendMessage(from, { text: `🌊 @${senderNumber} flood détecté, message supprimé. Avertissement ${count}.`, mentions: [senderJid] });
                                    global.floodTracker.set(fKey, []);
                                    continue;
                                }
                            }
                        }
                    } catch (modErr) {
                        addLog('error', `[${state.id}] Modération: ${modErr.message}`);
                    }
                }
                if (!isCmd) continue;
                if (!isOwner) continue;
                await handleCommand(sock, msg, {}, {
                    body, from: replyTo, isGroup, isOwner, senderNumber, sender: senderJid,
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

async function restoreFromEnvSessionString() {
    const vars = Object.entries(process.env)
        .filter(([k]) => k === 'SESSION_STRING' || /^SESSION_STRING_\d+$/.test(k))
        .sort(([a], [b]) => a.localeCompare(b));
    if (vars.length === 0) return;
    addLog('info', `[ENV] ${vars.length} SESSION_STRING trouvée(s) — restauration...`);
    for (const [envKey, b64] of vars) {
        try {
            const sessionData = JSON.parse(Buffer.from(b64.trim(), 'base64').toString('utf-8'));
            let sessionId = 'env_session';
            try {
                const creds = JSON.parse(sessionData['creds.json'] || '{}');
                const num = creds?.me?.id?.split(':')[0] || creds?.me?.id;
                if (num) sessionId = num;
            } catch {}
            if (vars.length > 1) {
                const suffix = envKey.replace('SESSION_STRING', '').replace('_', '');
                if (suffix && sessionId === 'env_session') sessionId = `env_session_${suffix}`;
            }
            const authPath = path.join(SESSIONS_ROOT, sessionId);
            if (fs.existsSync(path.join(authPath, 'creds.json'))) {
                addLog('info', `[ENV] Session [${sessionId}] déjà sur disque — skip`);
                continue;
            }
            fse.ensureDirSync(authPath);
            for (const [filename, content] of Object.entries(sessionData)) {
                fs.writeFileSync(path.join(authPath, filename), content, 'utf-8');
            }
            addLog('success', `[ENV] Session [${sessionId}] restaurée depuis ${envKey}`);
            saveSessionMongo(sessionId, sessionId, authPath).catch(e =>
                addLog('warn', `[ENV] Persistance MongoDB [${sessionId}]: ${e.message}`)
            );
        } catch (e) {
            addLog('warn', `[ENV] Erreur restauration ${envKey}: ${e.message}`);
        }
    }
}

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
        const wsState = state.sock.ws?.readyState;
        if (wsState !== undefined && wsState !== 1) {
            addLog('warn', `[Watchdog] [${id}] WebSocket fermé (readyState=${wsState}) — reconnexion`);
            if (state.pingInterval)      { clearInterval(state.pingInterval);      state.pingInterval = null; }
            if (state.healthCheckInterval) { clearInterval(state.healthCheckInterval); state.healthCheckInterval = null; }
            state.connection = 'close';
            try { state.sock.end(); } catch {}
            scheduleReconnect(id, 3000);
            continue;
        }

        const lastActivity = state.lastActivity || state.lastConnectedAt || 0;
        const inactiveSince = now - lastActivity;
        if (inactiveSince > ZOMBIE_THRESHOLD_MS) {
            addLog('info', `[Watchdog] [${id}] Inactif depuis ${Math.round(inactiveSince/60000)}min — vérification WS ping...`);
            const alive = await wsPingCheck(state.sock);
            if (!alive) {
                addLog('warn', `[Watchdog] [${id}] Zombie détecté (pas de pong après ${PING_TIMEOUT_MS/1000}s) — reconnexion forcée`);
                if (state.pingInterval)       { clearInterval(state.pingInterval);       state.pingInterval = null; }
                if (state.healthCheckInterval){ clearInterval(state.healthCheckInterval); state.healthCheckInterval = null; }
                state.connection = 'close';
                try { state.sock.ws?.close(); } catch {}
                try { state.sock.end(); } catch {}
                scheduleReconnect(id, 5000);
                continue;
            }
            addLog('info', `[Watchdog] [${id}] Pong reçu — connexion OK, bot inactif normalement`);
            state.lastActivity = now;
        }

        try {
            await state.sock.sendPresenceUpdate('available');
            state.lastPing = new Date().toISOString();
        } catch (e) {
            addLog('warn', `[Watchdog] [${id}] sendPresence échoué: ${e.message} — reconnexion`);
            if (state.pingInterval)       { clearInterval(state.pingInterval);       state.pingInterval = null; }
            if (state.healthCheckInterval){ clearInterval(state.healthCheckInterval); state.healthCheckInterval = null; }
            state.connection = 'close';
            try { state.sock.ws?.close(); } catch {}
            try { state.sock.end(); } catch {}
            scheduleReconnect(id, 5000);
        }
    }
}, WATCHDOG_INTERVAL);
async function loadExistingSessions() {
    let sessionsToStart = [];
    const mongoOk = await connectMongo();
    if (mongoOk) {
        const db = getMongoDb();
        const lockName = process.env.INSTANCE_LOCK_NAME || 'wa-bot-main';
        const ttlMs = parseInt(process.env.INSTANCE_LOCK_TTL_MS || '60000'); // 60s
        const hbMs = parseInt(process.env.INSTANCE_LOCK_HEARTBEAT_MS || '20000'); // 20s
        const ownerId = buildOwnerId();
        const deployId = process.env.RENDER_SERVICE_ID || process.env.RAILWAY_DEPLOYMENT_ID || '';
        const lockRes = await tryAcquireLock({ db, lockName, ownerId, ttlMs, deployId });
        let lockOk = lockRes.ok;
        if (!lockOk) {
            await forceReleaseExpiredLock({ db, lockName });
            lockOk = await forceStealStaleLock({ db, lockName, ownerId, ttlMs, deployId });
            if (!lockOk && deployId) {
                lockOk = await forceStealOlderDeploy({ db, lockName, ownerId, ttlMs, deployId });
            }
            if (!lockOk) {
                const waitMs = Math.min(ttlMs / 2, 30000);
                addLog('warn', `[Lock] Lock détenu par ${lockRes.holder} — attente ${Math.round(waitMs/1000)}s...`);
                await new Promise(r => setTimeout(r, waitMs));
                const retry = await tryAcquireLock({ db, lockName, ownerId, ttlMs });
                lockOk = retry.ok;
                if (!lockOk) {
                    await forceStealStaleLock({ db, lockName, ownerId, ttlMs: 0, deployId });
                    lockOk = true;
                    addLog('warn', `[Lock] Lock forcé (takeover) — ancienne instance considérée morte`);
                }
            }
        }

        if (!lockOk) {
            addLog('warn', `[Lock] Impossible d'acquérir le lock — WhatsApp ne sera pas démarré ici.`);
            return;
        }

        addLog('success', `[Lock] Instance active (${lockName}) — WhatsApp autorisé`);
        const hb = startLockHeartbeat({
            db,
            lockName,
            ownerId,
            ttlMs,
            intervalMs: hbMs,
            deployId,
            onLost: (info) => {
                addLog('warn', `[Lock] Lock perdu (${info?.holder || 'unknown'}) — arrêt des sockets WhatsApp`);
                for (const [id, st] of sessions) {
                    try { st.sock?.ws?.close(); } catch {}
                    try { st.sock?.end?.(); } catch {}
                    st.connection = 'close';
                    clearReconnectTimer(id);
                }
            },
        });

        const shutdown = async (signal) => {
            console.log(`[Process] 🛑 ${signal} reçu — arrêt gracieux...`);
            try { hb.stop(); } catch {}
            try {
                await Promise.race([
                    flushAllPendingSaves(),
                    new Promise(r => setTimeout(r, 10000))
                ]);
                console.log('[Process] ✅ Flush terminé');
            } catch {}
            try { await releaseLock({ db, lockName, ownerId }); } catch {}
            cleanupTempSessions();
            process.exit(0);
        };

        process.on('SIGINT',  () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        addLog('info', '[MongoDB] Restauration des sessions depuis Atlas...');
        const count = await restoreAllSessions(SESSIONS_ROOT);
        if (count > 0) {
            addLog('success', `[MongoDB] ${count} session(s) restaurée(s)`);
            if (fs.existsSync(SESSIONS_ROOT)) {
                sessionsToStart = fs.readdirSync(SESSIONS_ROOT).filter(d =>
                    fs.statSync(path.join(SESSIONS_ROOT,d)).isDirectory() &&
                    fs.existsSync(path.join(SESSIONS_ROOT,d,'creds.json'))
                );
            }
        } else {
            addLog('info', '[MongoDB] Aucune session en base — premier déploiement ?');
            if (fs.existsSync(SESSIONS_ROOT)) {
                sessionsToStart = fs.readdirSync(SESSIONS_ROOT).filter(d =>
                    fs.statSync(path.join(SESSIONS_ROOT,d)).isDirectory() &&
                    fs.existsSync(path.join(SESSIONS_ROOT,d,'creds.json'))
                );
            }
        }
    } else {
        addLog('warn', '[MongoDB] Indisponible — fallback SESSION_STRING');
        await restoreFromEnvSessionString();
        if (fs.existsSync(SESSIONS_ROOT)) {
            sessionsToStart = fs.readdirSync(SESSIONS_ROOT).filter(d =>
                fs.statSync(path.join(SESSIONS_ROOT,d)).isDirectory() &&
                fs.existsSync(path.join(SESSIONS_ROOT,d,'creds.json'))
            );
        }
    }

    if (sessionsToStart.length === 0) addLog('info','Aucune session — créez-en une depuis le dashboard');
    else { 
        const startAll = process.env.START_ALL_SESSIONS === '1'; // désactivé par défaut — évite les 440 storm au démarrage
        const list = [...sessionsToStart].sort();
        const selected = startAll ? list : [list[list.length - 1]];
        addLog('info', `${selected.length}/${list.length} session(s) lancée(s): ${selected.join(', ')}${startAll ? '' : ' (START_ALL_SESSIONS=1 pour tout lancer)'}`);
        for (const [i, id] of selected.entries()) {
            setTimeout(() => startSession(id), i * 1500);
        }
    }
}

function readBody(req) {
    return new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{r(JSON.parse(b));}catch{r({});} }); });
}

function getStatsData() {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_ROOT,'stats','stats.json'),'utf8')); } catch { return {}; }
}

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

    try {
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

    if ((pathname==='/'||pathname==='/dashboard') && method==='GET') {
        if (!isAuthenticated(req)) { res.writeHead(302,{Location:'/login'}); return res.end(); }
        const hp = path.join(DASH_DIR,'index.html');
        if (fs.existsSync(hp)) { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...SEC_HEADERS}); return res.end(fs.readFileSync(hp)); }
        res.writeHead(302,{Location:'/login'}); return res.end();
    }

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

    if (pathname==='/logout' && method==='POST') {
        const token = (req.headers['cookie']||'').match(/dash_token=([^;]+)/)?.[1];
        if (token) { dashSessions.delete(token); saveDashSessions(); }
        addLog('info', `[Auth] Déconnexion depuis ${ip}`);
        res.writeHead(302, { Location:'/login', 'Set-Cookie':'dash_token=; HttpOnly; Max-Age=0; Path=/', ...SECURITY_HEADERS });
        return res.end();
    }

    if (pathname==='/api/status') return sendJson(res,{ status:'online', sessions:sessions.size, uptime:Math.floor((Date.now()-startTime)/1000) });
    if (pathname==='/api/health' && method==='GET') {
        const sessionsList = [...sessions.values()].map(s => ({
            id: s.id,
            status: s.connection,
            messagesCount: s.messagesCount,
            lastActivity: s.lastActivity
        }));

        const connectedCount = sessionsList.filter(s => s.status === 'open').length;
        const strict = url.searchParams.get('strict') === '1' || process.env.STRICT_HEALTH_CHECK === '1';
        const httpStatus = (strict && connectedCount === 0) ? 503 : 200;
        return sendJson(res, {
            status: connectedCount > 0 ? 'ok' : 'degraded',
            uptime: Math.round((Date.now() - startTime) / 1000),
            sessions: sessionsList.length,
            connected: connectedCount,
            timestamp: new Date().toISOString()
        }, httpStatus);
    }

    if (!isAuthenticated(req)) return sendJson(res,{ error:'Non autorisé — connectez-vous sur /login' },401);
    if (pathname==='/api/logs' && method==='GET') {
        const since = Math.max(0, parseInt(url.searchParams.get('since')||'0'));
        const safeLogs = logs.slice(since).map(l => ({ ...l, msg: maskSensitive(l.msg) }));
        return sendJson(res,{ logs: safeLogs, total:logs.length });
    }

    if (pathname==='/api/sessions' && method==='GET') {
        const list = [...sessions.values()].map(s=>({
            id:s.id, connection:s.connection, connectedNumber:s.connectedNumber,
            ownerNumber:s.connectedNumber, ownerLid:s.ownerLid||null,
            qrCode:s.qrCode, pairingCode:s.pairingCode||null, commandsCount:s.commandsCount, messagesCount:s.messagesCount, createdAt:s.createdAt
        }));

        return sendJson(res,{ sessions:list });
    }

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

    if ((pathname==='/api/sessions' && method==='DELETE') || (pathname==='/api/sessions/purge-all' && method==='GET')) {
        const ids = [...sessions.keys()];
        for (const sid of ids) {
            const s = sessions.get(sid);
            try { if (s?.sock) await s.sock.end(); } catch {}
            try { fse.removeSync(path.join(SESSIONS_ROOT, sid)); } catch {}
            sessions.delete(sid);
        }

        const result = await deleteAllSessionsMongo().catch(e => ({ deleted: 0, error: e.message }));
        addLog('info', `Purge totale : ${ids.length} session(s) locale(s), ${result.deleted||0} en MongoDB (IP: ${ip})`);
        return sendJson(res, { ok:true, sessionsCleared: ids.length, mongoDeleted: result.deleted||0 });
    }

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
            groupMetaCache:undefined, voCache:undefined, lidCache:undefined, lidFailCache:undefined,
            recentCommands:(s.recentCommands || []).slice(-20),
            uptime, uptimeHuman:`${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`,
            totalUsers:Object.keys(statsData).length, totalCommands:totalCmds,
            topCommands:topCmds, users, prefix:PREFIX,
            memory:Math.round(process.memoryUsage().heapUsed/1024/1024), node:process.version,
            sessionString: s.sessionString || null,
        });
    }

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
    } catch (e) {
        addLog('error', `[HTTP] Exception non gérée sur ${method} ${pathname}: ${e.message}`);
        try {
            if (!res.headersSent) return sendJson(res, { error: 'Erreur serveur interne', detail: e.message }, 500);
        } catch {}
    }
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

loadExistingSessions().catch(e => console.error('[Boot] Erreur loadExistingSessions:', e.message));
(function startSelfPing() {
    if (process.env.SELF_PING === '0') return;
    const PING_INTERVAL_MS = 4 * 60 * 1000; // toutes les 4 min (< 15 min = seuil Render Free)
    function getPingUrl() {
        if (process.env.SELF_PING_URL) return process.env.SELF_PING_URL;
        if (process.env.RENDER_EXTERNAL_URL) return `${process.env.RENDER_EXTERNAL_URL}/api/status`;
        if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/status`;
        return `http://127.0.0.1:${PORT}/api/status`;
    }

    const doSelfPing = () => {
        const url = getPingUrl();
        axios.get(url, { timeout: 10000 })
            .then(() => { /* ping silencieux — garder le service éveillé */ })
            .catch(e => addLog('warn', `[SelfPing] Échec ping ${url}: ${e.message}`));
    };

    setTimeout(() => {
        doSelfPing();
        setInterval(doSelfPing, PING_INTERVAL_MS);
    }, 30_000);
    addLog('info', `[SelfPing] Keep-alive activé (toutes les ${PING_INTERVAL_MS / 60000} min) — désactive avec SELF_PING=0`);
})();
