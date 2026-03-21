FROM oven/bun:alpine AS deps
WORKDIR /app
COPY package.json ./
RUN bun install --frozen-lockfile

FROM oven/bun:alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG VITE_IPFS_GATEWAY
ENV VITE_IPFS_GATEWAY=$VITE_IPFS_GATEWAY
RUN bun run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
