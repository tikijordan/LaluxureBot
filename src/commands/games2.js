/**
 * ============================================================
 * @file        games2.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Jeux avances — Cartes, des, casino
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// JEUX — PARTIE 2
// hangman, math challenge, scramble, rpg
// ============================================================
import axios from 'axios';

if (!global.hangmanGames) global.hangmanGames = new Map();
if (!global.mathChallenges) global.mathChallenges = new Map();
if (!global.scrambleGames) global.scrambleGames = new Map();
if (!global.rpgGames) global.rpgGames = new Map();

const HANGMAN_WORDS = [
  'PROGRAMMATION','INTELLIGENCE','ALGORITHME','ORDINATEUR','LOGICIEL',
  'JAVASCRIPT','PYTHON','DATABASE','INTERFACE','CRYPTOGRAPHIE',
  'ELEPHANT','GIRAFE','PAPILLON','DAUPHIN','CROCODILE',
  'FOOTBALL','BASKETBALL','NATATION','VOLLEYBALL','ATHLETISME',
  'AVENTURE','MYSTERE','TRESOR','FANTOME','DRAGON',
  'CHOCOLAT','MANGUE','ANANAS','PAPAYE','NOIX DE COCO',
];

const HANGMAN_STAGES = [
  '```\n  +---+\n      |\n      |\n      |\n      |\n=========```',
  '```\n  +---+\n  O   |\n      |\n      |\n      |\n=========```',
  '```\n  +---+\n  O   |\n  |   |\n      |\n      |\n=========```',
  '```\n  +---+\n  O   |\n /|   |\n      |\n      |\n=========```',
  '```\n  +---+\n  O   |\n /|\\  |\n      |\n      |\n=========```',
  '```\n  +---+\n  O   |\n /|\\  |\n /    |\n      |\n=========```',
  '```\n  +---+\n  O   |\n /|\\  |\n / \\  |\n      |\n=========```',
];

async function callAI(prompt, temp=0.8) {
  const gKey = process.env.GEMINI_API_KEY_1;
  const qKey = process.env.GROQ_API_KEY_1;
  if (gKey) {
    try {
      const r = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${gKey}`,
        { contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:temp,maxOutputTokens:600} },
        { timeout:15000 }
      );
      return r.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    } catch {}
  }
  if (qKey) {
    try {
      const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
        { model:'llama-3.3-70b-versatile', messages:[{role:'user',content:prompt}], max_tokens:600, temperature:temp },
        { headers:{Authorization:`Bearer ${qKey}`}, timeout:15000 }
      );
      return r.data?.choices?.[0]?.message?.content?.trim();
    } catch {}
  }
  return null;
}

export default {

  // ════════════════════════════════════════
  // PENDU
  // ════════════════════════════════════════
  hangman: {
    description: 'Jeu du Pendu en WhatsApp',
    execute: async ({ sock, from, sender, args, text }) => {
      const guess = args[0]?.toUpperCase();

      // Nouvelle partie
      if (!global.hangmanGames.has(sender) || guess === 'NEW') {
        const word = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
        global.hangmanGames.set(sender, { word, guessed: new Set(), errors: 0, maxErrors: 6 });
        const game = global.hangmanGames.get(sender);
        const display = word.split('').map(l => ' _ ').join('');
        await sock.sendMessage(from, {
          text: `🎮 *PENDU*\n${'═'.repeat(22)}\n\n${HANGMAN_STAGES[0]}\n\n${display}\n\n📝 Mot de *${word.length}* lettres\n❤️ Vies: 6/6\n\n_Envoie !hangman [lettre] pour jouer_\n_!hangman stop pour abandonner_`,
        });
        return;
      }

      if (guess === 'STOP') {
        const game = global.hangmanGames.get(sender);
        global.hangmanGames.delete(sender);
        await sock.sendMessage(from, { text: `😔 Abandonné ! Le mot était: *${game?.word}*` });
        return;
      }

      const game = global.hangmanGames.get(sender);
      if (!guess || guess.length !== 1 || !/[A-Z]/.test(guess)) {
        await sock.sendMessage(from, { text: '❌ Envoie une seule lettre. Ex: !hangman A' });
        return;
      }

      if (game.guessed.has(guess)) {
        await sock.sendMessage(from, { text: `⚠️ Tu as déjà essayé la lettre *${guess}* !` });
        return;
      }

      game.guessed.add(guess);
      const isCorrect = game.word.includes(guess);
      if (!isCorrect) game.errors++;

      // Construire l'affichage
      const display = game.word.split('').map(l => game.guessed.has(l) ? ` ${l} ` : ' _ ').join('');
      const usedLetters = [...game.guessed].sort().join(' ');
      const won = game.word.split('').every(l => game.guessed.has(l));
      const lost = game.errors >= game.maxErrors;

      let msg = `🎮 *PENDU*\n\n${HANGMAN_STAGES[game.errors]}\n\n${display}\n\n`;
      msg += `❤️ Vies: ${game.maxErrors - game.errors}/${game.maxErrors}\n`;
      msg += `🔤 Lettres essayées: ${usedLetters || 'aucune'}\n\n`;

      if (won) {
        msg += `🎉 *BRAVO ! Tu as trouvé: ${game.word}*`;
        global.hangmanGames.delete(sender);
      } else if (lost) {
        msg += `💀 *PERDU ! Le mot était: ${game.word}*\n!hangman new pour rejouer`;
        global.hangmanGames.delete(sender);
      } else {
        msg += isCorrect ? `✅ *${guess}* est dans le mot !` : `❌ *${guess}* n'est pas dans le mot.`;
        msg += `\n_!hangman [lettre] pour continuer_`;
      }
      await sock.sendMessage(from, { text: msg });
    },
  },

  // ════════════════════════════════════════
  // DÉFI CALCUL MENTAL
  // ════════════════════════════════════════
  math: {
    description: 'Défi de calcul mental rapide',
    execute: async ({ sock, from, sender, args, isGroup }) => {
      const action = args[0]?.toLowerCase();

      // Réponse à un défi en cours
      if (global.mathChallenges.has(from) && !isNaN(args[0])) {
        const challenge = global.mathChallenges.get(from);
        if (challenge.answered?.has(sender)) {
          await sock.sendMessage(from, { text: `⚠️ Tu as déjà répondu !` });
          return;
        }
        const userAns = parseFloat(args[0]);
        const isCorrect = Math.abs(userAns - challenge.answer) < 0.01;
        const timeMs = Date.now() - challenge.startTime;
        const timeSec = (timeMs/1000).toFixed(2);

        if (!challenge.answered) challenge.answered = new Set();
        challenge.answered.add(sender);
        if (!challenge.scores) challenge.scores = {};

        if (isCorrect) {
          const pts = Math.max(1, Math.floor(10 - timeMs/1000));
          challenge.scores[sender] = (challenge.scores[sender]||0) + pts;
          await sock.sendMessage(from, {
            text: `✅ *@${sender.split('@')[0]}* Bonne réponse en *${timeSec}s* ! +${pts} pts 🎉`,
            mentions: [sender],
          });
        } else {
          await sock.sendMessage(from, {
            text: `❌ *@${sender.split('@')[0]}* Mauvaise réponse ! (${userAns})`,
            mentions: [sender],
          });
        }
        return;
      }

      if (action === 'stop') { global.mathChallenges.delete(from); await sock.sendMessage(from, { text: '🛑 Défi arrêté.' }); return; }
      if (action === 'score') {
        const c = global.mathChallenges.get(from);
        if (!c?.scores || Object.keys(c.scores).length === 0) { await sock.sendMessage(from, { text: '📊 Pas de score. Lance !math d\'abord.' }); return; }
        const sorted = Object.entries(c.scores).sort((a,b)=>b[1]-a[1]);
        await sock.sendMessage(from, { text: `🏆 *Scores Math*\n\n${sorted.map(([s,p],i)=>`${['🥇','🥈','🥉'][i]||`${i+1}.`} ${s.split('@')[0]}: *${p} pts*`).join('\n')}` });
        return;
      }

      // Générer un défi
      const level = action === 'hard' ? 3 : action === 'easy' ? 1 : 2;
      let question, answer;

      if (level === 1) {
        const a=Math.floor(Math.random()*50)+1, b=Math.floor(Math.random()*50)+1;
        const op=['+','-','×'][Math.floor(Math.random()*3)];
        question=`${a} ${op} ${b}`; answer=op==='+'?a+b:op==='-'?a-b:a*b;
      } else if (level === 2) {
        const a=Math.floor(Math.random()*20)+5, b=Math.floor(Math.random()*20)+5;
        const ops=[['×',a*b],['+',a+b],['²',a*a],['÷',(a*b)+'/'+b]];
        const pick=ops[Math.floor(Math.random()*2)];
        question=`${pick[0]==='²'?a+pick[0]:a+' '+pick[0]+' '+b}`; answer=pick[1];
      } else {
        const a=Math.floor(Math.random()*100)+10, b=Math.floor(Math.random()*100)+10;
        question=`${a} × ${b}`; answer=a*b;
      }

      const prev = global.mathChallenges.get(from);
      global.mathChallenges.set(from, { question, answer, startTime:Date.now(), scores:prev?.scores||{}, answered:new Set() });

      const levelStr = level===1?'🟢 Facile':level===2?'🟡 Moyen':'🔴 Difficile';
      await sock.sendMessage(from, {
        text: `🧮 *DÉFI MATH* ${levelStr}\n${'═'.repeat(22)}\n\n❓ *${question} = ?*\n\n⏱️ Sois le plus rapide !\n_!math easy/hard pour changer le niveau_`,
      });

      // Révéler après 15s si personne n'a répondu correctement
      setTimeout(async () => {
        const c = global.mathChallenges.get(from);
        if (c && c.startTime && Date.now()-c.startTime >= 14000) {
          await sock.sendMessage(from, { text: `⏰ Temps écoulé !\n✅ La réponse était: *${answer}*` }).catch(()=>{});
          if (c) { c.startTime = null; }
        }
      }, 15000);
    },
  },

  // ════════════════════════════════════════
  // SCRAMBLE — Mot mélangé
  // ════════════════════════════════════════
  scramble: {
    description: 'Reconstituer un mot mélangé',
    execute: async ({ sock, from, sender, args }) => {
      const guess = args[0]?.toUpperCase();

      if (global.scrambleGames.has(from) && guess && guess !== 'STOP' && guess !== 'HINT' && guess !== 'NEW') {
        const game = global.scrambleGames.get(from);
        if (guess === game.word) {
          const timeMs = Date.now() - game.startTime;
          global.scrambleGames.delete(from);
          await sock.sendMessage(from, {
            text: `🎉 *@${sender.split('@')[0]} a trouvé !*\n\n✅ Le mot était: *${game.word}*\n⏱️ En ${(timeMs/1000).toFixed(1)}s\n\n_!scramble pour jouer encore_`,
            mentions: [sender],
          });
        } else {
          await sock.sendMessage(from, { text: `❌ *${guess}* n'est pas le bon mot. Réessaie !\n_!scramble hint pour un indice_` });
        }
        return;
      }

      if (guess === 'STOP') { global.scrambleGames.delete(from); await sock.sendMessage(from, { text: '🛑 Scramble arrêté.' }); return; }

      if (guess === 'HINT' && global.scrambleGames.has(from)) {
        const game = global.scrambleGames.get(from);
        const hint = game.word[0] + '_'.repeat(game.word.length-2) + game.word[game.word.length-1];
        await sock.sendMessage(from, { text: `💡 Indice: *${hint}* (${game.word.length} lettres)` });
        return;
      }

      // Nouveau jeu
      const WORDS = [...HANGMAN_WORDS, 'WHATSAPP','FACEBOOK','INTERNET','TELEPHONE','VOITURE','MAISON'];
      const word = WORDS[Math.floor(Math.random()*WORDS.length)];
      const scrambled = word.split('').sort(()=>Math.random()-0.5).join('');
      global.scrambleGames.set(from, { word, scrambled, startTime:Date.now() });

      await sock.sendMessage(from, {
        text: `🔀 *SCRAMBLE*\n${'═'.repeat(22)}\n\n🔤 Mot mélangé: *${scrambled}*\n📝 ${word.length} lettres\n\n_Réponds avec !scramble [MOT]_\n_!scramble hint pour un indice_\n_!scramble stop pour abandonner_`,
      });

      // Timer 60s
      setTimeout(async () => {
        if (global.scrambleGames.has(from)) {
          const g = global.scrambleGames.get(from);
          if (g.word === word) {
            await sock.sendMessage(from, { text: `⏰ Temps écoulé ! Le mot était: *${word}*` }).catch(()=>{});
            global.scrambleGames.delete(from);
          }
        }
      }, 60000);
    },
  },

  // ════════════════════════════════════════
  // MINI RPG TEXTUEL IA
  // ════════════════════════════════════════
  rpg: {
    description: 'Mini RPG textuel généré par IA',
    execute: async ({ sock, from, sender, args, text }) => {
      const action = args[0]?.toLowerCase();

      if (action === 'stop' || action === 'quit') {
        global.rpgGames.delete(sender);
        await sock.sendMessage(from, { text: '⚔️ Aventure abandonnée. À bientôt héros ! 👋' });
        return;
      }

      if (action === 'status' && global.rpgGames.has(sender)) {
        const g = global.rpgGames.get(sender);
        await sock.sendMessage(from, {
          text: `⚔️ *Statut de ${g.name}*\n\n❤️ HP: ${g.hp}/100\n⚡ Niveau: ${g.level}\n💰 Or: ${g.gold}\n🗡️ Attaque: ${g.atk}\n🛡️ Défense: ${g.def}\n\n📖 Lieu: ${g.location}`,
        });
        return;
      }

      // Action en cours de partie
      if (global.rpgGames.has(sender) && action && !['new','start'].includes(action)) {
        const game = global.rpgGames.get(sender);
        const playerAction = text;

        const prompt = `Tu es le narrateur d'un RPG textuel. Le joueur s'appelle ${game.name}.
État actuel: HP:${game.hp}/100, Niveau:${game.level}, Or:${game.gold}, Lieu:${game.location}
Historique récent: ${game.history.slice(-2).join(' | ')}

Action du joueur: "${playerAction}"

Réponds en JSON STRICT (sans markdown):
{"narration":"[2-3 phrases narratives dramatiques avec emojis]","hpChange":0,"goldChange":0,"newLocation":"${game.location}","levelUp":false,"event":"[none/combat/treasure/merchant/trap]"}

Rends ça épique ! Combats aléatoires, trésors, pièges.`;

        const result = await callAI(prompt, 0.85);
        let parsed;
        try {
          parsed = JSON.parse(result?.replace(/```json|```/g,'').trim() || '{}');
        } catch {
          parsed = { narration: result || 'Tu avances prudemment dans l\'obscurité... ⚔️', hpChange:0, goldChange:0, newLocation:game.location };
        }

        game.hp = Math.min(100, Math.max(0, game.hp + (parsed.hpChange||0)));
        game.gold += parsed.goldChange||0;
        game.location = parsed.newLocation||game.location;
        if (parsed.levelUp) { game.level++; game.atk+=5; game.def+=3; }
        game.history.push(playerAction);
        if (game.history.length > 5) game.history.shift();

        let msg = `⚔️ *${game.name}*\n${'━'.repeat(22)}\n\n${parsed.narration}\n\n`;
        if (parsed.hpChange) msg += `${parsed.hpChange>0?'❤️ +':'💔 '}${parsed.hpChange} HP\n`;
        if (parsed.goldChange) msg += `${parsed.goldChange>0?'💰 +':'💸 '}${parsed.goldChange} or\n`;
        if (parsed.levelUp) msg += `⬆️ *NIVEAU ${game.level} !* Tes stats augmentent !\n`;
        msg += `\n❤️${game.hp}/100 | 💰${game.gold} or | ⭐Niv.${game.level}`;

        if (game.hp <= 0) {
          msg += `\n\n💀 *GAME OVER !* Tu es mort...\n_!rpg new pour recommencer_`;
          global.rpgGames.delete(sender);
        } else {
          msg += `\n\n_Que fais-tu ? (!rpg [action])_\n_!rpg stop pour quitter_`;
        }
        await sock.sendMessage(from, { text: msg });
        return;
      }

      // Démarrer une nouvelle aventure
      const heroName = text.replace(/new|start/i,'').trim() || `Héros_${sender.split('@')[0].slice(-4)}`;
      const universes = ['Fantasy médiévale 🏰','Science-fiction 🚀','Apocalypse zombie 🧟','Piraterie 🏴‍☠️','Japon féodal ⛩️'];
      const universe = universes[Math.floor(Math.random()*universes.length)];

      global.rpgGames.set(sender, { name:heroName, hp:100, level:1, gold:10, atk:15, def:10, location:'Village de départ', history:[], universe });

      const intro = await callAI(
        `Génère une introduction épique courte (3 phrases max) pour un RPG textuel ${universe}. Le héros s'appelle ${heroName} et commence dans un village. Utilise des emojis. Termine par une situation qui demande une action au joueur.`,
        0.9
      ) || `🗡️ *${heroName}* se réveille dans un village mystérieux. Une silhouette encapuchonnée te remet une mission urgente : sauver le royaume ! ⚔️ Que fais-tu ?`;

      await sock.sendMessage(from, {
        text: `⚔️ *RPG TEXTUEL — ${universe}*\n${'═'.repeat(28)}\n\n*Héros: ${heroName}*\n❤️ HP: 100 | 💰 Or: 10 | ⭐ Niv.1\n\n${'━'.repeat(28)}\n\n${intro}\n\n${'━'.repeat(28)}\n_!rpg [ton action] pour jouer_\nEx: !rpg J'entre dans la forêt\n_!rpg status | !rpg stop_`,
      });
    },
  },

};
