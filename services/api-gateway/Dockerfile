# Same pattern as promotions-service/Dockerfile — see that file's header
# comment for why the build context is the monorepo root.
FROM node:26-alpine AS base
RUN npm install -g pnpm@11.24.0
WORKDIR /repo

FROM base AS deps
COPY . .
RUN pnpm install --filter @vsb/api-gateway... --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo .
EXPOSE 3000
CMD ["node", "services/api-gateway/src/server.js"]
