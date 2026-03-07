/**
 * ============================================================
 * @file        captcha.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire captcha — Verification anti-bot a l'entree
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
const FILE = path.join(__dirname, '../../data/captcha.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return {}; } }
function save(d) { fs.writeFileSync(FILE, JSON.stringify(d,null,2)); }
// Groupes avec captcha activé
export function enableCaptcha(groupId) { const d = load(); d[groupId] = { enabled: true }; save(d); }
export function disableCaptcha(groupId) { const d = load(); delete d[groupId]; save(d); }
export function isCaptchaEnabled(groupId) { return load()[groupId]?.enabled === true; }
// Sessions captcha en attente: { jid: { answer, timer, groupId } }
const pending = new Map();
export function createChallenge(jid, groupId) {
  const a = Math.floor(Math.random()*20)+1, b = Math.floor(Math.random()*20)+1;
  const ops = ['+','-','×']; const op = ops[Math.floor(Math.random()*ops.length)];
  let answer;
  if (op==='+') answer=a+b; else if (op==='-') answer=Math.abs(a-b); else answer=a*b;
  const question = op==='-' ? `${Math.max(a,b)} - ${Math.min(a,b)}` : `${a} ${op} ${b}`;
  pending.set(jid, { answer, groupId, attempts: 0 });
  return { question, answer };
}
export function checkAnswer(jid, answer) {
  const session = pending.get(jid);
  if (!session) return null;
  session.attempts++;
  if (Number(answer) === session.answer) { pending.delete(jid); return 'correct'; }
  if (session.attempts >= 3) { pending.delete(jid); return 'failed'; }
  return 'wrong';
}
export function isPending(jid) { return pending.has(jid); }
export function cancelChallenge(jid) { pending.delete(jid); }
