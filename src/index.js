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

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_ROOT = path.join(__dirname, '../sessions');
const DATA_ROOT     = path.join(__dirname, '../data');
const DASH_DIR      = path.join(__dirname, '../dashboard');
const PREFIX        = process.env.PREFIX || '!';
const PORT          = parseInt(process.env.PORT || '3000');
const BIND_HOST     = process.env.BIND_HOST || '0.0.0.0';
const startTime     = Date.now();


fse.ensureDirSync(SESSIONS_ROOT);
fse.ensureDirSync(DATA_ROOT);
['stats','notes','banned'].forEach(d => fse.ensureDirSync(path.join(DATA_ROOT, d)));

// État global partagé avec les commandes
if (!global.noTagGroups)  global.noTagGroups  = new Set();
if (!global.mutedMembers) global.mutedMembers  = new Set();
if (!global.botMessages)  global.botMessages   = new Map();

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

// Sessions Map + logs circulaires
const sessions = new Map();
const logs = [];

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
    if (existing?.connection === 'open') { addLog('warn',`Session ${sessionId} déjà active`); return; }

    const authPath = path.join(SESSIONS_ROOT, sessionId);
    fse.ensureDirSync(authPath); // ← crée le dossier AVANT useMultiFileAuthState

    const state = sessions.get(sessionId) || {
        id: sessionId, connection: 'connecting', qrCode: null, pairingCode: null,
        connectedNumber: null, sock: null, pingInterval: null,
        commandsCount: 0, messagesCount: 0, recentCommands: [],
        lastPing: null, createdAt: new Date().toISOString(),
    };
    state.connection = 'connecting';
    state.qrCode = null;
    state.pairingCode = null;
    sessions.set(sessionId, state);
    addLog('info', `Démarrage session [${sessionId}]${phoneNumber ? ' (pairing: '+phoneNumber+')' : ''}...`);

    const { state: auth, saveCreds } = await useMultiFileAuthState(authPath);
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
    sock.ev.on('creds.update', saveCreds);

    // ── Pairing code : demander le code après connexion WS
    if (phoneNumber && !auth.creds.registered) {
        // Attendre que le socket soit prêt (petit délai)
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
            // QR seulement si pas de pairing code demandé
            state.qrCode = qr;
            state.connection = 'connecting';
            qrcodeterminal.generate(qr, { small: true });
            addLog('info', `[${sessionId}] QR prêt — scannez avec WhatsApp`);
        }

        if (connection === 'open') {
            const num = sock.user?.id?.split(':')[0] || sock.user?.id || sessionId;
            state.connection = 'open';
            state.qrCode = null;
            state.pairingCode = null;
            state.connectedNumber = num;

            // Renommer la session avec le numéro réel
            // Fix ENOENT : on copie puis supprime au lieu de moveSync (évite les conflits saveCreds)
            if (sessionId !== num && !sessions.has(num)) {
                sessions.set(num, state);
                sessions.delete(sessionId);
                state.id = num;
                const newPath = path.join(SESSIONS_ROOT, num);
                if (!fs.existsSync(newPath)) {
                    try {
                        fse.ensureDirSync(newPath);
                        fse.copySync(authPath, newPath, { overwrite: true });
                        setTimeout(() => { try { fse.removeSync(authPath); } catch {} }, 2000);
                    } catch (e) { addLog('warn', `Renommage session: ${e.message}`); }
                }
                addLog('success', `Session renommée [${sessionId}] → [${num}]`);
            }

            addLog('success', `[${state.id}] ✅ Connecté — Numéro: ${num} | Préfixe: ${PREFIX}`);

            // SESSION_STRING dans les logs
            try {
                const aPath = path.join(SESSIONS_ROOT, state.id);
                const files = fs.readdirSync(aPath).filter(f => f.endsWith('.json'));
                const sessionData = {};
                files.forEach(f => { sessionData[f] = fs.readFileSync(path.join(aPath,f),'utf-8'); });
                const sStr = Buffer.from(JSON.stringify(sessionData)).toString('base64');
                addLog('info', `[${state.id}] SESSION_STRING: ${sStr.slice(0,60)}...`);
            } catch {}

            if (state.pingInterval) clearInterval(state.pingInterval);
            const WA_PING = parseInt(process.env.WA_PING_INTERVAL_MS || '180000');
            state.pingInterval = setInterval(async () => {
                try { await sock.sendPresenceUpdate('available'); state.lastPing = new Date().toISOString(); } catch {}
            }, WA_PING);
        }

        if (connection === 'close') {
            state.connection = 'close';
            if (state.pingInterval) { clearInterval(state.pingInterval); state.pingInterval = null; }
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            addLog('warn', `[${state.id}] Déconnecté (code: ${code})`);
            if (code === DisconnectReason.loggedOut) {
                addLog('warn', `[${state.id}] Session expirée. Supprimez sessions/${state.id}/ pour rescanner.`);
            } else {
                addLog('info', `[${state.id}] Reconnexion dans 3s...`);
                setTimeout(() => startSession(state.id), 3000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
            state.messagesCount++;
            try {
                const rawJid  = msg.key.remoteJid;
                const fromMe  = msg.key.fromMe;
                const isGroup = rawJid.endsWith('@g.us');
                const isLid   = rawJid.endsWith('@lid');
                // OWNER = numéro du compte WhatsApp connecté (chiffres uniquement)
                const OWNER = (state.connectedNumber || '').replace(/\D/g, '');
                const from  = isGroup ? rawJid : ((isLid||fromMe) ? OWNER+'@s.whatsapp.net' : rawJid);

                let senderJid, senderNumber;
                if (isGroup) { senderJid=msg.key.participant||''; senderNumber=senderJid.split('@')[0].replace(/\D/g,''); }
                else { senderNumber=fromMe?OWNER:rawJid.split('@')[0].replace(/\D/g,''); senderJid=senderNumber+'@s.whatsapp.net'; }

                const isOwner = fromMe || senderNumber === OWNER;

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
                // getBotMode() retourne 'public' par défaut si le fichier n'existe pas
                const currentBotMode = getBotMode();
                if (isCmd && !isOwner && currentBotMode === 'private') {
                    const cmdCheck = body.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase() || '';
                    // Laisser !public et !botmode accessibles pour que l'owner puisse rétablir
                    if (!['public', 'botmode'].includes(cmdCheck)) {
                        await sock.sendMessage(from, {
                            text: `🔴 *Bot en mode privé*\nSeul l'administrateur peut utiliser le bot pour le moment.`,
                        });
                        continue;
                    }
                }

                // ── Anti-mute : supprimer messages des mutés ─────────────
                if (isGroup && global.mutedMembers?.has(`${from}__${senderJid}`) && !isOwner) {
                    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
                    continue;
                }

                await handleCommand(sock, msg, {}, {
                    body, from, isGroup, isOwner, senderNumber, sender: senderJid,
                    noTagGroups: global.noTagGroups,
                    botMode: currentBotMode,
                });
            } catch(err) { addLog('error', `[${state.id}] ${err.message}`); }
        }
    });
}

