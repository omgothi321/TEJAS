FROM node:20-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    alsa-utils \
    && rm -rf /var/lib/apt/lists/*

# Install app dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Set permissions
RUN chmod +x bin/tejas.js

# Link globally
RUN npm link

# Environment variables
ENV NODE_ENV=production

# Start Telegram integration by default
CMD ["node", "src/integrations/telegram.js"]
