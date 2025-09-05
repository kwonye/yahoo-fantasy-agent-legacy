FROM node:22.18.0
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && (npm ci || npm install)
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
EXPOSE 3443
CMD ["node","dist/start.js"]
