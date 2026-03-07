/**
 * ============================================================
 * @file        downloads.js
 * @description Commandes de téléchargement corrigées (YouTube, TikTok, Instagram)
 * ============================================================
 */

import axios from 'axios';
import yts from 'yt-search';

export default {
  play: {
    description: 'Rechercher et télécharger de la musique',
    execute: async ({ sock, from, text, msg }) => {
      if (!text) {
        return sock.sendMessage(from, { text: '🎵 Usage: !play [titre de la chanson]' });
      }

      try {
        // 1. Recherche via yt-search (plus stable qu'Invidious)
        const search = await yts(text);
        const video = search.videos[0];
        if (!video) return sock.sendMessage(from, { text: '❌ Aucun résultat trouvé.' });

        const infoText = `🎵 *Trouvé :* ${video.title}\n⏱️ *Durée :* ${video.timestamp}\n\n📥 *Téléchargement en cours...*`;
        await sock.sendMessage(from, { 
          image: { url: video.thumbnail }, 
          caption: infoText 
        }, { quoted: msg });

        // 2. Téléchargement via une API stable
        const res = await axios.get(`https://api.siputzx.my.id/api/dwnld/ytmp3?url=${encodeURIComponent(video.url)}`);
        
        if (res.data.status && res.data.data.dl) {
          await sock.sendMessage(from, {
            audio: { url: res.data.data.dl },
            mimetype: 'audio/mp4',
            fileName: `${video.title}.mp3`
          }, { quoted: msg });
        } else {
          throw new Error('API 1 échec');
        }
      } catch (err) {
        // Secours si l'API 1 échoue
        try {
            const res2 = await axios.get(`https://api.dreaded.site/api/ytdl/video?url=${encodeURIComponent(text)}`);
            if (res2.data.result.downloadLink) {
                await sock.sendMessage(from, { audio: { url: res2.data.result.downloadLink }, mimetype: 'audio/mp4' }, { quoted: msg });
            }
        } catch (e) {
            await sock.sendMessage(from, { text: '❌ Échec du téléchargement. Les serveurs YouTube sont saturés.' });
        }
      }
    },
  },

  ytmp3: {
    description: 'Convertir YouTube en MP3 via lien',
    execute: async ({ sock, from, text, msg }) => {
      if (!text || !text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)/)) {
        return sock.sendMessage(from, { text: '🎵 Usage: !ytmp3 [lien YouTube]' });
      }

      try {
        await sock.sendMessage(from, { text: '⬇️ Conversion en cours...' }, { quoted: msg });
        const res = await axios.get(`https://api.siputzx.my.id/api/dwnld/ytmp3?url=${encodeURIComponent(text)}`);
        
        if (res.data.data.dl) {
          await sock.sendMessage(from, {
            audio: { url: res.data.data.dl },
            mimetype: 'audio/mp4'
          }, { quoted: msg });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: '❌ Erreur de conversion.' });
      }
    },
  },

  video: {
    description: 'Télécharger une vidéo YouTube',
    execute: async ({ sock, from, text, msg }) => {
      if (!text) return sock.sendMessage(from, { text: '🎬 Usage: !video [titre ou lien]' });

      try {
        let videoUrl = text;
        if (!text.includes('http')) {
            const search = await yts(text);
            videoUrl = search.videos[0].url;
        }

        await sock.sendMessage(from, { text: '🎬 Téléchargement vidéo en cours...' }, { quoted: msg });
        
        const res = await axios.get(`https://api.siputzx.my.id/api/dwnld/ytmp4?url=${encodeURIComponent(videoUrl)}`);
        if (res.data.data.dl) {
          await sock.sendMessage(from, {
            video: { url: res.data.data.dl },
            caption: '✅ Vidéo téléchargée !'
          }, { quoted: msg });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: '❌ Impossible de télécharger la vidéo.' });
      }
    },
  },

  tiktok: {
    description: 'Télécharger une vidéo TikTok sans filigrane',
    execute: async ({ sock, from, text, msg }) => {
      if (!text || !text.includes('tiktok.com')) return sock.sendMessage(from, { text: '🎵 Lien TikTok invalide.' });

      try {
        const res = await axios.get(`https://api.siputzx.my.id/api/dwnld/tiktok?url=${encodeURIComponent(text)}`);
        if (res.data.data.video) {
          await sock.sendMessage(from, {
            video: { url: res.data.data.video },
            caption: '🎵 TikTok sans filigrane !'
          }, { quoted: msg });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: '❌ Erreur TikTok.' });
      }
    },
  },

  ig: {
    description: 'Télécharger depuis Instagram',
    execute: async ({ sock, from, text, msg }) => {
      if (!text || !text.includes('instagram.com')) return sock.sendMessage(from, { text: '📸 Lien Instagram invalide.' });

      try {
        const res = await axios.get(`https://api.siputzx.my.id/api/dwnld/igdl?url=${encodeURIComponent(text)}`);
        const data = res.data.data[0]; // Prend le premier média
        
        if (data.url.includes('video') || data.url.includes('.mp4')) {
            await sock.sendMessage(from, { video: { url: data.url }, caption: '📸 Instagram Vidéo' }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { image: { url: data.url }, caption: '📸 Instagram Image' }, { quoted: msg });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: '❌ Erreur Instagram.' });
      }
    },
  },

  dl: {
    description: 'Téléchargeur universel',
    execute: async ({ sock, from, text, msg }) => {
        // On redirige vers la vidéo par défaut pour le !dl universel
        if (!text.startsWith('http')) return sock.sendMessage(from, { text: '🌐 Envoyez un lien valide.' });
        await sock.sendMessage(from, { text: '🔍 Analyse du lien...' });
        
        try {
            // Utilisation d'une API de téléchargement multi-sites
            const res = await axios.get(`https://api.siputzx.my.id/api/dwnld/allin?url=${encodeURIComponent(text)}`);
            const dl = res.data.data.url || res.data.data.main;
            await sock.sendMessage(from, { video: { url: dl }, caption: '✅ Téléchargé !' }, { quoted: msg });
        } catch (e) {
            await sock.sendMessage(from, { text: '❌ Site non supporté ou lien invalide.' });
        }
    }
  }
};