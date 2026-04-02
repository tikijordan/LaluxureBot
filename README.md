# 🤖 LaLuxure Bot — Baileys

Bot WhatsApp complet développé avec `@whiskeysockets/baileys` (Node.js ES Modules).

---

## 📋 Prérequis

- **Node.js** v20+ 
- Compte WhatsApp actif
- Connexion Internet

---

## 🚀 Installation

```bash
# 1. Cloner / extraire le projet
cd LaluxureBot

# 2. Installer les dépendances
npm install

# 3. Configurer l'environnement
cp .env.example .env
nano .env  # ou ouvre avec un éditeur

# 4. Lancer le bot
npm start
```

Scanner le QR code qui apparaît dans le terminal avec WhatsApp.

---

## ⚙️ Configuration (.env)

| Variable | Description | Obligatoire |
|---|---|---|
| `PREFIX` | Préfixe des commandes (défaut: `!`) | Non |
| `OWNER_NUMBER` | Ton numéro (ex: 22890000000) | **Oui** |
| `BOT_NAME` | Nom affiché du bot | Non |
| `WEATHER_API_KEY` | [OpenWeatherMap](https://openweathermap.org/api) | Pour `!meteo` |
| `NEWS_API_KEY` | [NewsAPI.org](https://newsapi.org) | Pour `!news` |
| `OPENAI_API_KEY` | [OpenAI](https://platform.openai.com) | Pour `!ia` amélioré |

> **Note:** `!ia`, `!image`, `!translate` fonctionnent sans clé API (via services gratuits). Les clés permettent une meilleure qualité.

---

## 📦 Commandes disponibles

### 📌 Base
| Commande | Description |
|---|---|
| `menu` | Menu principal |
| `info` | Infos du bot |
| `aide` | Aide et exemples |

### 🎭 Divertissement
| Commande | Description |
|---|---|
| `blague` | Blague aléatoire |
| `citation` | Citation inspirante |
| `meteo [ville]` | Météo en temps réel |
| `news [sujet]` | Actualités |
| `meme` | Mème aléatoire |
| `quiz` | Question de quiz |
| `8ball [question]` | Boule magique |

### 📷 Médias
| Commande | Description |
|---|---|
| `sticker` | Convertir image → sticker |
| `vo` ou `viewonce` | Extraire un message vue unique |
| `pp [@mention]` | Photo de profil |
| `image [texte]` | Générer une image IA |

### 🎵 Musique & Vidéo
| Commande | Description |
|---|---|
| `play [titre]` | Rechercher & télécharger musique |
| `ytmp3 [lien]` | YouTube → MP3 |
| `video [titre/lien]` | Télécharger vidéo YouTube |
| `dl [lien]` | Télécharger depuis n'importe quel site |
| `tiktok [lien]` | TikTok sans filigrane |
| `ig [lien]` | Instagram Reels/Photos |

### 🤖 IA
| Commande | Description |
|---|---|
| `ia [question]` | Réponse IA (GPT ou Pollinations) |
| `translate [lang] [texte]` | Traduction (MyMemory API) |
| `resume [lien]` | Résumé d'article web |

### 🛡️ Sécurité
| Commande | Description |
|---|---|
| `antispam` | État de l'anti-spam |
| `unban [numéro]` | Débannir (admin) |
| `notag` | Activer protection anti-tag |
| `yestag` | Désactiver protection anti-tag |

### 💢 Spam (Admin)
| Commande | Description |
|---|---|
| `spam [num] [msg] [n]` | Envoyer n messages |
| `stopspam` | Arrêter le spam |

### 👥 Groupe
| Commande | Description |
|---|---|
| `tagall [message]` | Mentionner tout le monde |
| `everyone` | Alias tagall |
| `tagadmins` | Mentionner les admins |
| `groupinfo` | Infos du groupe |

### 🛠️ Utilitaires
| Commande | Description |
|---|---|
| `qrcode [texte]` | Générer QR Code |
| `calc [expression]` | Calculatrice (supporte sin, sqrt, etc.) |
| `reminder [min] [msg]` | Rappel temporisé |
| `note [texte]` | Sauvegarder une note |
| `mynotes` | Voir ses notes |
| `stats` | Statistiques d'utilisation |
| `contact` | Contacter l'owner |

---

## 🗂️ Structure du projet

```
Laluxure Bot/
├── src/
│   ├── index.js          # Point d'entrée, connexion Baileys
│   ├── handler.js        # Traitement des messages
│   ├── loader.js         # Chargement dynamique des commandes
│   ├── utils/
│   │   ├── antispam.js   # Système anti-spam
│   │   ├── notes.js      # Gestion des notes
│   │   └── stats.js      # Statistiques
│   └── commands/
│       ├── menu.js       # menu, info, aide
│       ├── divertissement.js  # blague, citation, meme, quiz, 8ball
│       ├── infos.js      # meteo, news
│       ├── media.js      # sticker, viewonce, pp, image
│       ├── downloads.js  # play, ytmp3, video, dl, tiktok, ig
│       ├── ai.js         # ia, translate, resume
│       ├── security.js   # antispam, unban, notag, yestag
│       ├── spam.js       # spam, stopspam
│       ├── group.js      # tagall, tagadmins, groupinfo
│       └── utils.js      # qrcode, calc, reminder, note, stats, contact
├── data/                 # Données persistantes (auto-créé)
├── auth_info/            # Session WhatsApp (auto-créé)
├── .env                  # Configuration
├── package.json
└── README.md
```

---

## ➕ Ajouter une commande

Crée un fichier dans `src/commands/macommande.js` :

```js
export default {
  macommande: {
    description: 'Description de ma commande',
    adminOnly: false, // true = owner seulement
    execute: async ({ sock, from, text, args, isGroup, sender }) => {
      await sock.sendMessage(from, { text: `Tu as dit: ${text}` });
    },
  },
};
```

Le bot la chargera **automatiquement** au prochain démarrage. Pas besoin de modifier handler.js !

---

## 🔧 Débogage

```bash
# Réinitialiser la session (se déconnecter)
rm -rf auth_info/

# Voir les logs en détail
DEBUG=* npm start

# Mode développement (redémarrage auto)
npm run dev
```

---

## 📜 Licence

Usage personnel et éducatif uniquement. Respecte les CGU de WhatsApp.
