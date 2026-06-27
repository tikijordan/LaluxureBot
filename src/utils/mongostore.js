/**
 * @file        mongostore.js
 * @description Persistance des sessions WhatsApp via MongoDB Atlas UNIQUEMENT
 *              Pas de fichiers sur disque, tout est en base de données
 *
 * Variable d'environnement requise :
 *   MONGODB_URI = mongodb+srv://user:pass@cluster.mongodb.net/laluxurebot
 *
 * Collection : sessions
 * Document   : { _id: sessionId, number: string, files: { "creds.json": "...", "keys/xxx": "..." }, updatedAt: Date }
 * 
 * MEMORY CACHE: Les sessions sont chargées en mémoire au démarrage pour éviter les requêtes BD à chaque accès
 */

import fs   from 'fs';
import fse  from 'fs-extra';
import path from 'path';
import { MongoClient } from 'mongodb';
import os from 'os';

const DB_NAME    = 'laluxurebot';
const COLLECTION = 'sessions';

let client     = null;
let collection = null;
let connected  = false;
let memCache   = new Map(); // Chaque sessionId → { number, files, updatedAt }
const TEMP_DIR = path.join(os.tmpdir(), 'wa-bot-sessions');

// Expose des accès read-only pour réutiliser le client Mongo ailleurs (lock d'instance, etc.)
export function getMongoClient() {
    return client;
}

export function getMongoDb() {
    try { return client?.db(DB_NAME) || null; } catch { return null; }
}

export function getMongoCollection() {
    return collection;
}

export async function connectMongo() {
    if (connected) return true;
    // Lire MONGODB_URI ici (après dotenv.config() de index.js)
    const MONGODB_URI = process.env.MONGODB_URI || '';
    if (!MONGODB_URI) {
        console.warn('[MongoDB] MONGODB_URI non défini — persistance désactivée');
        return false;
    }
    try {
        client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 15000,
            connectTimeoutMS:        15000,
            socketTimeoutMS:         15000,
        });
        await client.connect();
        const db = client.db(DB_NAME);
        collection = db.collection(COLLECTION);
        await collection.createIndex({ updatedAt: 1 });
        connected = true;
        console.log('[MongoDB] ✅ Connecté à Atlas');

        // Pré-charger toutes les sessions en mémoire (await avec timeout de 10s)
        // FIX: était non-awaité → connectMongo() retournait true avant que le cache soit prêt
        try {
            await Promise.race([
                preloadSessionsToMemory(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Preload timeout')), 10000))
            ]);
        } catch (e) {
            console.warn('[MongoDB] ⚠️  Preload sessions timeout/erreur (continuant sans cache):', e.message);
        }

        return true;
    } catch (e) {
        console.error('[MongoDB] ❌ Connexion échouée:', e.message);
        connected = false;
        // FIX: reset client pour permettre une nouvelle tentative propre
        try { await client?.close(); } catch {}
        client = null;
        collection = null;
        return false;
    }
}

// ─────────────────────────────────────────────
// Pré-charger toutes les sessions en cache mémoire
// ─────────────────────────────────────────────
async function preloadSessionsToMemory() {
    if (!connected || !collection) {
        console.warn('[MongoDB] ⚠️  Pas connecté pour preload');
        return;
    }
    try {
        console.log('[MongoDB] 📥 Chargement des sessions en cache...');
        const docs = await collection.find({}).toArray();
        memCache.clear();
        for (const doc of docs) {
            memCache.set(doc._id, {
                number: doc.number,
                files: doc.files,
                updatedAt: doc.updatedAt
            });
        }
        const ids = docs.map(d => `${d._id} (${d.number || '?'})`).join(', ');
        console.log(`[MongoDB] 📌 ${docs.length} session(s) en cache: ${ids || '(vide)'}`);
    } catch (e) {
        console.error('[MongoDB] ❌ Erreur preloadSessions:', e.message);
        // Continuer même si le preload échoue
    }
}

// ─────────────────────────────────────────────
// Lit les fichiers d'une session depuis le disque TEMPORAIRE
// (Ne lit que ce qui est en /tmp, pas de persistance sur /app)
// ─────────────────────────────────────────────
export function readSessionFiles(authPath) {
    const result = {};
    if (!fs.existsSync(authPath)) return result;

    // Lecture récursive pour couvrir tous les sous-dossiers (keys/, app-state-sync/, etc.)
    function readDir(dir, prefix) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                readDir(fullPath, relPath);
            } else if (entry.name.endsWith('.json')) {
                try {
                    result[relPath] = fs.readFileSync(fullPath, 'utf-8');
                } catch {}
            }
        }
    }

    readDir(authPath, '');
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
// SAVE — Sauvegarde une session dans MongoDB + cache mémoire
// ─────────────────────────────────────────────
export async function saveSessionMongo(sessionId, number, authPath) {
    if (!connected || !collection) return false;
    try {
        const files = readSessionFiles(authPath);
        if (Object.keys(files).length === 0) return false;

        // NE PAS faire deleteMany({ number }) ici — ça supprimait toutes les autres
        // sessions du même numéro à chaque sauvegarde (catastrophique en cas de doublon)
        // L'unicité est gérée manuellement depuis le dashboard

        // Sauvegarder en BD
        await collection.updateOne(
            { _id: sessionId },
            { $set: { _id: sessionId, number, files, updatedAt: new Date() } },
            { upsert: true }
        );
        
        // Mettre à jour le cache mémoire aussi
        memCache.set(sessionId, { number, files, updatedAt: new Date() });
        
        return true;
    } catch (e) {
        console.error(`[MongoDB] ❌ saveSession [${sessionId}]:`, e.message);
        return false;
    }
}

