"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  usePublicClient,
  useReadContract,
  useWriteContract,
  useAccount,
  useWaitForTransactionReceipt,
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
  metaFor,
  type OracleEvent,
} from "@/lib/contracts";
import { eventIcon, parseScore, shortAddr } from "@/lib/utils";
import { explorerAddress } from "@/lib/chain";
import { motion, AnimatePresence } from "framer-motion";

const DEMO_ID = Number(process.env.NEXT_PUBLIC_FIXTURE_ID || "2026001");

export default function DashboardPage() {
  const [selected, setSelected] = useState(DEMO_ID);
  const [mode, setMode] = useState<"live" | "simulator">("simulator");
  const [liveEvents, setLiveEvents] = useState<
    Array<{ matchId: number; type: string; category: string; ts: number; index: number }>
  >([]);
  const [stakeOpen, setStakeOpen] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("10");
  const [pick, setPick] = useState<1 | 2 | 3>(1);
  const pub = usePublicClient();
  const { address } = useAccount();
  const { writeContractAsync, data: txHash, isPending } = useWriteContract();
  useWaitForTransactionReceipt({ hash: txHash });

  const hasOracle = Boolean(ORACLE_ADDRESS && ORACLE_ADDRESS.length === 42);

  const { data: matchIds, refetch: refetchIds } = useReadContract({
    address: hasOracle ? ORACLE_ADDRESS : undefined,
    abi: ORACLE_ABI,
    functionName: "allMatchIds",
    query: { enabled: hasOracle, refetchInterval: 8_000 },
  });

  const { data: events, refetch: refetchEvents } = useReadContract({
    address: hasOracle ? ORACLE_ADDRESS : undefined,
    abi: ORACLE_ABI,
    functionName: "getEvents",
    args: [BigInt(selected)],
    query: { enabled: hasOracle, refetchInterval: 5_000 },
  });

  // Watch EventAdded
  useEffect(() => {
    if (!pub || !hasOracle) return;
    const unwatch = pub.watchContractEvent({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      eventName: "EventAdded",
      onLogs: (logs) => {
        for (const log of logs) {
          const { matchId, index, category, eventType, timestamp } = log.args as {
            matchId?: bigint;
            index?: bigint;
            category?: string;
            eventType?: string;
            timestamp?: bigint;
          };
          if (matchId == null) continue;
          setLiveEvents((prev) => [
            {
              matchId: Number(matchId),
              type: eventType || "?",
              category: category || "",
              ts: Number(timestamp || 0),
              index: Number(index || 0),
            },
            ...prev,
          ].slice(0, 50));
          if (Number(matchId) === selected) refetchEvents();
          refetchIds();
        }
      },
    });
    return () => unwatch();
  }, [pub, hasOracle, selected, refetchEvents, refetchIds]);

  const ids = useMemo(() => {
    const fromChain = (matchIds as bigint[] | undefined)?.map(Number) || [];
    if (!fromChain.includes(selected)) fromChain.unshift(selected);
    if (!fromChain.includes(DEMO_ID)) fromChain.unshift(DEMO_ID);
    return Array.from(new Set(fromChain));
  }, [matchIds, selected]);

  const eventList = (events as OracleEvent[] | undefined) || [];
  const latest = eventList[eventList.length - 1];
  const score = latest ? parseScore(latest.details) : {};
  const goals = eventList.filter((e) => e.eventType.toLowerCase().includes("goal")).length;
  const cards = eventList.filter((e) => e.eventType.toLowerCase().includes("card")).length;
  const meta = metaFor(selected);

  const doStake = useCallback(async () => {
    if (!address || !REWARDS_ADDRESS) {
      toast.error("Connect wallet and set REWARDS_ADDRESS");
      return;
    }
    try {
      const amount = parseUnits(stakeAmount, 6);
      await writeContractAsync({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [REWARDS_ADDRESS, amount],
      });
      const hash = await writeContractAsync({
        address: REWARDS_ADDRESS,
        abi: REWARDS_ABI,
        functionName: "stake",
        args: [BigInt(selected), pick, amount],
      });
      toast.success(`Staked — ${hash.slice(0, 10)}…`);
      setStakeOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stake failed");
    }
  }, [address, stakeAmount, pick, selected, writeContractAsync]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full shrink-0 lg:w-[280px]">
        <div className="card sticky top-20 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Matches</h2>
            <div className="flex rounded-lg border border-ink-border p-0.5 text-[10px]">
              {(["simulator", "live"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-2 py-1 capitalize ${
                    mode === m ? "bg-cyan-accent/20 text-cyan-accent" : "text-ink-muted"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <ul className="space-y-1">
            {ids.map((id) => {
              const m = metaFor(id);
              return (
                <li key={id}>
                  <button
                    onClick={() => setSelected(id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      selected === id
                        ? "bg-cyan-accent/10 text-white ring-1 ring-cyan-accent/40"
                        : "hover:bg-ink border border-transparent text-ink-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{m.homeFlag}</span>
                      <span className="truncate">
                        {m.home} vs {m.away}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-ink-muted">
                      #{id}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {!hasOracle && (
            <p className="text-xs text-amber-400">
              Set NEXT_PUBLIC_ORACLE_ADDRESS after deploy to stream live chain
              data. Demo meta still works.
            </p>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* Header score */}
        <div className="card relative overflow-hidden">
          <div className="absolute right-4 top-4">
            <span className="pill bg-live/15 text-live">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
              {mode === "simulator" ? "SIMULATOR" : "LIVE"}
            </span>
          </div>
          <div className="flex flex-col items-center gap-4 py-4 sm:flex-row sm:justify-center sm:gap-12">
            <div className="text-center">
              <div className="text-4xl">{meta.homeFlag}</div>
              <div className="mt-1 font-display text-lg font-semibold">
                {meta.home}
              </div>
            </div>
            <div className="text-center">
              <div className="font-display text-5xl font-bold tabular-nums text-cyan-accent">
                {score.home ?? "–"} : {score.away ?? "–"}
              </div>
              <div className="mt-1 text-xs text-ink-muted">
                {latest ? `min ${latest.minute} · ${latest.eventType}` : "waiting for events"}
              </div>
            </div>
            <div className="text-center">
              <div className="text-4xl">{meta.awayFlag}</div>
              <div className="mt-1 font-display text-lg font-semibold">
                {meta.away}
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Events", eventList.length],
            ["Goals", goals],
            ["Cards", cards],
            ["Match ID", selected],
          ].map(([k, v]) => (
            <div key={k as string} className="card py-3 text-center">
              <div className="text-xs text-ink-muted">{k}</div>
              <div className="font-display text-xl font-semibold">{v}</div>
            </div>
          ))}
        </div>

        {/* Feed + actions */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <h3 className="mb-4 font-display font-semibold">Event feed</h3>
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
                        <span className="font-medium capitalize">{e.eventType}</span>
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
                  No on-chain events yet. Start the feeder simulator:
                  <code className="mt-2 block text-cyan-accent">
                    npm run dev:feeder
                  </code>
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="card space-y-3">
              <h3 className="font-display font-semibold">Quick actions</h3>
              <Link
                href={`/agent?matchId=${selected}`}
                className="btn-primary w-full"
              >
                Ask agent about match
              </Link>
              <button
                className="btn-ghost w-full"
                onClick={() => setStakeOpen(true)}
              >
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
              <div>Live tips: {liveEvents.length}</div>
              {liveEvents[0] && (
                <div className="text-[10px]">
                  Last: {liveEvents[0].type} @ match {liveEvents[0].matchId}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stake modal */}
      {stakeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card w-full max-w-md space-y-4">
            <h3 className="font-display text-lg font-semibold">
              Stake — match #{selected}
            </h3>
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
              min="0"
              step="0.1"
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
