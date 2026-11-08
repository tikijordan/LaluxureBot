/**
 * ============================================================
 * @file        convert.js
 * @description !convert — conversions de médias
 *                • vidéo  → audio (mp3)
 *                • texte  → audio (message vocal)
 *                • audio  → texte (transcription)
 * @usage       Cite (reply) le message à convertir, puis !convert
 *              Texte → audio sans citer : !convert Bonjour tout le monde
 *              Autre langue pour la voix : !convert -en Hello everyone
 * @needs       ffmpeg (vidéo→audio et note vocale). Clés GEMINI_API_KEY_x
 *              (audio→texte). Voix : Google Translate TTS (sans clé).
 * ============================================================
 */

import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { downloadContentFromMessage, getContentType } from '@whiskeysockets/baileys';
import { extractGeminiText } from './ai.js';

const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 Mo
const MAX_AUDIO_STT_BYTES = 15 * 1024 * 1024; // limite requête inline Gemini
const MAX_TTS_CHARS = 1500;
const DEFAULT_LANG = process.env.CONVERT_LANG || 'fr';
const TTS_LANGS = new Set(['fr', 'en', 'es', 'de', 'it', 'pt', 'ar', 'sw', 'hi', 'ja', 'ko', 'zh-cn', 'ru', 'tr', 'nl']);

// ── Utilitaires ──────────────────────────────────────────────

/** Retire les enveloppes (éphémère, vue unique, document+légende). */
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner = m.ephemeralMessage?.message
      || m.viewOnceMessage?.message
      || m.viewOnceMessageV2?.message
      || m.viewOnceMessageV2Extension?.message
      || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

/** Message cible : le message cité, sinon le message de la commande (ex. vidéo + légende !convert). */
function getTarget(msg) {
  const own = unwrap(msg.message);
  const ctxInfo = own?.extendedTextMessage?.contextInfo
    || own?.videoMessage?.contextInfo
    || own?.audioMessage?.contextInfo
    || own?.imageMessage?.contextInfo;
  const quoted = unwrap(ctxInfo?.quotedMessage);
  return quoted || own;
}

function getText(m) {
  if (!m) return '';
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || '';
}

async function download(mediaMsg, type) {
  const stream = await downloadContentFromMessage(mediaMsg, type);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

let _ffmpegBin = null;
async function getFfmpeg() {
  if (_ffmpegBin) return _ffmpegBin;
  try {
    const mod = await import('ffmpeg-static'); // optionnel : npm i ffmpeg-static
    if (mod?.default) { _ffmpegBin = mod.default; return _ffmpegBin; }
  } catch { /* pas installé : on utilise ffmpeg du système */ }
  _ffmpegBin = 'ffmpeg';
  return _ffmpegBin;
}

async function runFfmpeg(args) {
  const bin = await getFfmpeg();
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (err, _so, se) => {
      if (!err) return resolve();
      if (err.code === 'ENOENT') return reject(new Error('FFMPEG_MISSING'));
      reject(new Error(String(se || err.message).slice(-200)));
    });
  });
}

