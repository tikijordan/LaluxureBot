/**
 * @file        downloads.js
 * @description Commandes de téléchargement (YouTube, TikTok, Instagram, Facebook)
 * @engine      yt-dlp (local)
 */

import { spawn, exec } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import util from 'util';
import axios from 'axios';
import yts from 'yt-search';
// Fallback SANS binaire externe pour YouTube — nécessaire sur les hébergements
// (comme SmarterASP.NET/IIS) où yt-dlp et ffmpeg ne peuvent pas être installés
// ou exécutés (pas d'accès shell, spawn() de binaires externes bloqué).
import ytdl from '@distube/ytdl-core';

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

function normalizeMediaUrl(url) {
    let u = url.trim();

    const ytShort = u.match(/(?:youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/i);
    if (ytShort) u = `https://www.youtube.com/watch?v=${ytShort[1]}`;

    const ytWatch = u.match(/youtube\.com\/watch\?.*v=([\w-]{6,})/i);
    if (ytWatch && !u.startsWith('https://www.youtube.com/watch?v=')) {
        u = `https://www.youtube.com/watch?v=${ytWatch[1]}`;
    }

    return u;
}

function validateDownloadUrl(text) {
    if (!text?.trim()) return { ok: false, msg: '📎 Usage: !video [lien http/https]' };
    const url = normalizeMediaUrl(text);
    if (url.startsWith('-')) return { ok: false, msg: '❌ Lien invalide.' };
    if (!/^https?:\/\//i.test(url)) return { ok: false, msg: '❌ Fournis un lien commençant par http:// ou https://' };
    // Rejeter uniquement les caractères dangereux pour le shell — & est OK dans les query strings
    if (/["'`$\\;|<>\n\r]/.test(url)) return { ok: false, msg: '❌ URL contient des caractères non autorisés.' };
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, msg: '❌ Protocole non supporté.' };
        if (!parsed.hostname) return { ok: false, msg: '❌ URL invalide.' };
        const host = parsed.hostname.toLowerCase();
        const allowed = ['youtube.com', 'youtu.be', 'tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
            'instagram.com', 'facebook.com', 'fb.watch', 'twitter.com', 'x.com'];
        if (!allowed.some(d => host === d || host.endsWith('.' + d))) {
            return { ok: false, msg: '❌ Plateforme non supportée (YouTube, TikTok, Instagram, Facebook).' };
        }
    } catch {
        return { ok: false, msg: '❌ URL invalide.' };
    }
    return { ok: true, url };
}

function validatePlayInput(text) {
    if (!text || !text.trim()) return { ok: false, msg: '🎵 Usage: !play [titre ou lien]' };
    const input = text.trim();
    if (input.startsWith('-')) return { ok: false, msg: '❌ Entrée invalide.' };
    if (input.length > 300) return { ok: false, msg: '❌ Recherche trop longue (max 300 caractères).' };
    if (input.startsWith('http')) {
        const check = validateDownloadUrl(input);
        if (!check.ok) return check;
        return { ok: true, text: check.url };
    }
    return { ok: true, text: input };
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
            const authCmd = password
                ? `AUTHENTICATE "${password}"`
                : cookieHex
                    ? `AUTHENTICATE ${cookieHex}`
                    : 'AUTHENTICATE ""';
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

let _impersonateCache = null;
async function canUseImpersonate() {
    if (_impersonateCache !== null) return _impersonateCache;
    try {
        const { stdout } = await execPromise('yt-dlp --list-impersonate-targets', { timeout: 10000 });
        _impersonateCache = /chrome/i.test(stdout) && !/chrome.*unavailable/i.test(stdout);
    } catch {
        _impersonateCache = false;
    }
    return _impersonateCache;
}

/** Exécute yt-dlp via spawn (pas de shell — URLs avec & OK) */
function execYtdlp(args, url) {
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', [...args, url], { timeout: PROCESS_TIMEOUT });
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('error', (err) => reject(Object.assign(err, { stderr: err.message })));
        proc.on('close', (code) => {
            if (code === 0) return resolve();
            reject(Object.assign(new Error(stderr.trim() || `yt-dlp exit ${code}`), { stderr, code }));
        });
    });
}

function resolveProxyUrl() {
    const torEnabled = isTorEnabled();
    const rawProxyUrl = process.env.YTDLP_PROXY || process.env.PROXY_URL || (torEnabled ? 'socks5h://127.0.0.1:9050' : '');
    if (!rawProxyUrl) return '';
    try {
        const parsed = new URL(rawProxyUrl);
        if (parsed.port && /^\d+$/.test(parsed.port)) return rawProxyUrl;
    } catch {}
    return '';
}

function buildYtdlpArgs({ filePath, isAudio, isYoutube, isTiktok, ytClient, videoFormat, tiktokImpersonate, tiktokApp }) {
    const args = [
        '--no-check-certificate', '--no-cache-dir',
        '--socket-timeout', '30', '--no-playlist',
        '--retries', '3', '--fragment-retries', '3',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        '-o', filePath,
    ];

    const proxyUrl = resolveProxyUrl();
    if (proxyUrl) args.push('--proxy', proxyUrl);

    if (isYoutube) {
        args.push('--extractor-args', `youtube:player_client=${ytClient}`);
        args.push('--age-limit', '99');
        const ytCookies = process.env.YT_COOKIES_FILE;
        if (ytCookies && fs.existsSync(ytCookies) && fs.statSync(ytCookies).size > 0) {
            args.push('--cookies', ytCookies);
        }
    }

    if (isTiktok) {
        if (tiktokImpersonate) args.push('--impersonate', 'chrome');
        args.push('--extractor-args', `tiktok:app_name=${tiktokApp}`);
        const cookiesPath = path.join(process.cwd(), 'cookies.txt');
        if (fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0) {
            args.push('--cookies', cookiesPath);
        }
    }

    if (isAudio) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
        args.push('-f', videoFormat, '--merge-output-format', 'mp4');
    }

    return args;
}

