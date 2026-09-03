# Same pattern as promotions-service/Dockerfile — see that file's header
# comment for why the build context is the monorepo root, and the WORKDIR
# fix comment for why CWD must be this service's own directory (NODE_OPTIONS
# --require resolution).
FROM node:26-alpine AS base
RUN npm install -g pnpm@11.24.0
WORKDIR /repo

FROM base AS deps
COPY . .
RUN pnpm install --filter @vsb/passenger-service... --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo .
WORKDIR /repo/services/passenger-service
EXPOSE 3005
CMD ["node", "src/server.js"]
