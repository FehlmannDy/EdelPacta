FROM oven/bun:alpine AS deps
WORKDIR /frontends/vendor
COPY vendor/package.json ./
RUN bun install --frozen-lockfile

FROM oven/bun:alpine AS builder
WORKDIR /frontends/vendor
COPY --from=deps /frontends/vendor/node_modules ./node_modules
RUN ln -s /frontends/vendor/node_modules /frontends/node_modules
COPY vendor/ .
COPY shared/ /frontends/shared/
ARG VITE_IPFS_GATEWAY
ENV VITE_IPFS_GATEWAY=$VITE_IPFS_GATEWAY
RUN bun run build

FROM nginx:alpine
COPY --from=builder /frontends/vendor/dist /usr/share/nginx/html
COPY vendor/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
