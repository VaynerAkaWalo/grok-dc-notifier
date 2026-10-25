FROM --platform=$BUILDPLATFORM oven/bun:1.4.4-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.4-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

USER bun
EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
