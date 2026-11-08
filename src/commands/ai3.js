import axios from 'axios';

const msgCache = new Set();

async function quickAI(prompt) {
    // Utilise gemini-3-flash-preview (plus robuste pour le JSON)
    const key = (process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_5);
    try {
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`,
            { contents: [{ parts: [{ text: prompt }] }] },
            { timeout: 20000 }
        );
        return res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    } catch { return null; }
}

export default {
    debate: {
        execute: async ({ sock, from, text, msg }) => {
            const msgId = msg.key.id;
            if (msgCache.has(msgId)) return;
            msgCache.add(msgId);
            setTimeout(() => msgCache.delete(msgId), 30000);

            if (!text) return sock.sendMessage(from, { text: '⚖️ Sujet manquant.' });
            
            sock.sendPresenceUpdate('composing', from).catch(() => {});
            const result = await quickAI(`Fais un débat court sur : ${text}. Pour/Contre/Verdict.`);
            sock.sendPresenceUpdate('paused', from).catch(() => {});
            
            if (result) {
                await sock.sendMessage(from, { text: `⚖️ *DÉBAT*\n\n${result}` }, { quoted: msg });
            } else {
                await sock.sendMessage(from, {
                    text: '❌ Service IA indisponible. Réessaie plus tard.',
                }, { quoted: msg });
            }
        }
    },

    // NOTE: cette commande "quiz" IA était inachevée (branche vide quand un
    // quiz est déjà actif : aucune réponse, aucune suite) et rentrait de
    // toute façon en collision silencieuse avec le vrai !quiz de
    // divertissement.js, qui l'écrasait. Renommée pour éviter la collision
    // et désactivée tant qu'elle n'est pas terminée (pas de gestion des
    // réponses A/B/C/D ni de state machine réelle).
    _quiz_ia_incomplete: {
        execute: async ({ sock, from, sender, text, msg }) => {
            const msgId = msg.key.id;
            if (msgCache.has(msgId)) return;
            msgCache.add(msgId);
            setTimeout(() => msgCache.delete(msgId), 30000);
            
            // Logique de quiz corrigée pour éviter le spam
            if (global.activeQuizzes?.has(`${from}_${sender}`)) {
                // ... (Reste de ta logique de réponse A/B/C/D)
            } else {
                sock.sendPresenceUpdate('composing', from).catch(() => {});
                const prompt = `Génère 3 questions de quiz sur ${text || 'Culture'}. Format JSON uniquement: [{"q":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A"}]`;
                const result = await quickAI(prompt);
                sock.sendPresenceUpdate('paused', from).catch(() => {});
                
                // Nettoyage du JSON car l'IA ajoute souvent des ```json ... ```
                const cleanJson = result?.replace(/```json|```/gi, '').trim();
                try {
                    const questions = JSON.parse(cleanJson);
                    // Initialisation du quiz...
                    await sock.sendMessage(from, { text: `📝 *Quiz prêt !*\nQuestion 1: ${questions[0].q}` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ Erreur de génération.' }, { quoted: msg });
                }
            }
        }
    }
};