function tmpFile(ext) {
  return path.join(os.tmpdir(), `convert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

function cleanup(...files) {
  for (const f of files) { try { fs.unlinkSync(f); } catch { /* déjà supprimé */ } }
}

// ── Vidéo → audio ────────────────────────────────────────────

async function videoToAudio(sock, from, msg, videoMsg) {
  const size = Number(videoMsg.fileLength || 0);
  if (size > MAX_VIDEO_BYTES) {
    return sock.sendMessage(from, { text: '❌ Vidéo trop lourde (max 100 Mo).' }, { quoted: msg });
  }
  const input = tmpFile('mp4');
  const output = tmpFile('mp3');
  try {
    fs.writeFileSync(input, await download(videoMsg, 'video'));
    await runFfmpeg(['-y', '-i', input, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', output]);
    const buf = fs.readFileSync(output);
    if (!buf.length) throw new Error('Aucune piste audio dans cette vidéo.');
    await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
  } finally {
    cleanup(input, output);
  }
}

// ── Texte → audio ────────────────────────────────────────────

/** Découpe en morceaux ≤ 180 caractères (limite de l'API TTS), en coupant sur la ponctuation/les espaces. */
function chunkText(text, max = 180) {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?;:\n]+[.!?;:]?/g) || [text];
  const chunks = [];
  let cur = '';
  const push = (s) => { if (s.trim()) chunks.push(s.trim()); };
  for (const sRaw of sentences) {
    let s = sRaw.trim();
    while (s.length > max) {
      let cut = s.lastIndexOf(' ', max);
      if (cut < max * 0.5) cut = max;
      if (cur) { push(cur); cur = ''; }
      push(s.slice(0, cut));
      s = s.slice(cut).trim();
    }
    if ((cur + ' ' + s).trim().length > max) { push(cur); cur = s; }
    else cur = (cur + ' ' + s).trim();
  }
  push(cur);
  return chunks;
}

async function ttsMp3(text, lang) {
  const parts = [];
  for (const chunk of chunkText(text)) {
    const res = await axios.get('https://translate.google.com/translate_tts', {
      params: { ie: 'UTF-8', q: chunk, tl: lang, client: 'tw-ob' },
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
    });
    parts.push(Buffer.from(res.data));
  }
  return Buffer.concat(parts); // les trames MP3 se concatènent telles quelles
}

async function textToAudio(sock, from, msg, text, lang) {
  if (text.length > MAX_TTS_CHARS) text = text.slice(0, MAX_TTS_CHARS);
  const mp3 = await ttsMp3(text, lang);
  if (!mp3.length) throw new Error('Synthèse vocale vide.');

  // Idéal : vraie note vocale (ogg/opus). Sans ffmpeg : on envoie le mp3 en fichier audio.
  const inFile = tmpFile('mp3');
  const outFile = tmpFile('ogg');
  try {
    fs.writeFileSync(inFile, mp3);
    await runFfmpeg(['-y', '-i', inFile, '-c:a', 'libopus', '-b:a', '48k', '-ac', '1', '-ar', '48000', outFile]);
    await sock.sendMessage(from, {
      audio: fs.readFileSync(outFile),
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    }, { quoted: msg });
  } catch (e) {
    if (e.message !== 'FFMPEG_MISSING') console.error('[convert] opus:', e.message);
    await sock.sendMessage(from, { audio: mp3, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
  } finally {
    cleanup(inFile, outFile);
  }
}

// ── Audio → texte ────────────────────────────────────────────

async function audioToText(audioMsg) {
  const size = Number(audioMsg.fileLength || 0);
  if (size > MAX_AUDIO_STT_BYTES) throw new Error('Audio trop long (max ~15 Mo).');
  const buf = await download(audioMsg, 'audio');
  if (buf.length > MAX_AUDIO_STT_BYTES) throw new Error('Audio trop long (max ~15 Mo).');

  const mimeType = (audioMsg.mimetype || 'audio/ogg').split(';')[0].trim();
  const keys = [1, 2, 3, 4, 5].map(i => process.env[`GEMINI_API_KEY_${i}`]).filter(Boolean);
  if (!keys.length) throw new Error('Aucune clé GEMINI_API_KEY configurée.');

  let lastErr = null;
  for (const key of keys) {
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`,
        {
          contents: [{
            parts: [
              { text: 'Transcris fidèlement cet audio, mot pour mot, dans sa langue d\'origine. Réponds uniquement avec la transcription, sans commentaire.' },
              { inlineData: { mimeType, data: buf.toString('base64') } },
            ],
          }],
        },
        { timeout: 60000 },
      );
      const out = extractGeminiText(res.data);
      if (out) return out;
      lastErr = new Error('Transcription vide (audio muet ou illisible).');
    } catch (e) {
      lastErr = e;
      const st = e.response?.status;
      if (![400, 403, 429, 500, 503].includes(st)) break; // erreur non liée à la clé
    }
  }
  throw lastErr || new Error('Transcription impossible.');
}

// ── Commande ─────────────────────────────────────────────────

const USAGE = `🔄 *!convert*

• Cite une *vidéo* → audio (mp3)
• Cite un *message texte* → message vocal
• Cite un *audio / vocal* → texte

Sans citer : \`!convert ton texte\` → vocal
Autre langue : \`!convert -en Hello everyone\`
_Langues : ${[...TTS_LANGS].join(', ')}_`;

const convert = {
  description: 'Convertir : vidéo→audio, texte→audio, audio→texte',
  execute: async ({ sock, from, msg, args }) => {
    // Option de langue : -en, -es, ...
    let lang = DEFAULT_LANG;
    let words = [...args];
    const flag = words[0]?.match(/^-([a-z]{2}(?:-[a-z]{2})?)$/i);
    if (flag && TTS_LANGS.has(flag[1].toLowerCase())) {
      lang = flag[1].toLowerCase();
      words = words.slice(1);
    }
    const typed = words.join(' ').trim();

    const target = getTarget(msg);
    const type = target ? getContentType(target) : null;

    const reply = (text) => sock.sendMessage(from, { text }, { quoted: msg });
    const busy = () => sock.sendPresenceUpdate('composing', from).catch(() => {});
    const idle = () => sock.sendPresenceUpdate('paused', from).catch(() => {});

    try {
      // 1) Vidéo → audio
      if (type === 'videoMessage') {
        busy();
        await videoToAudio(sock, from, msg, target.videoMessage);
        return;
      }

      // 2) Audio → texte
      if (type === 'audioMessage') {
        busy();
        const text = await audioToText(target.audioMessage);
        await reply(`📝 *Transcription*\n\n${text}`);
        return;
      }

      // 3) Texte → audio (texte cité, sinon texte tapé après la commande)
      const quotedText = type && type !== 'videoMessage' && type !== 'audioMessage' ? getText(target) : '';
      const isOwnCommandTarget = target === unwrap(msg.message); // pas de citation
      const source = typed || (!isOwnCommandTarget ? quotedText : '');
      if (source) {
        busy();
        await textToAudio(sock, from, msg, source, lang);
        return;
      }

      await reply(USAGE);
    } catch (e) {
      console.error('[convert]', e.message);
      let message;
      if (e.message === 'FFMPEG_MISSING') {
        message = '❌ ffmpeg est introuvable sur ce serveur. Installe-le (ou `npm i ffmpeg-static`) pour convertir les vidéos.';
      } else if (/Aucune piste audio/.test(e.message)) {
        message = '❌ Cette vidéo ne contient pas de piste audio.';
      } else if (e.response?.status === 429) {
        message = '❌ Service temporairement saturé, réessaie dans un instant.';
      } else {
        message = `❌ Conversion impossible : ${e.message}`;
      }
      await reply(message).catch(() => {});
    } finally {
      idle();
    }
  },
};

export default {
  convert,
  converts: convert,
};