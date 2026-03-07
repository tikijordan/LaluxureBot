/**
 * ============================================================
 * @file        infos.js
 * @project     WhatsApp Bot
 * @author      Bot Developer
 * @copyright   Copyright (c) 2026 Bot Developer
 * @license     MIT — See LICENSE file for details
 * @description Commandes d'information — Profil, statut bot
 * ============================================================
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies, subject
 * to the MIT License conditions. See LICENSE for full terms.
 * ============================================================
 */
// ============================================================
// COMMANDES: meteo, news
// ============================================================

import axios from 'axios';

export default {
  meteo: {
    description: 'Météo du jour',
    execute: async ({ sock, from, text }) => {
      const city = text || process.env.DEFAULT_CITY || 'Paris';
      const apiKey = process.env.WEATHER_API_KEY;

      if (!apiKey || apiKey === 'votre_cle_ici') {
        await sock.sendMessage(from, {
          text: `☁️ *Météo — ${city}*\n\n⚠️ Clé API OpenWeatherMap non configurée.\nAjoute WEATHER_API_KEY dans le fichier .env\n\nhttps://openweathermap.org/api (gratuit)`,
        });
        return;
      }

      try {
        const res = await axios.get(
          `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=fr`,
          { timeout: 6000 }
        );
        const d = res.data;
        const icons = {
          Clear: '☀️', Clouds: '☁️', Rain: '🌧️', Drizzle: '🌦️',
          Thunderstorm: '⛈️', Snow: '❄️', Mist: '🌫️', Fog: '🌫️',
        };
        const icon = icons[d.weather[0].main] || '🌈';
        const msg = `${icon} *Météo — ${d.name}, ${d.sys.country}*\n\n🌡️ Température: *${Math.round(d.main.temp)}°C* (ressenti ${Math.round(d.main.feels_like)}°C)\n📊 Min/Max: ${Math.round(d.main.temp_min)}°C / ${Math.round(d.main.temp_max)}°C\n💧 Humidité: ${d.main.humidity}%\n💨 Vent: ${Math.round(d.wind.speed * 3.6)} km/h\n👁️ Visibilité: ${d.visibility / 1000} km\n🌤️ Ciel: ${d.weather[0].description}\n\n_Mis à jour le ${new Date().toLocaleString('fr-FR')}_`;
        await sock.sendMessage(from, { text: msg });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Ville "${city}" introuvable. Vérifie l'orthographe.` });
      }
    },
  },

  news: {
    description: 'Dernières actualités',
    execute: async ({ sock, from, text }) => {
      const apiKey = process.env.NEWS_API_KEY;

      if (!apiKey || apiKey === 'votre_cle_ici') {
        await sock.sendMessage(from, {
          text: `📰 *Actualités*\n\n⚠️ Clé API NewsAPI non configurée.\nAjoute NEWS_API_KEY dans le fichier .env\n\nhttps://newsapi.org/ (gratuit)`,
        });
        return;
      }

      try {
        const query = text || 'Afrique';
        const res = await axios.get(
          `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=fr&pageSize=5&sortBy=publishedAt&apiKey=${apiKey}`,
          { timeout: 6000 }
        );
        const articles = res.data.articles.slice(0, 5);
        let msg = `📰 *Actualités — ${query}*\n\n`;
        articles.forEach((a, i) => {
          msg += `${i + 1}. *${a.title}*\n   📅 ${new Date(a.publishedAt).toLocaleDateString('fr-FR')}\n   🔗 ${a.url}\n\n`;
        });
        await sock.sendMessage(from, { text: msg });
      } catch {
        await sock.sendMessage(from, { text: '❌ Impossible de récupérer les actualités.' });
      }
    },
  },
};
