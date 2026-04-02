FROM node:20-slim

# Installer ffmpeg, wget et ca-certificates
RUN apt-get update && apt-get install -y \
    ffmpeg \
    wget \
    ca-certificates \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Installer yt-dlp depuis le release officiel GitHub
RUN wget --no-check-certificate https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copier et installer les dépendances Node
COPY package*.json ./
RUN npm install

# Copier le reste du projet
COPY . .

# Créer le dossier temporaire
RUN mkdir -p /tmp/bot-downloads

EXPOSE 3000

CMD ["node", "src/index.js"]