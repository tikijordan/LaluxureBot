/**
 * ============================================================
 * @file        ai.js
 * @description Commandes IA — Gemini 2.0 Flash uniquement
 * ============================================================
 */

import axios from 'axios';

// --- CONFIGURATION ---
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean);

// Modèle Gemini stable et disponible
const GEMINI_MODEL = 'gemini-3-flash-preview';

// Cache anti-doublon
const msgCache = new Set();

class KeyManager {
  constructor(keys, name) {
    this.keys = keys;
    this.name = name;
    this.currentIndex = 0;
    this.exhausted = new Set();
  }

  getKey() {
    if (this.allExhausted()) return null;
    let attempts = 0;
    while (this.exhausted.has(this.currentIndex) && attempts < this.keys.length) {
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      attempts++;
    }
    return this.keys[this.currentIndex];
  }

  markExhausted() {
    this.exhausted.add(this.currentIndex);
    const idx = this.currentIndex;
    setTimeout(() => this.exhausted.delete(idx), 60 * 60 * 1000); // Reset après 1h
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
  }

  allExhausted() {
    return this.keys.length === 0 || this.exhausted.size >= this.keys.length;
  }

  status() {
    return { total: this.keys.length, active: this.keys.length - this.exhausted.size };
  }
}

const geminiKeys = new KeyManager(GEMINI_KEYS, 'Gemini');

// --- APPEL GEMINI ---
async function callGemini(prompt) {
  const key = geminiKeys.getKey();
  if (!key) return null;

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 },
      },
      { timeout: 300000 }
    );

    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Réponse vide');
    return { text, provider: 'Gemini ✨' };

  } catch (err) {
    const status = err.response?.status;
    console.log(`⚠️ [Gemini] Erreur ${status || err.message}`);
    if (status === 429 || status === 400 || status === 403) {
      console.log('🔄 Rotation de clé Gemini...');
      geminiKeys.markExhausted();
    }
    return null;
  }
}

export default {

  ia: {
    description: 'IA intelligente (Gemini)',
    execute: async ({ sock, from, text, msg }) => {
      const msgId = msg.key.id;
      if (msgCache.has(msgId)) return;
      msgCache.add(msgId);
      setTimeout(() => msgCache.delete(msgId), 30000);

      if (!text) {
        return sock.sendMessage(from, { text: '🤖 Pose une question après !ia\nExemple: !ia Explique-moi la relativité' });
      }

      const { key } = await sock.sendMessage(from, { text: '🔄 _Réflexion..._' });

      const result = await callGemini(text);

      if (result) {
        await sock.sendMessage(from, {
          text: `🤖 *IA — ${result.provider}*\n\n${result.text}`,
          edit: key,
        });
      } else {
        await sock.sendMessage(from, {
          text: '❌ Service IA indisponible.\n\n_Vérifie que GEMINI_API_KEY_1 est bien configurée dans les variables d\'environnement._',
          edit: key,
        });
      }
    },
  },

  aistatus: {
    description: 'Statut des clés Gemini (admin)',
    adminOnly: true,
    execute: async ({ sock, from }) => {
      const g = geminiKeys.status();
      await sock.sendMessage(from, {
        text: `📊 *Statut IA*\n\n✨ Gemini (${GEMINI_MODEL})\n` +
          `🔑 Clés actives: *${g.active}/${g.total}*\n` +
          `${g.active === 0 ? '❌ Toutes les clés sont épuisées !' : '✅ Service opérationnel'}`,
      });
    },
  },
};