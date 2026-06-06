/**
 * ============================================================
 * @file        media3.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes medias avancees — Effets image, collage
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// MÉDIAS AVANCÉS — PARTIE 3
// gif, qrcode, avatar
// ============================================================
import axios from 'axios';

export default {

  gif: {
    description: 'Envoyer un GIF animé',
    execute: async ({ sock, from, text, args }) => {
      if (!text) {
        await sock.sendMessage(from, { text: '🎞️ Usage: !gif [mot-clé]\nEx: !gif chat drôle\nEx: !gif bonjour\nEx: !gif dance' });
        return;
      }
      await sock.sendMessage(from, { text: `🎞️ Recherche de GIF "${text}"...` });
      try {
        // Tenor API (gratuit)
        const tenorKey = process.env.TENOR_API_KEY || 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCDA'; // clé demo publique
        const res = await axios.get('https://tenor.googleapis.com/v2/search', {
          params: { q: text, key: tenorKey, limit: 5, media_filter: 'gif', locale: 'fr_FR' },
          timeout: 8000,
        });
        const results = res.data?.results || [];
        if (results.length === 0) {
          await sock.sendMessage(from, { text: `❌ Aucun GIF trouvé pour "${text}".` });
          return;
        }
        const pick = results[Math.floor(Math.random() * results.length)];
        const gifUrl = pick.media_formats?.gif?.url || pick.url;
        const gifRes = await axios.get(gifUrl, { responseType: 'arraybuffer', timeout: 15000 });
        const buf = Buffer.from(gifRes.data);
        await sock.sendMessage(from, {
          video: buf,
          gifPlayback: true,
          caption: `🎞️ *${text}*`,
          mimetype: 'video/mp4',
        });
      } catch (err) {
        // Fallback: Giphy public beta
        try {
          const res2 = await axios.get('https://api.giphy.com/v1/gifs/search', {
            params: { api_key: 'dc6zaTOxFJmzC', q: text, limit: 5, rating: 'g' },
            timeout: 8000,
          });
          const gifs = res2.data?.data || [];
          if (gifs.length === 0) throw new Error('No gifs', { cause: err });
          const pick2 = gifs[Math.floor(Math.random() * gifs.length)];
          const url2 = pick2.images?.fixed_height?.url;
          await sock.sendMessage(from, { image: { url: url2 }, caption: `🎞️ ${text}` });
        } catch {
          await sock.sendMessage(from, { text: `❌ Impossible de trouver un GIF pour "${text}".\n\nConsulte: https://tenor.com/search/${encodeURIComponent(text)}` });
        }
      }
    },
  },

  qrcode: {
    description: 'Générer un QR code pour un texte ou lien',
    execute: async ({ sock, from, text }) => {
      if (!text) {
        await sock.sendMessage(from, {
          text: '📱 Usage: !qrcode [texte ou lien]\n\nEx:\n• !qrcode https://google.com\n• !qrcode +22890000000\n• !qrcode Mon message secret\n• !qrcode WIFI:S:MonSSID;T:WPA;P:MonPassword;;',
        });
        return;
      }
      await sock.sendMessage(from, { text: '📱 Génération du QR code...' });
      try {
        // QR Server API (gratuit, sans clé)
        const size = 400;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&bgcolor=ffffff&color=000000&ecc=H&margin=10`;
        const imgRes = await axios.get(qrUrl, { responseType: 'arraybuffer', timeout: 10000 });
        const buf = Buffer.from(imgRes.data);
        await sock.sendMessage(from, {
          image: buf,
          caption: `📱 *QR Code généré !*\n\n📝 Contenu: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}\n\n_Scanne avec n'importe quel lecteur QR_`,
        });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },

  avatar: {
    description: 'Générer un avatar unique basé sur un nom',
    execute: async ({ sock, from, args, text, senderNumber }) => {
      const style = args[0]?.toLowerCase();
      const styles = {
        pixel: 'pixel-art',
        cartoon: 'adventurer',
        abstract: 'shapes',
        init: 'initials',
        monster: 'bottts',
        robot: 'micah',
        geo: 'identicon',
        fun: 'fun-emoji',
      };

      if (!style || !styles[style]) {
        await sock.sendMessage(from, {
          text: `🎨 *Usage:* !avatar [style]\n\n*Styles:*\n• pixel → Pixel art\n• cartoon → Cartoon\n• abstract → Abstrait\n• init → Initiales\n• monster → Monstre sympa\n• robot → Robot\n• geo → Géométrique\n• fun → Emoji fun\n\nEx: !avatar pixel`,
        });
        return;
      }

      const seed = text.replace(style, '').trim() || senderNumber;
      await sock.sendMessage(from, { text: `🎨 Génération de ton avatar "${style}"...` });

      try {
        const avatarUrl = `https://api.dicebear.com/7.x/${styles[style]}/png?seed=${encodeURIComponent(seed)}&size=400&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
        const imgRes = await axios.get(avatarUrl, { responseType: 'arraybuffer', timeout: 10000 });
        const buf = Buffer.from(imgRes.data);
        await sock.sendMessage(from, {
          image: buf,
          caption: `🎨 *Avatar ${style}*\n🌱 Seed: "${seed}"\n\n_Styles dispo: pixel, cartoon, abstract, init, monster, robot, geo, fun_`,
        });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Erreur: ${err.message}` });
      }
    },
  },

};
