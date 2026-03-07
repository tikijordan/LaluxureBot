/**
 * ============================================================
 * @file        filter.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire filtre — Mots interdits dans les groupes
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// FILTRE DE MOTS INTERDITS
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../../data/filters.json');

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); }

export function addFilter(groupId, word) {
  const d = load();
  if (!d[groupId]) d[groupId] = [];
  const w = word.toLowerCase().trim();
  if (!d[groupId].includes(w)) d[groupId].push(w);
  save(d);
}
export function removeFilter(groupId, word) {
  const d = load();
  if (!d[groupId]) return;
  d[groupId] = d[groupId].filter(w => w !== word.toLowerCase().trim());
  save(d);
}
export function getFilters(groupId) { return load()[groupId] || []; }
export function clearFilters(groupId) { const d = load(); delete d[groupId]; save(d); }
export function containsBadWord(groupId, text) {
  const words = getFilters(groupId);
  const t = text.toLowerCase();
  return words.find(w => t.includes(w)) || null;
}
