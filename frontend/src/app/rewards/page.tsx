"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { parseUnits, pad } from "viem";
import { toast } from "sonner";
import {
  REWARDS_ABI,
  REWARDS_ADDRESS,
  USDC_ADDRESS,
  ERC20_ABI,
  CCTP_TOKEN_MESSENGER,
  TOKEN_MESSENGER_ABI,
} from "@/lib/contracts";
import { shortAddr } from "@/lib/utils";

const MATCH = Number(process.env.NEXT_PUBLIC_FIXTURE_ID || "2026001");
const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:4020";
const SEPOLIA_DOMAIN = 0; // Ethereum Sepolia CCTP domain

type Step = "idle" | "pending" | "done" | "error" | "sim";

export default function RewardsPage() {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("5");
  const [cctpSim, setCctpSim] = useState(true);
  const [steps, setSteps] = useState<Record<number, Step>>({
    1: "idle",
    2: "idle",
    3: "idle",
    4: "idle",
  });
  const [x402Log, setX402Log] = useState<unknown>(null);
  const { writeContractAsync, isPending } = useWriteContract();

  const hasRewards = Boolean(REWARDS_ADDRESS && REWARDS_ADDRESS.length === 42);

  const { data: market } = useReadContract({
    address: hasRewards ? REWARDS_ADDRESS : undefined,
    abi: REWARDS_ABI,
    functionName: "markets",
    args: [BigInt(MATCH)],
    query: { enabled: hasRewards, refetchInterval: 10_000 },
  });

  const { data: userStakes } = useReadContract({
    address: hasRewards && address ? REWARDS_ADDRESS : undefined,
    abi: REWARDS_ABI,
    functionName: "stakes",
    args: address ? [BigInt(MATCH), address] : undefined,
    query: { enabled: Boolean(hasRewards && address) },
  });

  const { data: usdcBal } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const m = market as
    | readonly [bigint, bigint, number, bigint, bigint, bigint, boolean]
    | undefined;
  const totalStaked = m
    ? Number(m[3] + m[4] + m[5]) / 1e6
    : 0;
  const settled = m?.[6] ?? false;
  const resolved = m?.[2] ?? 0;
  const stakes = userStakes as readonly [bigint, bigint, bigint] | undefined;

  async function claim() {
    if (!hasRewards) return toast.error("REWARDS_ADDRESS not set");
    try {
      const hash = await writeContractAsync({
        address: REWARDS_ADDRESS,
        abi: REWARDS_ABI,
        functionName: "claim",
        args: [BigInt(MATCH)],
      });
      toast.success(`Claim tx ${hash.slice(0, 12)}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "claim failed");
    }
  }

  async function runCctp() {
    if (!address) return toast.error("Connect wallet");
    const amt = parseUnits(amount, 6);

    if (cctpSim) {
      setSteps({ 1: "sim", 2: "sim", 3: "sim", 4: "sim" });
      try {
        if (hasRewards) {
          const recipient = pad(address as `0x${string}`, { size: 32 });
          await writeContractAsync({
            address: REWARDS_ADDRESS,
            abi: REWARDS_ABI,
            functionName: "logCrossChainWithdraw",
            args: [BigInt(MATCH), SEPOLIA_DOMAIN, amt, recipient],
          });
        }
        toast.success("CCTP simulator: intent logged (no live attestation wait)");
      } catch (e) {
        toast.message("Simulator UI only — " + (e instanceof Error ? e.message : ""));
      }
      return;
    }

    try {
      setSteps({ 1: "pending", 2: "idle", 3: "idle", 4: "idle" });
      await writeContractAsync({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CCTP_TOKEN_MESSENGER, amt],
      });
      setSteps((s) => ({ ...s, 1: "done", 2: "pending" }));

      const mintRecipient = pad(address as `0x${string}`, { size: 32 });
      const hash = await writeContractAsync({
        address: CCTP_TOKEN_MESSENGER,
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [amt, SEPOLIA_DOMAIN, mintRecipient, USDC_ADDRESS],
      });
      setSteps((s) => ({ ...s, 2: "done", 3: "pending" }));
      toast.success(`Burn submitted ${hash.slice(0, 12)}… poll attestation offline`);
      // Attestation can take minutes — leave step 3 pending with note
      setSteps((s) => ({ ...s, 3: "pending", 4: "idle" }));
    } catch (e) {
      setSteps((s) => ({ ...s, 1: "error", 2: "error" }));
      toast.error(e instanceof Error ? e.message : "CCTP failed");
    }
  }

  async function x402Demo() {
    try {
      const r = await fetch(`${AGENT_URL}/x402-demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: MATCH }),
      });
      const data = await r.json();
      setX402Log(data);
      toast.success("x402 premium stats purchased by agent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "x402 demo failed");
    }
  }

  const stepLabel = (s: Step) =>
    s === "done" ? "✅" : s === "pending" ? "⏳" : s === "error" ? "❌" : s === "sim" ? "🧪" : "○";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Rewards Center</h1>
        <p className="mt-1 text-ink-muted">
          Stake on match outcomes, claim USDC, bridge via Circle CCTP.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <div className="text-xs text-ink-muted">Total staked (match {MATCH})</div>
          <div className="font-display text-2xl font-semibold">{totalStaked} USDC</div>
        </div>
        <div className="card">
          <div className="text-xs text-ink-muted">Your stakes H / D / A</div>
          <div className="font-display text-2xl font-semibold">
            {stakes
              ? `${Number(stakes[0]) / 1e6} / ${Number(stakes[1]) / 1e6} / ${Number(stakes[2]) / 1e6}`
              : "—"}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-ink-muted">USDC balance</div>
          <div className="font-display text-2xl font-semibold">
            {usdcBal != null ? `${Number(usdcBal) / 1e6}` : isConnected ? "…" : "connect"}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-4">
          <h2 className="font-display text-lg font-semibold">My positions</h2>
          <div className="text-sm text-ink-muted">
            Market: {settled ? `settled (outcome ${resolved})` : m?.[1] ? "open" : "not opened"}
          </div>
          <button
            className="btn-primary"
            disabled={!settled || isPending}
            onClick={claim}
          >
            Claim payout
          </button>
          <p className="text-xs text-ink-muted">
            Open a market from admin/deployer, stake from Dashboard, wait for{" "}
            <code className="text-cyan-accent">final</code> + settle via agent.
          </p>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">CCTP withdraw</h2>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={cctpSim}
                onChange={(e) => setCctpSim(e.target.checked)}
              />
              Simulator
            </label>
          </div>
          <p className="text-xs text-ink-muted">
            Destination: Ethereum Sepolia (domain {SEPOLIA_DOMAIN}). Source:
            Injective testnet domain 29 · Messenger {shortAddr(CCTP_TOKEN_MESSENGER)}
          </p>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
            placeholder="USDC amount"
          />
          <ol className="space-y-2 text-sm">
            {[
              "Approve USDC → TokenMessenger",
              "depositForBurn on Injective",
              "Poll Circle attestation",
              "receiveMessage on Sepolia",
            ].map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span className="w-6 text-center">{stepLabel(steps[i + 1])}</span>
                <span className={steps[i + 1] === "done" || steps[i + 1] === "sim" ? "text-white" : "text-ink-muted"}>
                  {i + 1}. {label}
                </span>
              </li>
            ))}
          </ol>
          <button className="btn-primary w-full" onClick={runCctp} disabled={isPending}>
            {cctpSim ? "Run CCTP simulator" : "Start CCTP burn"}
          </button>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-display text-lg font-semibold">x402 demo</h2>
        <p className="text-sm text-ink-muted">
          Simulate the agent buying premium stats (HTTP 402 → EIP-712 payment → 200).
        </p>
        <button className="btn-ghost" onClick={x402Demo}>
          Simulate agent buying premium stats
        </button>
        {x402Log != null && (
          <pre className="max-h-48 overflow-auto rounded-lg bg-ink p-3 font-mono text-[11px] text-ink-muted">
            {JSON.stringify(x402Log, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
