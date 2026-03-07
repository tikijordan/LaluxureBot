/**
 * ============================================================
 * @file        notes.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire notes — Notes personnelles des utilisateurs
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// NOTES
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTES_DIR = path.join(__dirname, '../../data/notes');

export function saveNote(number, note) {
  const file = path.join(NOTES_DIR, `${number}.json`);
  let notes = [];
  try { notes = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  notes.push({ text: note, date: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(notes, null, 2));
}

export function getNotes(number) {
  const file = path.join(NOTES_DIR, `${number}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
