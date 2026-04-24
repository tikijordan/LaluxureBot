FROM node:20-slim

# Installer ffmpeg, wget, ca-certificates et python3
RUN apt-get update && apt-get install -y \
    ffmpeg \
    wget \
    ca-certificates \
    python3 \
    python3-dev \
    build-essential \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Installer yt-dlp depuis le release officiel GitHub
RUN wget --no-check-certificate https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    yt-dlp -U

# Configurer yt-dlp :
#  - runtime JS    : node (présent dans node:20-slim)
#  - player_client : ios + android (bypass la détection bot YouTube sans cookies)
#  - no-check-certificates : évite les erreurs SSL dans certains VPS
RUN mkdir -p /root/.config/yt-dlp && \
    printf -- "--js-runtimes node\n--extractor-args youtube:player_client=ios,android\n--no-check-certificates\n" \
    > /root/.config/yt-dlp/config

WORKDIR /app

# Copier et installer les dépendances Node
COPY package*.json ./
RUN npm install

# Copier le reste du projet
COPY . .

# Créer les dossiers nécessaires
RUN mkdir -p /tmp/bot-downloads /app/sessions /app/data /app/data/stats /app/data/notes /app/data/banned

EXPOSE 3000

CMD ["node", "src/index.js"]