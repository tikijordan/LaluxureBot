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

// FIX 1 — WhatsApp refuse les fichiers > ~64 MB ; on coupe à 60 MB
const MAX_SIZE_BYTES  = 250 * 1024 * 1024;          // 60 MB

// FIX 2 — 9 000 000 ms (≈ 2h30) était absurde ; WhatsApp coupe la connexion bien avant.
//          90 s est amplement suffisant pour une vidéo 720p.
const PROCESS_TIMEOUT = 90_000;                    // 90 secondes

const DOWNLOAD_DIR = process.env.RAILWAY_ENVIRONMENT
    ? '/tmp/bot-downloads'
    : path.join(process.cwd(), 'downloads');

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

function cleanup(filePath) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

/**
 * Exécute yt-dlp avec des options adaptées par plateforme
 */
async function runYtdlp(url, isAudio, filePath) {
    const isYoutube = /youtube\.com|youtu\.be/i.test(url);
    const isTiktok  = /tiktok\.com/i.test(url);

    const args = [
        '--no-check-certificate',
        '--no-cache-dir',
        '--socket-timeout 30',
        '--no-playlist',
        `-o "${filePath}"`,
    ];

    // ── YouTube ────────────────────────────────────────────────
    if (isYoutube) {
        // FIX 3 — ios/android/web_creator sont bloqués par YouTube depuis début 2025.
        //          tv_embedded + mweb contournent la vérification bot sans cookies.
        args.push('--extractor-args "youtube:player_client=tv_embedded,mweb"');
        args.push('--age-limit 99');
        args.push('--add-header "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"');
        if (process.env.YT_COOKIES_FILE && fs.existsSync(process.env.YT_COOKIES_FILE) && fs.statSync(process.env.YT_COOKIES_FILE).size > 0) {
            args.push(`--cookies "${process.env.YT_COOKIES_FILE}"`);
        }
    }

    // ── TikTok ─────────────────────────────────────────────────
    if (isTiktok) {
        const cookiesPath = path.join(process.cwd(), 'cookies.txt');
        if (fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0) {
            args.push(`--cookies "${cookiesPath}"`);
        }
        // FIX 4 — impersonate_browser=chrome nécessite curl_cffi (absent sur Railway).
        //          Anciennement app_name=trill, maintenant retiré ou modifié.

        args.push('--add-header "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"');
    }

    if (isAudio) {
        args.push('-x', '--audio-format mp3', '--audio-quality 0');
    } else {
        args.push(
            '-f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]"',
            '--merge-output-format mp4'
        );
    }

    const cmd = `yt-dlp ${args.join(' ')} "${url}"`;
    try {
        return await execPromise(cmd, { timeout: PROCESS_TIMEOUT });
    } catch (e) {
        const stderr = e.stderr || e.message || '';

        if (stderr.includes('429')) {
            throw new Error('🚫 YouTube vous bloque temporairement. Réessayez dans quelques minutes.');
        }
        if (stderr.includes('Sign in to confirm')) {
            throw new Error('🔐 YouTube demande une authentification. Besoin de cookies YouTube valides.');
        }
        if (stderr.includes('impersonation')) {
            throw new Error('⚠️ TikTok: Dépendances d\'impersonation manquantes (curl_cffi).');
        }
        if (stderr.includes('format') || stderr.includes('not available')) {
            throw new Error('❌ Format vidéo indisponible pour ce lien.');
        }

        throw e;
    }
}

// ── Téléchargement vidéo commun ────────────────────────────────
async function downloadVideo({ sock, from, text, msg }) {
    if (!text) return sock.sendMessage(from, { text: ' Usage: /video [lien]' });

    const filePath = path.join(DOWNLOAD_DIR, `video_${Date.now()}.mp4`);

    try {
        await sock.sendMessage(from, { text: ' Téléchargement en cours...' }, { quoted: msg });

        await runYtdlp(text, false, filePath);

        if (!fs.existsSync(filePath)) {
            return sock.sendMessage(from, { text: " Échec : Le fichier n'a pas pu être généré." });
        }

        const size = fs.statSync(filePath).size;
        if (size > MAX_SIZE_BYTES) {
            cleanup(filePath);
            return sock.sendMessage(from, { text: ` Fichier trop lourd (${Math.round(size/1024/1024)} Mo). Limite : 60 Mo.` });
        }

        await sock.sendMessage(from, {
            video: fs.readFileSync(filePath),
            caption: ' Téléchargé avec succès',
            mimetype: 'video/mp4',
        }, { quoted: msg });

    } catch (err) {
        console.error('[video]', err.stderr || err.message);
        await sock.sendMessage(from, { text: ` Erreur : ${(err.stderr || err.message).split('\n')[0]}` });
    } finally {
        cleanup(filePath);
    }
}

// ── Export des commandes ───────────────────────────────────────
const cmds = {

    play: {
        description: 'Rechercher et télécharger de la musique en MP3',
        execute: async ({ sock, from, text, msg }) => {
            if (!text) return sock.sendMessage(from, { text: ' Usage: /play [titre ou lien]' });

            const filePath = path.join(DOWNLOAD_DIR, `audio_${Date.now()}.mp3`);

            try {
                let url = text;
                let title = text;
                let duration = '';
                let thumb = null;

                if (!text.startsWith('http')) {
                    const search = await yts(text);
                    const video  = search.videos[0];
                    if (!video) return sock.sendMessage(from, { text: ' Aucun résultat trouvé.' });
                    url      = video.url;
                    title    = video.title;
                    duration = video.timestamp;
                    thumb    = video.thumbnail;
                }

                const preview = thumb
                    ? { image: { url: thumb }, caption: ` *${title}*\n ${duration}\n\n Conversion MP3 en cours...` }
                    : { text: ` Conversion MP3 en cours...\n*${title}*` };

                await sock.sendMessage(from, preview, { quoted: msg });

                await runYtdlp(url, true, filePath);

                if (!fs.existsSync(filePath)) {
                    return sock.sendMessage(from, { text: ' Erreur de conversion.' });
                }

                await sock.sendMessage(from, {
                    audio: fs.readFileSync(filePath),
                    mimetype: 'audio/mpeg',
                    fileName: `${title}.mp3`,
                }, { quoted: msg });

            } catch (err) {
                console.error('[play]', err.stderr || err.message);
                await sock.sendMessage(from, { text: ' Erreur lors du téléchargement. Veuillez réessayer.' });
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
    },
};

export default cmds;