FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/db/package*.json ./packages/db/
COPY apps/mcp-server/package*.json ./apps/mcp-server/
COPY apps/mcp-engineering/package*.json ./apps/mcp-engineering/

# Install all workspace dependencies
RUN npm ci

# Copy source code and artifacts
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# Generate prisma client if present
RUN cd packages/db && npx prisma generate || true

# Build NestJS API
RUN npm run build --workspace=apps/api

FROM node:20-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y openssl curl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/apps/api ./apps/api

EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
