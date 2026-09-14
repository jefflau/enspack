FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY schema ./schema
COPY packages/core ./packages/core
COPY services/indexer ./services/indexer

RUN pnpm install --frozen-lockfile --filter @enspack/indexer...
RUN pnpm --filter @enspack/core build

WORKDIR /app/services/indexer

EXPOSE 42069

CMD ["pnpm", "exec", "ponder", "start"]
