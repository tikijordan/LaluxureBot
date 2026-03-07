/**
 * ============================================================
 * @file        membernotes.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire notes — Notes privees admin sur les membres
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../../data/membernotes.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d,null,2)); }
const k = (g,n) => `${g}__${n}`;
export function addNote(groupId, number, note, by) {
  const d = load(); const key = k(groupId,number);
  if (!d[key]) d[key] = [];
  d[key].push({ note, by, date: new Date().toISOString() });
  save(d);
}
export function getNotes(groupId, number) { return load()[k(groupId,number)] || []; }
export function clearNotes(groupId, number) { const d = load(); delete d[k(groupId,number)]; save(d); }
