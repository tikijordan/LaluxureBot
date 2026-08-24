/**
 * @file        menu.js
 * @description Menu d'aide — Liste de toutes les commandes disponibles
 * @license     MIT
 */

const MAX_WARNS = process.env.MAX_WARNS || '3';
const BOT_NAME  = process.env.BOT_NAME  || 'MonBot';

export default {

  menu: {
    description: 'Afficher le menu principal',
    execute: async ({ sock, from, prefix: P = '/' }) => {
      const menu = `╔══════════════════════════════╗
║   🤖 *${BOT_NAME}* — Menu Principal
╠══════════════════════════════╣

📌 *COMMANDES DE BASE*
${P}menu — Ce menu
${P}info — À propos du bot
${P}aide — Assistance

🎭 *DIVERTISSEMENT*
${P}blague — Blague aléatoire
${P}citation — Citation inspirante
${P}meteo [ville] — Météo
${P}news — Actualités
${P}quiz — Jeu de quiz
${P}8ball [question] — Boule magique
${P}rps [pierre/feuille/ciseaux] — Jeu contre le bot
${P}ship @m1 @m2 — Compatibilité amoureuse 💕
${P}roast @membre — Vanne IA amusante 🔥
${P}story [thème] — Histoire générée par IA 📖
${P}meme [texte haut] | [texte bas] — Créer mème
${P}randommeme — Mème aléatoire
${P}advice — Conseil de vie aléatoire ou sur un thème
${P}anime [titre] — Infos sur un anime ou manga
${P}color [hex ou nom] — Infos sur une couleur
${P}fact — Fait aléatoire insolite
${P}horoscope [signe] — Horoscope du jour
${P}tongue — Virelangue dans différentes langues
${P}rap [sujet] — Rap ou poème généré par IA
${P}poem [thème] — Poème généré par IA
${P}akinator — Jeu Akinator, l'IA devine ton personnage
${P}battle @m1 @m2 — Duel aléatoire entre deux membres
${P}hangman — Jeu du Pendu
${P}math — Défi de calcul mental rapide
${P}rpg — Mini RPG textuel généré par IA
${P}scramble — Reconstituer un mot mélangé
${P}trivia — Quiz multijoueur dans le groupe
${P}wordle — Devine le mot en 6 essais

📷 *MÉDIAS & IMAGES*
${P}imagine [style?] [texte] — Génération image IA avancée
${P}imagine styles — Voir les styles disponibles
${P}sticker (alias ${P}s) — Créer sticker
${P}vo (alias ${P}jolie) — Extraire vue unique
${P}pp [@quelqu'un] — Photo de profil
${P}avatar [nom] — Générer un avatar unique basé sur un nom
${P}caption [texte] — Ajouter un texte stylisé sur une image
${P}collage — Créer un collage (envoie 2-4 images)
${P}gif [terme] — Envoyer un GIF animé
${P}removebg — Supprimer le fond d'une image

🎵 *MUSIQUE*
${P}play [titre ou lien] — Recherche YouTube + MP3
${P}ytmp3 [lien YouTube] — YouTube → MP3 direct

⬇️ *TÉLÉCHARGEMENTS*
${P}video [lien] — Vidéo MP4 (YT, IG, FB, TikTok…)
${P}ytmp4 [lien YouTube] — YouTube → MP4 direct
${P}tiktok [lien] — TikTok sans filigrane
${P}dl [lien ou titre] — Universel : lien→vidéo, texte→MP3

🤖 *IA & OUTILS*
${P}ia [question] — Intelligence artificielle
${P}translate [texte] — Traduire texte
${P}resume [lien] — Résumer article web
${P}chatbot — Mode conversation continue
${P}ocr — Extraire le texte d'une image
${P}debate [sujet] — Débat IA pour/contre sur un sujet

🔍 *RECHERCHE*
${P}wiki [sujet] — Résumé Wikipedia
${P}define [mot] — Définition + synonymes
${P}movie [titre] — Infos film
${P}crypto [coin] — Prix crypto en temps réel
${P}github [username] — Profil GitHub
${P}lyrics [chanson] — Trouver les paroles d'une chanson
${P}google [recherche] — Recherche web rapide

💻 *PROGRAMMATION*
${P}code [lang] [code] — Exécuter du code
${P}snippet save/get/del/share — Gérer snippets
${P}regex /pattern/flags [texte] — Tester une regex
${P}regextest [pattern] | [texte] — Tester une regex (syntaxe alternative)
${P}codeai [question] — IA spécialisée en programmation
${P}runcode [lang] [code] — Exécuter du code en ligne
${P}base64 encode/decode [texte] — Encoder/décoder en Base64
${P}hash [texte] — Générer un hash MD5/SHA1/SHA256
${P}ipinfo [ip] — Infos sur une adresse IP
${P}timestamp [date] — Convertir date ↔ timestamp
${P}uuid — Générer des UUID uniques

🛡️ *SÉCURITÉ*
${P}antispam — État anti-spam
${P}notag / ${P}yestag — Anti-tag on/off
${P}botmode — Accès owner-only (toi seul)
${P}private — Confirmer le mode owner-only
${P}public — Info (bot toujours owner-only)

💢 *SPAM (Admin)*
${P}spam [num] [msg] [n] — Envoyer spam
${P}stopspam — Arrêter le spam

👥 *GROUPE*
${P}tagall [msg] — Taguer tout le monde
${P}everyone [msg] — Alias de tagall
${P}tagadmins — Taguer les admins
${P}groupinfo — Infos du groupe

🛠️ *ADMIN — MEMBRES*
${P}kick @membre — Expulser
${P}kickall — Expulser tous les non-admins
${P}add [numéro] — Ajouter un membre
${P}promote @membre — Promouvoir admin
${P}demote @membre — Rétrograder admin
${P}ban @membre — Bannir définitivement
${P}unbangroup [num] — Débannir
${P}banlist — Liste des bannis
${P}listmembers — Exporter la liste membres

⚙️ *ADMIN — PARAMÈTRES GROUPE*
${P}lock / ${P}unlock — Fermer/ouvrir le groupe
${P}setname [nom] — Changer le nom
${P}setdesc [texte] — Changer la description
${P}setico — Changer la photo du groupe
${P}getlink — Lien d'invitation
${P}revoke — Révoquer le lien
${P}backup — Sauvegarder infos + membres
${P}welcome [msg] — Message de bienvenue
${P}goodbye [msg] — Message d'au revoir

🚨 *ADMIN — MODÉRATION*
${P}warn @membre [raison] — Avertir (${MAX_WARNS} = kick)
${P}resetwarn @membre — Réinitialiser les warns
${P}listwarn — Membres avertis
${P}mute / ${P}unmute @membre — Sourdine
${P}antilink on/off — Bloquer les liens
${P}filter add/del/list [mot] — Mots interdits
${P}slowmode [sec] / off — Mode lent
${P}cleanbot [n] — Supprimer messages du bot
${P}tempkick @membre [min] — Expulsion temporaire
${P}vip add/del/list @membre — Statut VIP
${P}antifake on/off — Bloquer numéros suspects
${P}report @membre [raison] — Signaler à l'admin
${P}reports — Voir les signalements
${P}history @membre — Historique sanctions
${P}purge [n] — Supprimer N derniers messages
${P}clearhistory @membre — Effacer l'historique d'un membre
${P}clearreports — Effacer tous les signalements
${P}unban [numéro] — Débannir de la liste de sécurité (antifake/blacklist)
${P}aistatus — Statut des clés IA (Gemini)

📊 *SONDAGES & PLANIFICATION*
${P}poll [Question] | [Op1] | [Op2] — Sondage
${P}pollresult — Résultats en direct
${P}closepoll — Fermer le sondage
${P}broadcast [msg] — Message privé à tous
${P}schedule [30min/2h/14:30] [msg] — Programmer message

👤 *FICHES MEMBRES*
${P}memberinfo @membre — Fiche complète
${P}noted @membre [note] — Note privée
${P}birthday @membre JJ/MM — Enregistrer anniversaire
${P}birthday list — Voir les anniversaires

🌐 *ORGANISATION*
${P}rules — Afficher le règlement
${P}rules set [texte] — Définir le règlement
${P}announce [msg] — Annonce officielle
${P}autoreply add [mot] | [réponse] — Auto-réponse
${P}autoreply del/list/clear — Gérer auto-réponses
${P}groupstats — Statistiques d'activité

🎛️ *FILTRES MÉDIA*
${P}antiimage on/off — Bloquer images
${P}antivideo on/off — Bloquer vidéos
${P}antivoice on/off — Bloquer vocaux
${P}mediafilters — Voir les filtres actifs

🌙 *AUTOMATISATION*
${P}nightmode [22:00] [06:00] — Fermer groupe la nuit
${P}nightmode off — Désactiver
${P}warnspam on/off — Warn auto spammeurs

🔐 *SÉCURITÉ AVANCÉE*
${P}captcha on/off — Vérif anti-bot
${P}whitelist add/del/list @membre — Liste blanche
${P}maxmembers [n] / off — Limiter les membres
${P}floodprotect [n] [sec] / off — Anti-flood
${P}automod on/off — Modération automatique IA
${P}lockdown — Mode urgence (fermer + kick tout)
${P}lockdown off — Lever l'urgence
${P}grouplogs [n] — Journal admin
${P}autobackup [heures] — Backup automatique

🎮 *ENGAGEMENT*
${P}vote [question] — Vote oui/non
${P}leaderboard — Classement membres actifs
${P}challenge now — Défi immédiat
${P}challenge auto — Défi quotidien
${P}agenda — Événements à venir
${P}agenda add [JJ/MM/AAAA] [HH:MM] [titre] | [desc]

🛠️ *UTILITAIRES*
${P}qrcode [texte] — Générer QR code
${P}calc [expression] — Calculatrice
${P}reminder [min] [msg] — Rappel
${P}remind [texte] — Créer un rappel personnel
${P}note [texte] — Sauvegarder note
${P}notebook — Bloc-notes complet (titres, recherche)
${P}mynotes — Voir mes notes
${P}todo — Liste de tâches personnelle
${P}budget — Suivi de dépenses et budget personnel
${P}password [longueur] — Générer un mot de passe sécurisé
${P}pomodoro — Timer Pomodoro (travail + pause)
${P}stopwatch — Chronomètre
${P}shortlink [url] — Raccourcir un lien
${P}whois [domaine] — Infos WHOIS et DNS d'un domaine
${P}ytinfo [lien] — Infos détaillées sur une vidéo YouTube
${P}currency [montant] [de] [vers] — Convertisseur de devises
${P}tweet [texte] — Formater un texte en tweet stylisé avec stats

📊 *STATISTIQUES*
${P}stats — Mes statistiques

📞 *CONTACT*
${P}contact — Contacter l'équipe

╚══════════════════════════════╝
> Propulsé par Baileys 🔥`;

      await sock.sendMessage(from, { text: menu });
    },
  },

  info: {
    description: 'Informations sur le bot',
    execute: async ({ sock, from, owner }) => {
      const info = `🤖 *${BOT_NAME} — Informations*

📌 *Version:* 1.0.0
⚙️ *Framework:* @whiskeysockets/baileys
💻 *Langage:* Node.js ESM
🌐 *Runtime:* ${process.version}
📦 *Uptime:* ${Math.floor(process.uptime() / 60)} min
💾 *Mémoire:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB
👑 *Owner:* ${owner || 'Non défini'}

_Ce bot est conçu pour vous offrir divertissement, utilitaires et IA directement dans WhatsApp !_`;
      await sock.sendMessage(from, { text: info });
    },
  },

  aide: {
    description: 'Aide et assistance',
    execute: async ({ sock, from, prefix: P = '/' }) => {
      const aide = `🆘 *Aide & Assistance*

Pour utiliser le bot, commence toujours par le préfixe *${P}*

📖 *Exemples:*
• ${P}menu → affiche toutes les commandes
• ${P}ia Qui est Einstein? → pose une question
• ${P}meteo Paris → météo de Paris
• ${P}calc 5*9+2 → calcule une expression
• ${P}reminder 10 Réunion → rappel dans 10 min

❓ *Problème?*
Utilise *${P}contact* pour joindre l'équipe.

_Le bot répond uniquement aux commandes préfixées par ${P}_`;
      await sock.sendMessage(from, { text: aide });
    },
  },
};