import TelegramBot from 'node-telegram-bot-api';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_PATH = path.join(__dirname, '../auth_info');
const ZIP_PATH = path.join(__dirname, '../session.zip');

// On initialise le bot Telegram uniquement si les variables sont présentes
const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const bot = token ? new TelegramBot(token) : null;

/**
 * Télécharge la dernière session depuis Telegram
 */
export async function loadSessionFromTelegram() {
    if (!bot || !chatId) return console.log('⚠️ Telegram non configuré. Saut de la restauration.');

    try {
        console.log('📥 Tentative de récupération de la session depuis Telegram...');
        const updates = await bot.getUpdates({ limit: 100, offset: -100 });
        
        // On cherche le dernier document envoyé par vous/le bot dans ce chat
        const lastDoc = updates
            .reverse()
            .find(u => u.message?.document && String(u.message.chat.id) === String(chatId));

        if (!lastDoc) {
            console.log('❓ Aucune session trouvée sur Telegram. Un scan QR sera nécessaire.');
            return;
        }

        const fileId = lastDoc.message.document.file_id;
        const fileLink = await bot.getFileLink(fileId);
        
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        fs.writeFileSync(ZIP_PATH, response.data);

        const zip = new AdmZip(ZIP_PATH);
        fs.ensureDirSync(AUTH_PATH);
        zip.extractAllTo(AUTH_PATH, true);
        
        console.log('✅ Session WhatsApp restaurée avec succès depuis Telegram !');
        if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);
    } catch (error) {
        console.error('❌ Erreur lors de la restauration Telegram:', error.message);
    }
}

/**
 * Envoie une notification simple sur Telegram
 */
export async function notifyTelegram(message) {
    if (!bot || !chatId) return;
    try {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('❌ Erreur notification Telegram:', err.message);
    }
}

/**
 * Compresse et envoie la session actuelle vers Telegram
 */
export async function saveSessionToTelegram() {
    if (!bot || !chatId) return;

    try {
        const zip = new AdmZip();
        if (!fs.existsSync(AUTH_PATH)) return;

        zip.addLocalFolder(AUTH_PATH);
        zip.writeZip(ZIP_PATH);

        await bot.sendDocument(chatId, ZIP_PATH, {
            caption: `📦 Backup Session WhatsApp - ${new Date().toLocaleString()}`
        });
        
        console.log('✅ Backup de session envoyé sur Telegram.');
        if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);
    } catch (error) {
        console.error('❌ Erreur lors de l\'envoi vers Telegram:', error.message);
    }
}