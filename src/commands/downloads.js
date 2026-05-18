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

const MAX_SIZE_BYTES  = 250* 1024 * 1024;   // 250 MB — limite WhatsApp réelle
const PROCESS_TIMEOUT = 180_000;              // 180s — au-delà yt-dlp est bloqué

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
    const isYoutube  = /youtube\.com|youtu\.be/i.test(url);
    const isTiktok   = /tiktok\.com/i.test(url);
    const isInstagram = /instagram\.com/i.test(url);
    const isFacebook  = /facebook\.com|fb\.watch/i.test(url);

    const baseArgs = [
        '--no-check-certificate',
        '--no-cache-dir',
        '--socket-timeout 30',
        '--no-playlist',
        `-o "${filePath}"`,
    ];

    const ytCookiesFile = process.env.YT_COOKIES_FILE;
    const tiktokAppName = process.env.TIKTOK_APP_NAME || 'tiktok_web';
    const torEnabled = ['1', 'true', 'yes'].includes((process.env.TOR_PROXY || '').toLowerCase());
    const rawProxyUrl = process.env.YTDLP_PROXY || process.env.PROXY_URL || (torEnabled ? 'socks5h://127.0.0.1:9050' : '');
    let proxyUrl = '';
    if (rawProxyUrl) {
        try {
            const parsed = new URL(rawProxyUrl);
            if (parsed.port && /^\d+$/.test(parsed.port)) {
                proxyUrl = rawProxyUrl;
            }
        } catch {}
    }

    const buildArgs = ({ ytClient, tiktokImpersonate } = {}) => {
        const args = [...baseArgs];

        if (proxyUrl) {
            args.push(`--proxy "${proxyUrl}"`);
        }

        // ── YouTube ────────────────────────────────────────────────
        if (isYoutube) {
            const client = ytClient || 'ios,android,web_creator';
            args.push(`--extractor-args "youtube:player_client=${client}"`);
            args.push('--age-limit 99');
            args.push('--add-header "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"');
            if (ytCookiesFile && fs.existsSync(ytCookiesFile) && fs.statSync(ytCookiesFile).size > 0) {
                args.push(`--cookies "${ytCookiesFile}"`);
            }
        }

        // ── TikTok ─────────────────────────────────────────────────
        if (isTiktok) {
            const useImpersonate = tiktokImpersonate !== false;
            if (useImpersonate) args.push('--impersonate chrome');
            args.push(`--extractor-args "tiktok:app_name=${tiktokAppName}"`);
            const cookiesPath = path.join(process.cwd(), 'cookies.txt');
            if (fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0) {
                args.push(`--cookies "${cookiesPath}"`);
            }
            args.push('--add-header "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"');
        }

        // ── Instagram / Facebook ────────────────────────────────────
        if (isInstagram || isFacebook) {
            args.push('--add-header "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"');
        }

        if (isAudio) {
            args.push('-x', '--audio-format mp3', '--audio-quality 0');
        } else {
            // Limiter à 480p pour rester sous 60MB sur Railway
            args.push(
                '-f "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]/best"',
                '--merge-output-format mp4'
            );
        }

        return args;
    };

    const execWithArgs = (args) => execPromise(`yt-dlp ${args.join(' ')} "${url}"`, { timeout: PROCESS_TIMEOUT });

    if (rawProxyUrl && !proxyUrl) {
        throw new Error('⚠️ Proxy invalide. Utilise un format type http://user:pass@host:8080');
    }

    try {
        return await execWithArgs(buildArgs());
    } catch (e) {
        const stderr = e.stderr || e.message || '';
        const lower = stderr.toLowerCase();

        if (isYoutube && (lower.includes('po token') || lower.includes('http error 403') || lower.includes('sabr'))) {
            return await execWithArgs(buildArgs({ ytClient: 'tv_embedded,mweb' }));
        }

        if (isTiktok && (lower.includes('impersonation') || lower.includes('no impersonate target'))) {
            return await execWithArgs(buildArgs({ tiktokImpersonate: false }));
        }

        if (stderr.includes('429') || stderr.includes('Too Many Requests')) {
            throw new Error('🚫 Plateforme temporairement bloquée. Réessaie dans quelques minutes.');
        }
        if (stderr.includes('Sign in to confirm') || stderr.includes('bot')) {
            throw new Error('🔐 YouTube demande une vérification. Essaie avec un autre lien.');
        }
        if (isTiktok && (lower.includes('video unavailable') || lower.includes('private') || lower.includes('status code') || lower.includes('access'))) {
            throw new Error('⚠️ TikTok a refusé la vidéo (blocage IP ou privée). Essaie un proxy/cookies.');
        }
        if (stderr.includes('Video unavailable') || stderr.includes('not available')) {
            throw new Error('❌ Vidéo indisponible ou privée.');
        }
        if (stderr.includes('timeout') || e.killed) {
            throw new Error('⏱️ Téléchargement trop long (>90s). Essaie une vidéo plus courte.');
        }
        const firstLine = stderr.split('\n').filter(l => l.includes('ERROR')).pop()
            || stderr.split('\n')[0];
        throw new Error(firstLine || e.message);
    }
}