// Charger sessions existantes
function loadExistingSessions() {
    if (!fs.existsSync(SESSIONS_ROOT)) return;
    const dirs = fs.readdirSync(SESSIONS_ROOT).filter(d =>
        fs.statSync(path.join(SESSIONS_ROOT,d)).isDirectory() &&
        fs.existsSync(path.join(SESSIONS_ROOT,d,'creds.json'))
    );
    if (dirs.length === 0) addLog('info','Aucune session — créez-en une depuis le dashboard');
    else { addLog('info',`${dirs.length} session(s) trouvée(s): ${dirs.join(', ')}`); dirs.forEach(id => startSession(id)); }
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

// Token 256 bits (cryptographiquement sûr)
function genToken() { return randomBytes(32).toString('hex'); }

// Comparaison timing-safe (résistante aux timing attacks)
function checkPassword(input) {
    try {
        const h = createHash('sha256').update(input).digest();
        return timingSafeEqual(PASS_HASH, h);
    } catch { return false; }
}

// Rate limit global
function isRateLimited(ip) {
    const now = Date.now();
    const e = rateLimiter.get(ip);
    if (!e || now>e.reset) { rateLimiter.set(ip,{count:1,reset:now+RATE_WINDOW}); return false; }
    return ++e.count > RATE_MAX;
}

// Anti-bruteforce /login : 5 tentatives / 15 min → lockout 30 min
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

// Auth par cookie
function isAuthenticated(req) {
    const token = (req.headers['cookie']||'').match(/dash_token=([^;]+)/)?.[1];
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
    const s = dashSessions.get(token);
    if (!s || Date.now()>s.expires) { dashSessions.delete(token); return false; }
    return true;
}

// Path traversal — whitelist stricte
function sanitizeId(raw) {
    const id = decodeURIComponent(raw||'');
    if (!/^[\w\-+]{1,50}$/.test(id)) return null;
    const resolved = path.resolve(SESSIONS_ROOT, id);
    if (!resolved.startsWith(path.resolve(SESSIONS_ROOT)+path.sep) &&
        resolved !== path.resolve(SESSIONS_ROOT)) return null;
    return id;
}

// Body limité à 512 KB
function readBodySafe(req) {
    return new Promise((resolve, reject) => {
        let b='', size=0;
        req.on('data', c => { size+=c.length; if(size>MAX_BODY_BYTES){req.destroy();reject(new Error('Payload trop grand'));return;} b+=c; });
        req.on('end', ()=>{ try{resolve(JSON.parse(b));}catch{resolve({});} });
        req.on('error', reject);
    });
}

// Masquer les secrets dans les logs
function maskSensitive(msg) {
    return msg
        .replace(/(SESSION_STRING)[^\s,}]*/gi, '$1=[MASQUÉ]')
        .replace(/([A-Za-z0-9+/]{80,}={0,2})/g, m => m.slice(0,10)+'...[MASQUÉ]');
}