// ─────────────────────────────────────────────
// RESTORE — Restaure toutes les sessions depuis MongoDB
// Utilise le cache mémoire en priorité pour éviter les requêtes BD
// Retourne le nombre de sessions restaurées
// ─────────────────────────────────────────────
export async function restoreAllSessions(sessionsRoot) {
    if (!collection) return 0;
    let count = 0;
    
    try {
        let sessionIds = [];
        
        // Si cache est vide et on est connecté, charger depuis BD
        if (memCache.size === 0 && connected) {
            console.log('[MongoDB] 📥 Cache vide, chargement depuis MongoDB...');
            try {
                const docs = await collection.find({}).toArray();
                for (const doc of docs) {
                    memCache.set(doc._id, {
                        number: doc.number,
                        files: doc.files,
                        updatedAt: doc.updatedAt
                    });
                }
            } catch (e) {
                console.warn('[MongoDB] ⚠️  Impossible de charger de MongoDB:', e.message);
            }
        }
        
        sessionIds = Array.from(memCache.keys());
        
        if (sessionIds.length === 0) {
            console.log('[MongoDB] Aucune session en base');
            return 0;
        }
        
        console.log(`[MongoDB] 📌 ${sessionIds.length} session(s) en cache — restauration en TEMP...`);
        
        // 🧹 FIX CRITIQUE : détection des doublons (même numéro)
        // On garde le PLUS RÉCENT (updatedAt), on NE SUPPRIME PAS de MongoDB ici.
        // La suppression doit être explicite depuis le dashboard ou lors du renommage.
        // Supprimer ici = risque de perdre définitivement la bonne session.
        const sessionsByNumber = {};
        for (const sessionId of memCache.keys()) {
            const cached = memCache.get(sessionId);
            const number = cached.number || 'unknown';
            if (!sessionsByNumber[number]) sessionsByNumber[number] = [];
            sessionsByNumber[number].push({ id: sessionId, updatedAt: cached.updatedAt || new Date(0) });
        }

        const skippedIds = new Set();
        for (const [number, entries] of Object.entries(sessionsByNumber)) {
            if (entries.length > 1) {
                // Trier par updatedAt décroissant → garder le plus récent
                entries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
                const kept = entries[0];
                const dups = entries.slice(1);
                console.log(`[MongoDB] ⚠️  ${entries.length} sessions pour [${number}] — garde [${kept.id}], supprime: ${dups.map(d => d.id).join(', ')}`);
                for (const dup of dups) {
                    skippedIds.add(dup.id);
                    try {
                        await collection.deleteOne({ _id: dup.id });
                        memCache.delete(dup.id);
                    } catch (e) {
                        console.warn(`[MongoDB] Suppression doublon [${dup.id}]: ${e.message}`);
                    }
                }
            }
        }

        // Restaure uniquement les sessions non-dupliquées
        for (const sessionId of memCache.keys()) {
            if (skippedIds.has(sessionId)) continue; // ignorer les doublons sans supprimer
            const cached = memCache.get(sessionId);
            const authPath = path.join(TEMP_DIR, sessionId);
            
            try {
                // Toujours écraser depuis MongoDB — vider le dossier TEMP avant de restaurer
                fse.removeSync(authPath);
                fse.ensureDirSync(authPath);
                writeSessionFiles(authPath, cached.files);
                console.log(`[MongoDB] ✅ Session [${sessionId}] (${cached.number}) restaurée en TEMP`);
                count++;
            } catch (e) {
                console.error(`[MongoDB] ❌ Restauration [${sessionId}]:`, e.message);
            }
        }
    } catch (e) {
        console.error('[MongoDB] ❌ restoreAllSessions:', e.message);
    }
    return count;
}

// ─────────────────────────────────────────────
// DELETE — Supprime une session de MongoDB
// ─────────────────────────────────────────────
export async function deleteSessionMongo(sessionId) {
    if (!connected || !collection) return false;
    try {
        await collection.deleteOne({ _id: sessionId });
        memCache.delete(sessionId); // FIX: vider aussi le cache mémoire
        console.log(`[MongoDB] 🗑️ Session [${sessionId}] supprimée`);
        return true;
    } catch (e) {
        console.error(`[MongoDB] ❌ deleteSession [${sessionId}]:`, e.message);
        return false;
    }
}

