/**
 * ============================================================
 * @file        personal.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes personnelles — Preferences utilisateur
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// UTILITAIRES PERSONNELS
// remind, todo, note perso, budget
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '../../data');

function loadJson(file) { try { return JSON.parse(fs.readFileSync(path.join(DATA,file),'utf8')); } catch { return {}; } }
function saveJson(file, d) { fs.writeFileSync(path.join(DATA,file), JSON.stringify(d,null,2)); }

// Rappels actifs en mémoire
if (!global.reminders) global.reminders = new Map();

export default {

  remind: {
    description: 'Créer un rappel personnel',
    execute: async ({ sock, from, sender, args, text }) => {
      const action = args[0]?.toLowerCase();

      if (action === 'list') {
        const d = loadJson('reminders.json');
        const mine = Object.entries(d[sender] || {});
        if (mine.length === 0) { await sock.sendMessage(from, { text: '⏰ Aucun rappel en cours.\n!remind [délai] [message] pour en créer un.' }); return; }
        let msg = `⏰ *Tes rappels (${mine.length})*\n\n`;
        mine.forEach(([id,r],i) => { msg += `${i+1}. "${r.msg}"\n   📅 ${new Date(r.fireAt).toLocaleString('fr-FR')}\n`; });
        msg += `\n_!remind cancel [n°] pour annuler_`;
        await sock.sendMessage(from, { text: msg });
        return;
      }

      if (action === 'cancel') {
        const idx = parseInt(args[1]) - 1;
        const d = loadJson('reminders.json');
        const mine = Object.keys(d[sender] || {});
        if (isNaN(idx) || idx < 0 || idx >= mine.length) { await sock.sendMessage(from, { text: '❌ Numéro invalide.' }); return; }
        const id = mine[idx];
        if (global.reminders.has(id)) { clearTimeout(global.reminders.get(id)); global.reminders.delete(id); }
        delete d[sender][id];
        saveJson('reminders.json', d);
        await sock.sendMessage(from, { text: `✅ Rappel annulé.` });
        return;
      }

      // !remind [durée] [message]
      // Formats: 30m, 2h, 1j, 14:30, demain
      const timeStr = args[0];
      const message = args.slice(1).join(' ');

      if (!timeStr || !message) {
        await sock.sendMessage(from, {
          text: `⏰ *Usage:* !remind [durée] [message]\n\n*Formats:*\n• 30m → dans 30 minutes\n• 2h → dans 2 heures\n• 1j → dans 1 jour\n• 14:30 → à 14h30\n\nEx: !remind 1h Boire de l'eau 💧\nEx: !remind 14:30 Réunion importante`,
        });
        return;
      }

      let delayMs;
      if (/^\d+m$/.test(timeStr))  delayMs = parseInt(timeStr) * 60000;
      else if (/^\d+h$/.test(timeStr)) delayMs = parseInt(timeStr) * 3600000;
      else if (/^\d+j$/.test(timeStr)) delayMs = parseInt(timeStr) * 86400000;
      else if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
        const [hh,mm] = timeStr.split(':').map(Number);
        const t = new Date(); t.setHours(hh,mm,0,0);
        if (t <= new Date()) t.setDate(t.getDate()+1);
        delayMs = t - new Date();
      } else {
        await sock.sendMessage(from, { text: '❌ Format invalide. Utilise: 30m, 2h, 1j, ou 14:30' });
        return;
      }

      const fireAt = new Date(Date.now() + delayMs).toISOString();
      const id = `${sender}_${Date.now()}`;

      // Sauvegarder
      const d = loadJson('reminders.json');
      if (!d[sender]) d[sender] = {};
      d[sender][id] = { msg: message, fireAt };
      saveJson('reminders.json', d);

      // Timer
      const timer = setTimeout(async () => {
        await sock.sendMessage(from, {
          text: `⏰ *RAPPEL !*\n\n📌 ${message}\n\n_!remind list pour tes rappels_`,
        });
        const d2 = loadJson('reminders.json');
        if (d2[sender]) { delete d2[sender][id]; saveJson('reminders.json', d2); }
        global.reminders.delete(id);
      }, delayMs);
      global.reminders.set(id, timer);

      const fireTime = new Date(fireAt).toLocaleString('fr-FR');
      await sock.sendMessage(from, { text: `✅ *Rappel créé !*\n\n📌 "${message}"\n⏰ Prévu: *${fireTime}*\n\n_!remind list pour voir tes rappels_` });
    },
  },

  todo: {
    description: 'Liste de tâches personnelle',
    execute: async ({ sock, from, sender, args, text }) => {
      const action = args[0]?.toLowerCase();
      const d = loadJson('todos.json');
      if (!d[sender]) d[sender] = [];

      if (!action || action === 'list') {
        if (d[sender].length === 0) {
          await sock.sendMessage(from, { text: `✅ *Ta liste TODO est vide !*\n\n!todo add [tâche] pour ajouter` });
          return;
        }
        const done = d[sender].filter(t=>t.done).length;
        let msg = `📋 *TODO List (${done}/${d[sender].length} faits)*\n\n`;
        d[sender].forEach((t,i) => { msg += `${t.done?'✅':'⬜'} ${i+1}. ${t.text}${t.priority==='high'?' 🔴':t.priority==='med'?' 🟡':''}\n`; });
        msg += `\n_Commandes: add, done [n°], del [n°], clear_`;
        await sock.sendMessage(from, { text: msg });
        return;
      }

      if (action === 'add') {
        const taskText = args.slice(1).join(' ');
        if (!taskText) { await sock.sendMessage(from, { text: '❌ Usage: !todo add [tâche]' }); return; }
        const priority = taskText.includes('!!') ? 'high' : taskText.includes('!') ? 'med' : 'low';
        d[sender].push({ text: taskText.replace(/!!/g,'').replace(/!/g,'').trim(), done:false, priority, created:new Date().toISOString() });
        saveJson('todos.json', d);
        await sock.sendMessage(from, { text: `✅ Tâche ajoutée: "${taskText}"\n_Utilise !! pour haute priorité, ! pour moyenne_` });
      } else if (action === 'done') {
        const idx = parseInt(args[1])-1;
        if (isNaN(idx)||!d[sender][idx]) { await sock.sendMessage(from, { text: '❌ Numéro invalide.' }); return; }
        d[sender][idx].done = true;
        saveJson('todos.json', d);
        await sock.sendMessage(from, { text: `✅ Tâche marquée comme faite: "${d[sender][idx].text}"` });
      } else if (action === 'del') {
        const idx = parseInt(args[1])-1;
        if (isNaN(idx)||!d[sender][idx]) { await sock.sendMessage(from, { text: '❌ Numéro invalide.' }); return; }
        const removed = d[sender].splice(idx,1)[0];
        saveJson('todos.json', d);
        await sock.sendMessage(from, { text: `🗑️ Tâche supprimée: "${removed.text}"` });
      } else if (action === 'clear') {
        d[sender] = [];
        saveJson('todos.json', d);
        await sock.sendMessage(from, { text: '✅ Liste TODO vidée.' });
      } else if (action === 'cleardone') {
        d[sender] = d[sender].filter(t=>!t.done);
        saveJson('todos.json', d);
        await sock.sendMessage(from, { text: '✅ Tâches terminées supprimées.' });
      } else {
        await sock.sendMessage(from, { text: '❌ Action inconnue.\n\n_Commandes: list, add, done [n°], del [n°], clear, cleardone_' });
      }
    },
  },

  note: {
    description: 'Bloc-notes personnel',
    execute: async ({ sock, from, sender, args, text }) => {
      const action = args[0]?.toLowerCase();
      const d = loadJson('personalnotes.json');
      if (!d[sender]) d[sender] = [];

      if (!action || action === 'list') {
        if (d[sender].length === 0) { await sock.sendMessage(from, { text: '📓 Ton bloc-notes est vide.\n!note add [texte] pour ajouter' }); return; }
        let msg = `📓 *Bloc-notes (${d[sender].length} note(s))*\n\n`;
        d[sender].slice(-10).forEach((n,i) => { msg += `${i+1}. 📌 *${n.title||'Note'}*\n   ${n.text.slice(0,60)}${n.text.length>60?'...':''}\n   _${new Date(n.date).toLocaleDateString('fr-FR')}_\n\n`; });
        msg += `_!note view [n°] | !note del [n°] | !note search [mot]_`;
        await sock.sendMessage(from, { text: msg });
        return;
      }

      if (action === 'add') {
        const content = args.slice(1).join(' ');
        if (!content) { await sock.sendMessage(from, { text: '❌ !note add [titre:] [texte]' }); return; }
        let title = '', noteText = content;
        if (content.includes(':')) { let rest; [title, ...rest] = content.split(':'); noteText = rest.join(':').trim(); }
        d[sender].push({ title:title.trim()||'Note', text:noteText.trim(), date:new Date().toISOString() });
        saveJson('personalnotes.json', d);
        await sock.sendMessage(from, { text: `📓 Note ajoutée: *"${title||noteText.slice(0,30)}"*` });
      } else if (action === 'view') {
        const idx = parseInt(args[1])-1;
        const note = d[sender][idx];
        if (!note) { await sock.sendMessage(from, { text: '❌ Note introuvable.' }); return; }
        await sock.sendMessage(from, { text: `📓 *${note.title||'Note'}*\n${new Date(note.date).toLocaleDateString('fr-FR')}\n${'━'.repeat(20)}\n\n${note.text}` });
      } else if (action === 'del') {
        const idx = parseInt(args[1])-1;
        if (isNaN(idx)||!d[sender][idx]) { await sock.sendMessage(from, { text: '❌ Numéro invalide.' }); return; }
        d[sender].splice(idx,1);
        saveJson('personalnotes.json', d);
        await sock.sendMessage(from, { text: '✅ Note supprimée.' });
      } else if (action === 'search') {
        const kw = args.slice(1).join(' ').toLowerCase();
        const found = d[sender].filter(n => n.text.toLowerCase().includes(kw)||n.title?.toLowerCase().includes(kw));
        if (found.length === 0) { await sock.sendMessage(from, { text: `❌ Aucune note contenant "${kw}".` }); return; }
        let msg = `🔍 *Résultats pour "${kw}" (${found.length})*\n\n`;
        found.forEach((n,i) => { msg += `${i+1}. *${n.title}*: ${n.text.slice(0,80)}...\n`; });
        await sock.sendMessage(from, { text: msg });
      }
    },
  },

  budget: {
    description: 'Suivi de dépenses et budget personnel',
    execute: async ({ sock, from, sender, args, text }) => {
      const action = args[0]?.toLowerCase();
      const d = loadJson('budgets.json');
      if (!d[sender]) d[sender] = { income:0, expenses:[], currency:'XOF' };

      if (!action || action === 'status') {
        const b = d[sender];
        const totalExpenses = b.expenses.reduce((s,e)=>s+e.amount,0);
        const balance = b.income - totalExpenses;
        const byCategory = {};
        b.expenses.forEach(e => { byCategory[e.cat] = (byCategory[e.cat]||0)+e.amount; });
        const topCats = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,3);

        let msg = `💰 *Budget Personnel*\n${'━'.repeat(26)}\n\n`;
        msg += `💵 Revenu: *${b.income.toLocaleString()} ${b.currency}*\n`;
        msg += `💸 Dépenses: *${totalExpenses.toLocaleString()} ${b.currency}*\n`;
        msg += `${balance>=0?'✅':'🔴'} Solde: *${balance.toLocaleString()} ${b.currency}*\n\n`;
        if (topCats.length > 0) {
          msg += `📊 *Top dépenses:*\n`;
          topCats.forEach(([cat,amt]) => { msg += `  • ${cat}: ${amt.toLocaleString()}\n`; });
        }
        msg += `\n_Commandes: income, add, list, reset_`;
        await sock.sendMessage(from, { text: msg });
        return;
      }

      if (action === 'income') {
        const amt = parseFloat(args[1]);
        if (isNaN(amt)) { await sock.sendMessage(from, { text: '❌ !budget income [montant]' }); return; }
        d[sender].income = amt;
        saveJson('budgets.json', d);
        await sock.sendMessage(from, { text: `💵 Revenu défini: *${amt.toLocaleString()} ${d[sender].currency}*` });
      } else if (action === 'add') {
        // !budget add [montant] [catégorie] [description]
        const amt = parseFloat(args[1]);
        const cat = args[2] || 'Divers';
        const desc = args.slice(3).join(' ') || cat;
        if (isNaN(amt)) { await sock.sendMessage(from, { text: '❌ !budget add [montant] [catégorie] [description]' }); return; }
        d[sender].expenses.push({ amount:amt, cat, desc, date:new Date().toISOString() });
        saveJson('budgets.json', d);
        const total = d[sender].expenses.reduce((s,e)=>s+e.amount,0);
        const balance = d[sender].income - total;
        await sock.sendMessage(from, {
          text: `💸 *Dépense ajoutée*\n${amt.toLocaleString()} ${d[sender].currency} — ${desc}\n\n${balance>=0?'✅':'🔴'} Solde: *${balance.toLocaleString()}*`,
        });
      } else if (action === 'list') {
        const last = d[sender].expenses.slice(-10).reverse();
        if (last.length === 0) { await sock.sendMessage(from, { text: '📋 Aucune dépense enregistrée.' }); return; }
        let msg = `📋 *Dernières dépenses (${last.length})*\n\n`;
        last.forEach((e,i) => { msg += `${i+1}. *-${e.amount.toLocaleString()}* [${e.cat}] ${e.desc}\n   ${new Date(e.date).toLocaleDateString('fr-FR')}\n`; });
        await sock.sendMessage(from, { text: msg });
      } else if (action === 'reset') {
        d[sender] = { income:0, expenses:[], currency:'XOF' };
        saveJson('budgets.json', d);
        await sock.sendMessage(from, { text: '✅ Budget réinitialisé.' });
      } else if (action === 'currency') {
        d[sender].currency = args[1]?.toUpperCase() || 'XOF';
        saveJson('budgets.json', d);
        await sock.sendMessage(from, { text: `✅ Devise changée: ${d[sender].currency}` });
      } else {
        await sock.sendMessage(from, { text: '❌ Action inconnue.\n\n_Commandes: status, income, add, list, reset, currency_' });
      }
    },
  },

};
