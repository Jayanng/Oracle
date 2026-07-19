#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# KICKOFF — Fly.io deployment script
# =============================================================================
# Usage:
#   ./deploy.sh [service]
#
# Services:  frontend | x402 | agent | feeder | all
#
# Environment variables you can set (defaults shown):
#
#  ── Frontend build args ────────────────────────────────────────────────────
#   NEXT_PUBLIC_INJ_EVM_CHAIN_ID=1439
#   NEXT_PUBLIC_INJ_EVM_RPC=https://k8s.testnet.json-rpc.injective.network
#   NEXT_PUBLIC_INJ_EVM_EXPLORER=https://testnet.blockscout.injective.network
#
#  ── Feeder secrets (set via `fly secrets set --app kickoff-feeder`) ────────
#   SPORTS_API_KEY           # API-Football / sports data provider key
#   SPORTS_PROVIDER          # hybrid | simulator | api-football
#   SPORTS_SEASON            # 2026 (default) or 2022 for WC data
#
#  ── x402-endpoint secrets (set via `fly secrets set --app kickoff-x402`) ───
#   X402_RECEIVER_ADDRESS     # Address that receives x402 payments
#   X402_FACILITATOR_PRIVATE_KEY  # Private key for payment facilitation
#   FEEDER_URL                # URL of the feeder service
#
#  ── Agent secrets (set via `fly secrets set --app kickoff-agent`) ──────────
#   OPENAI_API_KEY            # Or other LLM provider key
#   FEEDER_URL                # URL of the feeder service
#   X402_ENDPOINT_URL         # URL of the x402-endpoint service
#   AGENT_ORACLE_ADDRESS      # Override oracle address (optional)
#   AGENT_DROPS_ADDRESS       # Override drops address (optional)
#   AGENT_TREASURY_ADDRESS    # Override treasury address (optional)
#
#  ── Frontend secrets (set via `fly secrets set --app kickoff`) ────────────
#   FEEDER_URL                # URL of the feeder service
#   AGENT_URL                 # URL of the agent service
#   X402_ENDPOINT_URL         # URL of the x402-endpoint service
# =============================================================================

SERVICE="${1:-all}"

# App names per service
APP_FRONTEND="kickoff"
APP_X402="kickoff-x402"
APP_AGENT="kickoff-agent"
APP_FEEDER="kickoff-feeder"

# Derive base URL for cross-service links
BASE_FRONTEND="https://${APP_FRONTEND}.fly.dev"
BASE_X402="https://${APP_X402}.fly.dev"
BASE_AGENT="https://${APP_AGENT}.fly.dev"
BASE_FEEDER="https://${APP_FEEDER}.fly.dev"

# ── Secrets / env helpers ──────────────────────────────────────────────────

secrets_feeder() {
  cat <<EOF

  ╔══════════════════════════════════════════════════════════════╗
  ║  Set feeder secrets                                         ║
  ╚══════════════════════════════════════════════════════════════╝

  fly secrets set --app ${APP_FEEDER} \\
    SPORTS_API_KEY="your-key-here" \\
    SPORTS_PROVIDER="hybrid" \\
    SPORTS_SEASON="2026"
EOF
}

secrets_x402() {
  cat <<EOF

  ╔══════════════════════════════════════════════════════════════╗
  ║  Set x402-endpoint secrets                                  ║
  ╚══════════════════════════════════════════════════════════════╝

  fly secrets set --app ${APP_X402} \\
    X402_RECEIVER_ADDRESS="0x..." \\
    X402_FACILITATOR_PRIVATE_KEY="0x..." \\
    FEEDER_URL="${BASE_FEEDER}"
EOF
}

secrets_agent() {
  cat <<EOF

  ╔══════════════════════════════════════════════════════════════╗
  ║  Set agent secrets                                          ║
  ╚══════════════════════════════════════════════════════════════╝

  fly secrets set --app ${APP_AGENT} \\
    OPENAI_API_KEY="sk-..." \\
    FEEDER_URL="${BASE_FEEDER}" \\
    X402_ENDPOINT_URL="${BASE_X402}"
EOF
}

