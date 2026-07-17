"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  usePublicClient,
  useReadContract,
  useWriteContract,
  useAccount,
  useConfig,
  useChainId,
} from "wagmi";
import { parseUnits } from "viem";
import { toast } from "sonner";
import {
  ORACLE_ABI,
  ORACLE_ADDRESS,
  REWARDS_ABI,
  REWARDS_ADDRESS,
  USDC_ADDRESS,
  ERC20_ABI,
  type OracleEvent,
} from "@/lib/contracts";
import { eventIcon, parseScore, shortAddr } from "@/lib/utils";
import { explorerAddress, explorerTx } from "@/lib/chain";
import { ensureInjectiveChain, isInjectiveChain } from "@/lib/ensureInjective";
import { INJECTIVE_EVM_CHAIN_ID } from "@/lib/wagmi";
import { motion, AnimatePresence } from "framer-motion";
import {
  fetchFixtures,
  statusLabel,
  type PublicFixture,
} from "@/lib/fixtures";

const STAGES = [
  { key: "GS1", label: "GS 1" },
  { key: "GS2", label: "GS 2" },
  { key: "GS3", label: "GS 3" },
  { key: "R32", label: "R32" },
  { key: "R16", label: "R16" },
  { key: "QF", label: "QF" },
  { key: "SF", label: "SF" },
  { key: "FS", label: "FS" },
];

function matchStageKey(fx: PublicFixture): string | null {
  const s = (fx.stageLabel || fx.stage || fx.group || "").toLowerCase();
  if (s.includes("md1") || s.includes("group") && !s.includes("md2") && !s.includes("md3")) return "GS1";
  if (s.includes("md2")) return "GS2";
  if (s.includes("md3")) return "GS3";
  if (s.includes("r32") || s.includes("round of 32")) return "R32";
  if (s.includes("r16") || s.includes("round of 16")) return "R16";
  if (s.includes("qf") || s.includes("quarter")) return "QF";
  if (s.includes("sf") || s.includes("semi")) return "SF";
  if (s.includes("final") || s.includes("3rd") || s.includes("third")) return "FS";
  return null;
}

