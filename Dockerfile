FROM node:20-slim

# Installer ffmpeg, wget, ca-certificates et python3
RUN apt-get update && apt-get install -y \
    ffmpeg \
    wget \
    ca-certificates \
    python3 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Installer yt-dlp depuis le release officiel GitHub
RUN wget --no-check-certificate https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    yt-dlp -U

# Configurer yt-dlp pour utiliser Node.js (déjà présent dans node:20-slim)
# comme runtime JavaScript (nécessaire pour certains formats YouTube)
RUN mkdir -p /root/.config/yt-dlp && \
    printf -- "--js-runtimes nodejs\n" > /root/.config/yt-dlp/config

WORKDIR /app

# Copier et installer les dépendances Node
COPY package*.json ./
RUN npm install

# Copier le reste du projet
COPY . .

# Créer les dossiers nécessaires
RUN mkdir -p /tmp/bot-downloads /app/sessions /app/data

EXPOSE 3000

CMD ["node", "src/index.js"]