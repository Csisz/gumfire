# GUMFIRE — the game and the online server in one small container (M17).
#   docker build -t gumfire .
#   docker run -d --name gumfire -p 8787:8787 --restart unless-stopped gumfire
# Then open http://<host>:8787 — "Online" connects to the same address.
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @gumfire/client build && pnpm --filter @gumfire/server build

FROM node:22-alpine
WORKDIR /app
RUN npm init -y >/dev/null && npm install --omit=dev ws@8 && npm cache clean --force
COPY --from=build /src/apps/server/dist/server.mjs ./server.mjs
COPY --from=build /src/apps/client/dist ./public
ENV PORT=8787 STATIC_DIR=/app/public NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8787/health || exit 1
USER node
CMD ["node", "server.mjs"]
