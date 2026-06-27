FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/discord-bot/package.json ./apps/discord-bot/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/rustplus-client/package.json ./packages/rustplus-client/
COPY patches ./patches
RUN npm install
COPY . .
RUN npm run build --workspace=@rusttools/shared \
  && npm run build --workspace=@rusttools/db \
  && npm run build --workspace=@rusttools/rustplus-client \
  && npm run build --workspace=@rusttools/api

FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/rustplus-client/package.json ./packages/rustplus-client/
COPY patches ./patches
RUN npm install --omit=dev
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=builder /app/packages/rustplus-client/dist ./packages/rustplus-client/dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "node packages/db/dist/migrate.js && node apps/api/dist/index.js"]
