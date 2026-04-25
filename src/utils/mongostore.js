/**
 * @file        mongostore.js
 * @description Persistance des sessions WhatsApp via MongoDB Atlas
 *              Remplace sessiondb.js (SQLite) et gistsync.js (GitHub Gist)
 *
 * Variable d'environnement requise :
 *   MONGODB_URI = mongodb+srv://user:pass@cluster.mongodb.net/laluxurebot
 *
 * Collection : sessions
 * Document   : { _id: sessionId, number: string, files: { "creds.json": "...", "keys/xxx": "..." }, updatedAt: Date }
 */

import fs   from 'fs';
import fse  from 'fs-extra';
import path from 'path';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config(); // charger .env avant de lire MONGODB_URI

const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME     = 'laluxurebot';
const COLLECTION  = 'sessions';

let client     = null;
let collection = null;
let connected  = false;

export async function connectMongo() {
    if (connected) return true;
    if (!MONGODB_URI) {
        console.warn('[MongoDB] MONGODB_URI non défini — persistance désactivée');
        return false;
    }
    try {
        client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 8000,
            connectTimeoutMS:        8000,
        });
        await client.connect();
        const db = client.db(DB_NAME);
        collection = db.collection(COLLECTION);
        // Index sur _id (sessionId) — déjà par défaut, on ajoute updatedAt pour TTL optionnel
        await collection.createIndex({ updatedAt: 1 });
        connected = true;
        console.log('[MongoDB] ✅ Connecté à Atlas');
        return true;
    } catch (e) {
        console.error('[MongoDB] ❌ Connexion échouée:', e.message);
        return false;
    }
}

// ─────────────────────────────────────────────
// Lit les fichiers d'une session depuis le disque
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
// SAVE — Sauvegarde une session dans MongoDB
// ─────────────────────────────────────────────
export async function saveSessionMongo(sessionId, number, authPath) {
    if (!connected || !collection) return false;
    try {
        const files = readSessionFiles(authPath);
        if (Object.keys(files).length === 0) return false;

        await collection.updateOne(
            { _id: sessionId },
            { $set: { _id: sessionId, number, files, updatedAt: new Date() } },
            { upsert: true }
        );
        return true;
    } catch (e) {
        console.error(`[MongoDB] ❌ saveSession [${sessionId}]:`, e.message);
        return false;
    }
}

// ─────────────────────────────────────────────
// RESTORE — Restaure toutes les sessions depuis MongoDB
// Retourne le nombre de sessions restaurées
// ─────────────────────────────────────────────
export async function restoreAllSessions(sessionsRoot) {
    if (!connected || !collection) return 0;
    let count = 0;
    try {
        const docs = await collection.find({}).toArray();
        if (docs.length === 0) {
            console.log('[MongoDB] Aucune session en base');
            return 0;
        }
        console.log(`[MongoDB] ${docs.length} session(s) trouvée(s) — restauration...`);
        for (const doc of docs) {
            const authPath = path.join(sessionsRoot, doc._id);
            try {
                // Toujours écraser depuis MongoDB — source de vérité
                writeSessionFiles(authPath, doc.files);
                console.log(`[MongoDB] ✅ Session [${doc._id}] (${doc.number}) restaurée`);
                count++;
            } catch (e) {
                console.error(`[MongoDB] ❌ Restauration [${doc._id}]:`, e.message);
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
    }, 5000)); // attendre 5s d'inactivité avant de sauvegarder
}