FROM node:20-slim

# Dépendances système : ffmpeg, python3, build tools pour curl_cffi et better-sqlite3
RUN apt-get update && apt-get install -y \
    ffmpeg \
    wget \
    ca-certificates \
    python3 \
    python3-dev \
    python3-pip \
    build-essential \
    libssl-dev \
    libffi-dev \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# yt-dlp via pip (plus à jour que wget)
RUN pip3 install --break-system-packages yt-dlp

# curl_cffi — compilé depuis les sources pour garantir le support TikTok
# (nécessite libssl-dev + libffi-dev + build-essential installés ci-dessus)
RUN pip3 install --break-system-packages --no-binary :all: curl_cffi || \
    pip3 install --break-system-packages curl_cffi || \
    echo "curl_cffi non disponible — TikTok fonctionnera sans impersonation"

# Mettre yt-dlp à jour
RUN yt-dlp -U || true

# Config yt-dlp globale :
#  - player_client ios+android : contourne la détection bot YouTube
#  - js-runtimes node : utilise node comme moteur JS (déjà présent dans l'image)
RUN mkdir -p /root/.config/yt-dlp && \
    printf -- "--extractor-args youtube:player_client=ios,android\n--js-runtimes node\n--no-check-certificates\n--socket-timeout 30\n" \
    > /root/.config/yt-dlp/config

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /tmp/bot-downloads /app/sessions /app/data /app/data/stats /app/data/notes /app/data/banned

EXPOSE 3000

CMD ["node", "src/index.js"]