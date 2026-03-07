/**
 * ============================================================
 * @file        autoreply.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire auto-reply — Reponses automatiques aux mots-cles
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
const FILE = path.join(__dirname, '../../data/autoreply.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d,null,2)); }
export function addReply(groupId, trigger, response) {
  const d = load(); if (!d[groupId]) d[groupId] = {};
  d[groupId][trigger.toLowerCase()] = response; save(d);
}
export function removeReply(groupId, trigger) {
  const d = load(); if (d[groupId]) { delete d[groupId][trigger.toLowerCase()]; save(d); }
}
export function getReplies(groupId) { return load()[groupId] || {}; }
export function findReply(groupId, text) {
  const replies = getReplies(groupId);
  const t = text.toLowerCase();
  for (const [trigger, response] of Object.entries(replies)) {
    if (t.includes(trigger)) return response;
  }
  return null;
}
