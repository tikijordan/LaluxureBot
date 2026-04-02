/**
 * ============================================================
 * @file        ai.js (CORRIGÉ)
 * @description Commandes IA — Gemini 1.5 & Groq avec gestion de session stable
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

const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean);

// Cache pour éviter que l'IA réponde 2 fois au même message (Anti-doublon)
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
    setTimeout(() => this.exhausted.delete(idx), 60 * 60 * 1000); // Reset 1h
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
const groqKeys = new KeyManager(GROQ_KEYS, 'Groq');

// --- APPEL GEMINI (CORRIGÉ : Modèle 1.5 Flash) ---
async function callGemini(prompt) {
  const key = geminiKeys.getKey();
  if (!key) return null;

  // Utilisation de gemini-1.5-flash (le plus stable et rapide)
  const model = "gemini-3-flash-preview"; 

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
      },
      { timeout: 15000 }
    );

    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('404_OR_EMPTY');
    return { text, provider: 'Gemini ✨' };

  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 400 || status === 403) {
      console.log(`⚠️ [Gemini] Clé HS ou Quota. Rotation...`);
      geminiKeys.markExhausted();
    }
    return null; // On retourne null pour laisser askAI passer à Groq
  }
}

// --- APPEL GROQ (CORRIGÉ : llama-3.3-70b) ---
async function callGroq(prompt) {
  const key = groqKeys.getKey();
  if (!key) return null;

  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 15000,
      }
    );

    const text = res.data?.choices?.[0]?.message?.content;
    return text ? { text, provider: 'Groq ⚡' } : null;
  } catch (err) {
    if (err.response?.status === 429) groqKeys.markExhausted();
    return null;
  }
}

async function askAI(prompt) {
  // Try Gemini
  let res = await callGemini(prompt);
  if (res) return res;

  // Fallback Groq
  console.log('🔀 Switch automatique: Gemini → Groq');
  res = await callGroq(prompt);
  return res;
}

export default {
  ia: {
    description: "IA intelligente (Gemini/Groq)",
    execute: async ({ sock, from, text, msg }) => {
      const msgId = msg.key.id;
      if (msgCache.has(msgId)) return; // STOP DOUBLONS
      msgCache.add(msgId);
      setTimeout(() => msgCache.delete(msgId), 30000);

      if (!text) return sock.sendMessage(from, { text: "🤖 Posez une question après !ia" });

      // Envoi d'un seul message d'attente
      const { key } = await sock.sendMessage(from, { text: '🔄 _Réflexion..._' });

      const result = await askAI(text);

      if (result) {
        // On modifie le message d'attente au lieu d'en envoyer un nouveau (plus propre)
        await sock.sendMessage(from, { 
            text: `🤖 *IA — ${result.provider}*\n\n${result.text}`,
            edit: key 
        });
      } else {
        await sock.sendMessage(from, { 
            text: "❌ Service IA indisponible. Réessaie plus tard.",
            edit: key 
        });
      }
    },
  },

  aistatus: {
    description: 'Statut des clés',
    adminOnly: true,
    execute: async ({ sock, from }) => {
      const g = geminiKeys.status();
      const gr = groqKeys.status();
      await sock.sendMessage(from, {
        text: `📊 *Statut IA*\n✨ Gemini: ${g.active}/${g.total} OK\n⚡ Groq: ${gr.active}/${gr.total} OK`
      });
    }
  }
};