/**
 * ============================================================
 * @file        schedule.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Utilitaire planification — Messages programmes
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// MESSAGES PROGRAMMÉS
// ============================================================
const scheduled = []; // { time, jid, message, sock }

export function addSchedule(sock, jid, message, delayMs) {
  const id = setTimeout(async () => {
    try { await sock.sendMessage(jid, { text: `⏰ *Message programmé:*\n\n${message}` }); }
    catch (e) { console.error('Schedule error:', e.message); }
    const idx = scheduled.findIndex(s => s.id === id);
    if (idx !== -1) scheduled.splice(idx, 1);
  }, delayMs);
  const entry = { id, jid, message, fireAt: new Date(Date.now() + delayMs).toISOString() };
  scheduled.push(entry);
  return entry;
}

export function getPendingSchedules(jid) { return scheduled.filter(s => s.jid === jid); }
export function cancelSchedule(id) {
  const idx = scheduled.findIndex(s => s.id === Number(id));
  if (idx !== -1) { clearTimeout(scheduled[idx].id); scheduled.splice(idx, 1); return true; }
  return false;
}
