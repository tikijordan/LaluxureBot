/**
 * ============================================================
 * @file        stats.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire statistiques — Compteurs d'utilisation du bot
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// STATISTIQUES
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_FILE = path.join(__dirname, '../../data/stats/stats.json');

function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveStats(data) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
}

export function addStat(number, cmd) {
  const stats = loadStats();
  if (!stats[number]) stats[number] = { total: 0, commands: {} };
  stats[number].total++;
  stats[number].commands[cmd] = (stats[number].commands[cmd] || 0) + 1;
  stats[number].lastSeen = new Date().toISOString();
  saveStats(stats);
}

export function getUserStats(number) {
  const stats = loadStats();
  return stats[number] || { total: 0, commands: {} };
}
