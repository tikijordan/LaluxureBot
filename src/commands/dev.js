/**
 * ============================================================
 * @file        dev.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Outils developpeur — Execution code, GitHub, regex, hash, base64, UUID, IP
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES DÉVELOPPEUR & OUTILS
// code (exécution), github, regex, snippet, converter,
// hash, base64, uuid, timestamp, ip
// ============================================================

import axios from 'axios';
import crypto from 'crypto';

async function callAI(prompt) {
  const geminiKey = process.env.GEMINI_API_KEY_1;
  const groqKey = process.env.GROQ_API_KEY_1;
  if (geminiKey) {
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 800 } },
        { timeout: 15000 }
      );
      return res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    } catch {}
  }
  if (groqKey) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.3 },
        { headers: { Authorization: `Bearer ${groqKey}` }, timeout: 15000 }
      );
      return res.data?.choices?.[0]?.message?.content;
    } catch {}
  }
  return null;
}

export default {

  runcode: {
    description: 'Exécuter du code en ligne (Python, JS, etc.)',
    execute: async ({ sock, from, args, text }) => {
      const lang = args[0]?.toLowerCase();
      const code = args.slice(1).join(' ');

      const supported = ['python', 'py', 'javascript', 'js', 'nodejs', 'bash', 'sh', 'php', 'ruby', 'go', 'java', 'cpp', 'c'];

      if (!lang || !supported.includes(lang) || !code) {
        await sock.sendMessage(from, {
          text: `💻 *Usage:* !runcode [langage] [code]\n\n*Langages supportés:*\npython, javascript, bash, php, ruby, go, java, cpp\n\n*Exemples:*\n• !runcode python print("Hello World")\n• !runcode js console.log(2+2)\n• !runcode python for i in range(5): print(i)`,
        });
        return;
      }

      await sock.sendMessage(from, { text: `⚙️ Exécution ${lang}...` });

      try {
        // Utiliser Piston API (gratuit, open source)
        const langMap = {
          py: 'python', js: 'javascript', nodejs: 'javascript', sh: 'bash', cpp: 'c++',
        };
        const pistonLang = langMap[lang] || lang;

        const res = await axios.post('https://emkc.org/api/v2/piston/execute', {
          language: pistonLang,
          version: '*',
          files: [{ content: code }],
        }, { timeout: 15000 });

        const output = res.data?.run?.output || res.data?.run?.stdout || '';
        const stderr = res.data?.run?.stderr || '';
        const exitCode = res.data?.run?.code;

        if (exitCode !== 0 && stderr) {
          await sock.sendMessage(from, {
            text: `💻 *${lang.toUpperCase()}* — ❌ Erreur\n\`\`\`\n${stderr.slice(0, 500)}\n\`\`\``,
          });
        } else {
          await sock.sendMessage(from, {
            text: `💻 *${lang.toUpperCase()}* — ✅ Résultat\n\n📥 Code:\n\`\`\`${lang}\n${code.slice(0, 300)}\n\`\`\`\n\n📤 Sortie:\n\`\`\`\n${output.slice(0, 500) || '(pas de sortie)'}\n\`\`\``,
          });
        }
      } catch (err) {
        // Fallback: demander à l'IA de simuler
        const result = await callAI(`Simule l'exécution de ce code ${lang} et donne uniquement la sortie (output) sans explication:\n\n${code}`);
        if (result) {
          await sock.sendMessage(from, {
            text: `💻 *${lang.toUpperCase()}* — 🤖 Simulé par IA\n\n📥 Code:\n\`\`\`${lang}\n${code.slice(0,300)}\n\`\`\`\n\n📤 Sortie simulée:\n\`\`\`\n${result}\n\`\`\``,
          });
        } else {
          await sock.sendMessage(from, { text: `❌ Erreur d'exécution: ${err.message}` });
        }
      }
    },
  },

  github: {
    description: 'Infos sur un repo ou utilisateur GitHub',
    execute: async ({ sock, from, args }) => {
      const query = args[0];
      if (!query) {
        await sock.sendMessage(from, { text: '🐙 Usage:\n• !github [user/repo] → Infos repo\n• !github [username] → Profil utilisateur\n\nEx: !github torvalds/linux\nEx: !github microsoft' });
        return;
      }

      await sock.sendMessage(from, { text: `🐙 Récupération des infos GitHub pour "${query}"...` });

      try {
        if (query.includes('/')) {
          // Repo
          const res = await axios.get(`https://api.github.com/repos/${query}`, {
            headers: { 'User-Agent': 'WhatsApp-Bot' }, timeout: 10000,
          });
          const r = res.data;
          const langs = await axios.get(r.languages_url, { headers: { 'User-Agent': 'WhatsApp-Bot' } }).catch(() => ({ data: {} }));
          const topLang = Object.keys(langs.data)[0] || 'N/A';

          await sock.sendMessage(from, {
            text: `🐙 *GitHub — ${r.full_name}*\n${'━'.repeat(28)}\n\n` +
              `📝 ${r.description || 'Pas de description'}\n\n` +
              `⭐ Stars: *${r.stargazers_count.toLocaleString()}*\n` +
              `🍴 Forks: *${r.forks_count.toLocaleString()}*\n` +
              `👁️ Watchers: *${r.watchers_count.toLocaleString()}*\n` +
              `🐛 Issues ouvertes: *${r.open_issues_count}*\n` +
              `💻 Langage principal: *${topLang}*\n` +
              `📄 Licence: ${r.license?.name || 'Aucune'}\n` +
              `📅 Créé: ${new Date(r.created_at).toLocaleDateString('fr-FR')}\n` +
              `🔄 Mis à jour: ${new Date(r.updated_at).toLocaleDateString('fr-FR')}\n\n` +
              `🔗 ${r.html_url}`,
          });
        } else {
          // Utilisateur
          const res = await axios.get(`https://api.github.com/users/${query}`, {
            headers: { 'User-Agent': 'WhatsApp-Bot' }, timeout: 10000,
          });
          const u = res.data;
          const repos = await axios.get(`https://api.github.com/users/${query}/repos?sort=stars&per_page=3`, {
            headers: { 'User-Agent': 'WhatsApp-Bot' }
          }).catch(() => ({ data: [] }));
          const topRepos = repos.data.map(r => `• ${r.name} ⭐${r.stargazers_count}`).join('\n');

          const text = `🐙 *GitHub — @${u.login}*\n${'━'.repeat(28)}\n\n` +
            `👤 *${u.name || u.login}*\n` +
            (u.bio ? `📝 ${u.bio}\n` : '') +
            (u.location ? `📍 ${u.location}\n` : '') +
            (u.company ? `🏢 ${u.company}\n` : '') +
            `\n📊 *Statistiques:*\n` +
            `📦 Repos publics: *${u.public_repos}*\n` +
            `👥 Followers: *${u.followers.toLocaleString()}*\n` +
            `👣 Following: *${u.following}*\n` +
            `📅 Membre depuis: ${new Date(u.created_at).toLocaleDateString('fr-FR')}\n` +
            (topRepos ? `\n🏆 *Top repos:*\n${topRepos}\n` : '') +
            `\n🔗 ${u.html_url}`;

          if (u.avatar_url) {
            await sock.sendMessage(from, { image: { url: u.avatar_url }, caption: text });
          } else {
            await sock.sendMessage(from, { text });
          }
        }
      } catch (err) {
        const status = err.response?.status;
        await sock.sendMessage(from, {
          text: status === 404
            ? `❌ "${query}" non trouvé sur GitHub.`
            : `❌ Erreur GitHub: ${err.message}`,
        });
      }
    },
  },

  regex: {
    description: 'Tester une expression régulière',
    execute: async ({ sock, from, text, args }) => {
      // Format: !regex [pattern] | [texte à tester]
      const parts = text?.split('|');
      if (!parts || parts.length < 2) {
        await sock.sendMessage(from, {
          text: `🔎 *Usage:* !regex [pattern] | [texte]\n\nExemples:\n• !regex \\d+ | abc 123 def\n• !regex [a-z]+ | Hello World\n• !regex ^\\S+@\\S+\\.\\S+$ | test@email.com\n\n_Supporte les flags: /pattern/flags | texte_`,
        });
        return;
      }

      const patternStr = parts[0].trim();
      const testStr = parts.slice(1).join('|').trim();

      try {
        // Extraire flags si présents /pattern/flags
        let pattern, flags = 'g';
        if (patternStr.startsWith('/')) {
          const lastSlash = patternStr.lastIndexOf('/');
          pattern = patternStr.slice(1, lastSlash);
          flags = patternStr.slice(lastSlash + 1) || 'g';
        } else {
          pattern = patternStr;
        }

        const regex = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
        const matches = [...testStr.matchAll(regex)];
        const isMatch = regex.test(testStr);

        let result = `🔎 *Regex Test*\n\n`;
        result += `📝 Pattern: \`${patternStr}\`\n`;
        result += `📄 Texte: "${testStr}"\n\n`;
        result += `✅ Match: *${isMatch ? 'OUI' : 'NON'}*\n`;

        if (matches.length > 0) {
          result += `🎯 Correspondances (${matches.length}):\n`;
          matches.slice(0, 10).forEach((m, i) => {
            result += `  ${i+1}. "${m[0]}" (position ${m.index})\n`;
            if (m.groups && Object.keys(m.groups).length > 0) {
              Object.entries(m.groups).forEach(([k,v]) => { result += `     Groupe "${k}": ${v}\n`; });
            }
          });
          if (matches.length > 10) result += `  ... et ${matches.length - 10} de plus\n`;
        } else {
          result += `❌ Aucune correspondance trouvée.`;
        }

        await sock.sendMessage(from, { text: result });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Regex invalide: ${err.message}` });
      }
    },
  },

  hash: {
    description: 'Générer un hash MD5/SHA1/SHA256',
    execute: async ({ sock, from, args, text }) => {
      const algo = args[0]?.toLowerCase();
      const content = args.slice(1).join(' ');

      const algos = ['md5', 'sha1', 'sha256', 'sha512'];
      if (!algo || !algos.includes(algo) || !content) {
        await sock.sendMessage(from, {
          text: `#️⃣ *Usage:* !hash [algorithme] [texte]\n\n*Algorithmes:* md5, sha1, sha256, sha512\n\nExemples:\n• !hash md5 password123\n• !hash sha256 MonMessage`,
        });
        return;
      }

      const h = crypto.createHash(algo).update(content).digest('hex');
      await sock.sendMessage(from, {
        text: `#️⃣ *Hash ${algo.toUpperCase()}*\n\n📝 Entrée: "${content}"\n🔐 Hash:\n\`${h}\``,
      });
    },
  },

  base64: {
    description: 'Encoder/décoder en Base64',
    execute: async ({ sock, from, args, text }) => {
      const action = args[0]?.toLowerCase();
      const content = args.slice(1).join(' ');

      if (!action || !['encode', 'decode', 'enc', 'dec'].includes(action) || !content) {
        await sock.sendMessage(from, { text: '🔡 Usage:\n• !base64 encode [texte] → Encoder\n• !base64 decode [base64] → Décoder' });
        return;
      }

      try {
        if (action === 'encode' || action === 'enc') {
          const encoded = Buffer.from(content, 'utf8').toString('base64');
          await sock.sendMessage(from, { text: `🔡 *Base64 Encodé*\n\n📝 Original: ${content}\n🔐 Encodé:\n\`${encoded}\`` });
        } else {
          const decoded = Buffer.from(content, 'base64').toString('utf8');
          await sock.sendMessage(from, { text: `🔡 *Base64 Décodé*\n\n🔐 Encodé: ${content.slice(0,50)}...\n📝 Décodé: ${decoded}` });
        }
      } catch {
        await sock.sendMessage(from, { text: '❌ Décodage impossible. Vérifie que le texte est bien en Base64.' });
      }
    },
  },

  uuid: {
    description: 'Générer des UUID uniques',
    execute: async ({ sock, from, args }) => {
      const count = Math.min(parseInt(args[0]) || 1, 10);
      const uuids = Array.from({ length: count }, () => crypto.randomUUID());
      await sock.sendMessage(from, {
        text: `🆔 *${count} UUID Généré(s)*\n\n${uuids.map((u,i) => `${i+1}. \`${u}\``).join('\n')}`,
      });
    },
  },

  timestamp: {
    description: 'Convertir une date en timestamp et vice versa',
    execute: async ({ sock, from, args, text }) => {
      if (!text) {
        const now = Date.now();
        await sock.sendMessage(from, {
          text: `⏱️ *Timestamp Actuel*\n\n🕐 Timestamp: \`${now}\`\n📅 Date: ${new Date().toLocaleString('fr-FR')}\n\n*Conversion:*\n• !timestamp [timestamp] → Date lisible\n• !timestamp [JJ/MM/AAAA] → Timestamp`,
        });
        return;
      }

      const input = text.trim();
      if (/^\d{10,13}$/.test(input)) {
        const ms = input.length === 10 ? parseInt(input) * 1000 : parseInt(input);
        const date = new Date(ms);
        await sock.sendMessage(from, {
          text: `⏱️ *Timestamp → Date*\n\n🔢 Timestamp: ${input}\n📅 Date: ${date.toLocaleString('fr-FR')}\n🌐 UTC: ${date.toUTCString()}`,
        });
      } else {
        const date = new Date(text.split('/').reverse().join('-'));
        if (isNaN(date.getTime())) {
          await sock.sendMessage(from, { text: '❌ Format invalide. Utilise: JJ/MM/AAAA ou un timestamp' });
          return;
        }
        await sock.sendMessage(from, {
          text: `⏱️ *Date → Timestamp*\n\n📅 Date: ${date.toLocaleDateString('fr-FR')}\n🔢 Timestamp (ms): \`${date.getTime()}\`\n🔢 Timestamp (s): \`${Math.floor(date.getTime()/1000)}\``,
        });
      }
    },
  },

  ipinfo: {
    description: 'Infos sur une adresse IP',
    execute: async ({ sock, from, args }) => {
      const ip = args[0] || 'me';
      await sock.sendMessage(from, { text: `🌐 Récupération des infos IP...` });
      try {
        const url = ip === 'me' ? 'https://ipapi.co/json/' : `https://ipapi.co/${ip}/json/`;
        const res = await axios.get(url, { timeout: 8000 });
        const d = res.data;
        if (d.error) throw new Error(d.reason);
        await sock.sendMessage(from, {
          text: `🌐 *Infos IP: ${d.ip}*\n${'━'.repeat(25)}\n\n` +
            `🌍 Pays: ${d.country_name} ${d.country_code}\n` +
            `🏙️ Ville: ${d.city || 'N/A'}\n` +
            `🗺️ Région: ${d.region || 'N/A'}\n` +
            `📮 Code postal: ${d.postal || 'N/A'}\n` +
            `🌐 Fuseau: ${d.timezone || 'N/A'}\n` +
            `📡 FAI: ${d.org || 'N/A'}\n` +
            `💱 Monnaie: ${d.currency_name || 'N/A'} (${d.currency || 'N/A'})\n` +
            `🗣️ Langue: ${d.languages?.split(',')[0] || 'N/A'}`,
        });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Impossible d'obtenir les infos pour "${ip}": ${err.message}` });
      }
    },
  },

};
