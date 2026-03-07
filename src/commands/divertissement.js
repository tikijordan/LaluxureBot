/**
 * ============================================================
 * @file        divertissement.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes de divertissement — Blagues, citations, devinettes
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES: blague, citation, meme, 8ball, quiz
// ============================================================

import axios from 'axios';

// Blagues locales de secours
const BLAGUES_FR = [
  'Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tomberaient dans le bateau ! 😂',
  'Un homme entre dans une bibliothèque et demande : "Avez-vous des livres sur la paranoïa ?" La bibliothécaire chuchote : "Ils sont derrière vous !"',
  'Comment appelle-t-on un chat tombé dans un pot de peinture le jour de Noël ? Un chat peint de Noël !',
  'Quelle est la différence entre un crocodile ? Plus il est vert !',
  'Comment appelle-t-on un canif ? Un petit fien ! 😂',
  'Pourquoi les canards ont-ils toujours des plumes ? Pour couvrir leur derrière ! 🦆',
  'Qu\'est-ce qu\'un crocodile qui surveille des bâtiments ? Un vigile reptile !',
  'Comment appelle-t-on un boomerang qui ne revient pas ? Un bâton !',
];

const CITATIONS = [
  '"La vie, c\'est ce qui arrive pendant qu\'on fait d\'autres projets." — John Lennon',
  '"Le succès c\'est tomber sept fois et se relever huit." — Proverbe japonais',
  '"Il n\'y a pas de vent favorable pour celui qui ne sait pas où il va." — Sénèque',
  '"Sois le changement que tu veux voir dans le monde." — Gandhi',
  '"L\'imagination est plus importante que la connaissance." — Albert Einstein',
  '"La seule façon de faire du bon travail est d\'aimer ce que vous faites." — Steve Jobs',
  '"Celui qui déplace des montagnes commence par déplacer de petites pierres." — Confucius',
  '"Chaque jour est une nouvelle chance de changer ta vie." — Anonyme',
];

const REPONSES_8BALL = [
  '🟢 Oui, absolument !',
  '🟢 C\'est certain.',
  '🟢 Sans aucun doute.',
  '🟢 Les signes indiquent oui.',
  '🟡 C\'est probable.',
  '🟡 Les perspectives sont bonnes.',
  '🟡 Réessaie plus tard.',
  '🟡 C\'est difficile à dire maintenant.',
  '🔴 Ne compte pas là-dessus.',
  '🔴 Ma réponse est non.',
  '🔴 Les perspectives ne sont pas bonnes.',
  '🔴 Très douteux.',
];

const QUIZ_QUESTIONS = [
  { q: 'Quelle est la capitale de la France ?', r: 'Paris', choices: ['Lyon', 'Paris', 'Marseille', 'Bordeaux'] },
  { q: 'Combien font 7 x 8 ?', r: '56', choices: ['48', '54', '56', '64'] },
  { q: 'Quel est le plus grand océan du monde ?', r: 'Pacifique', choices: ['Atlantique', 'Indien', 'Arctique', 'Pacifique'] },
  { q: 'En quelle année l\'homme a-t-il marché sur la Lune ?', r: '1969', choices: ['1965', '1969', '1972', '1975'] },
  { q: 'Quelle planète est la plus proche du Soleil ?', r: 'Mercure', choices: ['Vénus', 'Mars', 'Mercure', 'Terre'] },
  { q: 'Combien y a-t-il d\'os dans le corps humain adulte ?', r: '206', choices: ['186', '196', '206', '216'] },
];

export default {
  blague: {
    description: 'Blague aléatoire',
    execute: async ({ sock, from }) => {
      try {
        // Tenter API externe
        const res = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 4000 });
        await sock.sendMessage(from, {
          text: `😂 *Blague du jour*\n\n${res.data.setup}\n\n...${res.data.punchline}`,
        });
      } catch {
        const blague = BLAGUES_FR[Math.floor(Math.random() * BLAGUES_FR.length)];
        await sock.sendMessage(from, { text: `😂 *Blague du jour*\n\n${blague}` });
      }
    },
  },

  citation: {
    description: 'Citation inspirante',
    execute: async ({ sock, from }) => {
      const cit = CITATIONS[Math.floor(Math.random() * CITATIONS.length)];
      await sock.sendMessage(from, { text: `✨ *Citation du jour*\n\n${cit}` });
    },
  },

  meme: {
    description: 'Mème aléatoire',
    execute: async ({ sock, from }) => {
      try {
        const res = await axios.get('https://meme-api.com/gimme', { timeout: 6000 });
        const meme = res.data;
        await sock.sendMessage(from, {
          image: { url: meme.url },
          caption: `😂 *${meme.title}*\n👍 ${meme.ups} | r/${meme.subreddit}`,
        });
      } catch {
        await sock.sendMessage(from, { text: '😅 Impossible de récupérer un mème pour le moment. Réessaie !' });
      }
    },
  },

  '8ball': {
    description: 'Boule magique 8',
    execute: async ({ sock, from, text }) => {
      if (!text) {
        await sock.sendMessage(from, { text: `🎱 Usage: !8ball [ta question]` });
        return;
      }
      const rep = REPONSES_8BALL[Math.floor(Math.random() * REPONSES_8BALL.length)];
      await sock.sendMessage(from, {
        text: `🎱 *Boule Magique*\n\n❓ *Question:* ${text}\n\n🔮 *Réponse:* ${rep}`,
      });
    },
  },

  quiz: {
    description: 'Jeu de quiz',
    execute: async ({ sock, from }) => {
      const q = QUIZ_QUESTIONS[Math.floor(Math.random() * QUIZ_QUESTIONS.length)];
      const shuffled = q.choices.sort(() => Math.random() - 0.5);
      const letters = ['A', 'B', 'C', 'D'];
      const choicesText = shuffled.map((c, i) => `${letters[i]}) ${c}`).join('\n');
      const correctLetter = letters[shuffled.indexOf(q.r)];

      await sock.sendMessage(from, {
        text: `🧠 *Quiz Time!*\n\n❓ ${q.q}\n\n${choicesText}\n\n_Réponds avec la lettre (A, B, C ou D)_\n\n||La réponse est: ${correctLetter}) ${q.r}||`,
      });
    },
  },
};
