/**
 * @file        handler.js
 * @description Gestionnaire de commandes — multi-session compatible
 * @license     MIT
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { isSpam, trackMessage } from './utils/antispam.js';
import { loadCommands } from './loader.js';
import { addStat } from './utils/stats.js';
// FIX 2 — lire le mode bot dynamiquement depuis le fichier plutôt que depuis ctx
import { getBotMode } from './commands/security.js';
import { extractMessageBody, resolveIsOwner } from './utils/message.js';

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


/**
 * Traite un message entrant et exécute la commande correspondante.
 *
 * @param {object} sock    - Socket Baileys de la session
 * @param {object} msg     - Message WhatsApp
 * @param {object} store   - Store Baileys (peut être {})
 * @param {object} ctx     - Contexte pré-calculé par index.js
 */
export async function handleCommand(sock, msg, store, ctx = {}) {

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
    const noTagGroups = ctx.noTagGroups || _defaultNoTagGroups;

    // ── Extraction du contexte ────────────────────────────────
    let body         = ctx.body;
    let from         = ctx.from;
    let isGroup      = ctx.isGroup;
    let isOwner      = ctx.isOwner;
    let senderNumber = ctx.senderNumber;
    let sender       = ctx.sender;

    // Fallback complet si appelé sans contexte (compatibilité)
    if (body === undefined) {
        body = extractMessageBody(msg);

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
            from         = (isLid || fromMe) ? `${OWNER}@s.whatsapp.net` : rawJid;
            senderNumber = fromMe ? OWNER : stripSuffix(rawJid);
            sender       = `${senderNumber}@s.whatsapp.net`;
        }

        isOwner = resolveIsOwner({
            fromMe, senderNumber, senderJid: sender, OWNER, OWNER_LID,
            lidCache: ctx.lidCache,
        });
    }

    if (!body || !body.startsWith(PREFIX)) return;

    // Owner-only permanent — DM et groupes
    if (!isOwner) return;

    // ── Parsing de la commande ─────────────────────────────────
    const parts   = body.slice(PREFIX.length).trim().split(/\s+/);
    const cmdName = parts[0]?.toLowerCase();
    const args    = parts.slice(1);
    const text    = args.join(' ');

    if (!cmdName) return;

    const botMode = ctx.botMode ?? getBotMode();

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