/** Copie un flux Node.js (stream) vers un fichier. */
function streamToFile(stream, filePath) {
    return new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(filePath);
        stream.on('error', reject);
        ws.on('error', reject);
        ws.on('finish', resolve);
        stream.pipe(ws);
    });
}

/**
 * Fallback YouTube SANS binaire externe (ni yt-dlp ni ffmpeg), via
 * @distube/ytdl-core (pure JS, fait juste des requêtes HTTPS).
 * Utilisé quand yt-dlp est absent/inexécutable — typiquement sur un
 * hébergement Windows/IIS mutualisé type SmarterASP.NET, où il est en
 * général impossible d'installer ou d'exécuter des binaires externes.
 *
 * Contrainte : sans ffmpeg, on ne peut ni fusionner deux pistes séparées
 * ni transcoder. On doit donc choisir un format déjà combiné (audio+vidéo)
 * pour la vidéo, et le flux audio natif tel quel pour l'audio (pas un vrai
 * .mp3 — WhatsApp accepte très bien m4a/opus tant que le mimetype est correct).
 *
 * @returns {Promise<{mimetype: string, ext: string}>}
 */
async function downloadYoutubeNoBinary(url, isAudio, filePath) {
    const info = await ytdl.getInfo(url);

    if (isAudio) {
        const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
        if (!format) throw new Error('Aucun format audio disponible pour cette vidéo.');
        await streamToFile(ytdl.downloadFromInfo(info, { format }), filePath);
        const isM4a = /mp4/i.test(format.mimeType || '') || format.container === 'm4a';
        return isM4a ? { mimetype: 'audio/mp4', ext: 'm4a' } : { mimetype: 'audio/webm', ext: 'webm' };
    }

    // Vidéo : uniquement des formats mp4 déjà fusionnés (audio+vidéo dans le
    // même flux), sinon impossible à assembler sans ffmpeg.
    const format = ytdl.chooseFormat(info.formats, {
        quality: 'highest',
        filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4',
    });
    if (!format) throw new Error("Aucun format vidéo+audio combiné disponible sans ffmpeg pour cette vidéo (essaie une autre vidéo, ou !play pour l'audio seul).");
    await streamToFile(ytdl.downloadFromInfo(info, { format }), filePath);
    return { mimetype: 'video/mp4', ext: 'mp4' };
}


