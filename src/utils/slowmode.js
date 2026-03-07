/**
 * ============================================================
 * @file        slowmode.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire slow mode — Limitation de frequence des messages
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// SLOW MODE — Limiter la fréquence des messages
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../../data/slowmode.json');

const lastMessage = new Map(); // groupId__sender → timestamp

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); }

export function setSlowmode(groupId, seconds) {
  const d = load(); d[groupId] = seconds; save(d);
}
export function disableSlowmode(groupId) {
  const d = load(); delete d[groupId]; save(d);
}
export function getSlowmode(groupId) { return load()[groupId] || 0; }

// Retourne true si le message doit être supprimé (trop rapide)
export function isTooFast(groupId, sender) {
  const delay = getSlowmode(groupId);
  if (!delay) return false;
  const key = `${groupId}__${sender}`;
  const now = Date.now();
  const last = lastMessage.get(key) || 0;
  if (now - last < delay * 1000) return true;
  lastMessage.set(key, now);
  return false;
}
