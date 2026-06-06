/**
 * ============================================================
 * @file        stats.js
 * @project     WhatsApp Bot
 * @description Utilitaire statistiques — Compteurs d'utilisation du bot
 * ============================================================
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_FILE = path.join(__dirname, '../../data/stats/stats.json');

let _cache = null;
let _dirty = false;
let _flushTimer = null;
let _aggregated = null;
const FLUSH_MS = 5000;

function ensureDir() {
    try { fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true }); } catch {}
}

function loadStats() {
    if (_cache) return _cache;
    try {
        _cache = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    } catch {
        _cache = {};
    }
    return _cache;
}

function scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(() => {
        _flushTimer = null;
        if (!_dirty || !_cache) return;
        _dirty = false;
        ensureDir();
        try { fs.writeFileSync(STATS_FILE, JSON.stringify(_cache, null, 2)); } catch {}
    }, FLUSH_MS);
}

export function addStat(number, cmd) {
    const stats = loadStats();
    if (!stats[number]) stats[number] = { total: 0, commands: {} };
    stats[number].total++;
    stats[number].commands[cmd] = (stats[number].commands[cmd] || 0) + 1;
    stats[number].lastSeen = new Date().toISOString();
    _dirty = true;
    _aggregated = null;
    scheduleFlush();
}

export function getUserStats(number) {
    const stats = loadStats();
    return stats[number] || { total: 0, commands: {} };
}

export function getAllStats() {
    return loadStats();
}

export function getAggregatedStats() {
    if (_aggregated) return _aggregated;
    const statsData = loadStats();
    const totalCmds = Object.values(statsData).reduce((a, u) => a + (u.total || 0), 0);
    const topMap = {};
    Object.values(statsData).forEach(u => {
        Object.entries(u.commands || {}).forEach(([c, n]) => { topMap[c] = (topMap[c] || 0) + n; });
    });
    const topCmds = Object.entries(topMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([cmd, count]) => ({ cmd, count }));
    const users = Object.entries(statsData)
        .map(([n, d]) => ({
            number: n,
            total: d.total,
            lastSeen: d.lastSeen,
            topCmd: Object.entries(d.commands || {}).sort((a, b) => b[1] - a[1])[0]?.[0],
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 50);
    _aggregated = {
        totalUsers: Object.keys(statsData).length,
        totalCmds,
        topCmds,
        users,
    };
    return _aggregated;
}
