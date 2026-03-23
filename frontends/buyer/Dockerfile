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
RUN bun run build

FROM nginx:alpine
COPY --from=builder /frontends/buyer/dist /usr/share/nginx/html
COPY buyer/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
