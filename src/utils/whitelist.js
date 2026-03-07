/**
 * ============================================================
 * @file        whitelist.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire whitelist — Liste blanche de membres de confiance
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
const FILE = path.join(__dirname, '../../data/whitelist.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d,null,2)); }
export function addToWhitelist(groupId, number) {
  const d = load(); if (!d[groupId]) d[groupId] = [];
  if (!d[groupId].includes(number)) d[groupId].push(number); save(d);
}
export function removeFromWhitelist(groupId, number) {
  const d = load(); if (d[groupId]) { d[groupId] = d[groupId].filter(n => n !== number); save(d); }
}
export function isWhitelisted(groupId, number) { return (load()[groupId] || []).includes(number); }
export function getWhitelist(groupId) { return load()[groupId] || []; }
