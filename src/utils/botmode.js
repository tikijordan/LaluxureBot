/**
 * ============================================================
 * @file        botmode.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire mode bot — Controle acces public/prive
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// BOT MODE — Gestion du mode d'accès au bot
// Accès owner-only permanent — seul le numéro connecté peut utiliser le bot
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODE_FILE = path.join(__dirname, '../../data/botmode.json');

// Charger le mode depuis le fichier
function loadMode() {
  try {
    return JSON.parse(fs.readFileSync(MODE_FILE, 'utf8'));
  } catch {
    return { mode: 'private' };
  }
}

// Sauvegarder le mode
function saveMode(data) {
  fs.writeFileSync(MODE_FILE, JSON.stringify(data, null, 2));
}

// Lire le mode actuel
export function getBotMode() {
  return loadMode().mode; // 'public' | 'private'
}

// Passer en mode privé (admin only)
export function setPrivateMode() {
  saveMode({ mode: 'private', changedAt: new Date().toISOString() });
}

// Passer en mode public (tout le monde)
export function setPublicMode() {
  saveMode({ mode: 'public', changedAt: new Date().toISOString() });
}

// Vérifier si un utilisateur peut utiliser le bot
export function canUseBot(isOwner) {
  return isOwner; // Seul l'owner peut utiliser le bot
}
