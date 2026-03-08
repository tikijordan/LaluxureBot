/**
 * ============================================================
 * @file        menu.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Menu d'aide — Liste de toutes les commandes disponibles
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES: menu, info, aide
// ============================================================

const PREFIX = process.env.PREFIX || '!';
const MAX_WARNS = process.env.MAX_WARNS || '3';
const BOT_NAME = process.env.BOT_NAME || 'MonBot';

export default {
  menu: {
    description: 'Afficher le menu principal',
    execute: async ({ sock, from }) => {
      const menu = `╔══════════════════════════════╗
║   🤖 *${BOT_NAME}* — Menu Principal   
╠══════════════════════════════╣

📌 *COMMANDES DE BASE*
${PREFIX}menu — Ce menu
${PREFIX}info — À propos du bot
${PREFIX}aide — Assistance

🎭 *DIVERTISSEMENT*
${PREFIX}blague — Blague aléatoire
${PREFIX}citation — Citation inspirante
${PREFIX}meteo [ville] — Météo
${PREFIX}news — Actualités
${PREFIX}quiz — Jeu de quiz
${PREFIX}8ball [question] — Boule magique
${PREFIX}rps [pierre/feuille/ciseaux] — Jeu contre le bot
${PREFIX}ship @m1 @m2 — Compatibilité amoureuse 💕
${PREFIX}roast @membre — Vanne IA amusante 🔥
${PREFIX}story [thème] — Histoire générée par IA 📖
${PREFIX}meme [texte haut] | [texte bas] — Créer mème

📷 *MÉDIAS & IMAGES*
${PREFIX}imagine [style?] [texte] — Génération image IA avancée
${PREFIX}imagine styles — Voir les styles disponibles
${PREFIX}sticker — Créer sticker
${PREFIX}vo — Extraire vue unique
${PREFIX}pp [@ quelqu'un] — Photo de profil
${PREFIX}meme [texte haut] | [texte bas] — Créer mème

🎵 *MUSIQUE*
${PREFIX}play [titre] — Télécharger musique
${PREFIX}ytmp3 [lien] — YouTube → MP3

⬇️ *TÉLÉCHARGEMENTS*
${PREFIX}video [titre] — Télécharger vidéo YT
${PREFIX}dl [lien] — Télécharger n'importe quoi
${PREFIX}tiktok [lien] — TikTok Download
${PREFIX}ig [lien] — Instagram Download

🤖 *IA & OUTILS*
${PREFIX}ia [question] — Intelligence artificielle (Gemini/Groq)
${PREFIX}translate [texte] — Traduire texte
${PREFIX}resume [lien] — Résumer article web
${PREFIX}story [thème] — Histoire générée par IA

🔍 *RECHERCHE*
${PREFIX}wiki [sujet] — Résumé Wikipedia avec image
${PREFIX}define [mot] — Définition + synonymes
${PREFIX}movie [titre] — Infos film (note, synopsis, casting)
${PREFIX}crypto [coin] — Prix crypto en temps réel
${PREFIX}github [username] — Profil GitHub + top repos

💻 *PROGRAMMATION*
${PREFIX}code [lang] [code] — Exécuter du code (20+ langages)
${PREFIX}snippet save/get/del/share — Gérer snippets de code
${PREFIX}regex /pattern/flags [texte] — Tester une regex

🛡️ *SÉCURITÉ*
${PREFIX}antispam — État anti-spam
${PREFIX}unban [numéro] — Débannir (admin)
${PREFIX}notag — Activer anti-tag
${PREFIX}yestag — Désactiver anti-tag
${PREFIX}botmode — Voir le mode actuel
${PREFIX}private — 🔴 Réserver le bot à l'admin
${PREFIX}public — 🟢 Ouvrir le bot à tous

💢 *SPAM (Admin seulement)*
${PREFIX}spam [num] [msg] [n] — Spam
${PREFIX}stopspam — Arrêter le spam

👥 *GROUPE*
${PREFIX}tagall [msg] — Taguer tout le monde
${PREFIX}tagadmins — Taguer les admins
${PREFIX}groupinfo — Infos du groupe

🛠️ *ADMIN GROUPE — MEMBRES*
${PREFIX}kick @membre — Expulser un membre
${PREFIX}kickall — Expulser tous les non-admins
${PREFIX}add [numéro] — Ajouter un membre
${PREFIX}promote @membre — Promouvoir en admin
${PREFIX}demote @membre — Rétrograder un admin
${PREFIX}ban @membre — Bannir définitivement
${PREFIX}unbangroup [num] — Débannir
${PREFIX}banlist — Liste des bannis
${PREFIX}listmembers — Exporter la liste membres

⚙️ *ADMIN GROUPE — PARAMÈTRES*
${PREFIX}lock / ${PREFIX}unlock — Fermer/ouvrir le groupe
${PREFIX}setname [nom] — Changer le nom
${PREFIX}setdesc [texte] — Changer la description
${PREFIX}setico — Changer la photo du groupe
${PREFIX}getlink — Obtenir le lien d'invitation
${PREFIX}revoke — Révoquer le lien d'invitation
${PREFIX}backup — Sauvegarder infos + membres
${PREFIX}welcome [msg] — Message de bienvenue auto
${PREFIX}goodbye [msg] — Message d'au revoir auto

🚨 *ADMIN GROUPE — MODÉRATION*
${PREFIX}warn @membre [raison] — Avertir (${MAX_WARNS} warns = kick)
${PREFIX}resetwarn @membre — Réinitialiser les warns
${PREFIX}listwarn — Voir les membres avertis
${PREFIX}mute @membre — Mettre en sourdine
${PREFIX}unmute @membre — Lever la sourdine
${PREFIX}antilink on/off — Bloquer les liens
${PREFIX}filter add/del/list [mot] — Mots interdits
${PREFIX}slowmode [sec] / off — Mode lent
${PREFIX}cleanbot [n] — Supprimer messages du bot
${PREFIX}tempkick @membre [min] — Expulser temporairement
${PREFIX}vip add/del/list @membre — Statut VIP (immunisé)
${PREFIX}antifake on/off — Bloquer numéros suspects
${PREFIX}report @membre [raison] — Signaler à l'admin
${PREFIX}reports — Voir les signalements (admin)
${PREFIX}history @membre — Historique des sanctions
${PREFIX}purge [n] — Supprimer N derniers messages

📊 *GROUPE — SONDAGES & PLANIFICATION*
${PREFIX}poll [Question] | [Op1] | [Op2] — Créer sondage
${PREFIX}pollresult — Résultats en direct
${PREFIX}closepoll — Fermer le sondage (admin)
${PREFIX}broadcast [msg] — Message privé à tous (admin)
${PREFIX}schedule [30min/2h/14:30] [msg] — Programmer message

👤 *MEMBRES — FICHES & SUIVI*
${PREFIX}memberinfo @membre — Fiche complète du membre
${PREFIX}noted @membre [note] — Note privée sur un membre
${PREFIX}birthday @membre JJ/MM — Enregistrer anniversaire
${PREFIX}birthday list — Voir tous les anniversaires

🌐 *GROUPE — ORGANISATION*
${PREFIX}rules — Afficher le règlement
${PREFIX}rules set [texte] — Définir le règlement (admin)
${PREFIX}announce [msg] — Annonce officielle formatée
${PREFIX}autoreply add [mot] | [réponse] — Auto-réponse
${PREFIX}autoreply del/list/clear — Gérer auto-réponses
${PREFIX}groupstats — Statistiques d'activité

🎛️ *FILTRES MÉDIA*
${PREFIX}antiimage on/off — Bloquer images
${PREFIX}antivideo on/off — Bloquer vidéos
${PREFIX}antivoice on/off — Bloquer vocaux
${PREFIX}mediafilters — Voir tous les filtres actifs

🌙 *AUTOMATISATION*
${PREFIX}nightmode [22:00] [06:00] — Fermer groupe la nuit
${PREFIX}nightmode off — Désactiver night mode
${PREFIX}warnspam on/off — Warn auto pour spammeurs

🔐 *SÉCURITÉ AVANCÉE*
${PREFIX}captcha on/off — Vérif anti-bot à l'entrée
${PREFIX}whitelist add/del/list @membre — Liste blanche
${PREFIX}maxmembers [n] / off — Limiter les membres
${PREFIX}floodprotect [n] [sec] / off — Anti-flood avancé
${PREFIX}automod on/off — Modération automatique IA
${PREFIX}lockdown — Mode urgence (fermer + kick tout)
${PREFIX}lockdown off — Lever l'urgence
${PREFIX}grouplogs [n] — Journal des actions admin
${PREFIX}autobackup [heures] — Backup automatique

🎮 *ENGAGEMENT*
${PREFIX}vote [question] — Vote oui/non rapide
${PREFIX}leaderboard — Classement membres actifs
${PREFIX}challenge now — Défi immédiat
${PREFIX}challenge auto — Défi quotidien automatique
${PREFIX}agenda — Voir les événements à venir
${PREFIX}agenda add [JJ/MM/AAAA] [HH:MM] [titre] | [desc]

🛠️ *UTILITAIRES*
${PREFIX}qrcode [texte] — Générer QR code
${PREFIX}calc [expression] — Calculatrice
${PREFIX}reminder [min] [msg] — Rappel
${PREFIX}note [texte] — Sauvegarder note
${PREFIX}mynotes — Voir mes notes

📊 *STATISTIQUES*
${PREFIX}stats — Mes statistiques

📞 *CONTACT*
${PREFIX}contact — Contacter l'équipe

╚══════════════════════════════╝
> Propulsé par Baileys 🔥`;

      try {
        await sock.sendMessage(from, { text: menu });
        console.log('✅ Menu envoyé à', from);
      } catch(e) {
        console.error('❌ Erreur envoi menu:', e.message, '| from=', from);
      }
    },
  },

  info: {
    description: 'Informations sur le bot',
    execute: async ({ sock, from }) => {
      const info = `🤖 *${BOT_NAME} — Informations*

📌 *Version:* 1.0.0
⚙️ *Framework:* @whiskeysockets/baileys
💻 *Langage:* Node.js ESM
🌐 *Runtime:* ${process.version}
📦 *Uptime:* ${Math.floor(process.uptime() / 60)} min
💾 *Mémoire:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB
👑 *Owner:* ${process.env.OWNER_NUMBER || 'Non défini'}

_Ce bot est conçu pour vous offrir divertissement, utilitaires et IA directement dans WhatsApp !_`;
      await sock.sendMessage(from, { text: info });
    },
  },

  aide: {
    description: 'Aide et assistance',
    execute: async ({ sock, from }) => {
      const aide = `🆘 *Aide & Assistance*

Pour utiliser le bot, commence toujours par le préfixe *${PREFIX}*

📖 *Exemples:*
• ${PREFIX}menu → affiche toutes les commandes
• ${PREFIX}ia Qui est Einstein? → pose une question
• ${PREFIX}meteo Paris → météo de Paris
• ${PREFIX}calc 5*9+2 → calcule une expression
• ${PREFIX}reminder 10 Réunion → rappel dans 10 min

❓ *Problème?*
Utilise *${PREFIX}contact* pour joindre l'équipe.

_Le bot répond uniquement aux commandes préfixées par ${PREFIX}_`;
      await sock.sendMessage(from, { text: aide });
    },
  },
};