// ============================================================
// DEBUG BOT MINIMAL — Pour diagnostiquer pourquoi le bot ne répond pas
// Lance avec: node debug-bot.js
// ============================================================

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  getContentType,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeterminal from 'qrcode-terminal';
import dotenv from 'dotenv';

dotenv.config();

const PREFIX = process.env.PREFIX || '/';

console.log('\n╔══════════════════════════════════════╗');
console.log('║        DEBUG BOT MINIMAL             ║');
console.log('╠══════════════════════════════════════╣');
console.log(`  PREFIX      : "${PREFIX}"`);
console.log(`  OWNER       : auto (défini après QR/pairing)`);
console.log('╚══════════════════════════════════════╝\n');

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Debug Bot', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log('\n📱 SCANNEZ CE QR CODE:\n');
      qrcodeterminal.generate(qr, { small: true });
    }
    if (connection === 'open') {
      const ownerNum = sock.user?.id?.split(':')[0] || '';
      console.log(`\n✅ CONNECTÉ en tant que: ${sock.user?.id}`);
      console.log(`   Owner auto: ${ownerNum}`);
      console.log(`   LID: ${sock.user?.lid || 'N/A'}`);
      console.log('\n💬 Envoie un message pour tester...\n');
    }
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconnexion...');
        start();
      }
    }
  });

  // ── ÉCOUTE TOUS LES MESSAGES SANS FILTRE ─────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`\n🔔 EVENT messages.upsert — type: "${type}" — ${messages.length} message(s)`);

    for (const msg of messages) {
      console.log('\n' + '═'.repeat(50));
      console.log(`📨 MESSAGE REÇU:`);
      console.log(`   from     : ${msg.key.remoteJid}`);
      console.log(`   fromMe   : ${msg.key.fromMe}`);
      console.log(`   sender   : ${msg.key.participant || 'N/A (privé)'}`);
      console.log(`   type evt : ${type}`);

      if (!msg.message) {
        console.log('   ⚠️  msg.message est NULL — message ignoré');
        continue;
      }

      const ct = getContentType(msg.message);
      console.log(`   contentType: ${ct}`);

      // Extraire le texte
      let body = '';
      if (ct === 'conversation') body = msg.message.conversation;
      else if (ct === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text;
      else body = `[media: ${ct}]`;

      console.log(`   body     : "${body}"`);
      console.log(`   fromMe   : ${msg.key.fromMe}`);

      // Détection préfixe
      const hasPrefix = body.startsWith(PREFIX);
      console.log(`   prefix "${PREFIX}": ${hasPrefix ? '✅ détecté' : '❌ absent'}`);

      if (type !== 'notify') {
        console.log(`   ⏭️  Ignoré car type="${type}" (pas "notify")`);
        continue;
      }

      if (msg.key.fromMe) {
        console.log(`   ⏭️  fromMe=true`);
        // On traite quand même pour le debug
      }

      if (!hasPrefix) {
        console.log(`   ⏭️  Pas de préfixe "${PREFIX}"`);
        continue;
      }

      // Répondre !
      const cmd = body.slice(PREFIX.length).trim().split(' ')[0];
      console.log(`\n   ✅ COMMANDE DÉTECTÉE: "${cmd}"`);

      try {
        await sock.sendMessage(msg.key.remoteJid, {
          text: `✅ Debug OK!\n\nCommande reçue: *${PREFIX}${cmd}*\nFromMe: ${msg.key.fromMe}\nTon numéro: ${msg.key.remoteJid}\n\nLe bot fonctionne correctement !`,
        });
        console.log('   ✅ Réponse envoyée !');
      } catch (err) {
        console.log(`   ❌ Erreur envoi: ${err.message}`);
      }
    }
  });
}

start().catch(console.error);
