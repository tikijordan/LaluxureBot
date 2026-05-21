/**
 * @file        downloads.js
 * @description Commandes de téléchargement (YouTube, TikTok, Instagram, Facebook)
 * @engine      yt-dlp (local)
 */

import { exec } from 'child_process';
import net from 'net';
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

const TOR_COOKIE_PATHS = [
    process.env.TOR_CONTROL_COOKIE,
    '/tmp/tor_auth_cookie',
    '/run/tor/control.authcookie',
    '/var/run/tor/control.authcookie',
].filter(Boolean);

function isTorEnabled() {
    return ['1', 'true', 'yes'].includes((process.env.TOR_PROXY || '').toLowerCase());
}

function isTorRotationEnabled() {
    const raw = (process.env.TOR_ROTATE_ON_BLOCK ?? '1').toString().toLowerCase();
    return ['1', 'true', 'yes'].includes(raw);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readTorAuthCookieHex() {
    for (const p of TOR_COOKIE_PATHS) {
        try {
            if (fs.existsSync(p)) return fs.readFileSync(p).toString('hex');
        } catch {}
    }
    return null;
}

async function sendTorControl(command) {
    const host = process.env.TOR_CONTROL_HOST || '127.0.0.1';
    const port = parseInt(process.env.TOR_CONTROL_PORT || '9051', 10);
    const password = process.env.TOR_CONTROL_PASSWORD || '';
    const cookieHex = readTorAuthCookieHex();

    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => {
            let authCmd = 'AUTHENTICATE';
            if (password) authCmd = `AUTHENTICATE "${password}"`;
            else if (cookieHex) authCmd = `AUTHENTICATE ${cookieHex}`;
            else authCmd = 'AUTHENTICATE ""';
            socket.write(`${authCmd}\r\n${command}\r\nQUIT\r\n`);
        });

        // Timeout : évite que la Promise reste en suspens si le port est inaccessible
        socket.setTimeout(5000, () => {
            socket.destroy();
            reject(new Error('Tor control port timeout (5s)'));
        });

        let buffer = '';
        socket.on('data', (data) => { buffer += data.toString(); });
        socket.on('error', reject);
        socket.on('end', () => {
            if (buffer.includes('250 OK')) return resolve(buffer);
            reject(new Error(buffer.trim() || 'Tor control error'));
        });
    });
}

async function rotateTorIdentity() {
    try {
        await sendTorControl('SIGNAL NEWNYM');
        return true;
    } catch (e) {
        console.warn('[Tor] Rotation IP impossible:', e.message);
        return false;
    }
}

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
    const torEnabled = isTorEnabled();
    const rotateOnBlock = torEnabled && isTorRotationEnabled();
    const maxRotations = Math.max(0, parseInt(process.env.TOR_MAX_ROTATIONS || '4', 10));
    const rotationDelayMs = Math.max(10000, parseInt(process.env.TOR_ROTATE_DELAY_MS || '10000', 10));
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

    const totalAttempts = rotateOnBlock ? maxRotations + 1 : 1;
    let lastError;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        try {
            return await execWithArgs(buildArgs());
        } catch (e) {
            let stderr = e.stderr || e.message || '';
            let lower = stderr.toLowerCase();

            if (isYoutube && (lower.includes('po token') || lower.includes('http error 403') || lower.includes('sabr'))) {
                try {
                    return await execWithArgs(buildArgs({ ytClient: 'tv_embedded,mweb' }));
                } catch (err2) {
                    e = err2;
                    stderr = err2.stderr || err2.message || '';
                    lower = stderr.toLowerCase();
                }
            }

            if (isTiktok && (lower.includes('impersonation') || lower.includes('no impersonate target'))) {
                try {
                    return await execWithArgs(buildArgs({ tiktokImpersonate: false }));
                } catch (err2) {
                    e = err2;
                    stderr = err2.stderr || err2.message || '';
                    lower = stderr.toLowerCase();
                }
            }

            const blockNeedles = [
                'http error 403', 'status code 403', 'forbidden', '429', 'too many requests',
                'captcha', 'sign in to confirm', 'unusual traffic', 'access denied', 'blocked',
            ];
            const tiktokBlockNeedles = [
                'video unavailable', 'private', 'status code', 'access', 'not available',
            ];

            const isBlocked = blockNeedles.some(n => lower.includes(n)) ||
                (isTiktok && tiktokBlockNeedles.some(n => lower.includes(n)));

            if (isBlocked && rotateOnBlock && attempt < totalAttempts) {
                console.warn(`[Tor] Blocage détecté — rotation IP (${attempt}/${totalAttempts - 1})`);
                const rotated = await rotateTorIdentity();
                if (rotated) await sleep(rotationDelayMs);
                lastError = e;
                continue;
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

    throw new Error(lastError?.message || '❌ Téléchargement échoué après rotation Tor.');
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
                text: `❌ Fichier trop lourd (${Math.round(size / 1024 / 1024)} Mo > 250 Mo).\nEssaie une vidéo plus courte ou utilise !play pour l'audio.`
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