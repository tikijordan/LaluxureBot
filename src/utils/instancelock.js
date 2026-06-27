/**
 * @file        instancelock.js
 * @description Verrou distribué pour éviter plusieurs instances WhatsApp en parallèle.
 *
 * Objectif: limiter les 440 (session remplacée) quand Railway/PM2 lance 2 processus.
 *
 * Collection: instance_locks
 * Document: { _id: <lockName>, ownerId: string, updatedAt: Date, expiresAt: Date }
 */

import os from 'os';

const COLLECTION = 'instance_locks';

function now() {
    return new Date();
}

// FIX: ms() était définie mais jamais utilisée — supprimée

export function buildOwnerId() {
    const pid = process.pid;
    const host = os.hostname();
    const unique = Math.random().toString(16).slice(2);
    return `${host}:${pid}:${unique}`;
}

/** ID stable pour toute la durée du processus (évite lock acquis / heartbeat avec 2 IDs) */
let _instanceOwnerId = null;
export function getInstanceOwnerId() {
    if (!_instanceOwnerId) _instanceOwnerId = buildOwnerId();
    return _instanceOwnerId;
}

// FIX: MongoDB driver v5+ retourne le document directement (plus de .value)
// Cette fonction normalise les deux formats pour compatibilité ascendante
function extractDoc(result) {
    if (!result) return null;
    return result.value !== undefined ? result.value : result;
}

/**
 * Essaye de prendre (ou renouveler) un lock.
 * - Si lock inexistant ou expiré → acquis.
 * - Si lock détenu par ownerId → renouvelé.
 * - Sinon → refusé.
 */
/** Supprime un lock expiré avant tentative d'acquisition (redéploiement Render) */
export async function forceReleaseExpiredLock({ db, lockName }) {
    if (!db) return;
    try {
        const col = db.collection(COLLECTION);
        const res = await col.deleteOne({ _id: lockName, expiresAt: { $lte: now() } });
        if (res.deletedCount) console.log(`[Lock] Lock expiré "${lockName}" libéré`);
    } catch {}
}

/**
 * Reprend un lock dont le heartbeat est mort (ancienne instance Render crashée).
 * Si updatedAt > ttlMs sans renouvellement → vol légitime.
 */
export async function forceStealStaleLock({ db, lockName, ownerId, ttlMs, deployId = '' }) {
    if (!db) return false;
    try {
        const col = db.collection(COLLECTION);
        const staleBefore = new Date(now().getTime() - ttlMs);
        const stolen = extractDoc(
            await col.findOneAndUpdate(
                { _id: lockName, updatedAt: { $lte: staleBefore } },
                { $set: { ownerId, updatedAt: now(), expiresAt: new Date(now().getTime() + ttlMs), deployId } },
                { returnDocument: 'after' }
            )
        );
        if (stolen?.ownerId === ownerId) {
            console.log(`[Lock] Lock stale "${lockName}" repris (ancienne instance morte)`);
            return true;
        }
    } catch {}
    return false;
}

/**
 * Reprend le lock si un autre déploiement Render le détient encore (rolling deploy).
 * L'ancien conteneur heartbeat toutes les 30s → forceStealStaleLock ne suffit pas.
 */
export async function forceStealOlderDeploy({ db, lockName, ownerId, ttlMs, deployId }) {
    if (!db || !deployId) return false;
    try {
        const col = db.collection(COLLECTION);
        const expiresAt = new Date(now().getTime() + ttlMs);
        const patch = { ownerId, updatedAt: now(), expiresAt, deployId };

        // Lock sans deployId (ancienne version) ou deployId différent → reprise immédiate
        for (const filter of [
            { _id: lockName, deployId: { $ne: deployId } },
            { _id: lockName, deployId: { $exists: false } },
        ]) {
            const stolen = extractDoc(
                await col.findOneAndUpdate(filter, { $set: patch }, { returnDocument: 'after' })
            );
            if (stolen?.ownerId === ownerId) {
                console.log(`[Lock] Lock repris — nouveau déploiement (${deployId.slice(0, 8)})`);
                return true;
            }
        }
    } catch {}
    return false;
}

/** Reprise forcée après échecs répétés (une seule instance Render attendue) */
export async function forceTakeoverLock({ db, lockName, ownerId, ttlMs, deployId = '' }) {
    if (!db) return false;
    try {
        const col = db.collection(COLLECTION);
        await col.updateOne(
            { _id: lockName },
            { $set: { ownerId, updatedAt: now(), expiresAt: new Date(now().getTime() + ttlMs), deployId } },
            { upsert: true }
        );
        console.log(`[Lock] Lock "${lockName}" repris de force (takeover)`);
        return true;
    } catch {}
    return false;
}