// ── Téléchargement vidéo commun ────────────────────────────────
async function downloadVideo({ sock, from, text, msg }) {
    if (!text) return sock.sendMessage(from, { text: '📎 Usage: !video [lien]' });

    const filePath = path.join(DOWNLOAD_DIR, `video_${Date.now()}.mp4`);

    try {
        await sock.sendMessage(from, { text: '⬇️ Téléchargement en cours...' }, { quoted: msg });

        await runYtdlp(text, false, filePath);

        if (!fs.existsSync(filePath)) {
            return sock.sendMessage(from, { text: "❌ Échec : le fichier n'a pas pu être généré." });
        }

        const size = fs.statSync(filePath).size;
        if (size > MAX_SIZE_BYTES) {
            cleanup(filePath);
            return sock.sendMessage(from, {
                text: `❌ Fichier trop lourd (${Math.round(size / 1024 / 1024)} Mo > 60 Mo).\nEssaie une vidéo plus courte ou utilise !play pour l'audio.`
            });
        }

        await sock.sendMessage(from, {
            video: fs.readFileSync(filePath),
            caption: '✅ Téléchargé avec succès',
            mimetype: 'video/mp4',
        }, { quoted: msg });

    } catch (err) {
        console.error('[video]', err.message);
        await sock.sendMessage(from, { text: `❌ ${err.message}` });
    } finally {
        cleanup(filePath);
    }
}

// ── Export des commandes ───────────────────────────────────────
const cmds = {

    play: {
        description: 'Rechercher et télécharger de la musique en MP3',
        execute: async ({ sock, from, text, msg }) => {
            if (!text) return sock.sendMessage(from, { text: '🎵 Usage: !play [titre ou lien]' });

            const filePath = path.join(DOWNLOAD_DIR, `audio_${Date.now()}.mp3`);

            try {
                let url = text;
                let title = text;
                let duration = '';
                let thumb = null;

                if (!text.startsWith('http')) {
                    await sock.sendMessage(from, { text: `🔍 Recherche : *${text}*...` }, { quoted: msg });
                    const search = await yts(text);
                    const video  = search.videos[0];
                    if (!video) return sock.sendMessage(from, { text: '❌ Aucun résultat trouvé.' });
                    url      = video.url;
                    title    = video.title;
                    duration = video.timestamp;
                    thumb    = video.thumbnail;
                }

                const preview = thumb
                    ? { image: { url: thumb }, caption: `🎵 *${title}*\n⏱ ${duration}\n\n⬇️ Conversion MP3 en cours...` }
                    : { text: `⬇️ Conversion MP3 en cours...\n*${title}*` };

                await sock.sendMessage(from, preview, { quoted: msg });

                await runYtdlp(url, true, filePath);

                if (!fs.existsSync(filePath)) {
                    return sock.sendMessage(from, { text: '❌ Erreur de conversion.' });
                }

                const size = fs.statSync(filePath).size;
                if (size > MAX_SIZE_BYTES) {
                    cleanup(filePath);
                    return sock.sendMessage(from, { text: `❌ Fichier audio trop lourd (${Math.round(size / 1024 / 1024)} Mo).` });
                }

                await sock.sendMessage(from, {
                    audio: fs.readFileSync(filePath),
                    mimetype: 'audio/mpeg',
                    fileName: `${title}.mp3`,
                }, { quoted: msg });

            } catch (err) {
                console.error('[play]', err.message);
                await sock.sendMessage(from, { text: `❌ ${err.message}` });
            } finally {
                cleanup(filePath);
            }
        },
    },

    video: {
        description: 'Télécharger une vidéo YouTube/TikTok/Instagram',
        execute: downloadVideo,
    },

    dl: {
        description: 'Téléchargeur universel (lien → vidéo, titre → MP3)',
        execute: async ({ sock, from, text, msg }) => {
            if (!text) return sock.sendMessage(from, { text: '📎 Usage: !dl [lien ou titre]' });
            if (text.startsWith('http')) return downloadVideo({ sock, from, text, msg });
            return cmds.play.execute({ sock, from, text, msg });
        },
    },

    ytmp3: {
        description: 'YouTube → MP3',
        execute: async (ctx) => cmds.play.execute(ctx),
    },

    ytmp4: {
        description: 'YouTube → MP4 (480p max)',
        execute: async (ctx) => downloadVideo(ctx),
    },

    tiktok: {
        description: 'Télécharger une vidéo TikTok',
        execute: async (ctx) => downloadVideo(ctx),
    },
};

export default cmds;