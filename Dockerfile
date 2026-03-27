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

# Switch to non-root user
USER node

# Default port for some web components (if any)
EXPOSE 3000

# Start the Telegram bot by default
CMD ["npm", "run", "telegram"]
