FROM oven/bun:1.4.4-alpine

WORKDIR /app

ENV NODE_ENV=production
# No runtime transpiler cache, so the container runs on a read-only root filesystem.
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

COPY package.json tsconfig.json ./
COPY src ./src

USER bun
EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
