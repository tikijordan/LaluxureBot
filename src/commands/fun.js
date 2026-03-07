/**
 * ============================================================
 * @file        fun.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes fun — Horoscope, rap, google, anime, lyrics, currency, fact
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES FUN & RECHERCHE AVANCÉE
// horoscope, rap, google, codeai, anime, fact,
// currency, weather2, lyrics, color
// ============================================================

import axios from 'axios';

// ── Appel IA (Gemini → Groq) ─────────────────────────────────
async function callAI(prompt) {
  const geminiKey = process.env.GEMINI_API_KEY_1;
  const groqKey = process.env.GROQ_API_KEY_1;

  if (geminiKey) {
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 600 } },
        { timeout: 15000 }
      );
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch {}
  }

  if (groqKey) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0.9 },
        { headers: { Authorization: `Bearer ${groqKey}` }, timeout: 15000 }
      );
      return res.data?.choices?.[0]?.message?.content;
    } catch {}
  }
  return null;
}

export default {

  // ════════════════════════════════════════
  // FUN & CRÉATIF
  // ════════════════════════════════════════

  horoscope: {
    description: 'Horoscope du jour par signe',
    execute: async ({ sock, from, args }) => {
      const signes = {
        belier: '♈', taureau: '♉', gemeaux: '♊', cancer: '♋',
        lion: '♌', vierge: '♍', balance: '♎', scorpion: '♏',
        sagittaire: '♐', capricorne: '♑', verseau: '♒', poissons: '♓',
        aries: '♈', gemini: '♊', leo: '♌', virgo: '♍', libra: '♎',
        scorpio: '♏', sagittarius: '♐', capricorn: '♑', aquarius: '♒', pisces: '♓',
      };

      const signe = args[0]?.toLowerCase();
      if (!signe || !signes[signe]) {
        const liste = Object.keys(signes).filter(s => !['aries','gemini','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'].includes(s));
        await sock.sendMessage(from, {
          text: `🔮 *Usage:* !horoscope [signe]\n\n*Signes disponibles:*\n${liste.map(s => `${signes[s]} ${s}`).join('  ')}`,
        });
        return;
      }

      await sock.sendMessage(from, { text: `${signes[signe]} Lecture des astres pour *${signe}*...` });

      const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
      const prompt = `Génère un horoscope quotidien créatif et fun pour le signe ${signe} pour aujourd'hui ${today}. 
Inclus: 
- Amour ❤️ (1-2 phrases)
- Travail 💼 (1-2 phrases)  
- Santé 💚 (1 phrase)
- Chanceux aujourd'hui 🍀 (chiffre + couleur)
- Conseil du jour ⭐ (1 phrase)
Sois optimiste, original et mystérieux. Environ 150 mots.`;

      const result = await callAI(prompt);
      if (result) {
        await sock.sendMessage(from, {
          text: `${signes[signe]} *Horoscope ${signe.charAt(0).toUpperCase()+signe.slice(1)}*\n📅 ${today}\n\n${result}`,
        });
      } else {
        // Horoscopes statiques de fallback
        const fallbacks = [
          'Les astres favorisent vos projets aujourd\'hui ! ⭐ Amour: une surprise agréable vous attend. Travail: votre créativité brille. Chiffre chanceux: 7 🍀',
          'Journée positive sous le signe de la réussite. 💫 En amour, soyez ouvert. Au travail, faites confiance à votre intuition. Couleur : bleu 🔵',
          'Le cosmos vous sourit ! ✨ Relations harmonieuses, succès professionnel en vue. Restez positif et tout ira bien. Chiffre : 3 🎯',
        ];
        await sock.sendMessage(from, {
          text: `${signes[signe]} *Horoscope ${signe}*\n📅 ${today}\n\n${fallbacks[Math.floor(Math.random()*fallbacks.length)]}`,
        });
      }
    },
  },

  rap: {
    description: 'Générer un rap ou un poème IA sur n\'importe quel sujet',
    execute: async ({ sock, from, text, args }) => {
      if (!text) {
        await sock.sendMessage(from, {
          text: '🎤 *Usage:* !rap [sujet]\n\nExemples:\n• !rap WhatsApp bot\n• !rap la vie en Afrique\n• !rap mon école\n• !rap amour et trahison',
        });
        return;
      }

      const style = args[0]?.toLowerCase() === '--poeme' ? 'poème' : 'rap';
      await sock.sendMessage(from, { text: `🎤 Composition en cours sur "${text}"...` });

      const prompt = `Écris un ${style} original, créatif et accrocheur sur le thème: "${text}".
Style: ${style === 'rap' ? 'rap francophone avec des rimes, du flow et du slang' : 'poème lyrique avec des métaphores'}.
4 couplets de 4 lignes chacun. 
Commence directement par le texte sans introduction.
Utilise des émojis pertinents à la fin de chaque couplet.`;

      const result = await callAI(prompt);
      if (result) {
        await sock.sendMessage(from, {
          text: `🎤 *${style === 'rap' ? '🔥 RAP' : '✍️ POÈME'} — "${text}"*\n${'━'.repeat(25)}\n\n${result}\n\n${'━'.repeat(25)}\n_🤖 Généré par IA_`,
        });
      } else {
        await sock.sendMessage(from, { text: '❌ Impossible de générer le rap. Configure une clé Gemini ou Groq dans le .env.' });
      }
    },
  },

  poem: {
    description: 'Générer un poème IA',
    execute: async ({ sock, from, text }) => {
      if (!text) { await sock.sendMessage(from, { text: '✍️ Usage: !poem [thème]' }); return; }
      await sock.sendMessage(from, { text: `✍️ Écriture du poème sur "${text}"...` });
      const result = await callAI(`Écris un beau poème lyrique et émouvant sur: "${text}". 3-4 strophes, avec des métaphores poétiques. Commence directement par le poème.`);
      if (result) {
        await sock.sendMessage(from, { text: `✍️ *Poème — "${text}"*\n${'═'.repeat(24)}\n\n${result}\n\n${'═'.repeat(24)}\n_🤖 IA Créative_` });
      } else {
        await sock.sendMessage(from, { text: '❌ Configure une clé IA dans le .env.' });
      }
    },
  },

  // ════════════════════════════════════════
  // RECHERCHE & INFO
  // ════════════════════════════════════════

  google: {
    description: 'Recherche web rapide',
    execute: async ({ sock, from, text }) => {
      if (!text) { await sock.sendMessage(from, { text: '🔍 Usage: !google [recherche]' }); return; }
      await sock.sendMessage(from, { text: `🔍 Recherche de "${text}"...` });

      try {
        // DuckDuckGo Instant Answer API (gratuit, sans clé)
        const res = await axios.get('https://api.duckduckgo.com/', {
          params: { q: text, format: 'json', no_redirect: 1, no_html: 1, skip_disambig: 1 },
          timeout: 10000,
        });
        const data = res.data;
        const abstract = data.AbstractText || data.Answer || '';
        const url = data.AbstractURL || `https://www.google.com/search?q=${encodeURIComponent(text)}`;
        const source = data.AbstractSource || 'DuckDuckGo';

        if (abstract) {
          await sock.sendMessage(from, {
            text: `🔍 *Résultat: "${text}"*\n${'━'.repeat(25)}\n\n${abstract}\n\n🔗 Source: ${source}\n${url}`,
          });
        } else {
          // Si pas de résultat direct, utiliser l'IA
          const aiResult = await callAI(`Réponds à cette question de manière concise et factuelle (max 200 mots): "${text}"`);
          if (aiResult) {
            await sock.sendMessage(from, {
              text: `🔍 *"${text}"*\n${'━'.repeat(25)}\n\n${aiResult}\n\n🔗 En savoir plus:\nhttps://www.google.com/search?q=${encodeURIComponent(text)}`,
            });
          } else {
            await sock.sendMessage(from, {
              text: `🔍 *Recherche: "${text}"*\n\nAucun résultat direct. Consulte:\n🔗 https://www.google.com/search?q=${encodeURIComponent(text)}\n🔗 https://fr.wikipedia.org/wiki/${encodeURIComponent(text)}`,
            });
          }
        }
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur de recherche: ${err.message}` });
      }
    },
  },

  codeai: {
    description: 'IA spécialisée en programmation',
    execute: async ({ sock, from, text }) => {
      if (!text) {
        await sock.sendMessage(from, {
          text: `💻 *Usage:* !codeai [question]\n\nExemples:\n• !codeai Comment créer un tableau en JavaScript?\n• !codeai Explique les classes Python\n• !codeai Débogue ce code: for i in range(10 print(i)\n• !codeai Différence entre == et === en JS`,
        });
        return;
      }

      await sock.sendMessage(from, { text: '💻 Analyse en cours...' });

      const prompt = `Tu es un expert en programmation. Réponds à cette question de façon claire, concise et avec des exemples de code si nécessaire.

Question: ${text}

Format de réponse:
- Explication claire (2-3 phrases max)
- Exemple de code si pertinent (dans des backticks)
- Conseil pratique ou bonne pratique
Max 300 mots. Utilise des émojis pour structurer.`;

      const result = await callAI(prompt);
      if (result) {
        await sock.sendMessage(from, {
          text: `💻 *Code AI*\n❓ ${text}\n${'━'.repeat(25)}\n\n${result}`,
        });
      } else {
        await sock.sendMessage(from, { text: '❌ Configure une clé Gemini ou Groq dans le .env.' });
      }
    },
  },

  fact: {
    description: 'Fait aléatoire insolite',
    execute: async ({ sock, from, args }) => {
      const theme = args.join(' ') || 'monde';
      const result = await callAI(`Donne-moi UN seul fait insolite, surprenant et peu connu sur le thème "${theme}". 
Maximum 3 phrases. Commence par "💡 *Le saviez-vous ?*" et ajoute un emoji pertinent à la fin.`);
      if (result) {
        await sock.sendMessage(from, { text: result });
      } else {
        const facts = [
          '💡 *Le saviez-vous ?* Les pieuvres ont 3 cœurs et leur sang est bleu ! 🐙',
          '💡 *Le saviez-vous ?* Les fourmis ne dorment jamais et peuvent soulever 50 fois leur poids ! 🐜',
          '💡 *Le saviez-vous ?* Un jour sur Vénus dure plus longtemps qu\'une année sur Vénus ! 🪐',
          '💡 *Le saviez-vous ?* Le miel ne se périme jamais. Du miel vieux de 3000 ans a été trouvé dans des pyramides égyptiennes ! 🍯',
        ];
        await sock.sendMessage(from, { text: facts[Math.floor(Math.random()*facts.length)] });
      }
    },
  },

  currency: {
    description: 'Convertisseur de devises en temps réel',
    execute: async ({ sock, from, args, text }) => {
      if (!text || args.length < 3) {
        await sock.sendMessage(from, {
          text: '💱 *Usage:* !currency [montant] [de] [vers]\n\nExemples:\n• !currency 100 USD EUR\n• !currency 500 XOF USD\n• !currency 1 EUR CFA',
        });
        return;
      }

      const amount = parseFloat(args[0]);
      let from2 = args[1]?.toUpperCase();
      let to = args[2]?.toUpperCase();

      // Alias populaires
      const aliases = { CFA: 'XOF', FCFA: 'XOF', EURO: 'EUR', DOLLAR: 'USD', LIVRE: 'GBP' };
      if (aliases[from2]) from2 = aliases[from2];
      if (aliases[to]) to = aliases[to];

      if (isNaN(amount)) { await sock.sendMessage(from, { text: '❌ Montant invalide.' }); return; }

      try {
        // Exchangerate-API (gratuit, sans clé pour les basiques)
        const res = await axios.get(`https://open.er-api.com/v6/latest/${from2}`, { timeout: 8000 });
        const rate = res.data?.rates?.[to];
        if (!rate) { await sock.sendMessage(from, { text: `❌ Devise ${to} non trouvée.` }); return; }
        const result = (amount * rate).toFixed(2);
        await sock.sendMessage(from, {
          text: `💱 *Conversion*\n\n${amount} *${from2}* = *${result} ${to}*\n\n📊 Taux: 1 ${from2} = ${rate.toFixed(4)} ${to}\n_Taux mis à jour en temps réel_`,
        });
      } catch {
        await sock.sendMessage(from, { text: '❌ Erreur de conversion. Vérifie les codes devises (USD, EUR, XOF...).' });
      }
    },
  },

  color: {
    description: 'Infos sur une couleur (code hex ou nom)',
    execute: async ({ sock, from, args }) => {
      if (!args[0]) {
        await sock.sendMessage(from, { text: '🎨 Usage: !color [#hexcode ou nom]\nEx: !color #FF5733\nEx: !color rouge' });
        return;
      }

      const input = args[0].replace('#', '');
      let hex = input;

      // Noms de couleurs communs
      const namedColors = {
        rouge: 'FF0000', bleu: '0000FF', vert: '00FF00', jaune: 'FFFF00',
        orange: 'FFA500', violet: '8B00FF', rose: 'FF69B4', noir: '000000',
        blanc: 'FFFFFF', gris: '808080', marron: '8B4513', cyan: '00FFFF',
        red: 'FF0000', blue: '0000FF', green: '00FF00', yellow: 'FFFF00',
        purple: '8B00FF', pink: 'FF69B4', black: '000000', white: 'FFFFFF',
        orange2: 'FFA500', brown: '8B4513',
      };

      if (namedColors[input.toLowerCase()]) hex = namedColors[input.toLowerCase()];

      if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
        await sock.sendMessage(from, { text: '❌ Code couleur invalide. Exemple: !color #FF5733 ou !color rouge' });
        return;
      }

      const r = parseInt(hex.slice(0,2), 16);
      const g = parseInt(hex.slice(2,4), 16);
      const b = parseInt(hex.slice(4,6), 16);
      const hsl = rgbToHsl(r,g,b);
      const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
      const textColor = luminance > 0.5 ? 'sombre' : 'clair';

      await sock.sendMessage(from, {
        text: `🎨 *Couleur #${hex.toUpperCase()}*\n\n` +
          `🔴 R: ${r} | 🟢 G: ${g} | 🔵 B: ${b}\n` +
          `🌈 HSL: ${hsl[0]}° ${hsl[1]}% ${hsl[2]}%\n` +
          `☀️ Luminosité: ${Math.round(luminance*100)}% (texte ${textColor})\n\n` +
          `🔗 Aperçu: https://www.colorhexa.com/${hex}\n` +
          `🎨 Palette: https://coolors.co/${hex}`,
      });
    },
  },

  anime: {
    description: 'Infos sur un anime ou manga',
    execute: async ({ sock, from, text }) => {
      if (!text) { await sock.sendMessage(from, { text: '🎌 Usage: !anime [titre]\nExemple: !anime Naruto' }); return; }
      await sock.sendMessage(from, { text: `🎌 Recherche de "${text}"...` });
      try {
        const res = await axios.get('https://api.jikan.moe/v4/anime', {
          params: { q: text, limit: 1 },
          timeout: 10000,
        });
        const anime = res.data?.data?.[0];
        if (!anime) { await sock.sendMessage(from, { text: `❌ Anime "${text}" non trouvé.` }); return; }
        const info =
          `🎌 *${anime.title}*\n` +
          (anime.title_japanese ? `🇯🇵 ${anime.title_japanese}\n` : '') +
          `${'━'.repeat(24)}\n` +
          `📺 Type: ${anime.type || 'N/A'} | Episodes: ${anime.episodes || '?'}\n` +
          `⭐ Score: ${anime.score || 'N/A'}/10 | Classement: #${anime.rank || '?'}\n` +
          `📅 Statut: ${anime.status || 'N/A'}\n` +
          `🎭 Genres: ${anime.genres?.map(g=>g.name).join(', ') || 'N/A'}\n\n` +
          `📝 *Synopsis:*\n${(anime.synopsis || 'Pas de synopsis').slice(0, 300)}${anime.synopsis?.length > 300 ? '...' : ''}\n\n` +
          `🔗 ${anime.url}`;
        if (anime.images?.jpg?.image_url) {
          await sock.sendMessage(from, { image: { url: anime.images.jpg.image_url }, caption: info });
        } else {
          await sock.sendMessage(from, { text: info });
        }
      } catch {
        await sock.sendMessage(from, { text: `❌ Erreur lors de la recherche de "${text}".` });
      }
    },
  },

  lyrics: {
    description: 'Trouver les paroles d\'une chanson',
    execute: async ({ sock, from, args, text }) => {
      if (!text || args.length < 2) {
        await sock.sendMessage(from, { text: '🎵 Usage: !lyrics [artiste] - [titre]\nExemple: !lyrics Drake - God\'s Plan' });
        return;
      }

      const [artistPart, ...titleParts] = text.split('-');
      const artist = artistPart?.trim();
      const title = titleParts.join('-').trim();

      if (!artist || !title) {
        await sock.sendMessage(from, { text: '❌ Format: !lyrics [artiste] - [titre]' });
        return;
      }

      await sock.sendMessage(from, { text: `🎵 Recherche des paroles de "${title}" par ${artist}...` });

      try {
        const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, { timeout: 10000 });
        const lyrics = res.data?.lyrics;
        if (!lyrics) throw new Error('Pas de paroles');
        const truncated = lyrics.length > 2000 ? lyrics.slice(0, 2000) + '\n\n_[...] (paroles tronquées)_' : lyrics;
        await sock.sendMessage(from, {
          text: `🎵 *${title}* — ${artist}\n${'━'.repeat(25)}\n\n${truncated}`,
        });
      } catch {
        await sock.sendMessage(from, {
          text: `❌ Paroles non trouvées pour "${title}" de ${artist}.\n\n🔍 Cherche sur:\nhttps://genius.com/search?q=${encodeURIComponent(artist+' '+title)}`,
        });
      }
    },
  },

  advice: {
    description: 'Conseil de vie aléatoire ou sur un thème',
    execute: async ({ sock, from, text }) => {
      const theme = text || '';
      const result = await callAI(
        theme
          ? `Donne un conseil de vie sage, pratique et motivant sur le thème: "${theme}". Max 4 phrases. Utilise des émojis.`
          : `Donne un conseil de vie universel, sage et inspirant. Max 4 phrases. Commence par un emoji pertinent.`
      );
      if (result) {
        await sock.sendMessage(from, { text: `💫 *Conseil du Sage*\n\n${result}` });
      } else {
        const fallbacks = [
          '💫 *Conseil du Sage*\n\nLe succès est la somme de petits efforts répétés jour après jour. Ne cherche pas la perfection, cherche la progression. Chaque pas compte, même le plus petit. 🌱',
          '💫 *Conseil du Sage*\n\nN\'attends pas le bon moment, crée-le. La vie récompense ceux qui agissent, pas ceux qui attendent. Commence aujourd\'hui, même imparfaitement. 🚀',
        ];
        await sock.sendMessage(from, { text: fallbacks[Math.floor(Math.random()*fallbacks.length)] });
      }
    },
  },

  tongue: {
    description: 'Virelangue dans différentes langues',
    execute: async ({ sock, from, args }) => {
      const lang = args[0]?.toLowerCase() || 'fr';
      const virelangues = {
        fr: [
          'Les chaussettes de l\'archiduchesse sont-elles sèches ? Archi-sèches ! 👟',
          'Un chasseur sachant chasser doit savoir chasser sans son chien. 🐕',
          'Seize jacinthes sèchent dans seize sachets secs. 🌸',
        ],
        en: [
          'She sells seashells by the seashore 🐚',
          'How much wood would a woodchuck chuck if a woodchuck could chuck wood? 🪵',
          'Peter Piper picked a peck of pickled peppers 🫑',
        ],
      };
      const list = virelangues[lang] || virelangues.fr;
      const pick = list[Math.floor(Math.random()*list.length)];
      await sock.sendMessage(from, {
        text: `👅 *Virelangue*\n\n${pick}\n\n_Dis-le 3 fois rapidement ! 😄_`,
      });
    },
  },

};

// Utilitaire RGB → HSL
function rgbToHsl(r,g,b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h,s,l=(max+min)/2;
  if (max===min) { h=s=0; } else {
    const d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max) {
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      case b: h=(r-g)/d+4; break;
    }
    h/=6;
  }
  return [Math.round(h*360), Math.round(s*100), Math.round(l*100)];
}
