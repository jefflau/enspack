FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY schema ./schema
COPY packages/core ./packages/core
COPY packages/hf ./packages/hf
COPY services/registrar ./services/registrar

RUN pnpm install --frozen-lockfile --filter @enspack/registrar...
RUN pnpm --filter @enspack/core build
RUN pnpm --filter @enspack/hf build
RUN pnpm --filter @enspack/registrar build

WORKDIR /app/services/registrar

EXPOSE 8787

CMD ["node", "dist/server.js"]
