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
            serverSelectionTimeoutMS: 15000,  // 15s pour la sélection du serveur
            connectTimeoutMS:        15000,   // 15s pour la connexion
            socketTimeoutMS:         15000,   // 15s pour les opérations socket
        });
        await client.connect();
        const db = client.db(DB_NAME);
        collection = db.collection(COLLECTION);
        // Index sur _id (sessionId) — déjà par défaut, on ajoute updatedAt pour TTL optionnel
        await collection.createIndex({ updatedAt: 1 });
        connected = true;
        console.log('[MongoDB] ✅ Connecté à Atlas');
        
        // Pré-charger toutes les sessions en mémoire au démarrage (avec timeout)
        const preloadPromise = preloadSessionsToMemory();
        // Attendre max 10s, sinon continuer sans pré-charge
        Promise.race([
            preloadPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Preload timeout')), 10000))
        ]).catch(e => {
            console.warn('[MongoDB] ⚠️  Preload sessions timeout/erreur (continuant sans cache):', e.message);
        });
        
        return true;
    } catch (e) {
        console.error('[MongoDB] ❌ Connexion échouée:', e.message);
        connected = false;
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
        console.log(`[MongoDB] 📌 ${docs.length} session(s) chargée(s) en cache mémoire`);
    } catch (e) {
        console.error('[MongoDB] ❌ Erreur preloadSessions:', e.message);
        // Continuer même si le preload échoue
    }
}

// ─────────────────────────────────────────────
// Lit les fichiers d'une session depuis le disque TEMPORAIRE
// (Ne lit que ce qui est en /tmp, pas de persistance sur /app)
// ─────────────────────────────────────────────
function readSessionFiles(authPath) {
    const result = {};
    if (!fs.existsSync(authPath)) return result;

    // creds.json à la racine
    const credsPath = path.join(authPath, 'creds.json');
    if (fs.existsSync(credsPath)) {
        result['creds.json'] = fs.readFileSync(credsPath, 'utf-8');
    }

    // Sous-dossiers (keys/, app-state-sync/, etc.)
    const entries = fs.readdirSync(authPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const subDir = path.join(authPath, entry.name);
            for (const f of fs.readdirSync(subDir)) {
                const fp = path.join(subDir, f);
                if (fs.statSync(fp).isFile()) {
                    result[`${entry.name}/${f}`] = fs.readFileSync(fp, 'utf-8');
                }
            }
        } else if (entry.name.endsWith('.json') && entry.name !== 'creds.json') {
            result[entry.name] = fs.readFileSync(path.join(authPath, entry.name), 'utf-8');
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
// SAVE — Sauvegarde une session dans MongoDB + cache mémoire
// ─────────────────────────────────────────────
export async function saveSessionMongo(sessionId, number, authPath) {
    if (!connected || !collection) return false;
    try {
        const files = readSessionFiles(authPath);
        if (Object.keys(files).length === 0) return false;

        // Supprimer les autres sessions ayant le même numéro (unicité)
        await collection.deleteMany({ number });

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
        
        // 🧹 Nettoie les doublons (mêmes credentials)
        const sessionsByNumber = {};
        for (const sessionId of sessionIds) {
            const cached = memCache.get(sessionId);
            const number = cached.number || 'unknown';
            if (!sessionsByNumber[number]) {
                sessionsByNumber[number] = [];
            }
            sessionsByNumber[number].push(sessionId);
        }
        
        // Supprime les doublons (garde le premier, enlève les autres)
        for (const [number, ids] of Object.entries(sessionsByNumber)) {
            if (ids.length > 1) {
                console.log(`[MongoDB] ⚠️  ${ids.length} sessions avec le même numéro [${number}] — nettoyage...`);
                for (const dupId of ids.slice(1)) {
                    try {
                        if (connected) {
                            await collection.deleteOne({ _id: dupId });
                        }
                        memCache.delete(dupId);
                        console.log(`[MongoDB] 🗑️  Session dupliquée [${dupId}] supprimée`);
                    } catch (e) {
                        console.error(`[MongoDB] ❌ Suppression doublon [${dupId}]:`, e.message);
                    }
                }
            }
        }
        
        // Restaure uniquement les sessions non-supprimées (dans cache)
        for (const sessionId of memCache.keys()) {
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
    if (pushTimers.has(sessionId)) clearTimeout(pushTimers.get(sessionId));
    pushTimers.set(sessionId, setTimeout(async () => {
        pushTimers.delete(sessionId);
        await saveSessionMongo(sessionId, number, authPath);
    }, 2000)); // attendre 2s d'inactivité avant de sauvegarder
}

// ─────────────────────────────────────────────
// FLUSH — Forcer l'exécution immédiate de tous les saves en attente
// Appelé au SIGTERM pour ne pas perdre les creds mis à jour
// ─────────────────────────────────────────────
export async function flushAllPendingSaves() {
    if (pushTimers.size === 0) return;
    console.log(`[MongoDB] ⏳ Flush de ${pushTimers.size} save(s) en attente...`);
    const promises = [];
    for (const [sessionId, timer] of pushTimers) {
        clearTimeout(timer);
        pushTimers.delete(sessionId);
        // Retrouver le numéro depuis le cache
        const cached = memCache.get(sessionId);
        const number = cached?.number || sessionId;
        // Trouver le authPath depuis les sessions globales (si disponible)
        const authPath = global.sessions?.get(sessionId)?.authPath || null;
        if (authPath) {
            promises.push(
                saveSessionMongo(sessionId, number, authPath)
                    .then(() => console.log(`[MongoDB] ✅ Flush [${sessionId}]`))
                    .catch(e => console.warn(`[MongoDB] ⚠️ Flush [${sessionId}]: ${e.message}`))
            );
        }
    }
    await Promise.allSettled(promises);
    console.log('[MongoDB] ✅ Flush terminé');
}