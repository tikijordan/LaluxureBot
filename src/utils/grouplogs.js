/**
 * ============================================================
 * @file        grouplogs.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire logs — Journal des actions d'administration
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
const FILE = path.join(__dirname, '../../data/grouplogs.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d,null,2)); }
export function log(groupId, action, by, target = '', detail = '') {
  const d = load(); if (!d[groupId]) d[groupId] = [];
  d[groupId].push({ action, by, target, detail, date: new Date().toISOString() });
  if (d[groupId].length > 200) d[groupId] = d[groupId].slice(-200);
  save(d);
}
export function getLogs(groupId, limit = 20) {
  return (load()[groupId] || []).slice(-limit).reverse();
}
export function clearLogs(groupId) { const d = load(); delete d[groupId]; save(d); }
