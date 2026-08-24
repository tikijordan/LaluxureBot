import axios from 'axios';

// Utilisation du cache global ou local pour éviter les doublons
const msgCache = new Set();
const chatSessions = new Map();
const CHATBOT_TIMEOUT = 30 * 60 * 1000;

// Importation de la logique de rotation depuis ton fichier principal ai.js 
// (Ou copier/coller la classe KeyManager ici si les fichiers sont isolés)
// Pour l'exemple, j'utilise une fonction simplifiée qui respecte tes clés GEMINI_API_KEY_1, 2, 3...

async function callAI(messages, temperature = 0.7) {
    const keys = [process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2].filter(Boolean);
    const key = keys[0]; // À perfectionner avec KeyManager pour la rotation réelle

    try {
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`,
            { contents, generationConfig: { temperature, maxOutputTokens: 1000 } },
            { timeout: 20000 }
        );
        return res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    } catch (e) {
        console.error("Erreur IA:", e.message);
        return null;
    }
}

export async function runChatbotTurn({ sock, from, sender, text }) {
    let session = chatSessions.get(sender) || { history: [], lastActivity: Date.now() };
    if (Date.now() - session.lastActivity > CHATBOT_TIMEOUT) session.history = [];

    const { key } = await sock.sendMessage(from, { text: '🤖 _En train d\'écrire..._' });

    const messages = [
        { role: 'system', content: 'Tu es un assistant WhatsApp concis.' },
        ...session.history.slice(-10),
        { role: 'user', content: text }
    ];

    const reply = await callAI(messages);
    if (reply) {
        session.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
        session.lastActivity = Date.now();
        chatSessions.set(sender, session);
        await sock.sendMessage(from, { text: `🤖 ${reply}`, edit: key });
    } else {
        await sock.sendMessage(from, {
            text: '❌ Service IA indisponible. Réessaie plus tard ou utilise !chatbot reset.',
            edit: key,
        });
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
                        ? '🤖 Le mode conversation libre est déjà actif — écris directement, sans !chatbot.'
                        : '🤖 *Mode conversation libre activé !*\n\nÉcris directement, plus besoin de retaper !chatbot avant chaque message.\n\n_!chatbot off pour arrêter, !chatbot reset pour effacer la mémoire._',
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