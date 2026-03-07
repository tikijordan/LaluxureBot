/**
 * @file telegram-controller.js
 * Processus indépendant — Contrôleur Telegram
 * Lance avec : pm2 start telegram-controller.js --name "tg-controller"
 */

import TelegramBot from 'node-telegram-bot-api';
import { execSync, exec } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();

const token  = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
    console.error('❌ TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID manquant dans .env');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

function isOwner(msg) {
    return String(msg.chat.id) === String(chatId);
}

function pm2(cmd) {
    return new Promise((resolve, reject) => {
        exec(`pm2 ${cmd}`, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}

bot.onText(/\/start|\/help/, async (msg) => {
    if (!isOwner(msg)) return;
    await bot.sendMessage(chatId,
        '🤖 *Contrôleur Bot WhatsApp*\n\n' +
        '▶️ /on — Démarrer le bot\n' +
        '⏹️ /off — Arrêter le bot\n' +
        '🔄 /restart — Redémarrer le bot\n' +
        '📊 /status — État du bot\n' +
        '📈 /stats — Statistiques',
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/on/, async (msg) => {
    if (!isOwner(msg)) return;
    try {
        await pm2('start whatsapp-bot');
        await bot.sendMessage(chatId,
            '▶️ *Bot WhatsApp démarré !*\n_Il sera actif dans quelques secondes._',
            { parse_mode: 'Markdown' }
        );
    } catch {
        // Essai restart si déjà existant
        try {
            await pm2('restart whatsapp-bot');
            await bot.sendMessage(chatId, '🔄 *Bot WhatsApp redémarré !*', { parse_mode: 'Markdown' });
        } catch (e) {
            await bot.sendMessage(chatId, '❌ Erreur : ' + e.message);
        }
    }
});

bot.onText(/\/off/, async (msg) => {
    if (!isOwner(msg)) return;
    try {
        await pm2('stop whatsapp-bot');
        await bot.sendMessage(chatId,
            '⏹️ *Bot WhatsApp arrêté.*\n_Utilise /on pour le redémarrer._',
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        await bot.sendMessage(chatId, '❌ Erreur : ' + e.message);
    }
});

bot.onText(/\/restart/, async (msg) => {
    if (!isOwner(msg)) return;
    try {
        await pm2('restart whatsapp-bot');
        await bot.sendMessage(chatId,
            '🔄 *Bot WhatsApp redémarré !*\n_Il sera actif dans quelques secondes._',
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        await bot.sendMessage(chatId, '❌ Erreur : ' + e.message);
    }
});

bot.onText(/\/status/, async (msg) => {
    if (!isOwner(msg)) return;
    try {
        const out = execSync('pm2 jlist').toString();
        const list = JSON.parse(out);
        const wa = list.find(p => p.name === 'whatsapp-bot');
        if (!wa) {
            await bot.sendMessage(chatId, '❓ Bot WhatsApp non trouvé dans PM2.');
            return;
        }
        const status = wa.pm2_env.status;
        const uptime = wa.pm2_env.pm_uptime
            ? Math.floor((Date.now() - wa.pm2_env.pm_uptime) / 60000) + ' min'
            : 'N/A';
        const restarts = wa.pm2_env.restart_time || 0;
        const icon = status === 'online' ? '🟢' : '🔴';

        await bot.sendMessage(chatId,
            `*📊 Statut Bot WhatsApp*\n\n` +
            `${icon} *État* : ${status}\n` +
            `⏱️ *Uptime* : ${uptime}\n` +
            `🔁 *Redémarrages* : ${restarts}`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        await bot.sendMessage(chatId, '❌ Erreur status : ' + e.message);
    }
});

bot.onText(/\/stats/, async (msg) => {
    if (!isOwner(msg)) return;
    try {
        const fs = await import('fs-extra');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
        const statsDir = path.default.join(__dirname, 'data/stats');

        if (!fs.default.existsSync(statsDir)) {
            await bot.sendMessage(chatId, '_Aucune statistique disponible._', { parse_mode: 'Markdown' });
            return;
        }

        const files = fs.default.readdirSync(statsDir).filter(f => f.endsWith('.json'));
        let total = 0;
        const cmdCount = {};
        for (const file of files) {
            const data = JSON.parse(fs.default.readFileSync(path.default.join(statsDir, file), 'utf8'));
            for (const [cmd, count] of Object.entries(data)) {
                cmdCount[cmd] = (cmdCount[cmd] || 0) + count;
                total += count;
            }
        }
        const top = Object.entries(cmdCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
        let text = `*📈 Statistiques*\n\n📊 *Total* : ${total} commandes\n\n*🏆 Top 5 :*\n`;
        top.forEach(([cmd, count], i) => { text += `${i+1}. \`/${cmd}\` — ${count} fois\n`; });

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (e) {
        await bot.sendMessage(chatId, '❌ Erreur stats : ' + e.message);
    }
});

console.log('🤖 Contrôleur Telegram démarré. En attente de commandes...');
await bot.sendMessage(chatId, '🟢 *Contrôleur Telegram démarré et prêt !*', { parse_mode: 'Markdown' }).catch(() => {});