secrets_frontend() {
  cat <<EOF

  ╔══════════════════════════════════════════════════════════════╗
  ║  Set frontend secrets                                       ║
  ╚══════════════════════════════════════════════════════════════╝

  fly secrets set --app ${APP_FRONTEND} \\
    FEEDER_URL="${BASE_FEEDER}" \\
    AGENT_URL="${BASE_AGENT}" \\
    X402_ENDPOINT_URL="${BASE_X402}"
EOF
}

# ── Deploy functions ───────────────────────────────────────────────────────

deploy_frontend() {
  echo ""
  echo "  >>> Deploying frontend (${APP_FRONTEND})..."
  echo "      Build args: NEXT_PUBLIC_INJ_EVM_CHAIN_ID, RPC, EXPLORER"
  echo ""
  fly deploy \
    --config frontend/fly.toml \
    --dockerfile frontend/Dockerfile \
    --build-arg NEXT_PUBLIC_INJ_EVM_CHAIN_ID="${NEXT_PUBLIC_INJ_EVM_CHAIN_ID:-1439}" \
    --build-arg NEXT_PUBLIC_INJ_EVM_RPC="${NEXT_PUBLIC_INJ_EVM_RPC:-https://k8s.testnet.json-rpc.injective.network}" \
    --build-arg NEXT_PUBLIC_INJ_EVM_EXPLORER="${NEXT_PUBLIC_INJ_EVM_EXPLORER:-https://testnet.blockscout.injective.network}" \
    .
  secrets_frontend
}

deploy_x402() {
  echo ""
  echo "  >>> Deploying x402-endpoint (${APP_X402})..."
  echo "      Port: 4021"
  echo ""
  fly deploy --config x402-endpoint/fly.toml --dockerfile x402-endpoint/Dockerfile .
  secrets_x402
}

deploy_agent() {
  echo ""
  echo "  >>> Deploying agent (${APP_AGENT})..."
  echo "      Port: 4020"
  echo ""
  fly deploy --config agent/fly.toml --dockerfile agent/Dockerfile .
  secrets_agent
}

deploy_feeder() {
  echo ""
  echo "  >>> Deploying feeder (${APP_FEEDER})..."
  echo "      Port: 4030"
  echo ""
  fly deploy --config feeder/fly.toml --dockerfile feeder/Dockerfile .
  secrets_feeder
}

# ── Main ───────────────────────────────────────────────────────────────────

echo ""
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║          KICKOFF — Fly.io Deployment                        ║"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo ""

case "$SERVICE" in
  frontend) deploy_frontend ;;
  x402)     deploy_x402 ;;
  agent)    deploy_agent ;;
  feeder)   deploy_feeder ;;
  all)
    echo "  Deploying ALL services in order: feeder → x402 → agent → frontend"
    echo ""
    deploy_feeder
    echo ""
    deploy_x402
    echo ""
    deploy_agent
    echo ""
    deploy_frontend
    ;;
  *)
    echo "  Usage: $0 [frontend | x402 | agent | feeder | all]"
    echo ""
    echo "  Examples:"
    echo "    $0 all              # deploy everything"
    echo "    $0 frontend         # deploy only the frontend"
    echo ""
    exit 1
    ;;
esac

echo ""
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║  Deployment complete!                                       ║"
echo "  ║                                                             ║"
echo "  ║  Frontend:  ${BASE_FRONTEND}                      ║"
echo "  ║  x402:      ${BASE_X402}               ║"
echo "  ║  Agent:     ${BASE_AGENT}                ║"
echo "  ║  Feeder:    ${BASE_FEEDER}              ║"
echo "  ║                                                             ║"
echo "  ║  Don't forget to set secrets (printed above if needed)!     ║"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo ""
