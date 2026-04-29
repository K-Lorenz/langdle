# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Nur für vite/svelte-kit Postbuild (Server-Chunk-Analyse); echtes Postgres wird zur Build-Zeit nicht geöffnet.
ENV DATABASE_URL=postgres://langdle:langdle@127.0.0.1:5432/langdle
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/build ./build

EXPOSE 3000
CMD ["node", "build/index.js"]
