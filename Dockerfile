FROM node:20-slim

# Dépendances système
RUN apt-get update && apt-get install -y \
    ffmpeg \
    wget \
    ca-certificates \
    python3 \
    python3-pip \
    build-essential \
    python3-dev \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Installer curl_cffi (nécessaire pour TikTok impersonation) et yt-dlp via pip
RUN pip3 install --break-system-packages curl_cffi yt-dlp

# S'assurer que yt-dlp est à jour
RUN yt-dlp -U || true

# Configurer yt-dlp :
#  - player_client : ios + android + web_creator (bypass détection bot YouTube)
#  - js-runtime : node (pour les vidéos obfusquées)
#  - no-check-certificates : évite les erreurs SSL
RUN mkdir -p /root/.config/yt-dlp && \
    printf -- "--extractor-args youtube:player_client=ios,android,web_creator\n--js-runtime node\n--no-check-certificates\n--socket-timeout 30\n" \
    > /root/.config/yt-dlp/config

WORKDIR /app

# Copier et installer les dépendances Node
COPY package*.json ./
RUN npm install

# Copier le reste du projet
COPY . .

# Créer les dossiers nécessaires
RUN mkdir -p /tmp/bot-downloads /app/sessions /app/data /app/data/stats /app/data/notes /app/data/banned /app/data/viewonce

EXPOSE 3000

CMD ["node", "src/index.js"]