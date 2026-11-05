/**
 * @file        authState.js
 * @description État d'authentification Baileys stocké sur disque, avec un dossier
 *              RÉSOLU À CHAQUE ÉCRITURE au lieu d'être figé à la création du socket.
 *
 * Pourquoi : une session est d'abord créée sous un id temporaire (`sess_...`), puis
 * renommée vers le numéro WhatsApp après connexion. L'implémentation standard
 * `useMultiFileAuthState(folder)` capture le dossier initial : après le renommage,
 * `creds.update` continuait d'écrire dans l'ancien dossier, supprimé 1 s plus tard
 * → « ENOENT: no such file or directory, open '.../sess_xxx/creds.json' » à chaque
 * mise à jour des identifiants, et perte des nouvelles clés (prekeys, sessions).
 *
 * Ici, chaque lecture/écriture appelle `getFolder()` : dès que `state.authPath`
 * change, les écritures suivent automatiquement le nouveau dossier.
 */

import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

// Une file d'attente par fichier : évite les écritures concurrentes corrompues.
const fileQueues = new Map();

function queueFile(filePath, task) {
    const previous = fileQueues.get(filePath) || Promise.resolve();
    const next = previous.then(task, task);
    // On garde la queue « propre » (jamais rejetée) et on libère la mémoire quand
    // plus aucune opération n'est en attente sur ce fichier.
    const settled = next.catch(() => {});
    fileQueues.set(filePath, settled);
    settled.then(() => {
        if (fileQueues.get(filePath) === settled) fileQueues.delete(filePath);
    });
    return next;
}

function fixFileName(file) {
    return file?.replace(/\//g, '__')?.replace(/:/g, '-');
}

/**
 * @param {string | (() => string)} folderOrGetter Dossier courant, ou fonction
 *        renvoyant le dossier courant (appelée à chaque opération).
 */
export async function useDynamicMultiFileAuthState(folderOrGetter) {
    const getFolder = typeof folderOrGetter === 'function'
        ? folderOrGetter
        : () => folderOrGetter;

    const writeData = async (data, file) => {
        const folder = getFolder();
        await mkdir(folder, { recursive: true });
        const filePath = join(folder, fixFileName(file));
        return queueFile(filePath, () => writeFile(filePath, JSON.stringify(data, BufferJSON.replacer)));
    };

    const readData = async (file) => {
        const folder = getFolder();
        const filePath = join(folder, fixFileName(file));
        try {
            return await queueFile(filePath, async () => {
                const data = await readFile(filePath, { encoding: 'utf-8' });
                return JSON.parse(data, BufferJSON.reviver);
            });
        } catch {
            return null;
        }
    };

    const removeData = async (file) => {
        const folder = getFolder();
        const filePath = join(folder, fixFileName(file));
        try {
            return await queueFile(filePath, async () => {
                try { await unlink(filePath); } catch {}
            });
        } catch {}
    };

    const initialFolder = getFolder();
    const folderInfo = await stat(initialFolder).catch(() => null);
    if (folderInfo && !folderInfo.isDirectory()) {
        throw new Error(`found something that is not a directory at ${initialFolder}, either delete it or specify a different location`);
    }
    if (!folderInfo) await mkdir(initialFolder, { recursive: true });

    const creds = (await readData('creds.json')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}.json`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const file = `${category}-${id}.json`;
                            tasks.push(value ? writeData(value, file) : removeData(file));
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: async () => writeData(creds, 'creds.json'),
    };
}
