/**
 * ============================================================
 * @file        groupstats.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire statistiques — Suivi de l'activite du groupe
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
const FILE = path.join(__dirname, '../../data/groupstats.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d,null,2)); }
export function trackMessage(groupId, sender) {
  const d = load(); if (!d[groupId]) d[groupId] = { total: 0, members: {}, startDate: new Date().toISOString() };
  d[groupId].total++;
  if (!d[groupId].members[sender]) d[groupId].members[sender] = 0;
  d[groupId].members[sender]++;
  save(d);
}
export function getGroupStats(groupId) { return load()[groupId] || null; }
export function resetGroupStats(groupId) { const d = load(); delete d[groupId]; save(d); }
