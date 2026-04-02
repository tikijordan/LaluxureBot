/**
 * @file        downloads.js
 * @description Commandes de téléchargement complètes (YouTube, TikTok, Instagram, Facebook)
 * @engine      yt-dlp (Local)
 */

import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import util from 'util';
import yts from 'yt-search';

const execPromise = util.promisify(exec);

export default {
  // --- MUSIQUE (YOUTUBE SEARCH + CONVERSION MP3) ---
  play: {
    description: 'Rechercher et télécharger de la musique en MP3',
    execute: async ({ sock, from, text, msg }) => {
      if (!text) return sock.sendMessage(from, { text: '🎵 Usage: !play [titre ou lien]' });

      try {
        const search = await yts(text);
        const video = search.videos[0];
        if (!video) return sock.sendMessage(from, { text: '❌ Aucun résultat trouvé.' });

        const fileName = `audio_${Date.now()}.mp3`;
        const filePath = path.join(process.cwd(), fileName);

        await sock.sendMessage(from, { 
            image: { url: video.thumbnail }, 
            caption: `🎵 *Trouvé :* ${video.title}\n⏱️ *Durée :* ${video.timestamp}\n\n📥 *Conversion MP3 en cours...*` 
        }, { quoted: msg });

        // Commande yt-dlp optimisée pour l'audio
        const cmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${filePath}" ${video.url}`;
        await execPromise(cmd);

        if (fs.existsSync(filePath)) {
          await sock.sendMessage(from, { 
            audio: { url: filePath }, 
            mimetype: 'audio/mpeg',
            fileName: `${video.title}.mp3`
          }, { quoted: msg });
          
          fs.unlinkSync(filePath); // Nettoyage immédiat
        }
      } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: '❌ Erreur lors de la conversion audio.' });
      }
    },
  },

  // --- VIDÉO (YOUTUBE, TIKTOK, INSTAGRAM, FB) ---
  video: {
    description: 'Télécharger une vidéo (YouTube, TikTok, IG, FB)',
    execute: async ({ sock, from, text, msg }) => {
      if (!text) return sock.sendMessage(from, { text: '🎥 Usage: !video [lien]' });

      try {
        const fileName = `video_${Date.now()}.mp4`;
        const filePath = path.join(process.cwd(), fileName);

        await sock.sendMessage(from, { text: '⏳ Téléchargement de la vidéo...' });

        // yt-dlp gère nativement TikTok, IG, FB et YouTube.
        // On limite à 720p pour éviter de saturer la RAM de Railway/Render.
        const cmd = `yt-dlp -f "bestvideo[height<=720]+bestaudio/best[height<=720]" --merge-output-format mp4 -o "${filePath}" "${text}"`;
        
        await execPromise(cmd);

        if (fs.existsSync(filePath)) {
          await sock.sendMessage(from, { 
            video: { url: filePath }, 
            caption: '✅ Téléchargé par LaluxureBot' 
          }, { quoted: msg });
          
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: '❌ Impossible de télécharger cette vidéo. Vérifiez le lien ou la taille.' });
      }
    }
  },

  // --- TIKTOK (SANS FILIGRANE SI POSSIBLE) ---
  tiktok: {
    description: 'Télécharger une vidéo TikTok',
    execute: async ({ sock, from, text, msg }) => {
      if (!text || !text.includes('tiktok.com')) return sock.sendMessage(from, { text: '📱 Envoyez un lien TikTok valide.' });
      
      // On redirige simplement vers la commande video qui utilise yt-dlp (très efficace sur TikTok)
      return this.default.video.execute({ sock, from, text, msg });
    }
  },

  // --- COMMANDE UNIVERSELLE (!DL) ---
  dl: {
    description: 'Téléchargeur universel (Musique ou Vidéo)',
    execute: async ({ sock, from, text, msg }) => {
        if (!text) return sock.sendMessage(from, { text: '🌐 Envoyez un lien (YouTube, IG, FB, TikTok, etc.)' });
        
        // Par défaut, on tente le téléchargement vidéo
        return this.default.video.execute({ sock, from, text, msg });
    }
  }
};