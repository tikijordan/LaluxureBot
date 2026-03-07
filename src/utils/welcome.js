/**
 * ============================================================
 * @file        welcome.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire bienvenue — Messages d'accueil et d'au revoir
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// SYSTÈME DE BIENVENUE / AU REVOIR
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../../data/welcome.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); }

export function setWelcome(groupId, message) {
  const d = load();
  if (!d[groupId]) d[groupId] = {};
  d[groupId].welcome = message;
  d[groupId].enabled = true;
  save(d);
}

export function setGoodbye(groupId, message) {
  const d = load();
  if (!d[groupId]) d[groupId] = {};
  d[groupId].goodbye = message;
  save(d);
}

export function disableWelcome(groupId) {
  const d = load();
  if (d[groupId]) { d[groupId].enabled = false; save(d); }
}

export function getWelcomeConfig(groupId) {
  return load()[groupId] || null;
}
