/**
 * @file        sessiondb.js
 * @description Gestion de la base de données des sessions WhatsApp
 *              Permet de persister et restaurer les sessions sans scanner QR
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fse from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/sessions.db');

let db = null;

/**
 * Initialiser la base de données
 */
export function initDB() {
  try {
    // Créer le répertoire si nécessaire
    const dataDir = path.dirname(DB_PATH);
    fse.ensureDirSync(dataDir);

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    // Créer les tables si elles n'existent pas
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        phoneNumber TEXT UNIQUE,
        lastConnected TEXT,
        createdAt TEXT,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS sessionData (
        sessionId TEXT PRIMARY KEY,
        credsJson TEXT NOT NULL,
        keysJson TEXT NOT NULL,
        updatedAt TEXT,
        FOREIGN KEY(sessionId) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phoneNumber);
      CREATE INDEX IF NOT EXISTS idx_sessionData_updated ON sessionData(updatedAt);
    `);

    console.log('[SessionDB] ✅ Base de données initialisée');
    return true;
  } catch (e) {
    console.error('[SessionDB] ❌ Erreur init DB:', e.message);
    return false;
  }
}

/**
 * Sauvegarder une session dans la BD
 */
export function saveSession(sessionId, phoneNumber, authPath) {
  try {
    if (!db) return false;

    const credsPath = path.join(authPath, 'creds.json');
    const keysPath = path.join(authPath, 'keys');

    if (!fs.existsSync(credsPath)) {
      console.warn('[SessionDB] ⚠️ creds.json non trouvé:', credsPath);
      return false;
    }

    const credsJson = fs.readFileSync(credsPath, 'utf-8');
    let keysJson = '{}';

    // Compresser les clés en JSON
    if (fs.existsSync(keysPath)) {
      const keysData = {};
      const files = fs.readdirSync(keysPath);
      files.forEach(file => {
        const filePath = path.join(keysPath, file);
        if (fs.statSync(filePath).isFile()) {
          keysData[file] = fs.readFileSync(filePath, 'utf-8');
        }
      });
      keysJson = JSON.stringify(keysData);
    }

    // Insérer ou mettre à jour la session
    const insert = db.prepare(`
      INSERT OR IGNORE INTO sessions (id, phoneNumber, lastConnected, createdAt, status)
      VALUES (?, ?, ?, ?, 'active')
    `);
    insert.run(sessionId, phoneNumber, new Date().toISOString(), new Date().toISOString());

    const update = db.prepare(`
      INSERT OR REPLACE INTO sessionData (sessionId, credsJson, keysJson, updatedAt)
      VALUES (?, ?, ?, ?)
    `);
    update.run(sessionId, credsJson, keysJson, new Date().toISOString());

    console.log('[SessionDB] ✅ Session sauvegardée:', phoneNumber);
    return true;
  } catch (e) {
    console.error('[SessionDB] ❌ Erreur saveSession:', e.message);
    return false;
  }
}

/**
 * Lister toutes les sessions sauvegardées
 */
export function listSessions() {
  try {
    if (!db) return [];

    const query = db.prepare(`
      SELECT s.id, s.phoneNumber, s.lastConnected, s.status
      FROM sessions s
      WHERE s.status = 'active'
      ORDER BY s.lastConnected DESC
    `);

    return query.all();
  } catch (e) {
    console.error('[SessionDB] ❌ Erreur listSessions:', e.message);
    return [];
  }
}

/**
 * Restaurer une session depuis la BD vers le dossier sessions/
 */
export function restoreSession(sessionId, targetAuthPath) {
  try {
    if (!db) return false;

    const query = db.prepare('SELECT credsJson, keysJson FROM sessionData WHERE sessionId = ?');
    const row = query.get(sessionId);

    if (!row) {
      console.warn('[SessionDB] ⚠️ Session non trouvée en BD:', sessionId);
      return false;
    }

    // Créer le répertoire
    fse.ensureDirSync(targetAuthPath);

    // Restaurer creds.json
    const credsPath = path.join(targetAuthPath, 'creds.json');
    fs.writeFileSync(credsPath, row.credsJson, 'utf-8');

    // Restaurer les clés
    if (row.keysJson && row.keysJson !== '{}') {
      const keysData = JSON.parse(row.keysJson);
      const keysPath = path.join(targetAuthPath, 'keys');
      fse.ensureDirSync(keysPath);

      Object.entries(keysData).forEach(([file, content]) => {
        fs.writeFileSync(path.join(keysPath, file), content, 'utf-8');
      });
    }

    console.log('[SessionDB] ✅ Session restaurée:', sessionId);
    return true;
  } catch (e) {
    console.error('[SessionDB] ❌ Erreur restoreSession:', e.message);
    return false;
  }
}

/**
 * Supprimer une session de la BD
 */
export function deleteSession(sessionId) {
  try {
    if (!db) return false;

    db.prepare('DELETE FROM sessionData WHERE sessionId = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

    console.log('[SessionDB] ✅ Session supprimée:', sessionId);
    return true;
  } catch (e) {
    console.error('[SessionDB] ❌ Erreur deleteSession:', e.message);
    return false;
  }
}

/**
 * Fermer la base de données
 */
export function closeDB() {
  if (db) {
    db.close();
    db = null;
  }
}
