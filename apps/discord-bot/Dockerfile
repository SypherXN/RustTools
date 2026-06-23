FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/discord-bot/package.json ./apps/discord-bot/
COPY packages/shared/package.json ./packages/shared/
RUN npm install
COPY . .
RUN npm run build --workspace=@rusttools/shared \
  && npm run build --workspace=@rusttools/discord-bot

FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/discord-bot/package.json ./apps/discord-bot/
COPY packages/shared/package.json ./packages/shared/
RUN npm install --omit=dev
COPY --from=builder /app/apps/discord-bot/dist ./apps/discord-bot/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
ENV NODE_ENV=production
CMD ["node", "apps/discord-bot/dist/index.js"]