export default function DashboardPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  useEffect(() => {
    if (!isConnected) router.replace("/");
  }, [isConnected, router]);

  const [fixtures, setFixtures] = useState<PublicFixture[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [stageKey, setStageKey] = useState<string>("GS1");
  const [stakeOpen, setStakeOpen] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("10");
  const [pick, setPick] = useState<1 | 2 | 3>(1);
  const [stakeResult, setStakeResult] = useState<{
    approveHash: string;
    stakeHash?: string;
    matchLabel: string;
    outcomeLabel?: string;
    amount: string;
    status: "confirmed" | "failed";
    reason?: string;
  } | null>(null);
  const [stakeConfirming, setStakeConfirming] = useState<{
    step:
      | "approve-wallet"
      | "approve-confirm"
      | "stake-wallet"
      | "stake-confirm";
    approveHash?: string;
    stakeHash?: string;
    matchLabel: string;
    outcomeLabel: string;
    amount: string;
  } | null>(null);
  const [fundingModal, setFundingModal] = useState<"mock" | "circle" | null>(
    null
  );
  const pub = usePublicClient();
  const config = useConfig();
  const chainId = useChainId();
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  const { data: usdcBal } = useReadContract({
    address: address ? USDC_ADDRESS : undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });
  const usdcBalance = usdcBal != null ? Number(usdcBal) / 1e6 : null;

  const hasOracle = Boolean(ORACLE_ADDRESS && ORACLE_ADDRESS.length === 42);
  const hasRewards = Boolean(REWARDS_ADDRESS && REWARDS_ADDRESS.length === 42);
  const onInjective = isInjectiveChain(chainId);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchFixtures().then((list) => {
        if (cancelled) return;
        setFixtures(list);
        setSelectedKey((prev) => prev || list[0]?.label || "");
      });
    load();
    const t = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const stageFixtures = useMemo(
    () => fixtures.filter((f) => matchStageKey(f) === stageKey),
    [fixtures, stageKey]
  );

  useEffect(() => {
    if (stageFixtures.length > 0 && !stageFixtures.find((f) => f.label === selectedKey)) {
      setSelectedKey(stageFixtures[0].label);
    }
  }, [stageFixtures, selectedKey]);

  const selected = useMemo(
    () => fixtures.find((f) => f.label === selectedKey) || stageFixtures[0],
    [fixtures, selectedKey, stageFixtures]
  );
  const matchId = selected?.id;

  const { data: stakesData, refetch: refetchStakes } = useReadContract({
    address: hasRewards && matchId != null ? REWARDS_ADDRESS : undefined,
    abi: REWARDS_ABI,
    functionName: "stakes",
    args: address && matchId != null ? [BigInt(matchId), address] : undefined,
    query: {
      enabled: Boolean(hasRewards && address && matchId != null),
      refetchInterval: 10_000,
    },
  });

  const myStakes = stakesData as readonly [bigint, bigint, bigint] | undefined;
  const hasStakes =
    myStakes !== undefined &&
    (myStakes[0] > BigInt(0) || myStakes[1] > BigInt(0) || myStakes[2] > BigInt(0));

  const { data: events, refetch: refetchEvents } = useReadContract({
    address: hasOracle && matchId != null ? ORACLE_ADDRESS : undefined,
    abi: ORACLE_ABI,
    functionName: "getEvents",
    args: matchId != null ? [BigInt(matchId)] : undefined,
    query: {
      enabled: hasOracle && matchId != null,
      refetchInterval: 8_000,
    },
  });

  useEffect(() => {
    if (!pub || !hasOracle) return;
    const unwatch = pub.watchContractEvent({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      eventName: "EventAdded",
      onLogs: () => {
        refetchEvents();
      },
    });
    return () => unwatch();
  }, [pub, hasOracle, refetchEvents]);

  useEffect(() => {
    if (!pub || !hasRewards) return;
    const unwatch = pub.watchContractEvent({
      address: REWARDS_ADDRESS,
      abi: REWARDS_ABI,
      eventName: "Staked",
      onLogs: () => {
        refetchStakes();
      },
    });
    return () => unwatch();
  }, [pub, hasRewards, refetchStakes]);

  const eventList = (events as OracleEvent[] | undefined) || [];
  const latest = eventList[eventList.length - 1];
  const scoreFromChain = latest ? parseScore(latest.details) : {};
  const scoreHome = selected?.scoreHome ?? scoreFromChain.home;
  const scoreAway = selected?.scoreAway ?? scoreFromChain.away;
  const goals = eventList.filter((e) =>
    e.eventType.toLowerCase().includes("goal")
  ).length;
  const cards = eventList.filter((e) =>
    e.eventType.toLowerCase().includes("card")
  ).length;

  const doStake = useCallback(async () => {
    if (!address || !REWARDS_ADDRESS || matchId == null) {
      toast.error("Connect wallet and select a fixture");
      return;
    }
    if (selected && selected.status !== "NS" && selected.status !== "TBD") {
      toast.error("Staking is only available for upcoming matches");
      return;
    }
    try {
      await ensureInjectiveChain(config);
      const amount = parseUnits(stakeAmount, 6);
      const outcomeLabels: Record<number, string> = {
        1: "Home",
        2: "Draw",
        3: "Away",
      };
      const ol = outcomeLabels[pick] || "—";

      setStakeOpen(false);
      setStakeConfirming({
        step: "approve-wallet",
        matchLabel: selected?.label || "",
        outcomeLabel: ol,
        amount: stakeAmount,
      });

      // Step 1: Approve USDC
      const approveHash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [REWARDS_ADDRESS, amount],
      });
      // Wait for approve receipt before proceeding
      setStakeConfirming((prev) =>
        prev ? { ...prev, step: "approve-confirm", approveHash } : null
      );
      if (pub) {
        try {
          const approveReceipt = await pub.waitForTransactionReceipt({
            hash: approveHash,
            timeout: 120_000,
          });
          if (approveReceipt.status !== "success") {
            setStakeConfirming(null);
            setStakeResult({
              status: "failed",
              approveHash,
              matchLabel: selected?.label || "",
              amount: stakeAmount,
              reason:
                "USDC approval reverted on chain. The contract may already have sufficient allowance, or your wallet lacks USDC balance.",
            });
            return;
          }
        } catch (receiptErr) {
          console.warn("Approve receipt wait failed, proceeding to stake", receiptErr);
        }
      }

      // Step 2: Stake on outcome
      setStakeConfirming((prev) =>
        prev ? { ...prev, step: "stake-wallet" } : null
      );
      const stakeHash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: REWARDS_ADDRESS,
        abi: REWARDS_ABI,
        functionName: "stake",
        args: [BigInt(matchId), pick, amount],
      });
      // Wait for stake receipt to confirm success
      setStakeConfirming((prev) =>
        prev ? { ...prev, step: "stake-confirm", stakeHash } : null
      );
      if (pub) {
        try {
          const stakeReceipt = await pub.waitForTransactionReceipt({
            hash: stakeHash,
            timeout: 120_000,
          });
          if (stakeReceipt.status !== "success") {
            setStakeConfirming(null);
            setStakeResult({
              status: "failed",
              approveHash,
              stakeHash,
              matchLabel: selected?.label || "",
              amount: stakeAmount,
              reason:
                "The stake transaction reverted on Injective EVM. The USDC approval went through, but staking failed — possibly the market is closed or full.",
            });
            return;
          }
        } catch (receiptErr) {
          console.warn("Stake receipt wait failed, showing confirmed", receiptErr);
        }
      }

      // Both transactions confirmed successfully
      setStakeConfirming(null);
      setStakeResult({
        status: "confirmed",
        approveHash,
        stakeHash,
        matchLabel: selected?.label || "",
        outcomeLabel: ol,
        amount: stakeAmount,
      });
      // Share match ID with Rewards page via localStorage
      if (matchId != null) {
        try {
          localStorage.setItem("lastStakedMatchId", String(matchId));
          localStorage.setItem(
            "lastStakedMatchLabel",
            selected?.label || ""
          );
        } catch {}
      }
      refetchStakes();
      toast.success(
        `Confirmed: ${stakeAmount} USDC on ${selected?.label} (${ol})`
      );
    } catch (e) {
      setStakeConfirming(null);
      toast.error(e instanceof Error ? e.message : "Stake failed");
    }
  }, [
    address,
    stakeAmount,
    pick,
    matchId,
    selected?.label,
    selected?.status,
    writeContractAsync,
    config,
    refetchStakes,
    pub,
  ]);

  return (
    <div className="relative">
      <div
        className="pointer-events-none fixed inset-0 bg-cover bg-center bg-no-repeat opacity-10"
        style={{ backgroundImage: "url('/field.png')" }}
      />

      {/* Stage filter bar */}
      <div className="sticky top-0 z-30 mt-6 border-b border-[#1E293B] bg-[#0B0F19]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between overflow-x-auto px-4 py-3">
          {STAGES.map((s) => (
            <button
              key={s.key}
              onClick={() => { setStageKey(s.key); setSelectedKey(""); }}
              className={`shrink-0 rounded-lg px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${
                stageKey === s.key
                  ? "bg-[#4E46FF]/20 text-[#4E46FF] ring-1 ring-[#4E46FF]/30"
                  : "text-[#64748B] hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Match selector */}
      <div className="mx-auto max-w-7xl px-4 pt-4">
        {stageFixtures.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {stageFixtures.map((fx) => {
              const isSelected = selected?.label === fx.label;
              return (
                <button
                  key={fx.label}
                  onClick={() => setSelectedKey(fx.label)}
                  className={`shrink-0 rounded-xl border px-4 py-2.5 text-left transition-all duration-200 ${
                    isSelected
                      ? "border-[#4E46FF]/50 bg-[#4E46FF]/10 ring-1 ring-[#4E46FF]/30"
                      : "border-[#1E293B] bg-[#0F172A]/60 hover:border-[#4E46FF]/20"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                    <span>{fx.home}</span>
                    <span className="text-[10px] text-[#4E46FF] font-bold">vs</span>
                    <span>{fx.away}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#64748B]">
                    {fx.kickoffUtcLabel || fx.kickoffUtc || ""}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-4 text-center text-xs text-[#64748B]">
            No fixtures for this stage yet.
          </p>
        )}
      </div>

      {/* Match detail */}
      {selected && (
        <div className="mx-auto max-w-7xl px-4 pb-6 pt-4">
          <div className="space-y-4">
            {/* Score card */}
            <div className="card relative overflow-hidden">
              <div className="absolute right-4 top-4">
                <span
                  className={`pill ${
                    selected?.status === "LIVE"
                      ? "bg-live/15 text-live"
                      : "bg-ink-card text-ink-muted"
                  }`}
                >
                  {selected ? statusLabel(selected.status) : "—"}
                </span>
              </div>
              <div className="flex flex-col items-center gap-4 py-4 sm:flex-row sm:justify-center sm:gap-12">
                <div className="text-center">
                  <div className="font-display text-xl font-semibold">
                    {selected?.home || "Home"}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-display text-5xl font-bold tabular-nums text-[#4E46FF]">
                    {scoreHome ?? "–"} : {scoreAway ?? "–"}
                  </div>
                  <div className="mt-1 max-w-xs text-xs text-ink-muted">
                    {selected?.label || "Select a fixture"}
                    {latest ? ` · ${latest.eventType} ${latest.minute}'` : ""}
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-display text-xl font-semibold">
                    {selected?.away || "Away"}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["On-chain events", eventList.length],
                ["Goals (on-chain)", goals],
                ["Cards (on-chain)", cards],
                ["Source", selected?.source || "—"],
              ].map(([k, v]) => (
                <div key={k as string} className="card py-3 text-center">
                  <div className="text-xs text-ink-muted">{k}</div>
                  <div className="font-display text-lg font-semibold">{v}</div>
                </div>
              ))}
            </div>

            {/* Main grid: event feed + sidebar */}
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Event feed */}
              <div className="card lg:col-span-2">
                <h3 className="mb-4 font-display font-semibold">On-chain event feed</h3>
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  <AnimatePresence initial={false}>
                    {[...eventList].reverse().map((e, i) => (
                      <motion.div
                        key={`${e.timestamp}-${e.minute}-${e.eventType}-${i}`}
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-start gap-3 rounded-lg border border-ink-border/60 bg-ink/50 px-3 py-2"
                      >
                        <span className="text-xl">{eventIcon(e.eventType)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-ink-border px-1.5 font-mono text-[10px]">
                              {e.minute}&apos;
                            </span>
                            <span className="font-medium capitalize">
                              {e.eventType}
                            </span>
                          </div>
                          <p className="truncate font-mono text-xs text-ink-muted">
                            {e.details}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {eventList.length === 0 && (
                    <p className="py-8 text-center text-sm text-ink-muted">
                      No on-chain events for this fixture yet. Feeder posts when the
                      match is live/finished.
                    </p>
                  )}
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                {/* Quick actions card */}
                <div className="card space-y-3">
                  <h3 className="font-display font-semibold">Quick actions</h3>
                  <Link
                    href={`/agent?q=${encodeURIComponent(selected?.label || "")}`}
                    className="btn-primary w-full"
                  >
                    Ask agent about this match
                  </Link>
                  {selected && (selected.status === "NS" || selected.status === "TBD") ? (
                    <button
                      className="btn-ghost w-full"
                      onClick={() => {
                        if (usdcBalance != null && usdcBalance <= 0) {
                          setFundingModal("mock");
                        } else {
                          setStakeOpen(true);
                        }
                      }}
                    >
                      Stake on outcome
                    </button>
                  ) : (
                    <button className="btn-ghost w-full opacity-50" disabled title="Staking only available for upcoming matches">
                      Stake on outcome (match {selected?.status === "FT" ? "finished" : "live"})
                    </button>
                  )}
                </div>

                {/* My Ticket card */}
                {hasStakes && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="card space-y-3"
                  >
                    <h3 className="font-display font-semibold">🎫 My Ticket</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs">🏠</span>
                          <span className="text-ink-muted">Home</span>
                        </span>
                        <span className="font-medium text-white">
                          {Number(myStakes![0]) / 1e6} USDC
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs">🤝</span>
                          <span className="text-ink-muted">Draw</span>
                        </span>
                        <span className="font-medium text-white">
                          {Number(myStakes![1]) / 1e6} USDC
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs">✈️</span>
                          <span className="text-ink-muted">Away</span>
                        </span>
                        <span className="font-medium text-white">
                          {Number(myStakes![2]) / 1e6} USDC
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-ink-border pt-2 font-semibold">
                        <span>Total</span>
                        <span className="text-cyan-accent">
                          {Number(
                            myStakes![0] + myStakes![1] + myStakes![2]
                          ) / 1e6}{" "}
                          USDC
                        </span>
                      </div>
                    </div>
                    <Link
                      href="/rewards"
                      className="btn-ghost w-full text-xs"
                    >
                      Manage positions →
                    </Link>
                  </motion.div>
                )}

                {/* On-chain info card */}
                <div className="card space-y-2 text-xs text-ink-muted">
                  <div className="font-medium text-white">On-chain</div>
                  <div>
                    Oracle:{" "}
                    {hasOracle ? (
                      <a
                        href={explorerAddress(ORACLE_ADDRESS)}
                        className="text-cyan-accent"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddr(ORACLE_ADDRESS)}
                      </a>
                    ) : (
                      "not set"
                    )}
                  </div>
                  {hasRewards && (
                    <div>
                      Rewards:{" "}
                      <a
                        href={explorerAddress(REWARDS_ADDRESS)}
                        className="text-cyan-accent"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddr(REWARDS_ADDRESS)}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {stakeResult?.status === "confirmed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="card w-full max-w-md space-y-5"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20"
              >
                <svg
                  className="h-8 w-8 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <motion.path
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </motion.div>
              <div>
                <h3 className="font-display text-lg font-semibold">
                  Stake Confirmed! 🎉
                </h3>
                <p className="mt-1 text-sm text-ink-muted">
                  Your {stakeResult.amount} USDC {stakeResult.outcomeLabel ?? ""}{" "}
                  stake on{" "}
                  <strong className="text-white">
                    {stakeResult.matchLabel}
                  </strong>{" "}
                  has been confirmed on Injective EVM.
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-ink-border bg-ink/50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Match</span>
                <span className="font-medium text-white">
                  {stakeResult.matchLabel}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Outcome</span>
                <span className="font-medium text-cyan-accent">
                  {stakeResult.outcomeLabel}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Amount</span>
                <span className="font-medium text-white">
                  {stakeResult.amount} USDC
                </span>
              </div>
              <div className="border-t border-ink-border pt-3">
                <div className="mb-2 text-xs font-medium text-ink-muted">
                  Transactions
                </div>
                <div className="flex flex-col gap-2">
                  <a
                    href={explorerTx(stakeResult.approveHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg border border-ink-border px-3 py-2 text-xs transition hover:border-cyan-accent/40 hover:bg-ink"
                  >
                    <span className="text-ink-muted">Approve USDC</span>
                    <span className="font-mono text-cyan-accent">
                      {shortAddr(stakeResult.approveHash)} ↗
                    </span>
                  </a>
                  {stakeResult.stakeHash && (
                    <a
                      href={explorerTx(stakeResult.stakeHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-lg border border-ink-border px-3 py-2 text-xs transition hover:border-cyan-accent/40 hover:bg-ink"
                    >
                      <span className="text-ink-muted">Stake tx</span>
                      <span className="font-mono text-cyan-accent">
                        {shortAddr(stakeResult.stakeHash)} ↗
                      </span>
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="btn-ghost flex-1"
                onClick={() => setStakeResult(null)}
              >
                Close
              </button>
              {stakeResult.stakeHash && (
                <a
                  href={explorerTx(stakeResult.stakeHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary flex-1 text-center"
                >
                  View on Explorer
                </a>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {stakeResult?.status === "failed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="card w-full max-w-md space-y-5"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20"
              >
                <svg
                  className="h-8 w-8 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <motion.path
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.3 }}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </motion.div>
              <div>
                <h3 className="font-display text-lg font-semibold">
                  Transaction Failed ❌
                </h3>
                <p className="mt-1 text-sm text-ink-muted">
                  {stakeResult.reason ||
                    "The transaction reverted on chain. Check the explorer for details."}
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-ink-border bg-ink/50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Match</span>
                <span className="font-medium text-white">
                  {stakeResult.matchLabel}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Amount</span>
                <span className="font-medium text-white">
                  {stakeResult.amount} USDC
                </span>
              </div>
              <div className="border-t border-ink-border pt-3">
                <div className="mb-2 text-xs font-medium text-ink-muted">
                  Failed transaction
                </div>
                <a
                  href={
                    stakeResult.stakeHash
                      ? explorerTx(stakeResult.stakeHash)
                      : explorerTx(stakeResult.approveHash)
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs transition hover:border-red-500/60"
                >
                  <span className="text-red-400">
                    {stakeResult.stakeHash ? "Stake tx" : "Approve tx"}
                  </span>
                  <span className="font-mono text-red-400">
                    {shortAddr(
                      stakeResult.stakeHash || stakeResult.approveHash
                    )}{" "}
                    ↗
                  </span>
                </a>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="btn-ghost flex-1"
                onClick={() => setStakeResult(null)}
              >
                Dismiss
              </button>
              <a
                href={
                  stakeResult.stakeHash
                    ? explorerTx(stakeResult.stakeHash)
                    : explorerTx(stakeResult.approveHash)
                }
                target="_blank"
                rel="noreferrer"
                className="btn-primary flex-1 bg-red-500 text-center hover:bg-red-400"
              >
                Inspect on Explorer
              </a>
            </div>
          </motion.div>
        </div>
      )}

      {stakeConfirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="card w-full max-w-md space-y-6"
          >
            {/* Spinning ring */}
            <div className="flex flex-col items-center gap-4 text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  repeatType: "loop",
                  ease: "linear",
                }}
                className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-transparent border-t-cyan-accent"
              >
                <div className="h-8 w-8 rounded-full bg-cyan-accent/10" />
              </motion.div>
              <div>
                <h3 className="font-display text-lg font-semibold">
                  Staking in Progress
                </h3>
                <p className="mt-1 text-sm text-ink-muted">
                  {stakeConfirming.amount} USDC on{" "}
                  <strong className="text-white">
                    {stakeConfirming.matchLabel}
                  </strong>{" "}
                  ({stakeConfirming.outcomeLabel})
                </p>
              </div>
            </div>

            {/* Step progress */}
            <div className="space-y-3">
              {/* Step 1: Approve */}
              <div
                className={`rounded-xl border p-4 transition ${
                  stakeConfirming.step === "approve-wallet" ||
                  stakeConfirming.step === "approve-confirm"
                    ? "border-cyan-accent/40 bg-cyan-accent/5"
                    : "border-ink-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                      stakeConfirming.step === "approve-wallet" ||
                      stakeConfirming.step === "approve-confirm"
                        ? "bg-cyan-accent/20 text-cyan-accent"
                        : "bg-emerald-500/20 text-emerald-400"
                    }`}
                  >
                    {stakeConfirming.approveHash ? "✓" : "1"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Approve USDC</div>
                    {stakeConfirming.step === "approve-wallet" && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                        Waiting for wallet confirmation…
                      </div>
                    )}
                    {stakeConfirming.step === "approve-confirm" && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-accent" />
                        Confirming on Injective…
                      </div>
                    )}
                    {stakeConfirming.approveHash && (
                      <a
                        href={explorerTx(stakeConfirming.approveHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-cyan-accent/70 hover:text-cyan-accent"
                      >
                        {shortAddr(stakeConfirming.approveHash)} ↗
                      </a>
                    )}
                    {stakeConfirming.step !== "approve-wallet" &&
                      stakeConfirming.step !== "approve-confirm" &&
                      stakeConfirming.approveHash && (
                        <div className="mt-1 text-[10px] text-emerald-400">
                          Confirmed ✓
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* Step 2: Stake */}
              <div
                className={`rounded-xl border p-4 transition ${
                  stakeConfirming.step === "stake-wallet" ||
                  stakeConfirming.step === "stake-confirm"
                    ? "border-cyan-accent/40 bg-cyan-accent/5"
                    : stakeConfirming.approveHash
                      ? "border-ink-border opacity-60"
                      : "border-ink-border opacity-40"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                      stakeConfirming.step === "stake-wallet" ||
                      stakeConfirming.step === "stake-confirm"
                        ? "bg-cyan-accent/20 text-cyan-accent"
                        : stakeConfirming.stakeHash
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-ink-border text-ink-muted"
                    }`}
                  >
                    {stakeConfirming.stakeHash ? "✓" : "2"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      Stake on {stakeConfirming.outcomeLabel}
                    </div>
                    {stakeConfirming.step === "stake-wallet" && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                        Waiting for wallet confirmation…
                      </div>
                    )}
                    {stakeConfirming.step === "stake-confirm" && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-accent" />
                        Confirming on Injective…
                      </div>
                    )}
                    {stakeConfirming.stakeHash && (
                      <a
                        href={explorerTx(stakeConfirming.stakeHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-cyan-accent/70 hover:text-cyan-accent"
                      >
                        {shortAddr(stakeConfirming.stakeHash)} ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Shimmer skeleton for the receipt-waiting period */}
            {(stakeConfirming.step === "approve-confirm" ||
              stakeConfirming.step === "stake-confirm") && (
              <div className="space-y-2">
                <div className="h-2 w-3/4 animate-pulse rounded bg-ink-border" />
                <div className="h-2 w-1/2 animate-pulse rounded bg-ink-border" />
              </div>
            )}

            <p className="text-center text-[10px] text-ink-muted">
              Please keep this page open. Do not close or refresh.
            </p>
          </motion.div>
        </div>
      )}

      {fundingModal === "mock" && (
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
                Need MockUSDC
              </h3>
              <p className="mt-2 text-sm text-ink-muted">
                You need MockUSDC in your wallet to stake. Head to the Rewards
                page to mint free test USDC instantly.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="btn-ghost flex-1"
                onClick={() => setFundingModal(null)}
              >
                Cancel
              </button>
              <Link
                href="/rewards"
                className="btn-primary flex-1 text-center"
                onClick={() => setFundingModal(null)}
              >
                Go to Rewards
              </Link>
            </div>
          </motion.div>
        </div>
      )}

      {stakeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card w-full max-w-md space-y-4">
            <h3 className="font-display text-lg font-semibold">
              Stake — {selected?.label}
            </h3>
            <p className="text-xs text-cyan-accent">
              ⚽ Upcoming match · staking locks at kickoff
            </p>
            <p className="text-xs text-ink-muted">
              Network:{" "}
              <span className={onInjective ? "text-cyan-accent" : "text-amber-300"}>
                {onInjective
                  ? `Injective EVM · ${INJECTIVE_EVM_CHAIN_ID} (INJ gas)`
                  : `Wrong chain ${chainId} — will switch to Injective before stake`}
              </span>
              . Stake asset is <strong className="text-white">USDC</strong> on
              Injective (not ETH).
            </p>
            <div className="flex gap-2">
              {(
                [
                  [1, "Home"],
                  [2, "Draw"],
                  [3, "Away"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setPick(v)}
                  className={`flex-1 rounded-lg border py-2 text-sm ${
                    pick === v
                      ? "border-cyan-accent bg-cyan-accent/10 text-cyan-accent"
                      : "border-ink-border"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="number"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm outline-none focus:border-cyan-accent"
              placeholder="USDC amount"
            />
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setStakeOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                disabled={isPending || stakeConfirming != null}
                onClick={doStake}
              >
                {isPending || stakeConfirming != null
                  ? "Confirming…"
                  : "Approve + Stake"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}