export async function getLockInfo({ db, lockName }) {
    if (!db) return null;
    try {
        return await db.collection(COLLECTION).findOne({ _id: lockName });
    } catch {
        return null;
    }
}

export async function tryAcquireLock({ db, lockName, ownerId, ttlMs, deployId = '' }) {
    if (!db) return { ok: true, reason: 'no-db' }; // fail-open si pas de DB
    const col = db.collection(COLLECTION);

    const nowDate = now();
    const expiresAt = new Date(nowDate.getTime() + ttlMs);

    // TTL index (best effort) — expireAfterSeconds=0 => Mongo supprime à expiresAt
    try {
        await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    } catch {}

    const lockFields = { ownerId, updatedAt: nowDate, expiresAt, deployId };

    // 1) tenter de créer si absent
    try {
        await col.insertOne({ _id: lockName, ...lockFields });
        return { ok: true, reason: 'created' };
    } catch {
        // ignore duplicate key error
    }

    // 2) tenter d'acquérir si expiré
    const acquiredDoc = extractDoc(
        await col.findOneAndUpdate(
            { _id: lockName, expiresAt: { $lte: nowDate } },
            { $set: lockFields },
            { returnDocument: 'after' }
        )
    );
    if (acquiredDoc?.ownerId === ownerId) return { ok: true, reason: 'expired-acquired' };

    // 3) renouveler si on est déjà owner
    const renewedDoc = extractDoc(
        await col.findOneAndUpdate(
            { _id: lockName, ownerId },
            { $set: lockFields },
            { returnDocument: 'after' }
        )
    );
    if (renewedDoc?.ownerId === ownerId) return { ok: true, reason: 'renewed' };

    // 4) lock détenu par quelqu'un d'autre
    const doc = await col.findOne({ _id: lockName });
    return {
        ok: false, reason: 'held',
        holder: doc?.ownerId || 'unknown',
        holderDeploy: doc?.deployId || null,
        expiresAt: doc?.expiresAt,
        updatedAt: doc?.updatedAt,
    };
}

export async function releaseLock({ db, lockName, ownerId }) {
    if (!db) return;
    try {
        await db.collection(COLLECTION).deleteOne({ _id: lockName, ownerId });
    } catch {}
}

/** Supprime tous les locks d'instance (nettoyage complet) */
export async function deleteAllInstanceLocks(db) {
    if (!db) return { deleted: 0 };
    try {
        const res = await db.collection(COLLECTION).deleteMany({});
        if (res.deletedCount) console.log(`[Lock] 🗑️ ${res.deletedCount} lock(s) supprimé(s)`);
        return { deleted: res.deletedCount };
    } catch (e) {
        console.error('[Lock] ❌ deleteAllInstanceLocks:', e.message);
        return { deleted: 0, error: e.message };
    }
}

/**
 * Démarre un renouvellement périodique du lock.
 *
 * FIX: le premier tick est retardé de intervalMs (pas immédiat) pour éviter
 * un renouvellement inutile juste après l'acquisition initiale.
 *
 * FIX: compteur de failures consécutives — si la DB est instable pendant
 * MAX_CONSECUTIVE_FAILURES ticks, onLost() est appelé pour éviter deux
 * instances actives en silence.
 */
export function startLockHeartbeat({
    db,
    lockName,
    ownerId,
    ttlMs,
    intervalMs,
    onLost,
    deployId = '',
}) {
    let stopped = false;
    const MAX_CONSECUTIVE_FAILURES = 8;
    let consecutiveFailures = 0;

    const tick = async () => {
        if (stopped) return;
        try {
            const res = await tryAcquireLock({ db, lockName, ownerId, ttlMs, deployId });
            consecutiveFailures = 0; // reset sur succès
            if (!res.ok) {
                stopped = true;
                onLost?.(res);
            }
        } catch (e) {
            // DB instable : on ne coupe pas immédiatement, mais on compte les échecs
            consecutiveFailures++;
            console.warn(`[Lock] Heartbeat erreur (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${e.message}`);
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                stopped = true;
                console.error('[Lock] Trop d\'erreurs consécutives — lock considéré perdu (DB instable)');
                onLost?.({ ok: false, reason: 'db-unavailable' });
            }
        }
    };

    // FIX: premier tick après intervalMs, pas immédiatement
    // (le lock vient juste d'être acquis — pas besoin de le renouveler de suite)
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();

    return {
        stop: () => {
            stopped = true;
            clearInterval(timer);
        },
    };
}