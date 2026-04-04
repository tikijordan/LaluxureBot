import axios from 'axios';

const msgCache = new Set();

async function quickAI(prompt) {
    // Utilise gemini-1.5-flash (plus robuste pour le JSON)
    const key = process.env.GEMINI_API_KEY_1;
    try {
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`,
            { contents: [{ parts: [{ text: prompt }] }] }
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

            if (!text) return sock.sendMessage(from, { text: '⚖️ Sujet manquant.' });
            
            const { key } = await sock.sendMessage(from, { text: '⚖️ _Analyse des arguments..._' });
            const result = await quickAI(`Fais un débat court sur : ${text}. Pour/Contre/Verdict.`);
            
            if (result) {
                await sock.sendMessage(from, { text: `⚖️ *DÉBAT*\n\n${result}`, edit: key });
            }
        }
    },

    quiz: {
        execute: async ({ sock, from, sender, text, msg }) => {
            const msgId = msg.key.id;
            if (msgCache.has(msgId)) return;
            msgCache.add(msgId);
            
            // Logique de quiz corrigée pour éviter le spam
            if (global.activeQuizzes?.has(`${from}_${sender}`)) {
                // ... (Reste de ta logique de réponse A/B/C/D)
            } else {
                const { key } = await sock.sendMessage(from, { text: '📝 _Préparation du quiz..._' });
                const prompt = `Génère 3 questions de quiz sur ${text || 'Culture'}. Format JSON uniquement: [{"q":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A"}]`;
                const result = await quickAI(prompt);
                
                // Nettoyage du JSON car l'IA ajoute souvent des ```json ... ```
                const cleanJson = result?.replace(/```json|```/gi, '').trim();
                try {
                    const questions = JSON.parse(cleanJson);
                    // Initialisation du quiz...
                    await sock.sendMessage(from, { text: `📝 *Quiz prêt !*\nQuestion 1: ${questions[0].q}`, edit: key });
                } catch {
                    await sock.sendMessage(from, { text: '❌ Erreur de génération.', edit: key });
                }
            }
        }
    }
};