// Headers de sécurité HTTP
const SECURITY_HEADERS = {
    'X-Content-Type-Options':  'nosniff',
    'X-Frame-Options':         'DENY',
    'X-XSS-Protection':        '1; mode=block',
    'Referrer-Policy':         'strict-origin',
    'Content-Security-Policy': "default-src \'self\'; script-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com https://fonts.gstatic.com; img-src \'self\' data: https://api.qrserver.com; font-src https://fonts.gstatic.com; connect-src \'self\'",
    ...(IS_HTTPS ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
};

// Alias utilisé dans quelques routes du handler HTTP
const SEC_HEADERS = SECURITY_HEADERS;

// Helpers auth manquants
function getSessionToken(req) {
    return (req.headers['cookie']||'').match(/dash_token=([^;]+)/)?.[1] || null;
}
function recordFailedLogin(ip) {
    // checkLoginAttempt incrémente déjà le compteur — on appelle juste pour l'effet de bord
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

    // ── Rate limiting ──────────────────────────────────────────────
    if (isRateLimited(ip)) {
        res.writeHead(429, { 'Content-Type':'application/json', 'Retry-After':'60' });
        return res.end(JSON.stringify({ error:'Trop de requêtes. Réessaie dans 1 minute.' }));
    }

    // ── CORS restreint ──────────────────────────────────────────────
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

    // ── Routes publiques (sans auth) ───────────────────────────────

    // GET / — dashboard (redirige vers /login si non auth)
    if ((pathname==='/'||pathname==='/dashboard') && method==='GET') {
        if (!isAuthenticated(req)) { res.writeHead(302,{Location:'/login'}); return res.end(); }
        const hp = path.join(DASH_DIR,'index.html');
        if (fs.existsSync(hp)) { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...SEC_HEADERS}); return res.end(fs.readFileSync(hp)); }
        res.writeHead(302,{Location:'/login'}); return res.end();
    }

    // GET /login — page de connexion
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

    // POST /login — authentification
    if (pathname==='/login' && method==='POST') {
        // Anti brute-force
        //if (isBruteForced(ip)) {
          //  res.writeHead(429,{'Content-Type':'text/html; charset=utf-8',...SEC_HEADERS,'Retry-After':'900'});
            //return res.end('<!DOCTYPE html><html><body style="font-family:monospace;background:#080b10;color:#f85149;padding:40px">IP bloquée 15 min — trop de tentatives.</body></html>');
        //}
        let b = '';
        await new Promise(r => { req.on('data',c=>b+=c.slice(0,500)); req.on('end',r); });
        const pwd = new URLSearchParams(b).get('password') || '';
        if (pwd !== DASH_PASSWORD) {
            recordFailedLogin(ip);
            addLog('warn', `[Auth] Échec login depuis ${ip}`);
            res.writeHead(302,{Location:'/login?error=1'}); return res.end();
        }
        // Succès — invalider l'ancien token si présent (anti session fixation)
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

    // ── Routes protégées (auth requise) ────────────────────────────
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
            ...s, sock:undefined, pingInterval:undefined,
            recentCommands:s.recentCommands.slice(-20),
            uptime, uptimeHuman:`${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`,
            totalUsers:Object.keys(statsData).length, totalCommands:totalCmds,
            topCommands:topCmds, users, prefix:PREFIX,
            memory:Math.round(process.memoryUsage().heapUsed/1024/1024), node:process.version,
        });
    }

    // POST /api/sessions/:id/pair — demander un pairing code
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
                // Créer une nouvelle session avec pairing
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
        // Validation numéro de téléphone (chiffres uniquement, 7-15 digits)
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
    // ── Railway : URL publique via RAILWAY_PUBLIC_DOMAIN ──
    const railwayUrl = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : null;
 
    addLog('success', `Dashboard démarré sur le port ${PORT} (${BIND_HOST}) — mot de passe requis`);
    if (railwayUrl) addLog('success', `URL publique Railway: ${railwayUrl}`);
 
    if (DASH_PASSWORD === 'changeme') {
        addLog('warn', 'SÉCURITÉ: Changez DASHBOARD_PASSWORD dans les variables Railway !');
    }
});

loadExistingSessions();