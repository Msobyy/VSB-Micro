# Build context is the monorepo root (see infra/docker-compose.dev.yaml)
# because pnpm needs the whole workspace manifest to resolve this service's
# "workspace:*" deps on libs/* — a single service's package.json alone isn't
# enough for pnpm to build the dependency graph.
FROM node:26-alpine AS base
RUN npm install -g pnpm@11.24.0
WORKDIR /repo

FROM base AS deps
COPY . .
RUN pnpm install --filter @vsb/promotions-service... --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo .
EXPOSE 3001
CMD ["node", "services/promotions-service/src/server.js"]
