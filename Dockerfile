# Use lightweight Node.js image
FROM node:20-slim

# Create and set the working directory
WORKDIR /app

# Install system dependencies (build-essential for better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . .

# Create a data directory for persistence
RUN mkdir -p /app/data && chown -R node:node /app/data

# Switch to non-root user and set HOME for HF compatibility
USER node
ENV HOME=/home/node
WORKDIR $HOME/app
RUN mkdir -p $HOME/app/data

# Start the Telegram bot
EXPOSE 7860
CMD ["node", "start-telegram.js"]
