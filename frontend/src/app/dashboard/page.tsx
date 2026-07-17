"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { explorerAddress } from "@/lib/chain";
import { ensureInjectiveChain, isInjectiveChain } from "@/lib/ensureInjective";
import { INJECTIVE_EVM_CHAIN_ID } from "@/lib/wagmi";
import { motion, AnimatePresence } from "framer-motion";
import {
  fetchFixtures,
  statusLabel,
  type PublicFixture,
} from "@/lib/fixtures";

export default function DashboardPage() {
  const [fixtures, setFixtures] = useState<PublicFixture[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "LIVE" | "FT" | "NS">("all");
  const [stakeOpen, setStakeOpen] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("10");
  const [pick, setPick] = useState<1 | 2 | 3>(1);
  const pub = usePublicClient();
  const config = useConfig();
  const chainId = useChainId();
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  const hasOracle = Boolean(ORACLE_ADDRESS && ORACLE_ADDRESS.length === 42);
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

  const selected = useMemo(
    () => fixtures.find((f) => f.label === selectedKey) || fixtures[0],
    [fixtures, selectedKey]
  );
  // internal only — never shown
  const matchId = selected?.id;

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

  const filtered = useMemo(() => {
    if (filter === "all") return fixtures;
    if (filter === "LIVE")
      return fixtures.filter((f) => f.status === "LIVE" || f.status === "HT");
    return fixtures.filter((f) => f.status === filter);
  }, [fixtures, filter]);

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
    try {
      // Predictions MUST run on Injective EVM — not Ethereum mainnet/sepolia
      await ensureInjectiveChain(config);
      const amount = parseUnits(stakeAmount, 6);
      await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [REWARDS_ADDRESS, amount],
      });
      await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: REWARDS_ADDRESS,
        abi: REWARDS_ABI,
        functionName: "stake",
        args: [BigInt(matchId), pick, amount],
      });
      toast.success(`Staked on ${selected?.label} (Injective)`);
      setStakeOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stake failed");
    }
  }, [
    address,
    stakeAmount,
    pick,
    matchId,
    selected?.label,
    writeContractAsync,
    config,
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-[300px]">
        <div className="card sticky top-20 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Fixtures</h2>
            <span className="text-[10px] text-ink-muted">
              {fixtures.length} loaded
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "LIVE", "FT", "NS"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 text-[10px] ${
                  filter === f
                    ? "bg-cyan-accent/20 text-cyan-accent"
                    : "text-ink-muted"
                }`}
              >
                {f === "NS" ? "UPCOMING" : f}
              </button>
            ))}
          </div>
          <ul className="max-h-[70vh] space-y-1 overflow-y-auto">
            {filtered.map((fx) => (
              <li key={fx.label + (fx.kickoffUtc || "")}>
                <button
                  onClick={() => setSelectedKey(fx.label)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    selected?.label === fx.label
                      ? "bg-cyan-accent/10 text-white ring-1 ring-cyan-accent/40"
                      : "text-ink-muted hover:bg-ink"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-white/90">
                      {fx.home} vs {fx.away}
                    </span>
                    <span
                      className={`pill shrink-0 ${
                        fx.status === "LIVE" || fx.status === "HT"
                          ? "bg-live/15 text-live"
                          : "bg-ink-border text-ink-muted"
                      }`}
                    >
                      {statusLabel(fx.status)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-muted">
                    {fx.stageLabel ||
                      (fx.group ? `Group ${fx.group}` : fx.stage || "")}
                    {fx.kickoffUtcLabel || fx.kickoffUtc
                      ? ` · ${fx.kickoffUtcLabel || fx.kickoffUtc}`
                      : ""}
                  </div>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <div className="space-y-2 py-6 text-center text-xs text-ink-muted">
                {fixtures.length > 0 && filter === "LIVE" ? (
                  <>
                    <p>
                      No live matches right now.{" "}
                      {fixtures.filter((f) => f.status === "FT").length} finished
                      · {fixtures.filter((f) => f.status === "NS").length}{" "}
                      upcoming are loaded.
                    </p>
                    <button
                      type="button"
                      className="text-cyan-accent underline"
                      onClick={() => setFilter("all")}
                    >
                      Show all fixtures
                    </button>
                  </>
                ) : fixtures.length > 0 ? (
                  <p>
                    No fixtures in this filter.{" "}
                    <button
                      type="button"
                      className="text-cyan-accent underline"
                      onClick={() => setFilter("all")}
                    >
                      Show all
                    </button>
                  </p>
                ) : (
                  <p>
                    Loading fixtures… If this stays empty, start the feeder:{" "}
                    <code className="text-cyan-accent">npm run dev:feeder</code>
                  </p>
                )}
              </div>
            )}
          </ul>
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
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
              <div className="font-display text-5xl font-bold tabular-nums text-cyan-accent">
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

        <div className="grid gap-4 lg:grid-cols-3">
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

          <div className="space-y-4">
            <div className="card space-y-3">
              <h3 className="font-display font-semibold">Quick actions</h3>
              <Link
                href={`/agent?q=${encodeURIComponent(selected?.label || "")}`}
                className="btn-primary w-full"
              >
                Ask agent about this match
              </Link>
              <button className="btn-ghost w-full" onClick={() => setStakeOpen(true)}>
                Stake on outcome
              </button>
            </div>
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
            </div>
          </div>
        </div>
      </div>

      {stakeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card w-full max-w-md space-y-4">
            <h3 className="font-display text-lg font-semibold">
              Stake — {selected?.label}
            </h3>
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
                disabled={isPending}
                onClick={doStake}
              >
                {isPending ? "Confirm…" : "Approve + Stake"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
