FROM oven/bun:alpine AS deps
WORKDIR /frontends/buyer
COPY buyer/package.json ./
RUN bun install --frozen-lockfile

FROM oven/bun:alpine AS builder
WORKDIR /frontends/buyer
COPY --from=deps /frontends/buyer/node_modules ./node_modules
RUN ln -s /frontends/buyer/node_modules /frontends/node_modules
COPY buyer/ .
COPY shared/ /frontends/shared/
ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN bun run build

FROM oven/bun:alpine
WORKDIR /app
COPY --from=builder /frontends/buyer/node_modules ./node_modules
COPY --from=builder /frontends/buyer/dist ./dist
COPY buyer/package.json buyer/vite.config.ts buyer/tsconfig.json ./
EXPOSE 3002
CMD ["bun", "run", "preview", "--host", "0.0.0.0"]
