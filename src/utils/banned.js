/**
 * ============================================================
 * @file        banned.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire bannissement — Liste noire des membres bannis
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// LISTE NOIRE — Membres bannis définitivement
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../../data/banned/banned.json');

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); }

export function banUser(groupId, number, reason = '') {
  const d = load();
  if (!d[groupId]) d[groupId] = {};
  d[groupId][number] = { reason, date: new Date().toISOString() };
  save(d);
}
export function unbanUser(groupId, number) {
  const d = load();
  if (d[groupId]) { delete d[groupId][number]; save(d); }
}
export function isBanned(groupId, number) {
  return !!load()[groupId]?.[number];
}
export function getBanList(groupId) { return load()[groupId] || {}; }
