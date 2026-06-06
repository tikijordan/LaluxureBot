/**
 * ============================================================
 * @file        creative.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes creatives — Imagine, meme, wiki, define, crypto, roast, story
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES CRÉATIVES — Images, Fun, Recherche, Dev
// imagine, filter, meme, collage, roast, ship, rps, story,
// wiki, define, crypto, movie, code, snippet, github, regex
// ============================================================

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNIPPETS_FILE = path.join(__dirname, '../../data/snippets.json');

// ── Helpers ─────────────────────────────────────────────────
function loadSnippets() { try { return JSON.parse(fs.readFileSync(SNIPPETS_FILE,'utf8')); } catch { return {}; } }
function saveSnippets(d) { fs.writeFileSync(SNIPPETS_FILE, JSON.stringify(d,null,2)); }

function getMentionedJid(msg, args) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned?.length > 0) return mentioned;
  return [];
}

async function askAI(prompt) {
  const geminiKeys = [
    process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4, process.env.GEMINI_API_KEY_5
  ].filter(Boolean);
  
  const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

  for (const key of geminiKeys) {
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 600 } },
        { timeout: 15000 }
      );
      if (res.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return res.data.candidates[0].content.parts[0].text;
      }
    } catch (e) {
      continue;
    }
  }

  const groqKeys = [
    process.env.GROQ_API_KEY_1, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4, process.env.GROQ_API_KEY_5
  ].filter(Boolean);
  
  const groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  for (const key of groqKeys) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: groqModel, messages: [{ role:'user', content: prompt }], max_tokens: 600 },
        { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 }
      );
      if (res.data?.choices?.[0]?.message?.content) {
        return res.data.choices[0].message.content;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

export default {

  // ════════════════════════════════════════
  // IMAGES & MÉDIAS
  // ════════════════════════════════════════

  imagine: {
    description: 'Génération d\'image IA avancée avec styles',
    execute: async ({ sock, from, args, text }) => {
      const STYLES = {
        'realistic': 'photorealistic, 8k, ultra detailed',
        'anime':     'anime style, manga, vibrant colors',
        'oil':       'oil painting, classical art, masterpiece',
        'pixel':     'pixel art, retro game style, 16-bit',
        'neon':      'neon cyberpunk, glowing, dark background',
        'watercolor':'watercolor painting, soft, artistic',
        'sketch':    'pencil sketch, hand drawn, black and white',
        'cartoon':   'cartoon style, colorful, fun',
      };

      if (!text || args[0] === 'styles') {
        const styleList = Object.keys(STYLES).map(s => `• !imagine ${s} [description]`).join('\n');
        await sock.sendMessage(from, {
          text: `🎨 *Génération d'image IA*\n\n*Usage:* !imagine [style?] [description]\n\n*Styles disponibles:*\n${styleList}\n\n*Exemple:*\n!imagine anime un dragon crachant du feu au coucher du soleil`,
        });
        return;
      }

      const styleKey = Object.keys(STYLES).find(s => args[0]?.toLowerCase() === s);
      const stylePrompt = styleKey ? STYLES[styleKey] : 'beautiful, detailed, high quality';
      const prompt = styleKey ? args.slice(1).join(' ') : text;

      if (!prompt) { await sock.sendMessage(from, { text: '❌ Décris l\'image souhaitée.' }); return; }

      await sock.sendMessage(from, { text: `🎨 Génération en cours${styleKey ? ` (style: ${styleKey})` : ''}...` });

      try {
        const encodedPrompt = encodeURIComponent(`${prompt}, ${stylePrompt}`);
        const seed = Math.floor(Math.random() * 9999999);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true&enhance=true`;

        const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 40000 });
        const buffer = Buffer.from(res.data);

        await sock.sendMessage(from, {
          image: buffer,
          caption: `🎨 *Image générée par IA*\n📝 "${prompt}"${styleKey ? `\n🖼️ Style: ${styleKey}` : ''}\n\n_Propulsé par Pollinations AI_`,
        });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur de génération: ${err.message}` });
      }
    },
  },

  meme: {
    description: 'Créer un mème avec texte personnalisé',
    execute: async ({ sock, from, text }) => {
      if (!text) {
        await sock.sendMessage(from, {
          text: `😂 *Générateur de mèmes*\n\n*Usage:* !meme [texte haut] | [texte bas]\n\nExemple:\n!meme Quand le bot répond | En moins d'une seconde`,
        });
        return;
      }

      const [topText, bottomText = ''] = text.split('|').map(t => t.trim());
      await sock.sendMessage(from, { text: '😂 Création du mème...' });

      try {
        // Mèmes populaires
        const templates = [
          'Drake Hotline Bling', 'Two Buttons', 'Distracted Boyfriend',
          'Change My Mind', 'Is This A Pigeon', 'Woman Yelling At Cat',
          'Expanding Brain', 'Surprised Pikachu', 'This Is Fine',
        ];
        const template = templates[Math.floor(Math.random() * templates.length)];

        // Utiliser l'API Imgflip (gratuite)
        const formData = new URLSearchParams({
          template_id: getMemeTemplateId(template),
          username: 'imgflip_hubot',
          password: 'imgflip_hubot',
          text0: topText,
          text1: bottomText,
        });

        const res = await axios.post('https://api.imgflip.com/caption_image', formData.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        });

        if (res.data.success) {
          const imageRes = await axios.get(res.data.data.url, { responseType: 'arraybuffer' });
          await sock.sendMessage(from, {
            image: Buffer.from(imageRes.data),
            caption: `😂 *Mème généré !*\n📝 "${topText}"\n${bottomText ? `💬 "${bottomText}"` : ''}`,
          });
        } else {
          // Fallback: mème texte stylisé si API échoue
          await sendTextMeme(sock, from, topText, bottomText);
        }
      } catch {
        await sendTextMeme(sock, from, topText, bottomText);
      }
    },
  },

  // ════════════════════════════════════════
  // RECHERCHE & INFORMATION
  // ════════════════════════════════════════

  wiki: {
    description: 'Résumé Wikipedia d\'un sujet',
    execute: async ({ sock, from, text }) => {
      if (!text) { await sock.sendMessage(from, { text: '📖 Usage: !wiki [sujet]\nExemple: !wiki Tour Eiffel' }); return; }
      await sock.sendMessage(from, { text: '📖 Recherche sur Wikipedia...' });

      try {
        const lang = 'fr';
        const searchRes = await axios.get(
          `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`,
          { timeout: 10000 }
        );
        const { title, extract, content_urls, thumbnail } = searchRes.data;
        const summary = extract?.slice(0, 800) || 'Aucune description disponible.';
        const url = content_urls?.desktop?.page || '';

        const msg = `📖 *Wikipedia: ${title}*\n${'─'.repeat(30)}\n\n${summary}${extract?.length > 800 ? '...' : ''}\n\n🔗 ${url}`;

        if (thumbnail?.source) {
          try {
            const imgRes = await axios.get(thumbnail.source, { responseType: 'arraybuffer', timeout: 8000 });
            await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: msg });
          } catch {
            await sock.sendMessage(from, { text: msg });
          }
        } else {
          await sock.sendMessage(from, { text: msg });
        }
      } catch {
        // Fallback en anglais
        try {
          const res = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`, { timeout: 8000 });
          const { title, extract } = res.data;
          await sock.sendMessage(from, { text: `📖 *Wikipedia: ${title}*\n\n${extract?.slice(0,800) || 'Non trouvé.'}` });
        } catch {
          await sock.sendMessage(from, { text: `❌ Aucun résultat pour "${text}". Essaie un autre terme.` });
        }
      }
    },
  },

  define: {
    description: 'Définition d\'un mot + synonymes',
    execute: async ({ sock, from, text }) => {
      if (!text) { await sock.sendMessage(from, { text: '📚 Usage: !define [mot]' }); return; }
      await sock.sendMessage(from, { text: '📚 Recherche de la définition...' });

      try {
        // API Dictionary (anglais)
        const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`, { timeout: 8000 });
        const entry = res.data[0];
        const word = entry.word;
        const phonetic = entry.phonetic || '';

        let msg = `📚 *${word}* ${phonetic}\n${'─'.repeat(25)}\n\n`;

        entry.meanings.slice(0,3).forEach((m, i) => {
          msg += `*${i+1}. ${m.partOfSpeech}*\n`;
          m.definitions.slice(0,2).forEach((d, j) => {
            msg += `   ${j+1}. ${d.definition}\n`;
            if (d.example) msg += `   _Ex: "${d.example}"_\n`;
          });
          if (m.synonyms?.length) msg += `   🔀 Synonymes: ${m.synonyms.slice(0,5).join(', ')}\n`;
          msg += '\n';
        });

        await sock.sendMessage(from, { text: msg });
      } catch {
        // Fallback IA pour définition en français
        const aiDef = await askAI(`Donne la définition claire et concise du mot "${text}" en français. Format: définition + 2 exemples d'utilisation + 3 synonymes. Sois bref.`);
        if (aiDef) {
          await sock.sendMessage(from, { text: `📚 *Définition: ${text}*\n\n${aiDef}` });
        } else {
          await sock.sendMessage(from, { text: `❌ Définition introuvable pour "${text}".` });
        }
      }
    },
  },

  crypto: {
    description: 'Prix et infos des cryptomonnaies en temps réel',
    execute: async ({ sock, from, args, text }) => {
      const coins = text ? text.toLowerCase().split(/[\s,]+/).slice(0,5) : ['bitcoin','ethereum','bnb'];
      await sock.sendMessage(from, { text: '💰 Récupération des prix crypto...' });

      try {
        const ids = coins.join(',');
        const res = await axios.get(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,eur&include_24hr_change=true&include_market_cap=true`,
          { timeout: 10000 }
        );
        const data = res.data;

        if (Object.keys(data).length === 0) {
          await sock.sendMessage(from, { text: `❌ Crypto introuvable: "${text}"\n\nExemples: !crypto bitcoin ethereum solana` });
          return;
        }

        const trendEmoji = (change) => change > 5 ? '🚀' : change > 0 ? '📈' : change > -5 ? '📉' : '💥';
        let msg = `💰 *Prix Crypto — Temps Réel*\n${'─'.repeat(28)}\n\n`;

        for (const [coin, prices] of Object.entries(data)) {
          const change = prices.usd_24h_change?.toFixed(2) || '?';
          const emoji = trendEmoji(parseFloat(change));
          msg += `${emoji} *${coin.toUpperCase()}*\n`;
          msg += `   💵 USD: $${prices.usd?.toLocaleString('en') || '?'}\n`;
          msg += `   💶 EUR: €${prices.eur?.toLocaleString('fr') || '?'}\n`;
          msg += `   📊 24h: ${change}%\n\n`;
        }

        msg += `_Mis à jour: ${new Date().toLocaleTimeString('fr-FR')}_\n_Source: CoinGecko_`;
        await sock.sendMessage(from, { text: msg });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}\n\nEssaie: !crypto bitcoin` });
      }
    },
  },

  movie: {
    description: 'Infos film: note, synopsis, casting',
    execute: async ({ sock, from, text }) => {
      if (!text) { await sock.sendMessage(from, { text: '🎬 Usage: !movie [titre du film]\nExemple: !movie Inception' }); return; }
      await sock.sendMessage(from, { text: '🎬 Recherche du film...' });

      try {
        const apiKey = process.env.OMDB_API_KEY || '';
        let data;

        if (apiKey) {
          const res = await axios.get(`http://www.omdbapi.com/?t=${encodeURIComponent(text)}&apikey=${apiKey}&plot=full`, { timeout: 8000 });
          data = res.data;
        } else {
          // Fallback IA si pas de clé OMDB
          const aiInfo = await askAI(`Donne les infos du film "${text}": année, genre, réalisateur, acteurs principaux, note sur 10, synopsis en 3 phrases. Sois concis et structuré.`);
          if (aiInfo) {
            await sock.sendMessage(from, { text: `🎬 *${text}*\n\n${aiInfo}\n\n_💡 Pour plus de détails: ajoute OMDB_API_KEY dans .env (gratuit sur omdbapi.com)_` });
          } else {
            await sock.sendMessage(from, { text: '❌ Impossible de récupérer les infos. Ajoute OMDB_API_KEY dans .env' });
          }
          return;
        }

        if (data.Response === 'False') {
          await sock.sendMessage(from, { text: `❌ Film "${text}" introuvable.` });
          return;
        }

        const stars = '⭐'.repeat(Math.round(parseFloat(data.imdbRating)/2)) || '';
        const msg =
          `🎬 *${data.Title}* (${data.Year})\n${'─'.repeat(30)}\n\n` +
          `🎭 Genre: ${data.Genre}\n` +
          `🎥 Réalisateur: ${data.Director}\n` +
          `👥 Casting: ${data.Actors}\n` +
          `⏱️ Durée: ${data.Runtime}\n` +
          `🌍 Pays: ${data.Country}\n` +
          `⭐ Note IMDb: *${data.imdbRating}/10* ${stars}\n` +
          `📊 Rotten Tomatoes: ${data.Ratings?.find(r=>r.Source.includes('Rotten'))?.Value || 'N/A'}\n\n` +
          `📝 *Synopsis:*\n${data.Plot}\n\n` +
          `_IMDb: https://imdb.com/title/${data.imdbID}_`;

        if (data.Poster && data.Poster !== 'N/A') {
          try {
            const imgRes = await axios.get(data.Poster, { responseType: 'arraybuffer', timeout: 8000 });
            await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: msg });
          } catch { await sock.sendMessage(from, { text: msg }); }
        } else {
          await sock.sendMessage(from, { text: msg });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },

  // ════════════════════════════════════════
  // PROGRAMMATION & DEV
  // ════════════════════════════════════════

  code: {
    description: 'Exécuter du code en ligne (Python, JS, etc.)',
    execute: async ({ sock, from, args, text }) => {
      const LANGUAGES = { python:'python3', js:'javascript', javascript:'javascript', bash:'bash', php:'php', ruby:'ruby', go:'go', rust:'rust', c:'c', cpp:'cpp', java:'java' };
      const lang = args[0]?.toLowerCase();
      const code = args.slice(1).join(' ');

      if (!lang || !LANGUAGES[lang] || !code) {
        await sock.sendMessage(from, {
          text: `💻 *Exécution de Code*\n\n*Usage:* !code [langage] [code]\n\n*Langages:* python, js, bash, php, ruby, go, rust, c, cpp, java\n\nExemples:\n• !code python print("Bonjour")\n• !code js console.log(2+2)\n• !code python for i in range(5): print(i)`,
        });
        return;
      }

      await sock.sendMessage(from, { text: `⚙️ Exécution ${lang}...` });

      try {
        // API Piston (gratuite, open source)
        const res = await axios.post('https://emkc.org/api/v2/piston/execute', {
          language: LANGUAGES[lang],
          version: '*',
          files: [{ content: code }],
          stdin: '',
          args: [],
        }, { timeout: 15000 });

        const output = res.data.run;
        const stdout = output.stdout?.trim() || '';
        const stderr = output.stderr?.trim() || '';
        const exitCode = output.code;

        let msg = `💻 *Exécution ${lang.toUpperCase()}*\n${'─'.repeat(25)}\n\n`;
        msg += `📝 *Code:*\n\`\`\`\n${code.slice(0,200)}\n\`\`\`\n\n`;

        if (stdout) msg += `✅ *Sortie:*\n\`\`\`\n${stdout.slice(0,500)}\n\`\`\`\n`;
        if (stderr) msg += `⚠️ *Erreur:*\n\`\`\`\n${stderr.slice(0,300)}\n\`\`\`\n`;
        if (!stdout && !stderr) msg += `✅ Code exécuté sans sortie. (exit: ${exitCode})\n`;
        msg += `\n⏱️ Exit: ${exitCode}`;

        await sock.sendMessage(from, { text: msg });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur d'exécution: ${err.message}\n\nVérifie la syntaxe de ton code.` });
      }
    },
  },

  snippet: {
    description: 'Sauvegarder et partager des snippets de code',
    execute: async ({ sock, from, args, senderNumber }) => {
      const action = args[0]?.toLowerCase();

      if (!action || action === 'list') {
        const snips = loadSnippets();
        const userSnips = Object.entries(snips).filter(([,v]) => v.owner === senderNumber);
        const publicSnips = Object.entries(snips).filter(([,v]) => v.public && v.owner !== senderNumber);
        let text = `📋 *Snippets de Code*\n\n`;
        text += `*Mes snippets (${userSnips.length}):*\n`;
        userSnips.forEach(([k,v]) => { text += `• *${k}* [${v.lang}] — ${v.desc || 'Sans description'}\n`; });
        text += `\n*Snippets publics (${publicSnips.length}):*\n`;
        publicSnips.slice(0,5).forEach(([k,v]) => { text += `• *${k}* [${v.lang}] par ${v.owner}\n`; });
        text += `\n*Commandes:*\n• !snippet save [nom] [lang] [code] → Sauvegarder\n• !snippet get [nom] → Récupérer\n• !snippet del [nom] → Supprimer\n• !snippet share [nom] → Rendre public`;
        await sock.sendMessage(from, { text });
        return;
      }

      const snips = loadSnippets();
      const name = args[1];

      if (action === 'save') {
        const lang = args[2] || 'text';
        const code = args.slice(3).join(' ');
        if (!name || !code) { await sock.sendMessage(from, { text: '❌ Usage: !snippet save [nom] [lang] [code]' }); return; }
        snips[name] = { lang, code, owner: senderNumber, public: false, date: new Date().toISOString(), desc: '' };
        saveSnippets(snips);
        await sock.sendMessage(from, { text: `✅ Snippet *"${name}"* sauvegardé [${lang}]\n_!snippet share ${name} pour le rendre public_` });

      } else if (action === 'get') {
        if (!name || !snips[name]) { await sock.sendMessage(from, { text: `❌ Snippet "${name}" introuvable.` }); return; }
        const s = snips[name];
        await sock.sendMessage(from, { text: `📋 *Snippet: ${name}* [${s.lang}]\n👤 Par: ${s.owner}\n\n\`\`\`\n${s.code}\n\`\`\`` });

      } else if (action === 'del') {
        if (!snips[name] || snips[name].owner !== senderNumber) { await sock.sendMessage(from, { text: '❌ Snippet introuvable ou non autorisé.' }); return; }
        delete snips[name]; saveSnippets(snips);
        await sock.sendMessage(from, { text: `✅ Snippet *"${name}"* supprimé.` });

      } else if (action === 'share') {
        if (!snips[name] || snips[name].owner !== senderNumber) { await sock.sendMessage(from, { text: '❌ Snippet introuvable ou non autorisé.' }); return; }
        snips[name].public = true; saveSnippets(snips);
        await sock.sendMessage(from, { text: `✅ Snippet *"${name}"* partagé publiquement!\nTous les utilisateurs peuvent y accéder avec !snippet get ${name}` });
      } else {
        await sock.sendMessage(from, { text: '❌ Action inconnue.\n\n_Commandes: list, save, get, del, share_' });
      }
    },
  },

  github: {
    description: 'Infos profil GitHub d\'un utilisateur',
    execute: async ({ sock, from, args }) => {
      const username = args[0];
      if (!username) { await sock.sendMessage(from, { text: '🐙 Usage: !github [username]\nExemple: !github torvalds' }); return; }
      await sock.sendMessage(from, { text: '🐙 Récupération du profil GitHub...' });

      try {
        const [userRes, reposRes] = await Promise.all([
          axios.get(`https://api.github.com/users/${username}`, { timeout: 8000 }),
          axios.get(`https://api.github.com/users/${username}/repos?sort=stars&per_page=5`, { timeout: 8000 }),
        ]);
        const u = userRes.data;
        const repos = reposRes.data;
        const topRepos = repos.sort((a,b)=>b.stargazers_count-a.stargazers_count).slice(0,3);

        let msg =
          `🐙 *GitHub: ${u.name || u.login}*\n${'─'.repeat(28)}\n\n` +
          `👤 Username: @${u.login}\n` +
          `${u.bio ? `💬 Bio: ${u.bio}\n` : ''}` +
          `${u.location ? `📍 Localisation: ${u.location}\n` : ''}` +
          `${u.company ? `🏢 Entreprise: ${u.company}\n` : ''}` +
          `\n📊 *Statistiques:*\n` +
          `   📦 Repos publics: ${u.public_repos}\n` +
          `   👥 Followers: ${u.followers.toLocaleString()}\n` +
          `   👣 Following: ${u.following}\n` +
          `   ⭐ Total stars: ${repos.reduce((s,r)=>s+r.stargazers_count,0).toLocaleString()}\n` +
          `\n🔥 *Top repos:*\n`;

        topRepos.forEach(r => {
          msg += `• *${r.name}* ⭐${r.stargazers_count} [${r.language || '?'}]\n  ${r.description?.slice(0,60) || ''}\n`;
        });

        msg += `\n🔗 https://github.com/${u.login}`;

        if (u.avatar_url) {
          try {
            const imgRes = await axios.get(u.avatar_url, { responseType: 'arraybuffer', timeout: 6000 });
            await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: msg });
          } catch { await sock.sendMessage(from, { text: msg }); }
        } else {
          await sock.sendMessage(from, { text: msg });
        }
      } catch (err) {
        const status = err.response?.status;
        if (status === 404) await sock.sendMessage(from, { text: `❌ Utilisateur GitHub "${username}" introuvable.` });
        else if (status === 403) await sock.sendMessage(from, { text: '❌ Limite API GitHub atteinte. Réessaie dans 1 heure.' });
        else await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },

  regex: {
    description: 'Tester une expression régulière',
    execute: async ({ sock, from, args, text }) => {
      // Format: !regex /pattern/flags texte_à_tester
      if (!text || !text.startsWith('/')) {
        await sock.sendMessage(from, {
          text: `🔍 *Testeur de Regex*\n\n*Usage:* !regex /pattern/flags [texte]\n\n*Exemples:*\n• !regex /\\d+/g "J'ai 25 ans et 3 chats"\n• !regex /^[a-z]+$/i "HelloWorld"\n• !regex /email@/i "mon email@gmail.com"`,
        });
        return;
      }

      try {
        const regexMatch = text.match(/^\/(.+)\/([gimsuy]*)\s+([\s\S]+)$/);
        if (!regexMatch) { await sock.sendMessage(from, { text: '❌ Format invalide. Exemple: !regex /\\d+/g "texte à tester"' }); return; }

        const [, pattern, flags, testStr] = regexMatch;
        const regex = new RegExp(pattern, flags);
        const matches = [...testStr.matchAll(new RegExp(pattern, flags.includes('g') ? flags : flags+'g'))];
        const isMatch = regex.test(testStr);

        let msg = `🔍 *Test Regex*\n${'─'.repeat(25)}\n\n`;
        msg += `📝 Pattern: \`/${pattern}/${flags}\`\n`;
        msg += `🎯 Texte: "${testStr.slice(0,100)}"\n\n`;
        msg += `${isMatch ? '✅ *MATCH trouvé!*' : '❌ *Aucun match*'}\n\n`;

        if (matches.length > 0) {
          msg += `🎯 *Correspondances (${matches.length}):*\n`;
          matches.slice(0,10).forEach((m, i) => {
            msg += `${i+1}. "${m[0]}" à l'index ${m.index}\n`;
            if (m.slice(1).filter(Boolean).length > 0) {
              msg += `   Groupes: ${m.slice(1).map((g,i)=>`$${i+1}="${g||''}"`).join(', ')}\n`;
            }
          });
          if (matches.length > 10) msg += `_...et ${matches.length-10} autres_\n`;
        }

        await sock.sendMessage(from, { text: msg });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Regex invalide: ${err.message}` });
      }
    },
  },

  // ════════════════════════════════════════
  // FUN & DIVERTISSEMENT AVANCÉ
  // ════════════════════════════════════════

  roast: {
    description: 'Vanne IA personnalisée sur un membre (fun!)',
    execute: async ({ sock, msg, from, args, sender }) => {
      const targets = getMentionedJid(msg, args);
      const target = targets[0] || sender;
      const targetNum = target.split('@')[0];

      await sock.sendMessage(from, { text: '🔥 Chargement de la vanne...' });

      const roast = await askAI(
        `Crée une vanne amusante, légère et bienveillante pour un ami nommé "${targetNum}" dans un groupe WhatsApp. ` +
        `La vanne doit être drôle, pas méchante, max 2-3 phrases. En français. Style humoristique et fun, pas vulgaire.`
      );

      if (roast) {
        await sock.sendMessage(from, {
          text: `🔥 *Vanne pour @${targetNum}:*\n\n${roast}\n\n😂🔥`,
          mentions: [target],
        });
      } else {
        const fallbacks = [
          `@${targetNum} est tellement lent que Google Maps lui propose des itinéraires dans le passé! 😂`,
          `@${targetNum} a cherché "comment faire une blague" sur Google... et c'est ressorti en suggestion automatique! 🤣`,
          `@${targetNum} met ses lunettes pour mieux voir ses erreurs. Au moins il les assume! 😄`,
        ];
        await sock.sendMessage(from, {
          text: `🔥 *Vanne pour @${targetNum}:*\n\n${fallbacks[Math.floor(Math.random()*fallbacks.length)]}`,
          mentions: [target],
        });
      }
    },
  },

  ship: {
    description: 'Calculer la compatibilité amoureuse entre 2 membres',
    execute: async ({ sock, msg, from, args }) => {
      const mentions = getMentionedJid(msg, args);

      if (mentions.length < 2) {
        // Essai avec des noms en texte
        const names = args.filter(a => !a.startsWith('@'));
        if (names.length >= 2) {
          const score = calculateShipScore(names[0], names[1]);
          await sendShipResult(sock, from, names[0], names[1], null, null, score);
          return;
        }
        await sock.sendMessage(from, { text: '💕 Usage: !ship @membre1 @membre2\nOu: !ship Nom1 Nom2' });
        return;
      }

      const [p1, p2] = mentions;
      const num1 = p1.split('@')[0];
      const num2 = p2.split('@')[0];
      const score = calculateShipScore(num1, num2);

      await sendShipResult(sock, from, num1, num2, p1, p2, score);
    },
  },

  rps: {
    description: 'Pierre Feuille Ciseaux contre le bot',
    execute: async ({ sock, from, args, sender }) => {
      const choices = { 'pierre':'🪨', 'feuille':'📄', 'ciseaux':'✂️', 'p':'🪨', 'f':'📄', 'c':'✂️', 'rock':'🪨', 'paper':'📄', 'scissors':'✂️' };
      const normalize = { 'p':'pierre','f':'feuille','c':'ciseaux','rock':'pierre','paper':'feuille','scissors':'ciseaux' };
      const userInput = args[0]?.toLowerCase();

      if (!userInput || !choices[userInput]) {
        await sock.sendMessage(from, { text: '🪨📄✂️ *Pierre Feuille Ciseaux*\n\nUsage: !rps [pierre/feuille/ciseaux]\nOu abréviations: p / f / c' });
        return;
      }

      const botOptions = ['pierre','feuille','ciseaux'];
      const botChoice = botOptions[Math.floor(Math.random()*3)];
      const userChoice = normalize[userInput] || userInput;

      const wins = { pierre:'ciseaux', feuille:'pierre', ciseaux:'feuille' };
      let result, emoji;
      if (userChoice === botChoice) { result = 'ÉGALITÉ'; emoji = '🤝'; }
      else if (wins[userChoice] === botChoice) { result = 'GAGNÉ'; emoji = '🎉'; }
      else { result = 'PERDU'; emoji = '😢'; }

      await sock.sendMessage(from, {
        text: `🪨📄✂️ *Pierre Feuille Ciseaux*\n\n` +
          `👤 Toi: ${choices[userChoice]} ${userChoice}\n` +
          `🤖 Bot: ${choices[botChoice]} ${botChoice}\n\n` +
          `${emoji} *${result}!*\n\n` +
          `${result==='GAGNÉ' ? 'Bravo! Tu as battu le bot 🏆' : result==='PERDU' ? 'Meilleure chance la prochaine fois! 😅' : 'Personne ne gagne cette fois! 🤝'}`,
      });
    },
  },

  story: {
    description: 'Histoire courte générée par IA',
    execute: async ({ sock, from, args, text }) => {
      const GENRES = ['aventure','horreur','romance','science-fiction','comédie','mystère','fantaisie','thriller'];
      if (!text || args[0] === 'genres') {
        await sock.sendMessage(from, {
          text: `📖 *Générateur d'Histoires IA*\n\n*Usage:* !story [thème ou genre]\n\n*Genres disponibles:*\n${GENRES.map(g=>`• ${g}`).join('\n')}\n\n*Exemples:*\n!story un robot qui tombe amoureux\n!story horreur dans une forêt abandonnée\n!story aventure pirate en Afrique de l'Ouest`,
        });
        return;
      }

      await sock.sendMessage(from, { text: '📖 Création de l\'histoire...' });

      const prompt = `Écris une histoire courte et captivante (max 300 mots) sur le thème: "${text}". ` +
        `L'histoire doit avoir un début, un développement et une fin surprenante. En français. Utilise des emojis pour rendre ça vivant.`;

      const story = await askAI(prompt);

      if (story) {
        await sock.sendMessage(from, {
          text: `📖 *Histoire: "${text}"*\n${'─'.repeat(28)}\n\n${story}\n\n${'─'.repeat(28)}\n_Générée par IA ✨_`,
        });
      } else {
        await sock.sendMessage(from, { text: '❌ Impossible de générer l\'histoire. Configure une clé Gemini ou Groq dans le .env' });
      }
    },
  },
};

// ── Fonctions utilitaires internes ───────────────────────────

function getMemeTemplateId(template) {
  const ids = {
    'Drake Hotline Bling': '181913649', 'Two Buttons': '87743020',
    'Distracted Boyfriend': '112126428', 'Change My Mind': '129242436',
    'Is This A Pigeon': '100777631', 'Woman Yelling At Cat': '188390779',
    'Expanding Brain': '93895088', 'Surprised Pikachu': '155067746',
    'This Is Fine': '55311130',
  };
  return ids[template] || '181913649';
}

async function sendTextMeme(sock, from, top, bottom) {
  const border = '═'.repeat(Math.max(top.length, bottom?.length || 0) + 4);
  const text = `😂 *MÈME*\n\n${border}\n  ${top}\n${border}\n${bottom ? `\n  ${bottom}\n${border}` : ''}`;
  await sock.sendMessage(from, { text });
}

function calculateShipScore(name1, name2) {
  // Score basé sur les caractères des noms (déterministe mais fun)
  const combined = (name1 + name2).toLowerCase();
  let score = 0;
  for (const char of combined) score += char.charCodeAt(0);
  return (score % 100);
}

async function sendShipResult(sock, from, num1, num2, jid1, jid2, score) {
  const hearts = score >= 80 ? '💕💕💕💕💕' : score >= 60 ? '💕💕💕' : score >= 40 ? '💕💕' : '💕';
  const bar = '█'.repeat(Math.round(score/10)) + '░'.repeat(10-Math.round(score/10));
  const messages = {
    90: '🔥 Âmes sœurs ! C\'est le grand amour ! 💍',
    70: '💖 Très bonne compatibilité ! Les étoiles sont alignées !',
    50: '😊 Compatibles ! Qui sait ce que l\'avenir réserve...',
    30: '🤔 Compatibilité moyenne... il faudra faire des efforts!',
    0:  '😅 L\'amour est mystérieux... peut-être dans une autre vie!',
  };
  const msg2 = Object.entries(messages).reverse().find(([min]) => score >= parseInt(min))?.[1] || messages[0];

  const shipName = (num1.slice(0,3) + num2.slice(-3)).toUpperCase();

  await sock.sendMessage(from, {
    text: `💕 *SHIP: ${num1} ❤️ ${num2}*\n${'─'.repeat(28)}\n\n` +
      `💑 Nom du couple: *${shipName}*\n\n` +
      `💯 Compatibilité: *${score}%* ${hearts}\n` +
      `${bar}\n\n${msg2}`,
    mentions: [jid1, jid2].filter(Boolean),
  });
}
