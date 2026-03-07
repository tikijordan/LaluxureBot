/**
 * ============================================================
 * @file        agenda.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire agenda — Gestion des evenements du groupe
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
const FILE = path.join(__dirname, '../../data/agenda.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d,null,2)); }
export function addEvent(groupId, event) {
  const d = load(); if (!d[groupId]) d[groupId] = [];
  event.id = Date.now(); d[groupId].push(event); save(d); return event;
}
export function getEvents(groupId) {
  const d = load()[groupId] || [];
  return d.filter(e => new Date(e.date) >= new Date()).sort((a,b) => new Date(a.date)-new Date(b.date));
}
export function removeEvent(groupId, id) {
  const d = load(); if (!d[groupId]) return;
  d[groupId] = d[groupId].filter(e => e.id !== Number(id)); save(d);
}
export function getAllEvents(groupId) { return load()[groupId] || []; }
