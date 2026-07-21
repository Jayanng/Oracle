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
# ── Shared contract addresses (set these to auto-configure all services) ────
#   ORACLE_ADDRESS=0x...           # CupEventOracle contract
#   DROPS_ADDRESS=0x...            # FanDrops contract
#   TREASURY_ADDRESS=0x...         # OracleTreasury contract
#
# ── Frontend build args ────────────────────────────────────────────────────
#   NEXT_PUBLIC_INJ_EVM_CHAIN_ID=1439
#   NEXT_PUBLIC_INJ_EVM_RPC=https://k8s.testnet.json-rpc.injective.network
#   NEXT_PUBLIC_INJ_EVM_EXPLORER=https://testnet.blockscout.injective.network
#   NEXT_PUBLIC_ORACLE_ADDRESS=0x...
#   NEXT_PUBLIC_DROPS_ADDRESS=0x...
#   NEXT_PUBLIC_TREASURY_ADDRESS=0x...
#   NEXT_PUBLIC_USDC_ADDRESS=0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d
#   NEXT_PUBLIC_CCTP_TOKEN_MESSENGER=0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
#
# ── Feeder secrets (set these env vars and deploy.sh will auto-set them) ───
#   SPORTS_API_KEY                # API-Football / sports data provider key
#   SPORTS_PROVIDER               # hybrid | simulator | api-football
#   SPORTS_SEASON                 # 2026 (default) or 2022 for WC data
#   FEEDER_PRIVATE_KEY            # Private key for writing events to oracle
#
# ── x402-endpoint secrets ─────────────────────────────────────────────────
#   X402_RECEIVER_ADDRESS          # Address that receives x402 payments
#   X402_FACILITATOR_PRIVATE_KEY   # Private key for payment facilitation
#
# ── Agent secrets ─────────────────────────────────────────────────────────
#   OPENAI_API_KEY                 # Or other LLM provider key
#   GROQ_API_KEY                  # Alternative LLM (preferred)
#   AGENT_PRIVATE_KEY             # Private key for on-chain write tools
#   AUTO_DROP_AMOUNT_USDC         # Per-winner USDC for auto-created drops (default 0.10)
#   AUTO_DROP_MAX_WINNERS         # Max winners for auto-created drops (default 20)
#
# ── Frontend runtime secrets ──────────────────────────────────────────────
#   FEEDER_URL                     # URL of the feeder service
#   AGENT_URL                      # URL of the agent service
#   X402_ENDPOINT_URL              # URL of the x402-endpoint service
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

# ── Helpers ────────────────────────────────────────────────────────────────

# Print a divider header
section() {
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════════╗"
  printf "  ║  %-60s  ║\n" "$1"
  echo "  ╚══════════════════════════════════════════════════════════════╝"
  echo ""
}

