# MVP.md WP-09: multi-stage Node 22 image for the seed API.
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY schema ./schema
COPY services/seed ./services/seed
COPY bootstrap ./bootstrap
RUN mkdir -p test/e2e
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @enspack/core --filter @enspack/torrent --filter @enspack/seed build
RUN pnpm deploy --filter @enspack/seed --prod /deploy

FROM node:22-alpine
WORKDIR /app
COPY --from=build /deploy ./
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]
