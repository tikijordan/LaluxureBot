/**
 * @file        downloads.js
 * @description Commandes de téléchargement (YouTube, TikTok, Instagram, Facebook)
 * @engine      yt-dlp (local)
 */

import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import util from 'util';
import yts from 'yt-search';

const execPromise = util.promisify(exec);

// Taille max envoyable via WhatsApp (50 Mo)
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

// Timeout global du processus (90 secondes)
const PROCESS_TIMEOUT = 90_000;

// Dossier de téléchargement — /tmp sur Railway (éphémère), sinon ./downloads/ en local
const DOWNLOAD_DIR = process.env.RAILWAY_ENVIRONMENT
    ? '/tmp/bot-downloads'
    : path.join(process.cwd(), 'downloads');

// Créer le dossier s'il n'existe pas
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Nettoie le fichier temporaire s'il existe
function cleanup(filePath) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

/**
 * Exécute yt-dlp avec des options universelles
 */
async function runYtdlp(url, isAudio, filePath) {
    // Suppression de --allow-dynamic-js qui cause l'erreur sur votre version
    // Utilisation de --extractor-args pour forcer le comportement si nécessaire
    const args = [
        '--no-check-certificate',
        '--no-cache-dir',
        '--socket-timeout 30',
        '--no-playlist',
        '--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"',
        `-o "${filePath}"`
    ];

    if (isAudio) {
        args.push('-x', '--audio-format mp3', '--audio-quality 0');
    } else {
        args.push('-f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]"', '--merge-output-format mp4');
    }

    const cmd = `yt-dlp ${args.join(' ')} "${url}"`;
    return execPromise(cmd, { timeout: PROCESS_TIMEOUT });
}

// ── Téléchargement vidéo commun ────────────────────────────────
async function downloadVideo({ sock, from, text, msg }) {
    if (!text) return sock.sendMessage(from, { text: '🎥 Usage: /video [lien]' });

    const filePath = path.join(DOWNLOAD_DIR, `video_${Date.now()}.mp4`);

    try {
        await sock.sendMessage(from, { text: '⏳ Téléchargement en cours...' }, { quoted: msg });

        await runYtdlp(text, false, filePath);

        if (!fs.existsSync(filePath)) {
            return sock.sendMessage(from, { text: '❌ Échec : Le fichier n\'a pas pu être généré.' });
        }

        const size = fs.statSync(filePath).size;
        if (size > MAX_SIZE_BYTES) {
            cleanup(filePath);
            return sock.sendMessage(from, { text: `❌ Fichier trop lourd (${Math.round(size/1024/1024)} Mo).` });
        }

        await sock.sendMessage(from, {
            video: fs.readFileSync(filePath),
            caption: '✅ Téléchargé avec succès',
            mimetype: 'video/mp4',
        }, { quoted: msg });

    } catch (err) {
        console.error('[video]', err.stderr || err.message);
        await sock.sendMessage(from, { text: `❌ Erreur : ${err.message.split('\n')[0]}` });
    } finally {
        cleanup(filePath);
    }
}

// ── Export des commandes ───────────────────────────────────────
const cmds = {

    play: {
        description: 'Rechercher et télécharger de la musique en MP3',
        execute: async ({ sock, from, text, msg }) => {
            if (!text) return sock.sendMessage(from, { text: '🎵 Usage: /play [titre ou lien]' });

            const filePath = path.join(DOWNLOAD_DIR, `audio_${Date.now()}.mp3`);

            try {
                let url = text;
                let title = text;
                let duration = '';
                let thumb = null;

                if (!text.startsWith('http')) {
                    const search = await yts(text);
                    const video  = search.videos[0];
                    if (!video) return sock.sendMessage(from, { text: '❌ Aucun résultat trouvé.' });
                    url      = video.url;
                    title    = video.title;
                    duration = video.timestamp;
                    thumb    = video.thumbnail;
                }

                const preview = thumb
                    ? { image: { url: thumb }, caption: `🎵 *${title}*\n⏱️ ${duration}\n\n📥 Conversion MP3 en cours...` }
                    : { text: `🎵 Conversion MP3 en cours...\n*${title}*` };
                
                await sock.sendMessage(from, preview, { quoted: msg });

                await runYtdlp(url, true, filePath);

                if (!fs.existsSync(filePath)) {
                    return sock.sendMessage(from, { text: '❌ Erreur de conversion.' });
                }

                await sock.sendMessage(from, {
                    audio: fs.readFileSync(filePath),
                    mimetype: 'audio/mpeg',
                    fileName: `${title}.mp3`,
                }, { quoted: msg });

            } catch (err) {
                console.error('[play]', err.stderr || err.message);
                await sock.sendMessage(from, { text: `❌ Erreur lors du téléchargement. Veuillez réessayer.` });
            } finally {
                cleanup(filePath);
            }
        },
    },

    video: {
        description: 'Télécharger une vidéo',
        execute: downloadVideo,
    },

    dl: {
        description: 'Téléchargeur universel',
        execute: async ({ sock, from, text, msg }) => {
            if (!text) return sock.sendMessage(from, { text: 'Usage: /dl [lien ou titre]' });
            if (text.startsWith('http')) return downloadVideo({ sock, from, text, msg });
            return cmds.play.execute({ sock, from, text, msg });
        },
    },

    ytmp3: {
        description: 'YouTube → MP3',
        execute: async (ctx) => cmds.play.execute(ctx),
    },

    ytmp4: {
        description: 'YouTube → MP4',
        execute: async (ctx) => downloadVideo(ctx),
    }
};

export default cmds;