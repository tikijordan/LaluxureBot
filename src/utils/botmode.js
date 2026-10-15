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

/**
 * POLITIQUE D'ACCÈS — seul endroit où les droits sont décidés.
 * false : seul le propriétaire (numéro connecté) peut lancer une commande.
 * true  : les admins du groupe peuvent lancer les commandes marquées adminOnly
 *         (le bot doit aussi être admin du groupe).
 */
export const ALLOW_GROUP_ADMINS = false;

const DEFAULT_MODE = 'private';

export function normalizeNumber(n) {
  return (n || '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Décide si un expéditeur est le propriétaire. Retourne toujours un booléen strict. */
export function isOwnerSender({ fromMe, senderNumber, senderLid, owner, ownerLid, ownerPersonal }) {
  if (fromMe) return true;
  if (owner && normalizeNumber(senderNumber) === normalizeNumber(owner)) return true;
  if (ownerPersonal && normalizeNumber(senderNumber) === normalizeNumber(ownerPersonal)) return true;
  if (ownerLid && senderLid && senderLid === ownerLid) return true;
  return false;
}

/** Peut-on traiter les commandes de cet expéditeur ? */
export function canUseBot(isOwner, isGroup = false) {
  if (isOwner === true) return true;
  return ALLOW_GROUP_ADMINS && isGroup === true;
}

/** Droits sur UNE commande. Retourne { allowed: true } ou { allowed: false, message }. */
export async function checkCommandAccess({ sock, command, from, sender, isGroup, isOwner }) {
  if ((command.private || command.public === false) && !isOwner) {
    return { allowed: false, message: '🔐 Cette commande est privée et réservée au propriétaire.' };
  }

  if (command.adminOnly && !isOwner) {
    if (!ALLOW_GROUP_ADMINS || !isGroup) {
      return { allowed: false, message: '🔒 Cette commande est réservée au propriétaire.' };
    }
    const metadata = await sock.groupMetadata(from).catch(() => null);
    if (!metadata) return { allowed: false, message: '⚠️ Impossible de vérifier les droits du groupe.' };

    const isUserAdmin = !!metadata.participants.find(p => p.id === sender && (p.admin || p.isSuperAdmin));
    const botNumId = (sock.user?.id || '').split(':')[0] + '@s.whatsapp.net';
    const botLidId = sock.user?.lid || null;
    const isBotAdmin = !!metadata.participants.find(p => {
      if (!(p.admin || p.isSuperAdmin)) return false;
      return p.id === botNumId || p.id === sock.user?.id || (botLidId && p.id === botLidId);
    });

    if (!isBotAdmin) return { allowed: false, message: '⚠️ Je ne suis pas administrateur du groupe.' };
    if (!isUserAdmin) return { allowed: false, message: '🔒 Cette commande est réservée aux administrateurs.' };
  }

  return { allowed: true };
}

/* ───── Mode du bot : seul lecteur/écrivain de data/botmode.json ───── */

let modeCache = null;

export function getBotMode() {
  if (modeCache) return modeCache;
  try {
    if (fs.existsSync(MODE_FILE)) {
      const data = JSON.parse(fs.readFileSync(MODE_FILE, 'utf-8'));
      modeCache = data.mode || DEFAULT_MODE;
      return modeCache;
    }
  } catch {}
  modeCache = DEFAULT_MODE;
  return modeCache;
}

export function setBotMode(mode) {
  modeCache = mode;
  try {
    fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true });
    fs.writeFileSync(MODE_FILE, JSON.stringify({ mode, changedAt: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.warn('[BotMode] Écriture botmode.json impossible:', e.message);
  }
}

/** Crée le fichier au démarrage s'il n'existe pas (jamais 'public'). */
export function ensureBotModeFile() {
  if (!fs.existsSync(MODE_FILE)) setBotMode(DEFAULT_MODE);
}