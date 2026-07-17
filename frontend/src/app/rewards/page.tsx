"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useConfig,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { parseUnits, pad, type Hex } from "viem";
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
import { explorerTx } from "@/lib/chain";
import { ensureInjectiveChain, isInjectiveChain } from "@/lib/ensureInjective";
import { INJECTIVE_EVM_CHAIN_ID } from "@/lib/wagmi";
import {
  fetchFixtures,
  statusLabel,
  type PublicFixture,
} from "@/lib/fixtures";
import type { Address } from "viem";
import { motion } from "framer-motion";

/** CCTP destination domain only. Source burn is always Injective. */
const SEPOLIA_DOMAIN = 0;
const LS_MATCH_ID = "lastStakedMatchId";
const LS_MATCH_LABEL = "lastStakedMatchLabel";

type Step = "idle" | "pending" | "done" | "error" | "sim";

type HistoryItem = {
  id: string;
  kind: "claim" | "cctp" | "x402";
  label: string;
  hash?: string;
  at: string;
  detail?: string;
};

export default function RewardsPage() {
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const chainId = useChainId();
  const pub = usePublicClient();
  const [amount, setAmount] = useState("5");
  const [cctpSim, setCctpSim] = useState(true);
  const [steps, setSteps] = useState<Record<number, Step>>({
    1: "idle",
    2: "idle",
    3: "idle",
    4: "idle",
  });
  const [burnTx, setBurnTx] = useState<string | null>(null);
  const [attestNote, setAttestNote] = useState<string | null>(null);
  const [x402Log, setX402Log] = useState<unknown>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [fixtures, setFixtures] = useState<PublicFixture[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [lastLabel, setLastLabel] = useState<string>("");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [mintPending, setMintPending] = useState(false);
  const [cctpFundingOpen, setCctpFundingOpen] = useState(false);
  const { writeContractAsync, isPending } = useWriteContract();

  const hasRewards = Boolean(REWARDS_ADDRESS && REWARDS_ADDRESS.length === 42);
  const onInjective = isInjectiveChain(chainId);

  // Load fixtures + last staked match from localStorage
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchFixtures().then((list) => {
        if (cancelled) return;
        setFixtures(list);
        // Default to last staked match or first fixture
        const savedId = (() => {
          try {
            return localStorage.getItem(LS_MATCH_ID);
          } catch {
            return null;
          }
        })();
        const savedLabel = (() => {
          try {
            return localStorage.getItem(LS_MATCH_LABEL) || "";
          } catch {
            return "";
          }
        })();
        setLastLabel(savedLabel);
        if (savedId) {
          const n = Number(savedId);
          if (list.some((f) => f.id === n)) {
            setSelectedMatchId(n);
            return;
          }
        }
        setSelectedMatchId(list[0]?.id ?? null);
      });
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const selectedFixture = useMemo(
    () => fixtures.find((f) => f.id === selectedMatchId),
    [fixtures, selectedMatchId]
  );

  const matchId = selectedMatchId ?? 0;

  // ---- Contract reads ----
  const { data: market, refetch: refetchMarket } = useReadContract({
    address: hasRewards && matchId > 0 ? REWARDS_ADDRESS : undefined,
    abi: REWARDS_ABI,
    functionName: "markets",
    args: matchId > 0 ? [BigInt(matchId)] : undefined,
    query: {
      enabled: hasRewards && matchId > 0,
      refetchInterval: 10_000,
    },
  });

  const {
    data: userStakes,
    refetch: refetchStakes,
  } = useReadContract({
    address: hasRewards && address && matchId > 0 ? REWARDS_ADDRESS : undefined,
    abi: REWARDS_ABI,
    functionName: "stakes",
    args: address && matchId > 0 ? [BigInt(matchId), address] : undefined,
    query: {
      enabled: Boolean(hasRewards && address && matchId > 0),
      refetchInterval: 10_000,
    },
  });

  const { data: usdcBal, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
      refetchInterval: 15_000,
    },
  });

  // ---- Event watchers for real-time sync ----
  useEffect(() => {
    if (!pub || !hasRewards) return;
    const unwatch = pub.watchContractEvent({
      address: REWARDS_ADDRESS,
      abi: REWARDS_ABI,
      eventName: "Staked",
      onLogs: () => {
        refetchStakes();
        refetchMarket();
        refetchBalance();
      },
    });
    return () => unwatch();
  }, [pub, hasRewards, refetchStakes, refetchMarket, refetchBalance]);

  // Force re-fetch once when matchId/address become available
  useEffect(() => {
    if (matchId > 0 && address) {
      const t = setTimeout(() => refetchStakes(), 500);
      return () => clearTimeout(t);
    }
  }, [matchId, address, refetchStakes]);

  useEffect(() => {
    if (!pub || !hasRewards) return;
    const unwatch = pub.watchContractEvent({
      address: REWARDS_ADDRESS,
      abi: REWARDS_ABI,
      eventName: "Claimed",
      onLogs: () => {
        refetchStakes();
        refetchMarket();
        refetchBalance();
      },
    });
    return () => unwatch();
  }, [pub, hasRewards, refetchStakes, refetchMarket, refetchBalance]);

  // ---- Derived data ----
  const m = market as
    | readonly [bigint, bigint, number, bigint, bigint, bigint, boolean]
    | undefined;
  const totalStaked = m ? Number(m[3] + m[4] + m[5]) / 1e6 : 0;
  const settled = m?.[6] ?? false;
  const resolved = m?.[2] ?? 0;
  const stakes = userStakes as readonly [bigint, bigint, bigint] | undefined;
  const stakesLoading = userStakes === undefined;
  const hasAnyStake =
    stakes !== undefined &&
    (stakes[0] > BigInt(0) || stakes[1] > BigInt(0) || stakes[2] > BigInt(0));

  // ---- Actions ----
  function pushHistory(item: Omit<HistoryItem, "id" | "at">) {
    setHistory((h) =>
      [
        {
          ...item,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          at: new Date().toISOString(),
        },
        ...h,
      ].slice(0, 20)
    );
  }

  async function claim() {
    if (!hasRewards) return toast.error("REWARDS_ADDRESS not set");
    if (matchId <= 0) return toast.error("Select a match first");
    try {
      await ensureInjectiveChain(config);
      const hash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: REWARDS_ADDRESS,
        abi: REWARDS_ABI,
        functionName: "claim",
        args: [BigInt(matchId)],
      });
      toast.success(`Claim tx ${hash.slice(0, 12)}… (Injective)`);
      pushHistory({
        kind: "claim",
        label: "Claim payout",
        hash,
        detail: `match ${matchId} ${selectedFixture?.label || ""}`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "claim failed");
    }
  }

  async function doMint() {
    if (!address) return;
    setMintPending(true);
    try {
      await ensureInjectiveChain(config);
      // Mint 100 USDC (6 decimals)
      const hash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [address, parseUnits("100", 6)],
      });
      if (pub) {
        await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      }
      refetchBalance();
      toast.success("Minted 100 test USDC!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMintPending(false);
    }
  }

  function handleCctpClick() {
    if (!address) {
      toast.error("Connect wallet");
      return;
    }
    if (matchId <= 0) {
      toast.error("Select a match first");
      return;
    }
    // Check if user has Circle USDC balance
    if (usdcBal == null || usdcBal <= BigInt(0)) {
      setCctpFundingOpen(true);
      return;
    }
    runCctp();
  }

  async function runCctp() {
    if (!address) return toast.error("Connect wallet");
    if (matchId <= 0) return toast.error("Select a match first");
    const amt = parseUnits(amount, 6);

    try {
      await ensureInjectiveChain(config);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Switch to Injective first");
      return;
    }

    if (cctpSim) {
      setSteps({ 1: "sim", 2: "sim", 3: "sim", 4: "sim" });
      setBurnTx(null);
      setAttestNote("Simulator: no real burn or Circle attestation.");
      try {
        if (hasRewards) {
          const recipient = pad(address as Address, { size: 32 });
          const hash = await writeContractAsync({
            chainId: INJECTIVE_EVM_CHAIN_ID,
            address: REWARDS_ADDRESS,
            abi: REWARDS_ABI,
            functionName: "logCrossChainWithdraw",
            args: [BigInt(matchId), SEPOLIA_DOMAIN, amt, recipient],
          });
          pushHistory({
            kind: "cctp",
            label: "CCTP simulator intent",
            hash,
            detail: `${amount} USDC → Sepolia domain ${SEPOLIA_DOMAIN}`,
          });
        } else {
          pushHistory({
            kind: "cctp",
            label: "CCTP simulator (UI only)",
            detail: "REWARDS_ADDRESS not set",
          });
        }
        toast.success(
          "CCTP simulator: intent logged on Injective (no live attestation wait)"
        );
      } catch (e) {
        toast.message(
          "Simulator UI only — " + (e instanceof Error ? e.message : "")
        );
      }
      return;
    }

    try {
      setSteps({ 1: "pending", 2: "idle", 3: "idle", 4: "idle" });
      setAttestNote(null);
      setBurnTx(null);

      await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CCTP_TOKEN_MESSENGER, amt],
      });
      setSteps((s) => ({ ...s, 1: "done", 2: "pending" }));

      const mintRecipient = pad(address as Address, { size: 32 });
      const hash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: CCTP_TOKEN_MESSENGER,
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [amt, SEPOLIA_DOMAIN, mintRecipient, USDC_ADDRESS],
      });

      setBurnTx(hash);
      setSteps((s) => ({ ...s, 2: "done", 3: "pending" }));
      pushHistory({
        kind: "cctp",
        label: "CCTP depositForBurn",
        hash,
        detail: `${amount} USDC on Injective → Sepolia`,
      });
      toast.success(`Burn submitted on Injective ${hash.slice(0, 12)}…`);

      setAttestNote("Waiting for burn receipt on Injective…");
      try {
        if (pub) {
          await pub.waitForTransactionReceipt({ hash: hash as Hex });
        }
        setSteps((s) => ({ ...s, 3: "done", 4: "pending" }));
        setAttestNote(
          "Burn confirmed on Injective. Circle iris attestation (domain 29 → 0) can take minutes on sandbox. Complete receiveMessage on Sepolia with message bytes from the burn logs when ready."
        );
      } catch (e) {
        setSteps((s) => ({ ...s, 3: "error" }));
        setAttestNote(
          e instanceof Error
            ? e.message
            : "Could not wait for receipt — check burn tx on explorer."
        );
      }
    } catch (e) {
      setSteps((s) => ({ ...s, 1: "error", 2: "error" }));
      toast.error(e instanceof Error ? e.message : "CCTP failed");
    }
  }

  async function x402Demo() {
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: "Get premium stats for Qatar vs Ecuador",
            },
          ],
        }),
      });
      const data = await r.json();
      setX402Log(data);
      const first = Array.isArray(data.trace) ? data.trace[0] : null;
      const result = first?.result as Record<string, unknown> | undefined;
      const x402 = result?._x402 as { transaction?: string } | undefined;
      const tx =
        (typeof x402?.transaction === "string" && x402.transaction) ||
        (typeof result?.hash === "string" && result.hash) ||
        undefined;
      pushHistory({
        kind: "x402",
        label: "Agent x402 premium stats",
        hash: tx,
        detail: data.answer
          ? String(data.answer).slice(0, 120)
          : "premium stats",
      });
      toast.success("x402 premium stats purchased by agent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "x402 demo failed");
    }
  }

  const stepLabel = (s: Step) =>
    s === "done"
      ? "✅"
      : s === "pending"
        ? "⏳"
        : s === "error"
          ? "❌"
          : s === "sim"
            ? "🧪"
            : "○";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Rewards Center</h1>
        <p className="mt-1 text-ink-muted">
          Claim your staking rewards on match outcomes, bridge USDC via Circle
          CCTP.
        </p>
        <p className="mt-2 text-xs">
          Active wallet network:{" "}
          <span className={onInjective ? "text-cyan-accent" : "text-amber-300"}>
            {onInjective
              ? `Injective EVM · ${chainId} (gas = INJ, stake = USDC)`
              : `chain ${chainId} — switch to Injective ${INJECTIVE_EVM_CHAIN_ID} before claim/stake`}
          </span>
        </p>
      </div>

      {/* Collapsible match selector */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setSelectorOpen(!selectorOpen)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 text-xs font-medium text-ink-muted">
              Match
            </span>
            <span className="truncate text-sm font-medium text-white">
              {selectedFixture
                ? `${selectedFixture.home} vs ${selectedFixture.away}`
                : fixtures.length > 0
                  ? "Select a match"
                  : "Loading…"}
            </span>
            {selectedFixture && (
              <span
                className={`pill shrink-0 ${
                  selectedFixture.status === "LIVE" ||
                  selectedFixture.status === "HT"
                    ? "bg-live/15 text-live"
                    : "bg-ink-border text-ink-muted"
                }`}
              >
                {statusLabel(selectedFixture.status)}
              </span>
            )}
          </div>
          <svg
            className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 ${
              selectorOpen ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        <div
          className={`grid transition-all duration-200 ${
            selectorOpen
              ? "mt-4 grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-wrap gap-1.5">
              {fixtures.map((fx) => (
                <button
                  key={fx.id}
                  onClick={() => {
                    setSelectedMatchId(fx.id);
                    setSelectorOpen(false);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs transition ${
                    selectedMatchId === fx.id
                      ? "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/40"
                      : "bg-ink text-ink-muted hover:bg-ink-border"
                  }`}
                >
                  {fx.status === "LIVE" || fx.status === "HT" ? "🔴 " : ""}
                  {fx.home} vs {fx.away}
                  <span className="ml-1.5 text-[10px] opacity-60">
                    {statusLabel(fx.status)}
                  </span>
                </button>
              ))}
              {fixtures.length === 0 && (
                <span className="text-xs text-ink-muted">
                  Loading fixtures…
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <div className="text-xs text-ink-muted">
            Total staked{" "}
            <span className="text-white/60">
              ({selectedFixture?.label || `match ${matchId}`})
            </span>
          </div>
          <div className="font-display text-2xl font-semibold">
            {totalStaked} USDC
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-ink-muted">
            Your stakes H / D / A{" "}
            {lastLabel && selectedMatchId && (
              <span className="text-cyan-accent/60">
                (last staked: {lastLabel})
              </span>
            )}
          </div>
          <div className="font-display text-2xl font-semibold">
            {stakesLoading
              ? "..."
              : stakes
                ? `${Number(stakes[0]) / 1e6} / ${Number(stakes[1]) / 1e6} / ${Number(stakes[2]) / 1e6}`
                : "0 / 0 / 0"}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <div className="text-xs text-ink-muted">USDC balance</div>
            <span className="rounded bg-cyan-accent/10 px-1.5 py-0.5 text-[10px] text-cyan-accent">
              MockUSDC
            </span>
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="font-display text-2xl font-semibold">
              {usdcBal != null
                ? `${Number(usdcBal) / 1e6}`
                : isConnected
                  ? "…"
                  : "connect"}
            </div>
            {address != null && (
              <button
                className="btn-ghost shrink-0 text-xs"
                disabled={mintPending || isPending}
                onClick={doMint}
              >
                {mintPending ? "Minting…" : "Mint 100"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* My positions & CCTP */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-4">
          <h2 className="font-display text-lg font-semibold">
            My positions{" "}
            {hasAnyStake && (
              <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                Active
              </span>
            )}
          </h2>
          {selectedFixture && (
            <div className="rounded-lg border border-ink-border bg-ink/50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">Match</span>
                <span className="font-medium text-white">
                  {selectedFixture.home} vs {selectedFixture.away}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-ink-muted">Status</span>
                <span
                  className={`pill ${
                    selectedFixture.status === "LIVE" ||
                    selectedFixture.status === "HT"
                      ? "bg-live/15 text-live"
                      : "bg-ink-border text-ink-muted"
                  }`}
                >
                  {statusLabel(selectedFixture.status)}
                </span>
              </div>
            </div>
          )}
          <div className="text-sm text-ink-muted">
            Market status:{" "}
            {settled
              ? `settled (outcome ${resolved})`
              : m?.[1]
                ? "open"
                : "not opened"}
          </div>
          {hasAnyStake && (
            <div className="rounded-lg border border-ink-border bg-ink/50 p-3 text-sm">
              <div className="mb-2 text-xs font-medium text-ink-muted">
                Your ticket breakdown
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-ink-muted">🏠 Home</span>
                  <span>{Number(stakes![0]) / 1e6} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">🤝 Draw</span>
                  <span>{Number(stakes![1]) / 1e6} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">✈️ Away</span>
                  <span>{Number(stakes![2]) / 1e6} USDC</span>
                </div>
                <div className="flex justify-between border-t border-ink-border pt-1 font-semibold text-cyan-accent">
                  <span>Total</span>
                  <span>
                    {Number(stakes![0] + stakes![1] + stakes![2]) / 1e6} USDC
                  </span>
                </div>
              </div>
            </div>
          )}
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
            <strong className="text-white">Source burn:</strong> Injective EVM
            (chain {INJECTIVE_EVM_CHAIN_ID}, domain 29) ·{" "}
            <strong className="text-white">Destination mint:</strong> Sepolia
            CCTP domain {SEPOLIA_DOMAIN} only (predictions stay on Injective).
            Messenger {shortAddr(CCTP_TOKEN_MESSENGER)}
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
                <span className="w-6 text-center">
                  {stepLabel(steps[i + 1])}
                </span>
                <span
                  className={
                    steps[i + 1] === "done" || steps[i + 1] === "sim"
                      ? "text-white"
                      : "text-ink-muted"
                  }
                >
                  {i + 1}. {label}
                </span>
              </li>
            ))}
          </ol>
          {burnTx && (
            <a
              href={explorerTx(burnTx)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-cyan-accent hover:underline"
            >
              Burn tx {shortAddr(burnTx)}
            </a>
          )}
          {attestNote && (
            <p className="rounded-lg border border-ink-border bg-ink px-3 py-2 text-[11px] text-ink-muted">
              {attestNote}
            </p>
          )}
          <button
            className="btn-primary w-full"
            onClick={handleCctpClick}
            disabled={isPending}
          >
            {cctpSim ? "Run CCTP simulator" : "Start CCTP burn"}
          </button>
        </div>
      </div>

      {/* CCTP funding modal */}
      {cctpFundingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="card w-full max-w-md space-y-5 text-center"
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20">
              <svg
                className="h-7 w-7 text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold">
                Need Circle USDC
              </h3>
              <p className="mt-2 text-sm text-ink-muted">
                CCTP requires official Circle USDC on Injective testnet —
                MockUSDC cannot be bridged. Get testnet USDC from the Circle
                faucet.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="btn-ghost flex-1"
                onClick={() => setCctpFundingOpen(false)}
              >
                Cancel
              </button>
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                className="btn-primary flex-1 text-center"
                onClick={() => setCctpFundingOpen(false)}
              >
                Open Circle Faucet
              </a>
            </div>
          </motion.div>
        </div>
      )}

      {/* x402 demo */}
      <div className="card space-y-3">
        <h2 className="font-display text-lg font-semibold">x402 demo</h2>
        <p className="text-sm text-ink-muted">
          Agent buys premium stats on Injective via x402 (HTTP 402 → USDC
          payment → data).
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

      {/* Session history */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">
            Session history
          </h2>
          {history.length > 0 && (
            <button
              type="button"
              className="text-xs text-ink-muted hover:text-white"
              onClick={() => setHistory([])}
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Claims, CCTP burns, and x402 demos from this browser session.
        </p>
        {history.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-muted">
            No actions yet.
          </p>
        ) : (
          <ul className="divide-y divide-ink-border text-sm">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <span className="font-medium text-white">{h.label}</span>
                  <span className="ml-2 text-[10px] uppercase text-ink-muted">
                    {h.kind}
                  </span>
                  {h.detail && (
                    <div className="text-xs text-ink-muted">{h.detail}</div>
                  )}
                  <div className="text-[10px] text-ink-muted">
                    {new Date(h.at).toLocaleString()}
                  </div>
                </div>
                {h.hash && (
                  <a
                    href={explorerTx(h.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-cyan-accent"
                  >
                    {shortAddr(h.hash)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
