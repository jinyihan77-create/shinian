FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 echo && useradd --system --uid 1001 --gid echo echo
COPY --from=build --chown=echo:echo /app/.next/standalone ./
COPY --from=build --chown=echo:echo /app/.next/static ./.next/static
COPY --from=build --chown=echo:echo /app/public ./public
USER echo
EXPOSE 3000
CMD ["node", "server.js"]
