"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  usePublicClient,
  useReadContract,
  useAccount,
  useChainId,
} from "wagmi";
import {
  ORACLE_ABI,
  ORACLE_ADDRESS,
  DROPS_ADDRESS,
  TREASURY_ADDRESS,
  USDC_ADDRESS,
  ERC20_ABI,
  type OracleEvent,
} from "@/lib/contracts";
import { eventIcon, parseScore, shortAddr } from "@/lib/utils";
import { explorerAddress } from "@/lib/chain";
import { isInjectiveChain } from "@/lib/ensureInjective";
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
  if (s.includes("md1") || (s.includes("group") && !s.includes("md2") && !s.includes("md3"))) return "GS1";
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
  const { isConnected, address } = useAccount();
  useEffect(() => {
    if (!isConnected) router.replace("/");
  }, [isConnected, router]);

  const [fixtures, setFixtures] = useState<PublicFixture[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [stageKey, setStageKey] = useState<string>("GS1");
  const pub = usePublicClient();
  const chainId = useChainId();

  const hasOracle = Boolean(ORACLE_ADDRESS && ORACLE_ADDRESS.length === 42);
  const hasDrops = Boolean(DROPS_ADDRESS && DROPS_ADDRESS.length === 42);
  const hasTreasury = Boolean(TREASURY_ADDRESS && TREASURY_ADDRESS.length === 42);
  const onInjective = isInjectiveChain(chainId);

  const { data: usdcBal } = useReadContract({
    address: address ? USDC_ADDRESS : undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });
  const usdcBalance = usdcBal != null ? Number(usdcBal) / 1e6 : null;

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
                  : "text-[#94A3B8] hover:text-white"
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
                  <div className="mt-0.5 text-[10px] text-[#94A3B8]">
                    {fx.kickoffUtcLabel || fx.kickoffUtc || ""}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-4 text-center text-xs text-[#94A3B8]">
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
                  <Link
                    href="/drops"
                    className="btn-ghost w-full text-center"
                  >
                    View Fan Drops
                  </Link>
                  <Link
                    href="/x402"
                    className="btn-ghost w-full text-center"
                  >
                    Premium Analytics
                  </Link>
                </div>

                {/* Balance card */}
                <div className="card space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display font-semibold text-sm">Wallet</h3>
                    <span className={`text-[10px] pill ${onInjective ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                      {onInjective ? "Injective" : `Chain ${chainId}`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">USDC Balance</span>
                    <span className="font-semibold">
                      {usdcBalance != null ? `${usdcBalance.toFixed(2)} USDC` : "—"}
                    </span>
                  </div>
                  {usdcBalance != null && usdcBalance <= 0 && hasDrops && (
                    <Link href="/drops" className="text-xs text-cyan-accent hover:underline">
                      Need USDC? Check the Drops page →
                    </Link>
                  )}
                </div>

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
                  {hasDrops && (
                    <div>
                      Drops:{" "}
                      <a
                        href={explorerAddress(DROPS_ADDRESS)}
                        className="text-cyan-accent"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddr(DROPS_ADDRESS)}
                      </a>
                    </div>
                  )}
                  {hasTreasury && (
                    <div>
                      Treasury:{" "}
                      <a
                        href={explorerAddress(TREASURY_ADDRESS)}
                        className="text-cyan-accent"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddr(TREASURY_ADDRESS)}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
