import axios from 'axios';
import { KeyManager } from './ai.js';

// Utilisation du cache global ou local pour éviter les doublons
const msgCache = new Set();
const chatSessions = new Map();
const CHATBOT_TIMEOUT = 30 * 60 * 1000;

// ── Réponses IA déjà envoyées (par chat) ──────────────────────
// Permet, comme dans Ely, de répondre automatiquement quand l'utilisateur
// cite (reply) un message de l'IA, sans qu'il ait à la mentionner.
const aiReplyIds = new Map(); // chatJid → Map(messageId → timestamp)
const AI_REPLY_TTL = 60 * 60 * 1000;

export function addAIReply(chatJid, id) {
    if (!chatJid || !id) return;
    let ids = aiReplyIds.get(chatJid);
    if (!ids) { ids = new Map(); aiReplyIds.set(chatJid, ids); }
    ids.set(id, Date.now());
}

export function isReplyToAI(chatJid, id) {
    if (!chatJid || !id) return false;
    const ids = aiReplyIds.get(chatJid);
    const at = ids?.get(id);
    if (!at) return false;
    if (Date.now() - at > AI_REPLY_TTL) { ids.delete(id); return false; }
    return true;
}

// Nettoyage périodique des identifiants expirés.
setInterval(() => {
    const now = Date.now();
    for (const [chatJid, ids] of aiReplyIds) {
        for (const [id, at] of ids) if (now - at > AI_REPLY_TTL) ids.delete(id);
        if (ids.size === 0) aiReplyIds.delete(chatJid);
    }
}, 10 * 60 * 1000).unref?.();

// Importation de la logique de rotation depuis ton fichier principal ai.js 
// (Ou copier/coller la classe KeyManager ici si les fichiers sont isolés)
// Pour l'exemple, j'utilise une fonction simplifiée qui respecte tes clés GEMINI_API_KEY_1, 2, 3...

const geminiKeys2 = new KeyManager(
  [process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(Boolean),
  'Gemini2'
);
async function callAI(messages, temperature = 0.7) {
    let key = geminiKeys2.getKey();
    if (!key) return null;

    try {
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`,
            { contents, generationConfig: { temperature, maxOutputTokens: 4096 } },
            { timeout: 20000 }
        );
        return res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    } catch (e) {
        const status = e.response?.status;
        console.error("Erreur IA:", e.message);
        if (status === 429 || status === 400 || status === 403) geminiKeys2.markExhausted();
        return null;
    }
}

export async function runChatbotTurn({ sock, from, sender, text, quoted }) {
    let session = chatSessions.get(sender) || { history: [], lastActivity: Date.now() };
    if (Date.now() - session.lastActivity > CHATBOT_TIMEOUT) session.history = [];

    // Comme Ely : la réponse cite le message qui a déclenché l'IA. Le wrapper
    // sendMessage retire automatiquement la citation si le chat change.
    const sendOpts = quoted ? { quoted } : undefined;
    const { key } = await sock.sendMessage(from, { text: '✍️ _En train d\'écrire..._' }, sendOpts);
    addAIReply(from, key?.id);

    const messages = [
        { role: 'system', content: 'Tu es un assistant WhatsApp utile qui fais ce qu\'on te demande evite parler trop et tu te nomme lalxureAi c\'est commca que tu presente , détaillé et naturel. Réponds complètement sans te couper.' },
        ...session.history.slice(-10),
        { role: 'user', content: text }
    ];

    const reply = await callAI(messages);
    if (reply) {
        session.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
        session.lastActivity = Date.now();
        chatSessions.set(sender, session);
        await sock.sendMessage(from, { text: `${reply}`, edit: key }, sendOpts);
    } else {
        await sock.sendMessage(from, {
            text: '❌ Service IA indisponible. Réessaie plus tard ou utilise !chatbot reset.',
            edit: key,
        }, sendOpts);
    }
}

export default {
    chatbot: {
        description: 'Mode conversation continue — une fois activé, plus besoin de retaper la commande, écris directement',
        // FIX (chatbot doit permettre de causer sans retaper la commande) :
        // avant, il fallait préfixer CHAQUE message par "!chatbot". On active
        // maintenant un "mode conversation libre" par utilisateur — après un
        // premier "!chatbot", ses messages sans préfixe sont automatiquement
        // envoyés à l'IA (voir handleFreeformChatbot dans handler.js et le
        // branchement dans index.js), jusqu'à "!chatbot off".
        execute: async ({ sock, from, sender, text, args, msg }) => {
            const msgId = msg.key.id;
            if (msgCache.has(msgId)) return;
            msgCache.add(msgId);
            setTimeout(() => msgCache.delete(msgId), 30000);

            const sub = args[0]?.toLowerCase();

            if (sub === 'off') {
                global.activeChatbotSessions?.delete(sender);
                return sock.sendMessage(from, { text: '🔕 Mode conversation libre désactivé. Retape !chatbot pour reprendre.' });
            }

            if (sub === 'reset') {
                chatSessions.delete(sender);
                global.activeChatbotSessions?.delete(sender);
                return sock.sendMessage(from, { text: '🔄 Mémoire effacée. Retape !chatbot pour reprendre.' });
            }

            // Active le mode conversation libre : les prochains messages de
            // cet utilisateur sans préfixe seront envoyés à l'IA directement.
            if (!global.activeChatbotSessions) global.activeChatbotSessions = new Set();
            const alreadyActive = global.activeChatbotSessions.has(sender);
            global.activeChatbotSessions.add(sender);

            if (!text) {
                return sock.sendMessage(from, {
                    text: alreadyActive
                        ? ' Le mode conversation libre est déjà actif — écris directement, sans !chatbot.'
                        : ' *Mode conversation libre activé !*\n\nÉcris directement, plus besoin de retaper !chatbot avant chaque message.\n\n_!chatbot off pour arrêter, !chatbot reset pour effacer la mémoire._',
                });
            }

            await runChatbotTurn({ sock, from, sender, text });
        }
    },

    ocr: {
        description: 'Extraire texte image',
        execute: async ({ sock, from, msg }) => {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const target = quoted || msg.message;
            if (!target?.imageMessage) return sock.sendMessage(from, { text: '❌ Cite une image.' });

            const { key } = await sock.sendMessage(from, { text: '🔍 _Lecture de l\'image..._' });

            try {
                const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
                const stream = await downloadContentFromMessage(target.imageMessage, 'image');
                let buf = Buffer.from([]);
                for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);

                const res = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_5}`,
                    {
                        contents: [{
                            parts: [
                                { text: 'Retranscris tout le texte de cette image.' },
                                { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } }
                            ]
                        }]
                    }
                );
                const result = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                await sock.sendMessage(from, { text: `🔍 *OCR*\n\n${result || 'Aucun texte.'}`, edit: key });
            } catch (e) {
                await sock.sendMessage(from, { text: '❌ Erreur OCR.', edit: key });
            }
        }
    }
};