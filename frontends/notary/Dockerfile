FROM oven/bun:alpine AS deps
WORKDIR /frontends/notary
COPY notary/package.json ./
RUN bun install --frozen-lockfile

FROM oven/bun:alpine AS builder
WORKDIR /frontends/notary
COPY --from=deps /frontends/notary/node_modules ./node_modules
RUN ln -s /frontends/notary/node_modules /frontends/node_modules
COPY notary/ .
COPY shared/ /frontends/shared/
ARG VITE_IPFS_GATEWAY
ENV VITE_IPFS_GATEWAY=$VITE_IPFS_GATEWAY
RUN bun run build

FROM nginx:alpine
COPY --from=builder /frontends/notary/dist /usr/share/nginx/html
COPY notary/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