async function downloadTikTokApi(url, filePath) {
    const res = await axios.get('https://www.tikwm.com/api/', {
        params: { url, hd: 1 },
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const data = res.data?.data;
    if (!data?.play && !data?.wmplay) {
        throw new Error(res.data?.msg || 'API TikTok indisponible');
    }
    const videoUrl = data.play || data.wmplay;
    const vidRes = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
    fs.writeFileSync(filePath, Buffer.from(vidRes.data));
}

function mapYtdlpError(stderr, isTiktok, isYoutube) {
    const lower = (stderr || '').toLowerCase();
    if (lower.includes('enoent') || lower.includes('is not recognized') || lower.includes('command not found') || lower.includes('spawn yt-dlp')) {
        return "❌ yt-dlp est introuvable ou inexécutable sur ce serveur (binaire absent ou hors PATH). Sur un hébergement Windows/IIS type SmarterASP.NET, il n'est en général pas possible d'installer/exécuter des binaires externes comme yt-dlp ou ffmpeg — c'est probablement la vraie cause, pas un bug du bot.";
    }
    if (lower.includes('eacces') || lower.includes('access is denied') || lower.includes('permission denied')) {
        return "❌ Le serveur refuse d'exécuter yt-dlp (permissions). Sur un hébergement mutualisé, l'exécution de binaires externes est souvent bloquée.";
    }
    if (lower.includes('ffmpeg') && (lower.includes('not found') || lower.includes('not recognized') || lower.includes('enoent'))) {
        return '❌ ffmpeg est introuvable sur ce serveur — nécessaire pour fusionner/convertir la vidéo ou l\'audio.';
    }
    if (lower.includes('429') || lower.includes('too many requests')) {
        return '🚫 Plateforme temporairement bloquée. Réessaie dans quelques minutes.';
    }
    if (lower.includes('sign in to confirm') || lower.includes('unusual traffic')) {
        return '🔐 YouTube demande une vérification. Ajoute YT_COOKIES_FILE ou réessaie plus tard.';
    }
    if (isTiktok && (lower.includes('blocked') || lower.includes('ip address'))) {
        return '⚠️ TikTok bloque cette IP. Réessaie ou active TOR_PROXY=1.';
    }
    if (lower.includes('video unavailable') || lower.includes('not available') || lower.includes('private')) {
        return '❌ Vidéo indisponible ou privée.';
    }
    if (lower.includes('timeout') || lower.includes('timed out')) {
        return '⏱️ Téléchargement trop long. Essaie une vidéo plus courte.';
    }
    if (isYoutube && (lower.includes('po token') || lower.includes('http error 403') || lower.includes('sabr'))) {
        return '🔐 YouTube bloque le téléchargement (403). Réessaie ou configure YT_COOKIES_FILE.';
    }
    const errLine = stderr.split('\n').find(l => /ERROR/i.test(l));
    return errLine?.replace(/^ERROR:\s*/, '').slice(0, 200) || '❌ Téléchargement échoué.';
}

/**
 * Exécute yt-dlp avec stratégies multiples par plateforme
 */
async function runYtdlp(url, isAudio, filePath) {
    url = normalizeMediaUrl(url);
    const isYoutube = /youtube\.com|youtu\.be/i.test(url);
    const isTiktok = /tiktok\.com/i.test(url);

    const proxyUrl = resolveProxyUrl();
    if ((process.env.YTDLP_PROXY || process.env.PROXY_URL) && !proxyUrl && !isTorEnabled()) {
        throw new Error('⚠️ Proxy invalide. Format: http://user:pass@host:8080');
    }

    const strategies = [];

    if (isYoutube) {
        const audioFmt = 'bestaudio/best';
        const videoFmts = [
            'best[height<=480][ext=mp4]/best[height<=480]/18/best',
            'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]/18/best',
            '18/best',
        ];
        const clients = ['android_vr,web', 'mweb,tv_embedded', 'ios,android,web_creator', 'tv,web'];
        for (const client of clients) {
            for (const fmt of (isAudio ? [audioFmt] : videoFmts)) {
                strategies.push({ ytClient: client, videoFormat: isAudio ? audioFmt : fmt });
            }
        }
    } else if (isTiktok) {
        const useImp = await canUseImpersonate();
        const apps = ['tiktok_web', 'musical_ly'];
        for (const app of apps) {
            if (useImp) strategies.push({ tiktokImpersonate: true, tiktokApp: app, videoFormat: 'best' });
            strategies.push({ tiktokImpersonate: false, tiktokApp: app, videoFormat: 'best' });
        }
    } else {
        strategies.push({
            videoFormat: isAudio ? 'bestaudio/best' : 'best[height<=480]/best',
        });
    }

    let lastError = null;
    for (const strat of strategies) {
        try {
            const args = buildYtdlpArgs({
                filePath, isAudio, isYoutube, isTiktok,
                ytClient: strat.ytClient || 'android_vr,web',
                videoFormat: strat.videoFormat,
                tiktokImpersonate: strat.tiktokImpersonate,
                tiktokApp: strat.tiktokApp || 'tiktok_web',
            });
            await execYtdlp(args, url);
            if (fs.existsSync(filePath)) return { mimetype: null, ext: null };
        } catch (e) {
            lastError = e;
            console.warn('[yt-dlp] Stratégie échouée:', e.stderr?.split('\n').find(l => /ERROR|WARNING/i.test(l)) || e.message);
            // yt-dlp lui-même est absent/inexécutable (cas typique SmarterASP.NET) —
            // inutile de retenter d'autres stratégies avec le même binaire manquant.
            const lower = (e.stderr || e.message || '').toLowerCase();
            const binMissing = lower.includes('enoent') || lower.includes('is not recognized')
                || lower.includes('command not found') || lower.includes('spawn yt-dlp')
                || lower.includes('access is denied') || lower.includes('eacces') || lower.includes('permission denied');
            if (binMissing) break;
        }
    }

    // Fallback SANS binaire externe pour YouTube (pas de yt-dlp/ffmpeg requis)
    if (isYoutube) {
        try {
            const result = await downloadYoutubeNoBinary(url, isAudio, filePath);
            if (fs.existsSync(filePath)) return result;
        } catch (e) {
            console.warn('[ytdl-core fallback]', e.message);
            lastError = e;
        }
    }

    // Fallback API TikTok
    if (isTiktok && !isAudio) {
        try {
            await downloadTikTokApi(url, filePath);
            if (fs.existsSync(filePath)) return { mimetype: null, ext: null };
        } catch (e) {
            console.warn('[TikTok API]', e.message);
            lastError = e;
        }
    }

    throw new Error(mapYtdlpError(lastError?.stderr || lastError?.message, isTiktok, isYoutube), { cause: lastError });
}

// ── Téléchargement vidéo commun ────────────────────────────────
async function downloadVideo({ sock, from, text, msg }) {
    const check = validateDownloadUrl(text);
    if (!check.ok) return sock.sendMessage(from, { text: check.msg });
    text = check.url;

    const filePath = path.join(DOWNLOAD_DIR, `video_${Date.now()}.mp4`);

    try {
        await sock.sendMessage(from, { text: '⬇️ Téléchargement en cours...' }, { quoted: msg });

        const result = await runYtdlp(text, false, filePath);

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
            mimetype: result?.mimetype || 'video/mp4',
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
            const check = validatePlayInput(text);
            if (!check.ok) return sock.sendMessage(from, { text: check.msg });
            text = check.text;

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

                const result = await runYtdlp(url, true, filePath);

                if (!fs.existsSync(filePath)) {
                    return sock.sendMessage(from, { text: '❌ Erreur de conversion.' });
                }

                const size = fs.statSync(filePath).size;
                if (size > MAX_SIZE_BYTES) {
                    cleanup(filePath);
                    return sock.sendMessage(from, { text: `❌ Fichier audio trop lourd (${Math.round(size / 1024 / 1024)} Mo).` });
                }

                const ext = result?.ext || 'mp3';
                await sock.sendMessage(from, {
                    audio: fs.readFileSync(filePath),
                    mimetype: result?.mimetype || 'audio/mpeg',
                    fileName: `${title}.${ext}`,
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
            const check = validatePlayInput(text);
            if (!check.ok) return sock.sendMessage(from, { text: check.msg });
            if (check.text.startsWith('http')) return downloadVideo({ sock, from, text: check.text, msg });
            return cmds.play.execute({ sock, from, text: check.text, msg });
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