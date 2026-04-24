/**
 * @file        gistsync.js
 * @description Synchronisation des sessions WhatsApp via GitHub Gist
 *              Permet la persistance entre redéploiements Railway sans volume
 *
 * Variables d'environnement requises :
 *   GITHUB_TOKEN  — token GitHub avec scope "gist"
 *   GIST_ID       — ID du Gist secret (32 chars dans l'URL du Gist)
 */

import fs   from 'fs';
import fse  from 'fs-extra';
import path from 'path';
import https from 'https';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_ID      = process.env.GIST_ID      || '';
const GIST_FILE    = 'sessions.json'; // nom du fichier dans le Gist

// Délai debounce pour éviter de spammer l'API GitHub à chaque creds.update
const PUSH_DEBOUNCE_MS = 10_000; // 10 secondes
let   pushTimer        = null;
let   pendingPush      = false;

// ─────────────────────────────────────────────
// Helpers HTTP (pas de dépendance axios ici)
// ─────────────────────────────────────────────
function gistRequest(method, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: 'api.github.com',
            path:     `/gists/${GIST_ID}`,
            method,
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent':    'LaluxureBot/1.0',
                'Accept':        'application/vnd.github.v3+json',
                'Content-Type':  'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// ─────────────────────────────────────────────
// Vérifie que les variables sont configurées
// ─────────────────────────────────────────────
export function isGistConfigured() {
    return !!(GITHUB_TOKEN && GIST_ID);
}

// ─────────────────────────────────────────────
// PULL — Charge toutes les sessions depuis le Gist
// Retourne un objet { sessionId: { fichier: contenu, ... }, ... }
// ─────────────────────────────────────────────
export async function pullSessionsFromGist() {
    if (!isGistConfigured()) return null;
    try {
        const { status, body } = await gistRequest('GET');
        if (status !== 200) {
            console.error(`[Gist] ❌ Pull échoué (HTTP ${status})`);
            return null;
        }
        const raw = body?.files?.[GIST_FILE]?.content;
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        console.log(`[Gist] ✅ Pull réussi — ${Object.keys(parsed).length} session(s)`);
        return parsed; // { "237XXXXX": { "creds.json": "...", ... }, ... }
    } catch (e) {
        console.error('[Gist] ❌ Erreur pull:', e.message);
        return null;
    }
}

// ─────────────────────────────────────────────
// PUSH — Envoie toutes les sessions vers le Gist
// sessionsData : { sessionId: { fichier: contenu }, ... }
// ─────────────────────────────────────────────
export async function pushSessionsToGist(sessionsData) {
    if (!isGistConfigured()) return false;
    try {
        const content = JSON.stringify(sessionsData, null, 0); // compact
        const { status } = await gistRequest('PATCH', {
            files: { [GIST_FILE]: { content } },
        });
        if (status !== 200) {
            console.error(`[Gist] ❌ Push échoué (HTTP ${status})`);
            return false;
        }
        console.log(`[Gist] ✅ Push réussi — ${Object.keys(sessionsData).length} session(s)`);
        return true;
    } catch (e) {
        console.error('[Gist] ❌ Erreur push:', e.message);
        return false;
    }
}

// ─────────────────────────────────────────────
// Lit les fichiers d'une session depuis le disque
// Retourne { "creds.json": "...", "keys/xxx": "..." }
// ─────────────────────────────────────────────
export function readSessionFiles(authPath) {
    const result = {};
    if (!fs.existsSync(authPath)) return result;

    // creds.json à la racine
    const credsPath = path.join(authPath, 'creds.json');
    if (fs.existsSync(credsPath)) {
        result['creds.json'] = fs.readFileSync(credsPath, 'utf-8');
    }

    // Fichiers dans keys/
    const keysDir = path.join(authPath, 'keys');
    if (fs.existsSync(keysDir)) {
        for (const f of fs.readdirSync(keysDir)) {
            const fp = path.join(keysDir, f);
            if (fs.statSync(fp).isFile()) {
                result[`keys/${f}`] = fs.readFileSync(fp, 'utf-8');
            }
        }
    }

    // Autres .json à la racine (app-state-sync, etc.)
    for (const f of fs.readdirSync(authPath)) {
        if (f.endsWith('.json') && f !== 'creds.json') {
            result[f] = fs.readFileSync(path.join(authPath, f), 'utf-8');
        }
    }

    return result;
}

// ─────────────────────────────────────────────
// Restaure les fichiers d'une session sur le disque
// ─────────────────────────────────────────────
export function writeSessionFiles(authPath, files) {
    fse.ensureDirSync(authPath);
    for (const [filename, content] of Object.entries(files)) {
        const fullPath = path.join(authPath, filename);
        fse.ensureDirSync(path.dirname(fullPath));
        fs.writeFileSync(fullPath, content, 'utf-8');
    }
}

// ─────────────────────────────────────────────
// PUSH DEBOUNCE — appelé à chaque creds.update
// Attend 10s d'inactivité avant de pusher pour grouper les appels
// ─────────────────────────────────────────────
export function schedulePush(sessionsRoot, activeSessions) {
    pendingPush = true;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
        if (!pendingPush) return;
        pendingPush = false;

        // Construire l'objet complet de toutes les sessions actives
        const allSessions = {};
        for (const [id, state] of activeSessions) {
            if (state.connection !== 'open' || !state.authPath) continue;
            const files = readSessionFiles(state.authPath);
            if (Object.keys(files).length > 0) {
                allSessions[id] = files;
            }
        }

        if (Object.keys(allSessions).length === 0) return;
        await pushSessionsToGist(allSessions);
    }, PUSH_DEBOUNCE_MS);
}