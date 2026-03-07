/**
 * ============================================================
 * @file        warns.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire avertissements — Systeme de warns avec kick auto
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// SYSTÈME D'AVERTISSEMENTS (WARNS)
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WARNS_FILE = path.join(__dirname, '../../data/warns.json');

function load() {
  try { return JSON.parse(fs.readFileSync(WARNS_FILE, 'utf8')); } catch { return {}; }
}
function save(data) {
  fs.writeFileSync(WARNS_FILE, JSON.stringify(data, null, 2));
}

// Clé unique par groupe + membre
const key = (groupId, number) => `${groupId}__${number}`;

export function addWarn(groupId, number) {
  const data = load();
  const k = key(groupId, number);
  if (!data[k]) data[k] = { count: 0, reasons: [], lastWarn: null };
  data[k].count++;
  data[k].lastWarn = new Date().toISOString();
  save(data);
  return data[k].count;
}

export function getWarns(groupId, number) {
  const data = load();
  return data[key(groupId, number)] || { count: 0 };
}

export function resetWarns(groupId, number) {
  const data = load();
  delete data[key(groupId, number)];
  save(data);
}

export function getAllWarns(groupId) {
  const data = load();
  const result = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith(groupId + '__')) {
      result[k.replace(groupId + '__', '')] = v;
    }
  }
  return result;
}
