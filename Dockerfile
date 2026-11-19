FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22.22.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.mastra/output ./
COPY db ./db
COPY scripts ./scripts
COPY certs ./certs
USER node
EXPOSE 4111
CMD ["sh", "-c", "node scripts/recover.mjs && exec node index.mjs"]
