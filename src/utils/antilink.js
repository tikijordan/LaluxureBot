/**
 * ============================================================
 * @file        antilink.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire anti-lien — Detection et blocage des URLs
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// SYSTÈME ANTI-LIEN
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../../data/antilink.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); }

export function enableAntilink(groupId) {
  const d = load(); d[groupId] = true; save(d);
}
export function disableAntilink(groupId) {
  const d = load(); delete d[groupId]; save(d);
}
export function isAntilinkEnabled(groupId) {
  return load()[groupId] === true;
}

// Détecte les liens dans un texte
export function containsLink(text) {
  const linkRegex = /(https?:\/\/|www\.|chat\.whatsapp\.com|t\.me\/|bit\.ly\/|tinyurl\.com\/)[^\s]*/gi;
  return linkRegex.test(text);
}
