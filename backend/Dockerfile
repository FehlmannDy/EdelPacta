FROM oven/bun:alpine AS deps

WORKDIR /app

COPY package.json ./
RUN bun install --production --frozen-lockfile

FROM oven/bun:distroless

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY tsconfig.json ./

EXPOSE 8080

CMD ["src/index.ts"]