FROM node:22-alpine AS base

# Stage 1: Install ALL dependencies (including dev for tsx)
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY x402-endpoint/package.json ./x402-endpoint/
COPY feeder/package.json ./feeder/
COPY agent/package.json ./agent/
COPY frontend/package.json ./frontend/
RUN npm install

# Stage 2: Build (compile TypeScript to JS)
FROM deps AS builder
WORKDIR /app
COPY . .
WORKDIR /app/x402-endpoint
RUN npx tsc --outDir dist

# Stage 3: Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

COPY --from=deps --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/x402-endpoint/dist ./x402-endpoint/dist
COPY --from=builder --chown=appuser:nodejs /app/x402-endpoint/package.json ./x402-endpoint/

USER appuser
EXPOSE 4021

ENV X402_PORT=4021
ENV HOST=0.0.0.0

CMD ["node", "x402-endpoint/dist/index.js"]
