# One-box seed image for `enspack-bootstrap` (infra compose profile `bootstrap`).
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY schema ./schema
COPY bootstrap ./bootstrap
COPY infra/package.json ./infra/package.json
RUN mkdir -p test/e2e
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @enspack/core --filter @enspack/hf --filter @enspack/torrent --filter @enspack/bootstrap build
RUN pnpm deploy --filter @enspack/bootstrap --prod /deploy

FROM node:22-alpine
RUN apk add --no-cache aria2
WORKDIR /app
COPY --from=build /deploy ./
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--help"]
