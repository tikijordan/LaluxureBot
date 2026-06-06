/**
 * ============================================================
 * @file        groupstats.js
 * @project     WhatsApp Bot
 * @description Utilitaire statistiques — Suivi de l'activité du groupe
 * ============================================================
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../../data/groupstats.json');

let _cache = null;
let _dirty = false;
let _flushTimer = null;
const FLUSH_MS = 30_000;

function load() {
    if (_cache) return _cache;
    try { _cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { _cache = {}; }
    return _cache;
}

function scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(() => {
        _flushTimer = null;
        if (!_dirty || !_cache) return;
        _dirty = false;
        try { fs.writeFileSync(FILE, JSON.stringify(_cache, null, 2)); } catch {}
    }, FLUSH_MS);
}

export function trackMessage(groupId, sender) {
    const d = load();
    if (!d[groupId]) d[groupId] = { total: 0, members: {}, startDate: new Date().toISOString() };
    d[groupId].total++;
    if (!d[groupId].members[sender]) d[groupId].members[sender] = 0;
    d[groupId].members[sender]++;
    _dirty = true;
    scheduleFlush();
}

export function getGroupStats(groupId) {
    return load()[groupId] || null;
}

export function resetGroupStats(groupId) {
    const d = load();
    delete d[groupId];
    _dirty = true;
    scheduleFlush();
}
