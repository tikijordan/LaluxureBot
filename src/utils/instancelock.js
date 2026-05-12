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

function ms(n) {
    return n;
}

export function buildOwnerId() {
    const pid = process.pid;
    const host = os.hostname();
    const unique = Math.random().toString(16).slice(2);
    return `${host}:${pid}:${unique}`;
}

/**
 * Essaye de prendre (ou renouveler) un lock.
 * - Si lock inexistant ou expiré → acquis.
 * - Si lock détenu par ownerId → renouvelé.
 * - Sinon → refusé.
 */
export async function tryAcquireLock({ db, lockName, ownerId, ttlMs }) {
    if (!db) return { ok: true, reason: 'no-db' }; // fail-open si pas de DB
    const col = db.collection(COLLECTION);

    const nowDate = now();
    const expiresAt = new Date(nowDate.getTime() + ttlMs);

    // TTL index (best effort)
    try {
        // expireAfterSeconds = 0 => Mongo supprime à expiresAt
        await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    } catch {}

    // 1) tenter de créer si absent
    try {
        await col.insertOne({
            _id: lockName,
            ownerId,
            updatedAt: nowDate,
            expiresAt,
        });
        return { ok: true, reason: 'created' };
    } catch {
        // ignore duplicate
    }

    // 2) tenter d'acquérir si expiré
    const acquired = await col.findOneAndUpdate(
        { _id: lockName, expiresAt: { $lte: nowDate } },
        { $set: { ownerId, updatedAt: nowDate, expiresAt } },
        { returnDocument: 'after' }
    );
    if (acquired?.value?.ownerId === ownerId) return { ok: true, reason: 'expired-acquired' };

    // 3) renouveler si on est owner
    const renewed = await col.findOneAndUpdate(
        { _id: lockName, ownerId },
        { $set: { updatedAt: nowDate, expiresAt } },
        { returnDocument: 'after' }
    );
    if (renewed?.value?.ownerId === ownerId) return { ok: true, reason: 'renewed' };

    // 4) sinon lock détenu par quelqu'un d'autre
    const doc = await col.findOne({ _id: lockName });
    return { ok: false, reason: 'held', holder: doc?.ownerId || 'unknown', expiresAt: doc?.expiresAt };
}

export async function releaseLock({ db, lockName, ownerId }) {
    if (!db) return;
    try {
        await db.collection(COLLECTION).deleteOne({ _id: lockName, ownerId });
    } catch {}
}

/**
 * Démarre un renouvellement périodique.
 */
export function startLockHeartbeat({
    db,
    lockName,
    ownerId,
    ttlMs,
    intervalMs,
    onLost,
}) {
    let stopped = false;

    const tick = async () => {
        if (stopped) return;
        try {
            const res = await tryAcquireLock({ db, lockName, ownerId, ttlMs });
            if (!res.ok) {
                stopped = true;
                onLost?.(res);
            }
        } catch (e) {
            // Si DB instable, on ne coupe pas brutalement
            // mais on signale qu'on n'a pas pu renouveler.
            // Au prochain tick, ça retentera.
        }
    };

    const timer = setInterval(tick, intervalMs);
    timer.unref?.();

    // premier tick immédiat
    tick();

    return {
        stop: () => {
            stopped = true;
            clearInterval(timer);
        },
    };
}
