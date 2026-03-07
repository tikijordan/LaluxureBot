/**
 * ============================================================
 * @file        mediafilter.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire filtre media — Blocage images, videos, vocaux
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
const FILE = path.join(__dirname, '../../data/mediafilter.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d,null,2)); }
export function setFilter(groupId, type, enabled) {
  const d = load(); if (!d[groupId]) d[groupId] = {};
  d[groupId][type] = enabled; save(d);
}
export function isFiltered(groupId, type) { return load()[groupId]?.[type] === true; }
export function getFilters(groupId) { return load()[groupId] || {}; }
