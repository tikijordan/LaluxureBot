FROM node:20-slim

# Dépendances système
RUN apt-get update && apt-get install -y \
    ffmpeg \
    wget \
    ca-certificates \
    tor \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Installer curl_cffi (nécessaire pour TikTok impersonation) et yt-dlp via pip
RUN pip3 install --break-system-packages curl_cffi yt-dlp

# S'assurer que yt-dlp est à jour (optionnel, ne pas échouer si pas de connexion)
RUN yt-dlp -U || echo "yt-dlp update skipped"

# Configurer yt-dlp :
#  - player_client : ios + android + web_creator (bypass détection bot YouTube)
#  - js-runtimes : node (runtime JS pour les extracteurs)
#  - no-check-certificates : évite les erreurs SSL
RUN mkdir -p /root/.config/yt-dlp && \
    printf -- "--no-check-certificates\n--socket-timeout 30\n--no-playlist\n" \
    > /root/.config/yt-dlp/config

# Configurer Tor (SOCKS + ControlPort pour rotation IP)
RUN mkdir -p /etc/tor && \
    printf -- "SocksPort 9050\nControlPort 9051\nCookieAuthentication 1\nCookieAuthFile /tmp/tor_auth_cookie\nLog notice file /tmp/tor_log\n" \
    > /etc/tor/torrc

WORKDIR /app

# Copier et installer les dépendances Node
COPY package*.json ./
RUN npm install

# Nettoyer les outils de build après installation
RUN apt-get update && \
    apt-get purge -y python3-dev build-essential && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Copier le reste du projet
COPY . .

# Créer les dossiers nécessaires
RUN mkdir -p /tmp/bot-downloads /app/sessions /app/data /app/data/stats /app/data/notes /app/data/banned /app/data/viewonce

EXPOSE 3000

RUN chmod +x /app/docker-entrypoint.sh

CMD ["/app/docker-entrypoint.sh"]