/** Supprime toutes les sessions WhatsApp de MongoDB (nettoyage complet) */
export async function deleteAllSessionsMongo() {
    if (!collection) return { deleted: 0 };
    try {
        const res = await collection.deleteMany({});
        memCache.clear();
        for (const t of pushTimers.values()) clearTimeout(t);
        pushTimers.clear();
        console.log(`[MongoDB] 🗑️ ${res.deletedCount} session(s) supprimée(s) — base vidée`);
        return { deleted: res.deletedCount };
    } catch (e) {
        console.error('[MongoDB] ❌ deleteAllSessions:', e.message);
        return { deleted: 0, error: e.message };
    }
}

// ─────────────────────────────────────────────
// LIST — Liste toutes les sessions en base
// ─────────────────────────────────────────────
export async function listSessionsMongo() {
    if (!connected || !collection) return [];
    try {
        return await collection.find({}, { projection: { _id: 1, number: 1, updatedAt: 1 } }).toArray();
    } catch (e) {
        console.error('[MongoDB] ❌ listSessions:', e.message);
        return [];
    }
}

// ─────────────────────────────────────────────
// PUSH DEBOUNCE — grouper les sauvegardes (évite les spams)
// ─────────────────────────────────────────────
const pushTimers = new Map(); // sessionId → timer

export function scheduleSave(sessionId, number, authPath) {
    // FIX: authPath capturé ici à l'appel (pas dans le callback) pour éviter
    // les problèmes si la session est renommée avant l'exécution du timeout
    const capturedPath = authPath;
    if (pushTimers.has(sessionId)) clearTimeout(pushTimers.get(sessionId));
    pushTimers.set(sessionId, setTimeout(async () => {
        pushTimers.delete(sessionId);
        await saveSessionMongo(sessionId, number, capturedPath);
    }, 2000));
}

// ─────────────────────────────────────────────
// FLUSH — Forcer l'exécution immédiate de tous les saves en attente
// Appelé au SIGTERM pour ne pas perdre les creds mis à jour
// ─────────────────────────────────────────────
/** Sauvegarde immédiate de toutes les sessions actives (SIGTERM + backup périodique) */
export async function saveAllActiveSessions(sessionsMap) {
    if (!connected || !collection || !sessionsMap) return 0;
    let saved = 0;
    for (const [, state] of sessionsMap) {
        if (!state?.authPath) continue;
        const id = state.id || state.connectedNumber;
        if (!id) continue;
        const ok = await saveSessionMongo(id, state.connectedNumber || id, state.authPath).catch(() => false);
        if (ok) saved++;
    }
    if (saved > 0) console.log(`[MongoDB] 💾 ${saved} session(s) sauvegardée(s)`);
    return saved;
}

export async function migrateSessionId(oldId, newId, number, authPath) {
    if (!connected || !collection || !oldId || !newId || oldId === newId) return;
    await saveSessionMongo(newId, number || newId, authPath).catch(() => {});
    if (oldId !== newId) await deleteSessionMongo(oldId).catch(() => {});
}

export async function flushAllPendingSaves() {
    if (pushTimers.size === 0) return true;
    console.log(`[MongoDB] ⏳ Flush de ${pushTimers.size} save(s) en attente...`);
    const promises = [];
    for (const [sessionId, timer] of pushTimers) {
        clearTimeout(timer);
        pushTimers.delete(sessionId);
        const cached = memCache.get(sessionId);
        const number = cached?.number || sessionId;

        // FIX: chercher l'authPath depuis global.sessions, mais aussi depuis toutes
        // les sessions si la session a été renommée (l'ancien sessionId ne matche plus)
        let authPath = global.sessions?.get(sessionId)?.authPath || null;
        if (!authPath) {
            // Parcourir toutes les sessions pour trouver celle qui correspond au numéro
            if (global.sessions) {
                for (const [, s] of global.sessions) {
                    if ((s.id === sessionId || s.connectedNumber === number) && s.authPath) {
                        authPath = s.authPath;
                        break;
                    }
                }
            }
        }
        // Dernier recours : reconstruire le chemin depuis TEMP_DIR
        if (!authPath) {
            authPath = path.join(TEMP_DIR, sessionId);
        }

        promises.push(
            saveSessionMongo(sessionId, number, authPath)
                .then(() => console.log(`[MongoDB] ✅ Flush [${sessionId}]`))
                .catch(e => console.warn(`[MongoDB] ⚠️ Flush [${sessionId}]: ${e.message}`))
        );
    }
    await Promise.allSettled(promises);
    console.log('[MongoDB] ✅ Flush terminé');
    return true;
}