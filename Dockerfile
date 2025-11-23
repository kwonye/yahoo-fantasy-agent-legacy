# Slim production image for Yahoo Fantasy Agent

# -------- Builder stage --------
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy sources
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# Build TypeScript
RUN npm run build

# Prune devDependencies for production
RUN npm prune --omit=dev


# -------- Runtime stage --------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Create runtime writable dirs (can be mounted by host)
RUN mkdir -p /app/config /app/logs /app/.secure

# Copy built app and production deps only
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Default port
EXPOSE 3000

# Install git and curl
RUN apk add --no-cache git curl && \
    curl -sSL https://github.com/cli/cli/releases/download/v2.50.0/gh_2.50.0_linux_arm64.tar.gz -o gh.tar.gz && \
    tar -xvf gh.tar.gz && \
    mv gh_2.50.0_linux_arm64/bin/gh /usr/local/bin/ && \
    rm -rf gh.tar.gz gh_2.50.0_linux_arm64 && \
    git config --global --add safe.directory /app

# Entrypoint for runtime setup
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Recommended env (override in Docker/compose):
#  - YAHOO_XML_WRITE=1
#  - DEBUG_YAHOO=1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/web/server.js"]
