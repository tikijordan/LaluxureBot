/**
 * @file        handler.js
 * @description Gestionnaire de commandes — multi-session compatible
 * @license     MIT
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getContentType } from '@whiskeysockets/baileys';
import { isSpam, trackMessage } from './utils/antispam.js';
import { loadCommands } from './loader.js';
import { addStat } from './utils/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Commandes chargées une fois au démarrage (partagées entre toutes les sessions)
let commands = {};
(async () => {
    commands = await loadCommands();
    console.log(`📦 ${Object.keys(commands).length} commandes prêtes.`);
})();

// noTagGroups par défaut (utilisé seulement si non fourni par la session)
const _defaultNoTagGroups = new Set();

// ══════════════════════════════════════════════════════════════
// DÉDUPLICATION HANDLER — filet de sécurité contre les doubles appels
// Distinct du cache dans index.js : couvre le cas où handler est
// appelé directement depuis un autre module sans passer par index.js.
// Clé : msg.key.id — nettoyage toutes les 5 min
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// DÉDUPLICATION HANDLER — Map avec TTL (10 min par message)
// Couvre le cas où handler est appelé directement sans passer par index.js
// ══════════════════════════════════════════════════════════════
const _handledMsgIds = new Map();
const _HANDLER_TTL   = 10 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of _handledMsgIds) {
        if (now - ts > _HANDLER_TTL) _handledMsgIds.delete(id);
    }
}, 60 * 1000);

/**
 * Traite un message entrant et exécute la commande correspondante.
 *
 * @param {object} sock    - Socket Baileys de la session
 * @param {object} msg     - Message WhatsApp
 * @param {object} store   - Store Baileys (peut être {})
 * @param {object} ctx     - Contexte pré-calculé par index.js :
 *   - body         {string}  Corps du message
 *   - from         {string}  JID de destination (groupe ou DM)
 *   - isGroup      {boolean}
 *   - isOwner      {boolean}
 *   - senderNumber {string}  Numéro sans @
 *   - sender       {string}  JID complet de l'expéditeur
 *   - prefix       {string}  Préfixe de la session (ex: '/')
 *   - owner        {string}  Numéro du propriétaire de la session
 *   - noTagGroups  {Set}     Groupes en mode no-tag
 *   - onCommand    {function} Callback dashboard (cmd, user)
 */
export async function handleCommand(sock, msg, store, ctx = {}) {

    // ── Déduplication au niveau handler ───────────────────────
    const msgId = msg?.key?.id;
    if (msgId) {
        if (_handledMsgIds.has(msgId)) return;
        _handledMsgIds.set(msgId, Date.now());
    }

    // ── Résolution du préfixe et du propriétaire (contexte session ou fallback) ──
    const PREFIX = ctx.prefix || process.env.PREFIX || '/';
    const OWNER  = ctx.owner  || (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
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

        if (isGroup) {
            from         = rawJid;
            sender       = msg.key.participant || '';
            senderNumber = sender.split('@')[0].replace(/\D/g, '');
        } else {
            from         = (isLid || fromMe) ? `${OWNER}@s.whatsapp.net` : rawJid;
            senderNumber = fromMe ? OWNER : rawJid.split('@')[0].replace(/\D/g, '');
            sender       = `${senderNumber}@s.whatsapp.net`;
        }
        isOwner = fromMe || (OWNER && senderNumber === OWNER);
    }

    if (!body || !body.startsWith(PREFIX)) return;

    // ── Anti-spam ──────────────────────────────────────────────
    if (!isOwner) {
        if (isSpam(senderNumber)) {
            return await sock.sendMessage(from, { text: ' Calme-toi ! Trop de messages.' });
        }
        trackMessage(senderNumber);
    }

    // ── Parsing de la commande ─────────────────────────────────
    const parts   = body.slice(PREFIX.length).trim().split(/\s+/);
    const cmdName = parts[0]?.toLowerCase();
    const args    = parts.slice(1);
    const text    = args.join(' ');

    if (!cmdName) return;

    // botMode transmis depuis index.js (le blocage est géré dans index.js)
    const botMode = ctx.botMode || 'public';

    const command = commands[cmdName];
    if (!command) return;

    // ── Vérification mode privé avec métadonnées groupe ────────
    if (botMode === 'private' && !isOwner) {
        let isUserOwner = false;
        
        if (isGroup) {
            // Utiliser metadata pour vérifier si l'utilisateur est le owner
            const metadata = await sock.groupMetadata(from).catch(() => null);
            if (metadata) {
                // Vérifier si c'est le owner en comparant le numéro du sender
                isUserOwner = metadata.participants.find(
                    p => p.id === sender && p.id.split('@')[0] === OWNER
                );
            }
        } else {
            // En DM, vérifier directement le numéro
            isUserOwner = senderNumber === OWNER;
        }
        
        // Si pas owner et mode private → refus
        if (!isUserOwner) {
            return await sock.sendMessage(from, { text: '🔐 Le bot est actuellement en mode privé. Seul le propriétaire peut l\'utiliser.' });
        }
    }

    // ── Vérification accès private ────────────────────────────
    if (command.private && !isOwner) {
        return await sock.sendMessage(from, { text: '🔐 Cette commande est privée et réservée au propriétaire.' });
    }

    // ── Vérification accès public ─────────────────────────────
    if (command.public === false && !isOwner) {
        return await sock.sendMessage(from, { text: '🔐 Cette commande est privée et réservée au propriétaire.' });
    }

    // ── Vérification admin ────────────────────────────────────
    if (command.adminOnly && !isOwner) {
        let isUserAdmin = false;
        let isBotAdmin = false;
        
        if (isGroup) {
            const metadata = await sock.groupMetadata(from).catch(() => null);
            if (metadata) {
                // Vérifier si l'utilisateur est admin
                isUserAdmin = metadata.participants.find(
                    p => p.id === sender && (p.admin || p.isSuperAdmin)
                );
                
                // Vérifier si le bot est admin
                const botId = sock.user.id;
                isBotAdmin = metadata.participants.find(
                    p => p.id === botId && (p.admin || p.isSuperAdmin)
                );
            }
        }
        
        // Si le bot n'est pas admin dans le groupe
        if (isGroup && !isBotAdmin && !isOwner) {
            return await sock.sendMessage(from, { text: '⚠️ Je ne suis pas administrateur du groupe.' });
        }
        
        // Si l'utilisateur n'est pas admin
        if (!isUserAdmin && !isOwner) {
            return await sock.sendMessage(from, { text: '🔒 Cette commande est réservée aux administrateurs.' });
        }
    }

    // ── Exécution ─────────────────────────────────────────────
    try {
        console.log(`⚡ [${cmdName}] par ${senderNumber} (Owner: ${isOwner})`);
        addStat(senderNumber, cmdName);

        // Notifier le dashboard (via callback de la session)
        if (typeof ctx.onCommand === 'function') ctx.onCommand(cmdName, senderNumber);
        // Rétro-compat : hook global si présent
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