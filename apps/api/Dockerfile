# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app
# Cài pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate
# Copy workspace root cần thiết để resolve workspace packages
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api...
COPY apps/api/ apps/api/
RUN pnpm --filter api build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Chỉ cài production deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN corepack enable && corepack prepare pnpm@latest --activate \
    && pnpm install --frozen-lockfile --filter api --prod \
    && corepack disable
COPY --from=builder /app/apps/api/dist apps/api/dist
# Scripts cần ts-node — ta chỉ cần chạy trc khi start qua entrypoint riêng
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
