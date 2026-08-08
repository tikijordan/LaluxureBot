/**
 * @file        handler.js
 * @description Gestionnaire de commandes — multi-session compatible
 * @license     MIT
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getContentType } from '@whiskeysockets/baileys';
import { loadCommands } from './loader.js';
import { addStat } from './utils/stats.js';
import { resolveIsOwner } from './utils/message.js';
import { canUseBot, getBotMode } from './utils/botmode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ══════════════════════════════════════════════════════════════
// CHARGEMENT DES COMMANDES — avec attente garantie
// ══════════════════════════════════════════════════════════════
let commands = {};
let _commandsReady = false;
const _commandsLoadPromise = loadCommands()
    .then(cmds => {
        commands = cmds;
        _commandsReady = true;
        console.log(`📦 ${Object.keys(commands).length} commandes prêtes.`);
    })
    .catch(err => {
        console.error('❌ Erreur critique chargement commandes:', err.message);
    });

const _defaultNoTagGroups = new Set();

// ══════════════════════════════════════════════════════════════
// DÉDUPLICATION HANDLER — Map avec TTL (10 min par message)
// ══════════════════════════════════════════════════════════════
const _handledMsgIds = new Map();
const _HANDLER_TTL   = 10 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of _handledMsgIds) {
        if (now - ts > _HANDLER_TTL) _handledMsgIds.delete(id);
    }
}, 60 * 1000);

// FIX 1 — normalize définie au niveau module (fallback si ctx incomplet)
const normalize = n => (n || '').replace(/[^0-9]/g, '').replace(/^0+/, '');

/**
 * Traite un message entrant et exécute la commande correspondante.
 *
 * @param {object} sock    - Socket Baileys de la session
 * @param {object} msg     - Message WhatsApp
 * @param {object} store   - Store Baileys (peut être {})
 * @param {object} ctx     - Contexte pré-calculé par index.js
 */