# Run fly secrets set with the given app and kv pairs — only for non-empty values
set_secrets() {
  local app="$1"
  shift
  local args=()
  while [ $# -gt 0 ]; do
    local key="$1"
    local val="$2"
    shift 2
    if [ -n "${val:-}" ]; then
      args+=("${key}=${val}")
    fi
  done
  if [ ${#args[@]} -gt 0 ]; then
    echo "  Setting ${#args[@]} secret(s) for ${app}..."
    fly secrets set --app "${app}" "${args[@]}"
  fi
}

# Print a reminder block for a service's secrets format
remind_feeder()   { section "Feeder secrets reminder";   echo "  If any secrets are still missing, set them:";  echo "  fly secrets set --app ${APP_FEEDER} \\";  echo "    SPORTS_API_KEY=\"your-key-here\" \\";  echo "    SPORTS_PROVIDER=\"hybrid\" \\";  echo "    SPORTS_SEASON=\"2026\" \\";  echo "    ORACLE_ADDRESS=\"0x...\" \\";  echo "    DROPS_ADDRESS=\"0x...\" \\";  echo "    TREASURY_ADDRESS=\"0x...\" \\";  echo "    FEEDER_PRIVATE_KEY=\"0x...\"";  echo ""; }
remind_x402()     { section "x402 secrets reminder";     echo "  If any secrets are still missing, set them:";  echo "  fly secrets set --app ${APP_X402} \\";  echo "    X402_RECEIVER_ADDRESS=\"0x...\" \\";  echo "    X402_FACILITATOR_PRIVATE_KEY=\"0x...\" \\";  echo "    FEEDER_URL=\"${BASE_FEEDER}\" \\";  echo "    ORACLE_ADDRESS=\"0x...\" \\";  echo "    DROPS_ADDRESS=\"0x...\" \\";  echo "    TREASURY_ADDRESS=\"0x...\"";  echo ""; }
remind_agent()    { section "Agent secrets reminder";    echo "  If any secrets are still missing, set them:";  echo "  fly secrets set --app ${APP_AGENT} \\";  echo "    OPENAI_API_KEY=\"sk-...\" \\";  echo "    GROQ_API_KEY=\"gsk-...\" \\";  echo "    FEEDER_URL=\"${BASE_FEEDER}\" \\";  echo "    X402_ENDPOINT_URL=\"${BASE_X402}\" \\";  echo "    ORACLE_ADDRESS=\"0x...\" \\";  echo "    DROPS_ADDRESS=\"0x...\" \\";  echo "    TREASURY_ADDRESS=\"0x...\" \\";  echo "    AGENT_PRIVATE_KEY=\"0x...\"";  echo ""; }
remind_frontend() { section "Frontend secrets reminder"; echo "  If any secrets are still missing, set them:"; echo "  fly secrets set --app ${APP_FRONTEND} \\";  echo "    FEEDER_URL=\"${BASE_FEEDER}\" \\";  echo "    AGENT_URL=\"${BASE_AGENT}\" \\";  echo "    X402_ENDPOINT_URL=\"${BASE_X402}\"";  echo ""; }

# ── Deploy functions ───────────────────────────────────────────────────────

deploy_frontend() {
  echo ""
  echo "  >>> Deploying frontend (${APP_FRONTEND})..."
  echo "      Build args: NEXT_PUBLIC_INJ_EVM_CHAIN_ID, RPC, EXPLORER, ORACLE, DROPS, TREASURY, USDC, CCTP"
  echo ""
  fly deploy \
    --config frontend/fly.toml \
    --dockerfile frontend/Dockerfile \
    --build-arg NEXT_PUBLIC_INJ_EVM_CHAIN_ID="${NEXT_PUBLIC_INJ_EVM_CHAIN_ID:-1439}" \
    --build-arg NEXT_PUBLIC_INJ_EVM_RPC="${NEXT_PUBLIC_INJ_EVM_RPC:-https://k8s.testnet.json-rpc.injective.network}" \
    --build-arg NEXT_PUBLIC_INJ_EVM_EXPLORER="${NEXT_PUBLIC_INJ_EVM_EXPLORER:-https://testnet.blockscout.injective.network}" \
    --build-arg NEXT_PUBLIC_ORACLE_ADDRESS="${NEXT_PUBLIC_ORACLE_ADDRESS}" \
    --build-arg NEXT_PUBLIC_DROPS_ADDRESS="${NEXT_PUBLIC_DROPS_ADDRESS}" \
    --build-arg NEXT_PUBLIC_TREASURY_ADDRESS="${NEXT_PUBLIC_TREASURY_ADDRESS}" \
    --build-arg NEXT_PUBLIC_USDC_ADDRESS="${NEXT_PUBLIC_USDC_ADDRESS:-0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d}" \
    --build-arg NEXT_PUBLIC_CCTP_TOKEN_MESSENGER="${NEXT_PUBLIC_CCTP_TOKEN_MESSENGER:-0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA}" \
    .
  # NOTE: X402_ENDPOINT_URL is hardcoded to BASE_X402 because the local
  # .env often has http://localhost:4021/premium-stats which breaks the
  # production proxy. The deploy script always knows the correct Fly URL.
  set_secrets "${APP_FRONTEND}" \
    FEEDER_URL           "${FEEDER_URL:-${BASE_FEEDER}}" \
    AGENT_URL            "${AGENT_URL:-${BASE_AGENT}}" \
    X402_ENDPOINT_URL    "${BASE_X402}"
  remind_frontend
}

deploy_x402() {
  echo ""
  echo "  >>> Deploying x402-endpoint (${APP_X402})..."
  echo "      Port: 4021"
  echo ""
  fly deploy --config x402-endpoint/fly.toml --dockerfile x402-endpoint/Dockerfile .
  set_secrets "${APP_X402}" \
    X402_RECEIVER_ADDRESS         "${X402_RECEIVER_ADDRESS:-}" \
    X402_FACILITATOR_PRIVATE_KEY  "${X402_FACILITATOR_PRIVATE_KEY:-}" \
    FEEDER_URL                    "${FEEDER_URL:-${BASE_FEEDER}}" \
    X402_BASE_URL                 "${X402_BASE_URL:-${BASE_X402}}" \
    ORACLE_ADDRESS                "${ORACLE_ADDRESS:-}" \
    DROPS_ADDRESS                 "${DROPS_ADDRESS:-}" \
    TREASURY_ADDRESS              "${TREASURY_ADDRESS:-}"
  remind_x402
}

deploy_agent() {
  echo ""
  echo "  >>> Deploying agent (${APP_AGENT})..."
  echo "      Port: 4020"
  echo ""
  fly deploy --config agent/fly.toml --dockerfile agent/Dockerfile .
  set_secrets "${APP_AGENT}" \
    OPENAI_API_KEY        "${OPENAI_API_KEY:-}" \
    GROQ_API_KEY          "${GROQ_API_KEY:-}" \
    FEEDER_URL            "${FEEDER_URL:-${BASE_FEEDER}}" \
    X402_ENDPOINT_URL     "${X402_ENDPOINT_URL:-${BASE_X402}}" \
    ORACLE_ADDRESS        "${ORACLE_ADDRESS:-}" \
    DROPS_ADDRESS         "${DROPS_ADDRESS:-}" \
    TREASURY_ADDRESS      "${TREASURY_ADDRESS:-}" \
    AGENT_PRIVATE_KEY     "${AGENT_PRIVATE_KEY:-}" \
    AUTO_DROP_AMOUNT_USDC "${AUTO_DROP_AMOUNT_USDC:-}" \
    AUTO_DROP_MAX_WINNERS "${AUTO_DROP_MAX_WINNERS:-}"
  remind_agent
}

deploy_feeder() {
  echo ""
  echo "  >>> Deploying feeder (${APP_FEEDER})..."
  echo "      Port: 4030"
  echo ""
  fly deploy --config feeder/fly.toml --dockerfile feeder/Dockerfile .
  set_secrets "${APP_FEEDER}" \
    SPORTS_API_KEY    "${SPORTS_API_KEY:-}" \
    SPORTS_PROVIDER   "${SPORTS_PROVIDER:-}" \
    SPORTS_SEASON     "${SPORTS_SEASON:-}" \
    ORACLE_ADDRESS    "${ORACLE_ADDRESS:-}" \
    DROPS_ADDRESS     "${DROPS_ADDRESS:-}" \
    TREASURY_ADDRESS  "${TREASURY_ADDRESS:-}" \
    FEEDER_PRIVATE_KEY "${FEEDER_PRIVATE_KEY:-}"
  remind_feeder
}

# ── Main ───────────────────────────────────────────────────────────────────

echo ""
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║          KICKOFF — Fly.io Deployment                        ║"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo ""

case "${SERVICE}" in
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
    echo "    $0 agent            # deploy only the agent"
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
echo "  ║  Secrets with provided env vars were auto-set.              ║"
echo "  ║  Check the reminders above for any still-missing secrets.   ║"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo ""
