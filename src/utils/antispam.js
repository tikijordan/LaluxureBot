/**
 * ============================================================
 * @file        antispam.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire anti-spam — Detection des comportements spam
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// ANTI-SPAM
// ============================================================

const userMessages = new Map(); // { number: [timestamps] }
const bannedUsers = new Set();

const MAX_MESSAGES = parseInt(process.env.ANTISPAM_MAX || '5');
const DELAY = parseInt(process.env.ANTISPAM_DELAY || '3000');
const WINDOW = 5000; // fenêtre de 5s

export function trackMessage(number) {
  const now = Date.now();
  const msgs = (userMessages.get(number) || []).filter(t => now - t < WINDOW);
  msgs.push(now);
  userMessages.set(number, msgs);

  if (msgs.length >= MAX_MESSAGES) {
    bannedUsers.add(number);
    setTimeout(() => bannedUsers.delete(number), 30000); // ban 30s
  }
}

export function isSpam(number) {
  return bannedUsers.has(number);
}

export function getAntispamStatus() {
  return {
    enabled: true,
    maxMessages: MAX_MESSAGES,
    window: WINDOW,
    delay: DELAY,
    currentlyBanned: bannedUsers.size,
  };
}

export function unban(number) {
  bannedUsers.delete(number);
  userMessages.delete(number);
}

export { bannedUsers };