export async function handleCommand(sock, msg, store, ctx = {}) {

    // ── Déduplication au niveau handler ───────────────────────
    const msgId = msg?.key?.id;
    if (msgId) {
        if (_handledMsgIds.has(msgId)) return;
        _handledMsgIds.set(msgId, Date.now());
    }

    // ── Attendre que les commandes soient chargées (max 15s) ──
    if (!_commandsReady) {
        try {
            await Promise.race([
                _commandsLoadPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
            ]);
        } catch {
            // Timeout ou erreur de chargement — on continue quand même
        }
    }

    // ── Résolution du préfixe et du propriétaire ──────────────
    const PREFIX    = ctx.prefix || process.env.PREFIX || '!';
    // Owner = numéro du compte connecté (auto après QR/pairing), pas de variable d'env
    const connectedOwner = (sock.user?.id?.split(':')[0] || '').replace(/\D/g, '');
    const OWNER     = (ctx.owner || connectedOwner).replace(/\D/g, '');
    const OWNER_LID = ctx.ownerLid || sock.user?.lid?.split('@')[0] || null;
    const OWNER_PERSONAL = ctx.ownerPersonal ?? (process.env.OWNER_NUMBER || '').replace(/\D/g, '').replace(/^0+/, '');
    const lidCache = ctx.lidCache || {};
    const noTagGroups = ctx.noTagGroups || _defaultNoTagGroups;

    // ── Extraction du contexte ────────────────────────────────
    let body         = ctx.body;
    let from         = ctx.from;
    let isGroup      = ctx.isGroup;
    let isOwner      = ctx.isOwner;
    let senderNumber = ctx.senderNumber;
    let sender       = ctx.sender;

    if (body !== undefined && sender !== undefined) {
        isOwner = resolveIsOwner({
            fromMe: !!msg.key?.fromMe,
            senderNumber,
            senderJid: msg.key?.participant || sender,
            OWNER,
            OWNER_LID,
            OWNER_PERSONAL,
            lidCache,
        });
    }

    // Fallback complet si appelé sans contexte (compatibilité)
    if (body === undefined) {
        const ct = getContentType(msg.message);
        if (ct === 'conversation')             body = msg.message.conversation || '';
        else if (ct === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || '';
        else if (ct === 'imageMessage')        body = msg.message.imageMessage?.caption || '';
        else if (ct === 'videoMessage')        body = msg.message.videoMessage?.caption || '';
        else body = '';

        const rawJid = msg.key.remoteJid;
        const fromMe = msg.key.fromMe;
        isGroup = rawJid.endsWith('@g.us');
        const isLid = rawJid.endsWith('@lid');

        const stripSuffix = jid => (jid||'').replace(/:[0-9]+@/, '@').split('@')[0].replace(/\D/g,'');
        if (isGroup) {
            from   = rawJid;
            sender = msg.key.participant || '';
            const isParticipantLid = sender.endsWith('@lid');

            if (isParticipantLid) {
                const participantAlt = msg.key.participantAlt || null;

                if (participantAlt && !participantAlt.endsWith('@lid')) {
                    senderNumber = participantAlt.split(':')[0].split('@')[0].replace(/\D/g, '');
                    sender       = senderNumber + '@s.whatsapp.net';
                } else {
                    try {
                        const pn = await sock.signalRepository?.lidMapping?.getPNForLID(sender);
                        if (pn) {
                            senderNumber = pn.split(':')[0].split('@')[0].replace(/\D/g, '');
                            sender       = senderNumber + '@s.whatsapp.net';
                        } else {
                            senderNumber = sender.split('@')[0];
                        }
                    } catch {
                        senderNumber = sender.split('@')[0];
                    }
                }
            } else {
                senderNumber = stripSuffix(sender);
            }
        } else {
            from         = rawJid;
            senderNumber = fromMe ? OWNER : stripSuffix(rawJid);
            sender       = `${senderNumber}@s.whatsapp.net`;
        }

        const senderIsLid = sender.endsWith('@lid');
        isOwner = resolveIsOwner({
            fromMe, senderNumber, senderJid: sender, OWNER, OWNER_LID, OWNER_PERSONAL, lidCache,
        });
    }

    if (!body || !body.startsWith(PREFIX)) return;

    const botMode = getBotMode();
    if (!canUseBot(isOwner, botMode)) return;

    // ── Parsing de la commande ─────────────────────────────────
    const parts   = body.slice(PREFIX.length).trim().split(/\s+/);
    const cmdName = parts[0]?.toLowerCase();
    const args    = parts.slice(1);
    const text    = args.join(' ');

    if (!cmdName) return;

    const command = commands[cmdName];
    if (!command) return;

    // ── Vérification accès private ────────────────────────────
    if ((command.private || command.public === false) && !isOwner) {
        return await sock.sendMessage(from, { text: '🔐 Cette commande est privée et réservée au propriétaire.' });
    }

    // ── Vérification admin ────────────────────────────────────
    if (command.adminOnly && !isOwner) {
        let isUserAdmin = false;
        let isBotAdmin = false;

        if (isGroup) {
            const metadata = await sock.groupMetadata(from).catch(() => null);
            if (metadata) {
                isUserAdmin = !!metadata.participants.find(
                    p => p.id === sender && (p.admin || p.isSuperAdmin)
                );
                const botNumId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                const botLidId = sock.user?.lid || null;
                isBotAdmin = !!metadata.participants.find(p => {
                    if (!(p.admin || p.isSuperAdmin)) return false;
                    return p.id === botNumId || p.id === sock.user?.id || (botLidId && p.id === botLidId);
                });
            }
        }

        if (isGroup && !isBotAdmin) {
            return await sock.sendMessage(from, { text: '⚠️ Je ne suis pas administrateur du groupe.' });
        }

        if (!isUserAdmin) {
            return await sock.sendMessage(from, { text: '🔒 Cette commande est réservée aux administrateurs.' });
        }
    }

    // ── Exécution ─────────────────────────────────────────────
    try {
        console.log(`⚡ [${cmdName}] par ${senderNumber} (Owner: ${isOwner})`);
        addStat(senderNumber, cmdName);

        if (typeof ctx.onCommand === 'function') ctx.onCommand(cmdName, senderNumber);
        if (global.__trackDashboardCommand) global.__trackDashboardCommand(cmdName, senderNumber);

        await command.execute({
            sock, msg, from, sender, senderNumber,
            isOwner, isGroup, args, text, store,
            noTagGroups,
            botMode,
            prefix: PREFIX,
            owner: OWNER,
        });
    } catch (err) {
        console.error(`❌ Erreur ${cmdName}:`, err.message);
        await sock.sendMessage(from, { text: `❌ Erreur : ${err.message}` }).catch(() => {});
    }
}