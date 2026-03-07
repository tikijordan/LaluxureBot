/**
 * ============================================================
 * @file        birthday.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire anniversaires — Suivi et souhaits automatiques
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
const FILE = path.join(__dirname, '../../data/birthdays.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d,null,2)); }
export function setBirthday(groupId, number, date) {
  const d = load(); if (!d[groupId]) d[groupId] = {};
  d[groupId][number] = date; save(d);
}
export function getBirthday(groupId, number) { return load()[groupId]?.[number] || null; }
export function getAllBirthdays(groupId) { return load()[groupId] || {}; }
export function getTodayBirthdays(groupId) {
  const all = getAllBirthdays(groupId);
  const today = new Date();
  const mm = String(today.getMonth()+1).padStart(2,'0');
  const dd = String(today.getDate()).padStart(2,'0');
  const todayStr = `${dd}/${mm}`;
  return Object.entries(all).filter(([,date]) => date.startsWith(todayStr));
}
