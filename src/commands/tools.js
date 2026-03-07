/**
 * ============================================================
 * @file        tools.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Outils utilitaires — Calcul, meteo, convertisseurs
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES OUTILS AVANCÉS
// password, shortlink, ytinfo, tweet, whois, carbon,
// weather, calculator avancée, stopwatch, pomodoro
// ============================================================
import axios from 'axios';
import crypto from 'crypto';

export default {

  password: {
    description: 'Générer un mot de passe sécurisé',
    execute: async ({ sock, from, args }) => {
      const length = Math.min(Math.max(parseInt(args[0]) || 16, 8), 64);
      const hasSymbols = !args.includes('--no-symbols');
      const hasNumbers = !args.includes('--no-numbers');
      const hasUpper   = !args.includes('--no-upper');
      const count      = Math.min(parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1]) || 1, 10);

      const chars = {
        lower:   'abcdefghijklmnopqrstuvwxyz',
        upper:   'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        numbers: '0123456789',
        symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
      };

      let pool = chars.lower;
      if (hasUpper)   pool += chars.upper;
      if (hasNumbers) pool += chars.numbers;
      if (hasSymbols) pool += chars.symbols;

      const generatePwd = () => {
        let pwd = '';
        // Garantir au moins un char de chaque catégorie
        if (hasUpper)   pwd += chars.upper[Math.floor(Math.random() * chars.upper.length)];
        if (hasNumbers) pwd += chars.numbers[Math.floor(Math.random() * chars.numbers.length)];
        if (hasSymbols) pwd += chars.symbols[Math.floor(Math.random() * chars.symbols.length)];
        // Remplir le reste
        for (let i = pwd.length; i < length; i++) {
          pwd += pool[crypto.randomInt(pool.length)];
        }
        // Mélanger
        return pwd.split('').sort(() => Math.random() - 0.5).join('');
      };

      const passwords = Array.from({ length: count }, generatePwd);
      const strength = length >= 20 && hasSymbols && hasNumbers ? '🟢 Très fort' :
                       length >= 12 && (hasSymbols || hasNumbers) ? '🟡 Fort' : '🔴 Moyen';

      let text = `🔐 *Mot(s) de passe généré(s)*\n\n`;
      passwords.forEach((p, i) => { text += `${i+1}. \`${p}\`\n`; });
      text += `\n📊 Longueur: ${length} | Sécurité: ${strength}\n`;
      text += `_Options: --no-symbols --no-numbers --no-upper --count=N_`;

      await sock.sendMessage(from, { text });
    },
  },

  shortlink: {
    description: 'Raccourcir un lien URL',
    execute: async ({ sock, from, text }) => {
      if (!text || !text.startsWith('http')) {
        await sock.sendMessage(from, { text: '🔗 Usage: !shortlink [URL]\nEx: !shortlink https://www.google.com/very/long/url' });
        return;
      }
      await sock.sendMessage(from, { text: '🔗 Raccourcissement en cours...' });
      try {
        // TinyURL API (gratuit, sans clé)
        const res = await axios.get(
          `https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`,
          { timeout: 8000 }
        );
        const shortUrl = res.data;
        await sock.sendMessage(from, {
          text: `🔗 *Lien raccourci !*\n\n📎 Original:\n${text.slice(0, 60)}${text.length > 60 ? '...' : ''}\n\n✅ Court:\n*${shortUrl}*`,
        });
      } catch {
        // Fallback is.gd
        try {
          const res2 = await axios.get(
            `https://is.gd/create.php?format=simple&url=${encodeURIComponent(text)}`,
            { timeout: 8000 }
          );
          await sock.sendMessage(from, { text: `🔗 *Lien raccourci !*\n\n✅ *${res2.data}*` });
        } catch {
          await sock.sendMessage(from, { text: '❌ Impossible de raccourcir ce lien.' });
        }
      }
    },
  },

  ytinfo: {
    description: 'Informations détaillées sur une vidéo YouTube',
    execute: async ({ sock, from, text }) => {
      if (!text || (!text.includes('youtube.com') && !text.includes('youtu.be'))) {
        await sock.sendMessage(from, { text: '▶️ Usage: !ytinfo [lien YouTube]' });
        return;
      }
      await sock.sendMessage(from, { text: '▶️ Récupération des infos YouTube...' });
      try {
        // Extraire l'ID vidéo
        const videoId = text.match(/(?:v=|youtu\.be\/)([^&\s?]+)/)?.[1];
        if (!videoId) { await sock.sendMessage(from, { text: '❌ Lien YouTube invalide.' }); return; }

        // Utiliser l'API Invidious (instance publique gratuite)
        const res = await axios.get(
          `https://inv.tux.pizza/api/v1/videos/${videoId}`,
          { timeout: 10000 }
        );
        const v = res.data;

        const duration = v.lengthSeconds;
        const h = Math.floor(duration/3600);
        const m = Math.floor((duration%3600)/60);
        const s = duration%60;
        const durationStr = h > 0 ? `${h}h${m}m${s}s` : `${m}m${s}s`;

        const views = parseInt(v.viewCount).toLocaleString('fr-FR');
        const likes = parseInt(v.likeCount || 0).toLocaleString('fr-FR');
        const subs  = parseInt(v.subCountText || 0).toLocaleString('fr-FR');
        const published = new Date(v.published * 1000).toLocaleDateString('fr-FR');

        const text2 =
          `▶️ *${v.title}*\n${'━'.repeat(28)}\n\n` +
          `👤 Chaîne: *${v.author}*\n` +
          `👥 Abonnés: ${subs}\n\n` +
          `👁️ Vues: *${views}*\n` +
          `👍 Likes: ${likes}\n` +
          `⏱️ Durée: *${durationStr}*\n` +
          `📅 Publié: ${published}\n` +
          `🏷️ Catégorie: ${v.genre || 'N/A'}\n\n` +
          `📝 *Description:*\n${(v.description || '').slice(0, 300)}${v.description?.length > 300 ? '...' : ''}\n\n` +
          `🔗 https://youtube.com/watch?v=${videoId}`;

        const thumb = v.videoThumbnails?.[0]?.url;
        if (thumb) {
          await sock.sendMessage(from, { image: { url: thumb }, caption: text2 });
        } else {
          await sock.sendMessage(from, { text: text2 });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },

  tweet: {
    description: 'Formater un texte en tweet stylisé avec stats',
    execute: async ({ sock, from, text, senderNumber }) => {
      if (!text) {
        await sock.sendMessage(from, { text: '🐦 Usage: !tweet [ton message]\nGénère un tweet stylisé avec compteur de caractères.' });
        return;
      }
      const maxLen = 280;
      const len = text.length;
      const remaining = maxLen - len;
      const bar = Math.round((len / maxLen) * 20);
      const progressBar = '█'.repeat(bar) + '░'.repeat(20 - bar);

      const status = remaining < 0 ? '❌ Trop long!' :
                     remaining < 20 ? '⚠️ Presque plein' :
                     remaining < 80 ? '🟡 Bien' : '🟢 Parfait';

      const hashtags = text.match(/#\w+/g) || [];
      const mentions = text.match(/@\w+/g) || [];
      const links    = text.match(/https?:\/\/\S+/g) || [];

      await sock.sendMessage(from, {
        text: `🐦 *Tweet Formaté*\n${'═'.repeat(26)}\n\n` +
          `"${text}"\n\n` +
          `${'═'.repeat(26)}\n` +
          `📊 ${progressBar}\n` +
          `📝 ${len}/${maxLen} caractères ${status}\n` +
          (remaining >= 0 ? `✅ Reste: ${remaining} caractères\n` : `❌ Dépasse de ${Math.abs(remaining)} caractères\n`) +
          `#️⃣ Hashtags: ${hashtags.length} | 👤 Mentions: ${mentions.length} | 🔗 Liens: ${links.length}`,
      });
    },
  },

  whois: {
    description: 'Infos WHOIS et DNS d\'un nom de domaine',
    execute: async ({ sock, from, args }) => {
      const domain = args[0]?.replace(/https?:\/\//, '').split('/')[0];
      if (!domain || !domain.includes('.')) {
        await sock.sendMessage(from, { text: '🌐 Usage: !whois [domaine]\nEx: !whois google.com' });
        return;
      }
      await sock.sendMessage(from, { text: `🌐 Recherche WHOIS pour ${domain}...` });
      try {
        // Utiliser l'API whois.whoisxmlapi.com ou l'alternative gratuite
        const res = await axios.get(`https://api.whois.vu/?q=${domain}`, { timeout: 10000 });
        const data = res.data;

        // Alternative: dig DNS via cloudflare
        const dnsRes = await axios.get(
          `https://cloudflare-dns.com/dns-query?name=${domain}&type=A`,
          { headers: { Accept: 'application/dns-json' }, timeout: 8000 }
        ).catch(() => null);

        const ips = dnsRes?.data?.Answer?.map(a => a.data).filter(Boolean).slice(0, 3) || [];

        let text = `🌐 *WHOIS — ${domain}*\n${'━'.repeat(28)}\n\n`;
        if (data.registrar)  text += `🏢 Registrar: ${data.registrar}\n`;
        if (data.created)    text += `📅 Créé: ${data.created}\n`;
        if (data.expires)    text += `⏳ Expire: ${data.expires}\n`;
        if (data.updated)    text += `🔄 Mis à jour: ${data.updated}\n`;
        if (data.status)     text += `📋 Statut: ${Array.isArray(data.status) ? data.status[0] : data.status}\n`;
        if (ips.length > 0)  text += `\n🖥️ *Adresses IP:*\n${ips.map(ip => `• ${ip}`).join('\n')}\n`;

        text += `\n🔗 Vérifier: https://lookup.icann.org/lookup?name=${domain}`;

        await sock.sendMessage(from, { text });
      } catch {
        // Fallback minimal
        try {
          const dnsRes = await axios.get(
            `https://cloudflare-dns.com/dns-query?name=${domain}&type=A`,
            { headers: { Accept: 'application/dns-json' }, timeout: 8000 }
          );
          const ips = dnsRes?.data?.Answer?.map(a => a.data).filter(Boolean) || [];
          await sock.sendMessage(from, {
            text: `🌐 *${domain}*\n\n🖥️ IPs: ${ips.join(', ') || 'Non résolues'}\n\n🔗 https://lookup.icann.org/lookup?name=${domain}`,
          });
        } catch {
          await sock.sendMessage(from, { text: `❌ Impossible d'obtenir les infos WHOIS pour "${domain}".` });
        }
      }
    },
  },

  pomodoro: {
    description: 'Timer Pomodoro (travail + pause)',
    execute: async ({ sock, from, sender, args }) => {
      const work = parseInt(args[0]) || 25;
      const pause = parseInt(args[1]) || 5;

      if (args[0] === 'stop') {
        if (global.pomodoroTimers?.has(sender)) {
          clearTimeout(global.pomodoroTimers.get(sender));
          global.pomodoroTimers.delete(sender);
          await sock.sendMessage(from, { text: '⏹️ Pomodoro arrêté.' });
        } else {
          await sock.sendMessage(from, { text: '❌ Aucun Pomodoro en cours.' });
        }
        return;
      }

      if (!global.pomodoroTimers) global.pomodoroTimers = new Map();

      await sock.sendMessage(from, {
        text: `🍅 *Pomodoro démarré !*\n\n⏱️ Travail: *${work} minutes*\n☕ Pause: *${pause} minutes*\n\n💪 Concentre-toi ! Je te préviens quand c'est l'heure.\n\n_!pomodoro stop pour arrêter_`,
      });

      // Timer travail
      const workTimer = setTimeout(async () => {
        await sock.sendMessage(from, {
          text: `🍅 *PAUSE !* ☕\n\nBravo ! Tu as travaillé ${work} minutes.\n\n☕ Prends une pause de *${pause} minutes*.\nRelève-toi, étire-toi, bois de l'eau ! 💧`,
        });

        // Timer pause
        const breakTimer = setTimeout(async () => {
          await sock.sendMessage(from, {
            text: `🍅 *REPRISE DU TRAVAIL !* 💪\n\nLa pause est terminée !\nProchain Pomodoro: !pomodoro ${work} ${pause}`,
          });
          global.pomodoroTimers?.delete(sender);
        }, pause * 60 * 1000);

        global.pomodoroTimers.set(sender, breakTimer);
      }, work * 60 * 1000);

      global.pomodoroTimers.set(sender, workTimer);
    },
  },

  stopwatch: {
    description: 'Chronomètre',
    execute: async ({ sock, from, sender, args }) => {
      if (!global.stopwatches) global.stopwatches = new Map();
      const action = args[0]?.toLowerCase();

      if (!action || action === 'start') {
        global.stopwatches.set(sender, Date.now());
        await sock.sendMessage(from, { text: '⏱️ *Chronomètre démarré !*\n\n_!stopwatch stop pour arrêter_' });
      } else if (action === 'stop' || action === 'lap') {
        const start = global.stopwatches.get(sender);
        if (!start) { await sock.sendMessage(from, { text: '❌ Aucun chronomètre en cours. !stopwatch start' }); return; }
        const elapsed = Date.now() - start;
        const ms = elapsed % 1000;
        const s  = Math.floor(elapsed / 1000) % 60;
        const m  = Math.floor(elapsed / 60000) % 60;
        const h  = Math.floor(elapsed / 3600000);
        const formatted = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s ${ms}ms` : `${s}s ${ms}ms`;
        if (action === 'stop') global.stopwatches.delete(sender);
        await sock.sendMessage(from, {
          text: `⏱️ *${action === 'stop' ? 'Temps final' : 'Intermédiaire'}:* ${formatted}${action === 'stop' ? '\n\nChronomètre arrêté.' : '\n_!stopwatch stop pour arrêter_'}`,
        });
      }
    },
  },

};
