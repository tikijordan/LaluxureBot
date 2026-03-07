/**
 * ============================================================
 * @file        history.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire historique — Sanctions et actions par membre
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// HISTORIQUE DES SANCTIONS PAR MEMBRE
// ============================================================
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../../data/history.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); }
const key = (gId, num) => `${gId}__${num}`;
export function logAction(groupId, number, action, reason = '', by = '') {
  const d = load(); const k = key(groupId, number);
  if (!d[k]) d[k] = [];
  d[k].push({ action, reason, by, date: new Date().toISOString() });
  save(d);
}
export function getHistory(groupId, number) { return load()[key(groupId, number)] || []; }
export function clearHistory(groupId, number) { const d = load(); delete d[key(groupId, number)]; save(d); }
