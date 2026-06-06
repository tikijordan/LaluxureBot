/**
 * ============================================================
 * @file        games.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Jeux interactifs — Quiz, pendu, morpion
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES JEUX
// trivia multijoueur, wordle, akinator, battleship
// ============================================================
import axios from 'axios';

// ── État global des jeux ────────────────────────────────────
if (!global.triviaGames)     global.triviaGames     = new Map(); // groupId → game
if (!global.wordleGames)     global.wordleGames     = new Map(); // sender  → game
if (!global.akinatorGames)   global.akinatorGames   = new Map(); // sender  → game
if (!global.battleshipGames) global.battleshipGames = new Map(); // sender  → game

// ── Helpers ─────────────────────────────────────────────────
async function callAI(prompt) {
  const geminiKey = (process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_5);
  const groqKey   = (process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY_5);
  if (geminiKey) {
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiKey}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 400 } },
        { timeout: 15000 }
      );
      return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    } catch {}
  }
  if (groqKey) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.8 },
        { headers: { Authorization: `Bearer ${groqKey}` }, timeout: 15000 }
      );
      return res.data?.choices?.[0]?.message?.content?.trim();
    } catch {}
  }
  return null;
}

const WORDLE_WORDS = [
  'CHIEN','MAISON','SOLEIL','FLEUR','PLUIE','ARBRE','OCEAN','MONDE','BAGUE','LIVRE',
  'TABLE','CHAISE','PORTE','FENETRE','NUAGE','ETOILE','LUNE','FROID','CHAUD','VILLE',
  'PAIX','AMOUR','JOIE','RIRE','DANSE','MUSIC','SPORT','ECOLE','ELEVE','PROF',
];

const TRIVIA_FALLBACK = [
  { q: 'Quelle est la capitale de la France ?', a: 'Paris', opts: ['Londres','Paris','Berlin','Madrid'] },
  { q: 'Combien font 7 × 8 ?', a: '56', opts: ['48','54','56','63'] },
  { q: 'Quel est le plus grand océan ?', a: 'Pacifique', opts: ['Atlantique','Pacifique','Indien','Arctique'] },
  { q: 'En quelle année a eu lieu la Révolution française ?', a: '1789', opts: ['1776','1789','1804','1815'] },
  { q: 'Quel animal est le symbole de WhatsApp ?', a: 'Aucun', opts: ['Hibou','Chat','Baleine','Aucun'] },
  { q: 'Combien de continents y a-t-il sur Terre ?', a: '7', opts: ['5','6','7','8'] },
  { q: 'Quelle est la planète la plus proche du soleil ?', a: 'Mercure', opts: ['Vénus','Mercure','Mars','Terre'] },
  { q: 'Qui a inventé la téléphone ?', a: 'Alexander Graham Bell', opts: ['Edison','Bell','Tesla','Marconi'] },
];

export default {

  // ════════════════════════════════════════
  // TRIVIA — Quiz multijoueur
  // ════════════════════════════════════════
  trivia: {
    description: 'Quiz multijoueur dans le groupe',
    execute: async ({ sock, from, isGroup, args, sender }) => {
      const action = args[0]?.toLowerCase();

      if (action === 'stop') {
        global.triviaGames.delete(from);
        await sock.sendMessage(from, { text: '🎮 Trivia arrêté.' });
        return;
      }

      if (action === 'score') {
        const game = global.triviaGames.get(from);
        if (!game?.scores || Object.keys(game.scores).length === 0) {
          await sock.sendMessage(from, { text: '📊 Aucun score enregistré. Lance !trivia d\'abord.' });
          return;
        }
        const sorted = Object.entries(game.scores).sort((a,b) => b[1]-a[1]);
        let text = `🏆 *Scores Trivia*\n\n`;
        const medals = ['🥇','🥈','🥉'];
        sorted.forEach(([num, score], i) => { text += `${medals[i]||`${i+1}.`} ${num}: *${score} pt(s)*\n`; });
        await sock.sendMessage(from, { text });
        return;
      }

      if (!isGroup) { await sock.sendMessage(from, { text: '❌ Trivia fonctionne uniquement dans les groupes.' }); return; }
      if (global.triviaGames.has(from)) { await sock.sendMessage(from, { text: '⚠️ Un Trivia est déjà en cours!\n!trivia stop pour l\'arrêter.' }); return; }

      await sock.sendMessage(from, { text: '🎮 *Trivia — Chargement de la question...* 🤔' });

      // Obtenir une question (IA ou fallback)
      let question, answer, options;
      const aiResult = await callAI(
        `Génère une question de culture générale intéressante avec 4 choix de réponse. Réponds UNIQUEMENT en JSON valide:\n{"q":"Question?","a":"Bonne réponse","opts":["Option1","Option2","Bonne réponse","Option4"]}`
      );

      try {
        const parsed = JSON.parse(aiResult?.replace(/```json|```/g, '') || '');
        question = parsed.q; answer = parsed.a; options = parsed.opts;
      } catch {
        const fallback = TRIVIA_FALLBACK[Math.floor(Math.random() * TRIVIA_FALLBACK.length)];
        question = fallback.q; answer = fallback.a; options = fallback.opts;
      }

      // Mélanger les options
      options = options.sort(() => Math.random() - 0.5);
      const letters = ['A','B','C','D'];
      const correctLetter = letters[options.indexOf(answer)];

      global.triviaGames.set(from, { question, answer, correctLetter, options, scores: global.triviaGames.get(from)?.scores || {}, answered: new Set(), startTime: Date.now() });

      let msg = `🎮 *TRIVIA*\n${'═'.repeat(26)}\n\n❓ *${question}*\n\n`;
      options.forEach((opt, i) => { msg += `${letters[i]}. ${opt}\n`; });
      msg += `\n⏱️ *30 secondes !* Réponds avec A, B, C ou D`;

      await sock.sendMessage(from, { text: msg });

      // Timer 30s → révéler la réponse
      setTimeout(async () => {
        const game = global.triviaGames.get(from);
        if (!game) return;
        global.triviaGames.delete(from);

        const winners = [...(game.answered || [])].filter(s => s.correct);
        let endMsg = `⏰ *Temps écoulé !*\n\n✅ Bonne réponse: *${correctLetter}. ${answer}*\n\n`;
        if (winners.length > 0) {
          endMsg += `🏆 *Bonne(s) réponse(s):*\n${winners.map(w => `• ${w.sender} (+1 pt)`).join('\n')}`;
        } else {
          endMsg += `😔 Personne n'a trouvé !`;
        }
        endMsg += `\n\n_!trivia pour jouer encore | !trivia score pour les scores_`;
        await sock.sendMessage(from, { text: endMsg }).catch(() => {});
      }, 30000);
    },
  },

  // Handler de réponses trivia (intégré dans index.js via message handler)
  triviaanswer: {
    description: 'Répondre au trivia en cours (interne)',
    execute: async ({ sock, from, sender, text, senderNumber, isGroup }) => {
      if (!isGroup) return;
      const game = global.triviaGames.get(from);
      if (!game) return;

      const answer = text?.trim().toUpperCase();
      if (!['A','B','C','D'].includes(answer)) return;
      if (!game.answered) game.answered = new Set();

      // Vérifier si déjà répondu
      if ([...game.answered].some(a => a.sender === senderNumber)) {
        await sock.sendMessage(from, { text: `⚠️ @${senderNumber} Tu as déjà répondu !`, mentions: [sender] });
        return;
      }

      const isCorrect = answer === game.correctLetter;
      if (!game.scores) game.scores = {};
      if (isCorrect) {
        game.scores[senderNumber] = (game.scores[senderNumber] || 0) + 1;
        game.answered.add({ sender: senderNumber, correct: true });
        const timeMs = Date.now() - game.startTime;
        const timeSec = (timeMs / 1000).toFixed(1);
        await sock.sendMessage(from, {
          text: `✅ *@${senderNumber}* Bonne réponse en *${timeSec}s* ! +1 point 🎉`,
          mentions: [sender],
        });
      } else {
        game.answered.add({ sender: senderNumber, correct: false });
        await sock.sendMessage(from, {
          text: `❌ *@${senderNumber}* Mauvaise réponse !`,
          mentions: [sender],
        });
      }
    },
  },

  // ════════════════════════════════════════
  // WORDLE — Jeu de mots
  // ════════════════════════════════════════
  wordle: {
    description: 'Jeu Wordle en WhatsApp — Devine le mot en 6 essais',
    execute: async ({ sock, from, sender, args, text }) => {
      const action = args[0]?.toUpperCase();

      if (action === 'STOP' || action === 'QUIT') {
        global.wordleGames.delete(sender);
        await sock.sendMessage(from, { text: '🟩 Partie Wordle abandonnée.' });
        return;
      }

      // Si le joueur a déjà une partie en cours et envoie une tentative
      if (global.wordleGames.has(sender) && action?.length === 5 && /^[A-Z]+$/.test(action)) {
        const game = global.wordleGames.get(sender);
        if (game.attempts >= 6) { await sock.sendMessage(from, { text: '❌ Partie terminée. !wordle new pour recommencer.' }); return; }

        const guess = action;
        const word = game.word;
        const result = [];
        const wordArr = word.split('');
        const guessArr = guess.split('');
        const used = new Array(5).fill(false);

        // Vérifier les lettres exactes (🟩)
        const marks = new Array(5).fill('⬜');
        guessArr.forEach((l, i) => {
          if (l === wordArr[i]) { marks[i] = '🟩'; used[i] = true; }
        });
        // Vérifier les lettres présentes (🟨)
        guessArr.forEach((l, i) => {
          if (marks[i] !== '🟩') {
            const idx = wordArr.findIndex((c, j) => c === l && !used[j]);
            if (idx !== -1) { marks[i] = '🟨'; used[idx] = true; }
          }
        });

        game.attempts++;
        game.history.push({ guess, marks });

        let msg = `🟩 *WORDLE* — Essai ${game.attempts}/6\n\n`;
        game.history.forEach(h => { msg += `${h.marks.join('')} ${h.guess}\n`; });

        if (guess === word) {
          msg += `\n🎉 *BRAVO !* Tu as trouvé en ${game.attempts} essai(s) !`;
          global.wordleGames.delete(sender);
        } else if (game.attempts >= 6) {
          msg += `\n😔 *Perdu !* Le mot était: *${word}*\n!wordle pour rejouer`;
          global.wordleGames.delete(sender);
        } else {
          msg += `\n\n🟩 Bonne place | 🟨 Mauvaise place | ⬜ Absent\n_${6-game.attempts} essai(s) restant(s)_`;
        }
        await sock.sendMessage(from, { text: msg, mentions: [sender] });
        return;
      }

      // Démarrer une nouvelle partie
      const word = WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)];
      global.wordleGames.set(sender, { word, attempts: 0, history: [] });

      await sock.sendMessage(from, {
        text: `🟩 *WORDLE*\n${'═'.repeat(22)}\n\n` +
          `Devine le mot de *${word.length} lettres* en *6 essais* !\n\n` +
          `🟩 = Bonne lettre, bonne place\n` +
          `🟨 = Bonne lettre, mauvaise place\n` +
          `⬜ = Lettre absente\n\n` +
          `Envoie ton premier mot (${word.length} lettres en majuscules):\nEx: !wordle CHIEN\n\n_!wordle STOP pour abandonner_`,
      });
    },
  },

  // ════════════════════════════════════════
  // AKINATOR — Devine le personnage
  // ════════════════════════════════════════
  akinator: {
    description: 'Jeu Akinator — L\'IA devine ton personnage',
    execute: async ({ sock, from, sender, args, text }) => {
      const action = args[0]?.toLowerCase();

      if (action === 'stop') {
        global.akinatorGames.delete(sender);
        await sock.sendMessage(from, { text: '🧞 Partie Akinator abandonnée.' });
        return;
      }

      // Réponse à une question en cours
      if (global.akinatorGames.has(sender) && ['oui','non','o','n','yes','no'].includes(action)) {
        const game = global.akinatorGames.get(sender);
        const isYes = ['oui','o','yes'].includes(action);
        game.answers.push({ q: game.currentQ, a: isYes ? 'oui' : 'non' });
        game.questionCount++;

        // Toutes les 5 questions, l'IA tente de deviner
        if (game.questionCount % 5 === 0 || game.questionCount >= 15) {
          const qa = game.answers.map(a => `Q: ${a.q} → R: ${a.a}`).join('\n');
          const guess = await callAI(
            `Tu joues à Akinator. Voici les réponses obtenues:\n${qa}\n\nQui est ce personnage ? Réponds avec:\nGUESS: [nom du personnage]\nou\nQUESTION: [prochaine question à poser]`
          );

          if (guess?.startsWith('GUESS:') || game.questionCount >= 15) {
            const character = guess?.replace('GUESS:', '').trim() || 'Inconnu';
            global.akinatorGames.delete(sender);
            await sock.sendMessage(from, {
              text: `🧞 *Je pense que c'est...*\n\n🎯 *${character}* !\n\nAi-je raison ? 😄\n\n_!akinator pour rejouer_`,
            });
            return;
          }

          if (guess?.startsWith('QUESTION:')) {
            game.currentQ = guess.replace('QUESTION:', '').trim();
            await sock.sendMessage(from, {
              text: `🧞 *Question ${game.questionCount + 1}:*\n\n❓ ${game.currentQ}\n\n_Réponds: oui / non_`,
            });
            return;
          }
        }

        // Prochaine question
        const nextQ = await callAI(
          `Tu joues à Akinator. Réponses jusqu'ici:\n${game.answers.map(a=>`Q:${a.q}→${a.a}`).join(', ')}\n\nPose UNE seule question oui/non pour deviner le personnage. Réponds UNIQUEMENT avec la question, rien d'autre.`
        );
        game.currentQ = nextQ || 'Est-ce un personnage de fiction ?';
        await sock.sendMessage(from, {
          text: `🧞 *Question ${game.questionCount + 1}:*\n\n❓ ${game.currentQ}\n\n_Réponds: oui / non | !akinator stop pour arrêter_`,
        });
        return;
      }

      // Démarrer une nouvelle partie
      global.akinatorGames.set(sender, { answers: [], questionCount: 0, currentQ: '' });

      const firstQ = await callAI('Tu joues à Akinator. Pose la première question pour deviner un personnage. Réponds UNIQUEMENT avec la question, rien d\'autre.') || 'Est-ce un personnage réel (non fictif) ?';
      global.akinatorGames.get(sender).currentQ = firstQ;

      await sock.sendMessage(from, {
        text: `🧞 *AKINATOR*\n${'═'.repeat(22)}\n\n` +
          `Pense à un *personnage, animal ou objet*.\n` +
          `Je vais essayer de le deviner avec des questions oui/non !\n\n` +
          `❓ *${firstQ}*\n\n_Réponds: oui / non | !akinator stop pour arrêter_`,
      });
    },
  },

  // ════════════════════════════════════════
  // BATTLE — Défi entre membres
  // ════════════════════════════════════════
  battle: {
    description: 'Duel aléatoire entre deux membres',
    execute: async ({ sock, from, msg, isGroup, args }) => {
      if (!isGroup) { await sock.sendMessage(from, { text: '❌ Uniquement dans les groupes.' }); return; }
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (mentioned.length < 1) { await sock.sendMessage(from, { text: '⚔️ Usage: !battle @membre\nEx: !battle @Jean' }); return; }

      const p1 = msg.key.participant || msg.participant;
      const p2 = mentioned[0];
      const n1 = p1.split('@')[0];
      const n2 = p2.split('@')[0];

      // Stats aléatoires
      const s1 = { hp: 100, atk: Math.floor(Math.random()*40)+20 };
      const s2 = { hp: 100, atk: Math.floor(Math.random()*40)+20 };
      const moves = ['Coup de poing 👊','Coup de pied 🦵','Magie noire 🔮','Boule de feu 🔥','Éclair ⚡','Coup critique 💥'];

      let log = `⚔️ *DUEL !*\n👤 @${n1} VS 👤 @${n2}\n${'━'.repeat(24)}\n\n`;
      let round = 0;
      while (s1.hp > 0 && s2.hp > 0 && round < 10) {
        round++;
        const move1 = moves[Math.floor(Math.random()*moves.length)];
        const dmg1 = Math.floor(Math.random()*s1.atk);
        s2.hp = Math.max(0, s2.hp - dmg1);
        log += `🔴 @${n1}: ${move1} → *-${dmg1} HP* (${n2}: ${s2.hp}❤️)\n`;
        if (s2.hp <= 0) break;

        const move2 = moves[Math.floor(Math.random()*moves.length)];
        const dmg2 = Math.floor(Math.random()*s2.atk);
        s1.hp = Math.max(0, s1.hp - dmg2);
        log += `🔵 @${n2}: ${move2} → *-${dmg2} HP* (${n1}: ${s1.hp}❤️)\n`;
        if (round < 4) log += '\n';
      }

      const winner = s1.hp > s2.hp ? n1 : n2;
      log += `\n${'━'.repeat(24)}\n🏆 *VAINQUEUR: @${winner}* 🎉`;

      await sock.sendMessage(from, { text: log, mentions: [p1, p2] });
    },
  },

};
