/**
 * ============================================================
 * @file        loader.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Chargeur dynamique de modules de commandes
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// LOADER - CHARGEMENT DYNAMIQUE DES COMMANDES
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(__dirname, 'commands');

export async function loadCommands() {
  const commands = {};
  const files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.js'));

  for (const file of files) {
    try {
      const mod = await import(`./commands/${file}`);
      const cmds = mod.default || mod;

      // Chaque fichier peut exporter un objet { nom: { execute, description, adminOnly } }
      for (const [name, cmdObj] of Object.entries(cmds)) {
        commands[name.toLowerCase()] = cmdObj;
      }
    } catch (err) {
      console.error(`❌ Erreur chargement ${file}:`, err.message);
    }
  }

  return commands;
}
