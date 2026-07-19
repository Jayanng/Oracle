FROM node:22-alpine AS base

# Stage 1: Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json ./frontend/
COPY agent/package.json ./agent/
COPY feeder/package.json ./feeder/
COPY x402-endpoint/package.json ./x402-endpoint/
RUN npm install
RUN npm install sharp

# Stage 2: Build the Next.js app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
WORKDIR /app/frontend
ARG NEXT_PUBLIC_INJ_EVM_CHAIN_ID
ARG NEXT_PUBLIC_INJ_EVM_RPC
ARG NEXT_PUBLIC_INJ_EVM_EXPLORER
ARG NEXT_PUBLIC_ORACLE_ADDRESS
ARG NEXT_PUBLIC_DROPS_ADDRESS
ARG NEXT_PUBLIC_TREASURY_ADDRESS
ARG NEXT_PUBLIC_USDC_ADDRESS
ARG NEXT_PUBLIC_CCTP_TOKEN_MESSENGER
ARG FEEDER_URL
ARG AGENT_URL
ARG X402_ENDPOINT_URL
ENV NEXT_PUBLIC_INJ_EVM_CHAIN_ID=${NEXT_PUBLIC_INJ_EVM_CHAIN_ID:-1439}
ENV NEXT_PUBLIC_INJ_EVM_RPC=${NEXT_PUBLIC_INJ_EVM_RPC:-https://k8s.testnet.json-rpc.injective.network}
ENV NEXT_PUBLIC_INJ_EVM_EXPLORER=${NEXT_PUBLIC_INJ_EVM_EXPLORER:-https://testnet.blockscout.injective.network}
ENV FEEDER_URL=${FEEDER_URL}
ENV AGENT_URL=${AGENT_URL}
ENV X402_ENDPOINT_URL=${X402_ENDPOINT_URL}
RUN npm run build

# Stage 3: Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone folder (nested under frontend/ in monorepo workspaces)
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone/ ./
# Copy static assets into the nested frontend/ directory (where server.js lives)
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/frontend/public frontend/public

USER nextjs
EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0
ENV HOSTNAME=0.0.0.0

# Standalone output is nested under frontend/ due to monorepo workspace structure
CMD ["node", "frontend/server.js"]
