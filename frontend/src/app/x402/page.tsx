"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWalletClient, useConfig } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { fetchFixtures, statusLabel, type PublicFixture } from "@/lib/fixtures";
import { explorerTx } from "@/lib/chain";
import { shortAddr } from "@/lib/utils";
import { USDC_ADDRESS } from "@/lib/contracts";
import { ensureInjectiveChain } from "@/lib/ensureInjective";
import { payPremiumStats } from "@/lib/x402";
import { TxModal, type TxStep } from "@/components/TxModal";
import { toast } from "sonner";
import { ChevronDown, Search, Check, X } from "lucide-react";

type PremiumStats = {
  home: string;
  away: string;
  matchId: number;
  status?: string;
  score?: { home: number; away: number };
  xg?: { home: number; away: number };
  possession?: { home: number; away: number };
  shots?: { home: number; away: number };
  form?: { home: string; away: string };
  h2h?: string | null;
  prediction?: {
    winner: string;
    confidence: string;
    reasoning: string;
  };
  narrative?: string;
  probabilities?: { home: number; draw: number; away: number };
  scorelines?: { score: string; probability: number }[];
  expectedGoals?: { home: number; away: number };
  model?: { type: string; inputs: string[]; dataCoverage: string };
  _paid?: boolean;
  _protocol?: string;
  _x402?: {
    paid?: boolean;
    protocol?: string;
    network?: string;
    transaction?: string;
    chainId?: number;
    onChain?: boolean;
    explorerTx?: string;
  };
  _source?: string;
};

type Status = "idle" | "loading" | "success" | "error";

const TEAM_FLAGS: Record<string, string> = {
  argentina: "🇦🇷", brazil: "🇧🇷", france: "🇫🇷", germany: "🇩🇪",
  italy: "🇮🇹", spain: "🇪🇸", england: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", portugal: "🇵🇹",
  netherlands: "🇳🇱", belgium: "🇧🇪", croatia: "🇭🇷", uruguay: "🇺🇾",
  mexico: "🇲🇽", "united states": "🇺🇸", canada: "🇨🇦", japan: "🇯🇵",
  "south korea": "🇰🇷", australia: "🇦🇺", morocco: "🇲🇦", senegal: "🇸🇳",
  nigeria: "🇳🇬", cameroon: "🇨🇲", ghana: "🇬🇭", tunisia: "🇹🇳",
  algeria: "🇩🇿", egypt: "🇪🇬", "saudi arabia": "🇸🇦", iran: "🇮🇷",
  qatar: "🇶🇦", ecuador: "🇪🇨", peru: "🇵🇪", colombia: "🇨🇴",
  chile: "🇨🇱", paraguay: "🇵🇾", denmark: "🇩🇰", sweden: "🇸🇪",
  norway: "🇳🇴", switzerland: "🇨🇭", poland: "🇵🇱", serbia: "🇷🇸",
  ukraine: "🇺🇦", turkey: "🇹🇷", wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", hungary: "🇭🇺", austria: "🇦🇹",
  "czech republic": "🇨🇿", slovakia: "🇸🇰", romania: "🇷🇴",
  bulgaria: "🇧🇬", greece: "🇬🇷", russia: "🇷🇺",
};

function flagFor(team: string): string {
  const key = team.toLowerCase().trim();
  if (TEAM_FLAGS[key]) return TEAM_FLAGS[key];
  const parts = key.split(/\s+/);
  for (const p of parts) {
    if (TEAM_FLAGS[p]) return TEAM_FLAGS[p];
  }
  return "⚽";
}

function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-xl border border-ink-border bg-ink-card p-5 ${className || ""}`} {...props}>
      {children}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-border/50 py-2 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}

export default function X402Page() {
  const router = useRouter();
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const config = useConfig();
  useEffect(() => {
    if (!isConnected) router.replace("/");
  }, [isConnected, router]);

  const [fixtures, setFixtures] = useState<PublicFixture[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [selected, setSelected] = useState<PublicFixture | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [stats, setStats] = useState<PremiumStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [whitelisted, setWhitelisted] = useState(false);
  const [successModal, setSuccessModal] = useState<{
    amountUsdc: string;
    txHash?: string;
    explorerUrl?: string;
    matchLabel: string;
    whitelisted: boolean;
  } | null>(null);
  const [payFlow, setPayFlow] = useState<{ open: boolean; steps: TxStep[] }>({
    open: false,
    steps: [],
  });

  useEffect(() => {
    fetchFixtures().then((list) => {
      setFixtures(list);
    });
  }, []);

  // Auto-select first fixture after fixtures load, or when connected
  useEffect(() => {
    if (fixtures.length > 0 && !selectedKey) {
      setSelectedKey(fixtures[0]?.label || "");
    }
  }, [fixtures, selectedKey]);

  useEffect(() => {
    const fx = fixtures.find((f) => f.label === selectedKey) || null;
    setSelected(fx);
    setStats(null);
    setStatus("idle");
    setError(null);
    setWhitelisted(false);
  }, [selectedKey, fixtures]);

  // Stage grouping for the picker
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

  // Filtered & grouped fixtures
  const query = searchQuery.toLowerCase().trim();
  const filteredFixtures = useMemo(
    () =>
      query
        ? fixtures.filter(
            (fx) =>
              fx.home.toLowerCase().includes(query) ||
              fx.away.toLowerCase().includes(query) ||
              fx.label.toLowerCase().includes(query)
          )
        : fixtures,
    [fixtures, query]
  );

  const groupedFixtures = useMemo(() => {
    const groups: { stageKey: string; label: string; items: PublicFixture[] }[] = [];
    if (query) {
      // No grouping when searching
      groups.push({ stageKey: "_all", label: "Results", items: filteredFixtures });
    } else {
      for (const s of STAGES) {
        const items = fixtures.filter((f) => matchStageKey(f) === s.key);
        if (items.length > 0) {
          groups.push({ stageKey: s.key, label: s.label, items });
        }
      }
      // Uncategorised
      const other = fixtures.filter((f) => !STAGES.some((s) => matchStageKey(f) === s.key));
      if (other.length > 0) {
        groups.push({ stageKey: "_other", label: "Other", items: other });
      }
    }
    return groups;
  }, [fixtures, query, filteredFixtures]);

  const doFetchPremium = useCallback(async () => {
    if (!selected) return;
    if (!walletClient || !address) {
      setError("Connect your wallet to pay for premium stats.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    setStats(null);
    setWhitelisted(false);

    // Open the processing modal — walks through sign -> settle -> whitelist.
    const SIGN = "Sign payment authorization";
    const SETTLE = "Settling payment on-chain";
    const WHITELIST = "Registering for fan drop";
    setPayFlow({
      open: true,
      steps: [
        { label: SIGN, status: "pending" },
        { label: SETTLE, status: "pending" },
        { label: WHITELIST, status: "pending" },
      ],
    });

    const setStep = (label: string, status: TxStep["status"]) =>
      setPayFlow((f) => ({
        ...f,
        steps: f.steps.map((s) => (s.label === label ? { ...s, status } : s)),
      }));

    // Fire whitelisting in parallel the moment the user signs, so it's
    // usually already resolved by the time the success modal appears.
    type WhitelistResult = { ok: boolean; dropId?: number; error?: string };
    let whitelistPromise: Promise<WhitelistResult> | null = null;
    const startWhitelist = () => {
      if (whitelistPromise) return;
      whitelistPromise = fetch("/api/whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: selected.id, address, wallet: address }),
      })
        .then(async (wl): Promise<WhitelistResult> => {
          const wlData = await wl.json().catch(() => ({}));
          if (wl.ok && !wlData.error) {
            return { ok: true, dropId: wlData.dropId as number | undefined };
          }
          return { ok: false, error: wlData.error || `HTTP ${wl.status}` };
        })
        .catch(
          (e): WhitelistResult => ({
            ok: false,
            error: e instanceof Error ? e.message : "network error",
          })
        );
    };

    try {
      // Ensure the wallet is on Injective EVM before signing the payment.
      await ensureInjectiveChain(config);

      // The USER's wallet pays the x402 paywall via EIP-3009.
      const { data, receipt } = await payPremiumStats(
        walletClient,
        address,
        selected.id,
        USDC_ADDRESS as `0x${string}`,
        undefined,
        undefined,
        (stage) => {
          if (stage === "sign") setStep(SIGN, "pending");
          if (stage === "settle") {
            setStep(SIGN, "confirmed");
            setStep(SETTLE, "pending");
            startWhitelist();
          }
          if (stage === "done") setStep(SETTLE, "confirmed");
        }
      );

      const result: PremiumStats = {
        ...(data as PremiumStats),
        _paid: true,
        _protocol: "x402",
        _x402: {
          paid: receipt?.success ?? true,
          protocol: "x402",
          network: receipt?.network,
          transaction: receipt?.transaction,
          onChain: !!receipt?.transaction,
          explorerTx: receipt?.transaction
            ? explorerTx(receipt.transaction)
            : undefined,
        },
      };
      setStats(result);
      setStatus("success");

      // Attach the settlement tx to the on-chain step (keep modal open so the
      // user sees both steps confirmed for a beat before we morph to success).
      setPayFlow((f) => ({
        ...f,
        steps: f.steps.map((s) =>
          s.label === SETTLE
            ? {
                ...s,
                status: "confirmed",
                txHash: receipt?.transaction as `0x${string}` | undefined,
              }
            : s
        ),
      }));

      // Amount charged for premium stats (0.10 USDC = 100000 in 6dp).
      const amountUsdc = "0.10";

      // Resolve whitelisting BEFORE showing success — it was kicked off in
      // parallel during settlement, so it's usually already done. This keeps the
      // last processing step accurate and lets the success modal appear fully
      // final (no in-modal spinner or state changes).
      startWhitelist();
      let didWhitelist = false;
      try {
        const wlRes: WhitelistResult =
          (await whitelistPromise) ?? { ok: false, error: "no result" };
        if (wlRes.ok) {
          didWhitelist = true;
          setWhitelisted(true);
          setStep(WHITELIST, "confirmed");
          toast.success(
            wlRes.dropId != null
              ? `Whitelisted for Drop #${wlRes.dropId} — go claim your reward`
              : "You're whitelisted for this match's fan drop"
          );
        } else {
          const reason = wlRes.error || "whitelist failed";
          console.warn("[x402] auto-whitelist failed:", reason);
          setStep(WHITELIST, "error");
          toast.error(`Auto-whitelist failed: ${reason}`);
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : "network error";
        console.warn("[x402] auto-whitelist error:", reason);
        setStep(WHITELIST, "error");
        toast.error(`Auto-whitelist failed: ${reason}`);
      }

      // All steps resolved — brief beat so the final checks register, then
      // morph straight into a fully-final success modal (nothing loads inside).
      await new Promise((r) => setTimeout(r, 400));
      setPayFlow((f) => ({ ...f, open: false }));
      setSuccessModal({
        amountUsdc,
        txHash: receipt?.transaction,
        explorerUrl: receipt?.transaction
          ? explorerTx(receipt.transaction)
          : undefined,
        matchLabel: selected.label,
        whitelisted: didWhitelist,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Payment failed";
      setError(msg);
      setStatus("error");
      // Mark the first still-pending step as failed so the modal shows why.
      setPayFlow((f) => {
        const idx = f.steps.findIndex((s) => s.status === "pending");
        if (idx === -1) return f;
        return {
          ...f,
          steps: f.steps.map((s, i) =>
            i === idx ? { ...s, status: "error", label: `${s.label} — ${msg}` } : s
          ),
        };
      });
      toast.error(msg);
    }
  }, [selected, walletClient, address, config]);

  return (
    <div className="relative">
      <div
        className="pointer-events-none fixed inset-0 bg-cover bg-center bg-no-repeat opacity-10"
        style={{ backgroundImage: "url('/field.png')" }}
      />

      {/* Sticky top bar — matches dashboard shell */}
      <div className="sticky top-0 z-30 border-b border-[#1E293B] bg-[#0B0F19]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-cyan-accent/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan-accent ring-1 ring-cyan-accent/30">
              Premium Analytics
            </span>
            <span className="hidden text-[11px] text-ink-muted sm:inline">
              x402 · pay-per-call on Injective
            </span>
          </div>
          {address && (
            <span className="pill bg-cyan-accent/15 text-[10px] text-cyan-accent">
              {shortAddr(address)}
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 pb-8 pt-6">
        <div>
          <h1 className="font-display text-3xl font-bold">Premium Analytics</h1>
          <p className="mt-1 text-ink-muted">
            AI-powered match analysis delivered via x402 payments on Injective.
          </p>
        </div>

      {/* Fixture selector — collapsible */}
      <Card className={`transition-all duration-300 ${panelOpen ? "" : ""}`}>
        {/* Header bar — always visible */}
        <button
          onClick={() => setPanelOpen(!panelOpen)}
          className="flex w-full items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-accent/10 text-sm">
              {selected ? (
                <span className="text-lg">{flagFor(selected.home)}</span>
              ) : (
                <Search className="h-4 w-4 text-cyan-accent" />
              )}
            </div>
            <div className="text-left">
              <div className="font-display font-semibold">
                {selected ? (
                  <span className="flex items-center gap-2">
                    <span>{flagFor(selected.home)} {selected.home}</span>
                    <span className="text-[10px] text-cyan-accent font-bold">vs</span>
                    <span>{flagFor(selected.away)} {selected.away}</span>
                  </span>
                ) : (
                  "Select a match"
                )}
              </div>
              {selected && (
                <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                  <span>{selected.stageLabel || selected.stage || selected.group || ""}</span>
                  <span>·</span>
                  <span>{selected.kickoffUtcLabel || ""}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      selected.status === "LIVE" || selected.status === "HT"
                        ? "bg-live/15 text-live"
                        : "bg-ink-border text-ink-muted"
                    }`}
                  >
                    {statusLabel(selected.status)}
                  </span>
                </div>
              )}
              {!selected && fixtures.length > 0 && (
                <div className="text-[11px] text-ink-muted">
                  {fixtures.length} fixtures available
                </div>
              )}
            </div>
          </div>
          <motion.div
            animate={{ rotate: panelOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-border/50"
          >
            <ChevronDown className="h-4 w-4 text-ink-muted" />
          </motion.div>
        </button>

        {/* Expandable panel */}
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="mt-4 border-t border-ink-border pt-4">
                {/* Search */}
                <div className="relative mb-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by team name…"
                    className="w-full rounded-lg border border-ink-border bg-ink py-2 pl-10 pr-8 text-sm outline-none transition focus:border-cyan-accent/50 focus:ring-1 focus:ring-cyan-accent/20"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Grouped fixture list */}
                {groupedFixtures.length > 0 ? (
                  <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
                    {groupedFixtures.map((group) => (
                      <div key={group.stageKey}>
                        <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                          <span>{group.label}</span>
                          <span className="h-px flex-1 bg-ink-border/50" />
                          <span className="text-[10px] font-normal">{group.items.length}</span>
                        </div>
                        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {group.items.map((fx) => {
                            const isSelected = selected?.label === fx.label;
                            return (
                              <button
                                key={fx.label}
                                onClick={() => {
                                  setSelectedKey(fx.label);
                                  setPanelOpen(false);
                                  setSearchQuery("");
                                }}
                                className={`group relative flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all duration-150 ${
                                  isSelected
                                    ? "border-cyan-accent/50 bg-cyan-accent/10 ring-1 ring-cyan-accent/30"
                                    : "border-ink-border/70 bg-ink/40 hover:border-cyan-accent/20 hover:bg-ink-card"
                                }`}
                              >
                                {/* Checkmark for selected */}
                                {isSelected && (
                                  <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-accent">
                                    <Check className="h-3 w-3 text-white" />
                                  </div>
                                )}
                                <span className="shrink-0 text-lg">{flagFor(fx.home)}</span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate font-medium text-white/90">{fx.home}</span>
                                    <span className="shrink-0 text-[9px] font-bold text-cyan-accent">vs</span>
                                    <span className="truncate font-medium text-white/90">{fx.away}</span>
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-muted">
                                    <span>{fx.kickoffUtcLabel || ""}</span>
                                    <span
                                      className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${
                                        fx.status === "LIVE" || fx.status === "HT"
                                          ? "bg-live/15 text-live"
                                          : "bg-ink-border/50 text-ink-muted"
                                      }`}
                                    >
                                      {statusLabel(fx.status)}
                                    </span>
                                  </div>
                                </div>
                                <span className="shrink-0 text-lg opacity-60 group-hover:opacity-100 transition-opacity">
                                  {flagFor(fx.away)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-ink-muted">
                    {searchQuery
                      ? `No fixtures match "${searchQuery}"`
                      : "No fixtures available. Ensure the feeder is running."}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Selected match detail + action */}
      {selected && (
        <Card>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-3xl">{flagFor(selected.home)}</div>
                <div className="mt-1 font-display text-lg font-semibold">
                  {selected.home}
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-cyan-accent">vs</div>
              </div>
              <div className="text-center">
                <div className="text-3xl">{flagFor(selected.away)}</div>
                <div className="mt-1 font-display text-lg font-semibold">
                  {selected.away}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2 sm:items-end">
              <span
                className={`pill ${
                  selected.status === "LIVE" || selected.status === "HT"
                    ? "bg-live/15 text-live"
                    : "bg-ink-border text-ink-muted"
                }`}
              >
                {statusLabel(selected.status)}
              </span>
              {status !== "loading" && (
                <button
                  className="btn-primary"
                  onClick={doFetchPremium}
                >
                  Get Premium Analytics
                </button>
              )}
              {status === "loading" && (
                <button className="btn-ghost" disabled>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-cyan-accent border-t-transparent" />
                  Fetching premium data…
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Loading state */}
      {status === "loading" && (
        <Card>
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex items-center gap-3">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-cyan-accent border-t-transparent" />
              <p className="text-sm text-ink-muted">
                Agent is purchasing premium analytics via x402…
              </p>
            </div>
            <p className="text-xs text-ink-muted">
              This may take a few seconds. The agent pays USDC on Injective to
              unlock the data.
            </p>
          </div>
        </Card>
      )}

      {/* Error state */}
      {status === "error" && error && (
        <Card className="border-red-500/30">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
              <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <h3 className="font-display font-semibold text-red-400">
                Analytics fetch failed
              </h3>
              <p className="mt-1 text-sm text-ink-muted">{error}</p>
            </div>
            <button className="btn-ghost text-sm" onClick={doFetchPremium}>
              Retry
            </button>
          </div>
        </Card>
      )}

      {/* Premium analytics results */}
      <AnimatePresence>
        {status === "success" && stats && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Score card */}
            {stats.score && (stats.score.home != null || stats.score.away != null) && (
              <Card>
                <div className="flex items-center justify-center gap-8 py-2">
                  <div className="text-center">
                    <div className="text-3xl">{flagFor(stats.home)}</div>
                    <div className="mt-1 text-sm font-medium text-white/80">{stats.home}</div>
                  </div>
                  <div className="text-center">
                    <div className="font-display text-5xl font-bold text-cyan-accent">
                      {stats.score.home ?? "–"} : {stats.score.away ?? "–"}
                    </div>
                    <div className="mt-1 text-xs text-ink-muted">
                      {stats.status ? statusLabel(stats.status) : "—"}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl">{flagFor(stats.away)}</div>
                    <div className="mt-1 text-sm font-medium text-white/80">{stats.away}</div>
                  </div>
                </div>
              </Card>
            )}

            {/* Win probabilities - the headline probabilistic output */}
            {stats.probabilities && (
              <Card className="border-cyan-accent/20">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Win Probabilities
                </h3>
                <div className="mb-3 flex h-3 overflow-hidden rounded-full">
                  <div className="bg-cyan-accent" style={{ width: `${Math.round(stats.probabilities.home * 100)}%` }} />
                  <div className="bg-ink-border" style={{ width: `${Math.round(stats.probabilities.draw * 100)}%` }} />
                  <div className="bg-cyan-accent/50" style={{ width: `${Math.round(stats.probabilities.away * 100)}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-xs text-ink-muted">{flagFor(stats.home)} {stats.home}</div>
                    <div className="font-display text-lg font-bold text-cyan-accent">{Math.round(stats.probabilities.home * 100)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-muted">Draw</div>
                    <div className="font-display text-lg font-bold text-ink-muted">{Math.round(stats.probabilities.draw * 100)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-muted">{stats.away} {flagFor(stats.away)}</div>
                    <div className="font-display text-lg font-bold text-cyan-accent/70">{Math.round(stats.probabilities.away * 100)}%</div>
                  </div>
                </div>
              </Card>
            )}

            {/* Most likely scorelines */}
            {stats.scorelines && stats.scorelines.length > 0 && (
              <Card>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Most Likely Scorelines
                </h3>
                <div className="space-y-2">
                  {stats.scorelines.map((s) => (
                    <div key={s.score} className="flex items-center justify-between">
                      <span className="font-mono text-sm text-white/90">{s.score}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-border">
                          <div className="h-full rounded-full bg-cyan-accent" style={{ width: `${Math.round(s.probability * 100)}%` }} />
                        </div>
                        <span className="w-10 text-right text-xs text-ink-muted">{Math.round(s.probability * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {/* Stats grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {stats.xg && (
                <Card>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Expected Goals (xG)
                  </h3>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <span>{flagFor(stats.home)}</span>
                        {stats.home}
                      </span>
                      <span className="font-display text-lg font-bold text-cyan-accent">
                        {stats.xg.home?.toFixed(2)}
                      </span>
                    </div>
                    <div className="border-t border-ink-border/30" />
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <span>{flagFor(stats.away)}</span>
                        {stats.away}
                      </span>
                      <span className="font-display text-lg font-bold text-cyan-accent">
                        {stats.xg.away?.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </Card>
              )}

              {stats.possession && (
                <Card>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Possession
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5">
                          <span>{flagFor(stats.home)}</span>
                          {stats.home}
                        </span>
                        <span className="text-sm font-medium">
                          {stats.possession.home}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-border">
                        <div
                          className="h-full rounded-full bg-cyan-accent transition-all duration-700"
                          style={{ width: `${stats.possession.home}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5">
                          <span>{flagFor(stats.away)}</span>
                          {stats.away}
                        </span>
                        <span className="text-sm font-medium">
                          {stats.possession.away}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-border">
                        <div
                          className="h-full rounded-full bg-cyan-accent/60 transition-all duration-700"
                          style={{ width: `${stats.possession.away}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {stats.shots && (
                <Card>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Shots
                  </h3>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <span>{flagFor(stats.home)}</span>
                        {stats.home}
                      </span>
                      <span className="font-display text-lg font-bold">
                        {stats.shots.home}
                      </span>
                    </div>
                    <div className="border-t border-ink-border/30" />
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <span>{flagFor(stats.away)}</span>
                        {stats.away}
                      </span>
                      <span className="font-display text-lg font-bold">
                        {stats.shots.away}
                      </span>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Form + H2H */}
            <div className="grid gap-4 sm:grid-cols-2">
              {stats.form && (
                <Card>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Recent Form (last 5 matches)
                  </h3>
                  <div className="space-y-2">
                    <StatRow
                      label={stats.home}
                      value={
                        <span className="font-mono text-xs">{stats.form.home || "—"}</span>
                      }
                    />
                    <StatRow
                      label={stats.away}
                      value={
                        <span className="font-mono text-xs">{stats.form.away || "—"}</span>
                      }
                    />
                  </div>
                </Card>
              )}

              {stats.h2h && (
                <Card>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Head to Head
                  </h3>
                  <p className="text-sm text-white/80">{stats.h2h}</p>
                </Card>
              )}
            </div>

            {/* Prediction */}
            {stats.prediction && (
              <Card>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Match Prediction
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`pill ${
                        stats.prediction.confidence === "high"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : stats.prediction.confidence === "medium"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-ink-border text-ink-muted"
                      }`}
                    >
                      {stats.prediction.confidence === "high"
                        ? "High"
                        : stats.prediction.confidence === "medium"
                          ? "Medium"
                          : "Low"}
                    </span>
                    <span className="font-display text-lg font-semibold">
                      {stats.prediction.winner}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-ink-muted">
                    {stats.prediction.reasoning}
                  </p>
                </div>
              </Card>
            )}

            {/* Narrative */}
            {stats.narrative && (
              <Card>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Analysis
                </h3>
                <p className="text-sm leading-relaxed text-white/80">
                  {stats.narrative}
                </p>
              </Card>
            )}

            {/* Model & data coverage */}
            {stats.model && (
              <Card>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Model & Data Coverage
                </h3>
                <div className="space-y-2">
                  <StatRow
                    label="Model"
                    value={<span className="text-xs text-cyan-accent">{stats.model.type}</span>}
                  />
                  <StatRow
                    label="Inputs"
                    value={<span className="text-xs text-white/80">{stats.model.inputs.join(" · ")}</span>}
                  />
                  <p className="text-xs leading-relaxed text-ink-muted">{stats.model.dataCoverage}</p>
                </div>
              </Card>
            )}
            {/* x402 payment info */}
            <Card className="border-cyan-accent/20">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Payment
              </h3>
              <div className="space-y-2">
                <StatRow
                  label="Protocol"
                  value={
                    <span className="rounded bg-cyan-accent/10 px-2 py-0.5 text-xs text-cyan-accent">
                      {stats._protocol || stats._x402?.protocol || "x402"}
                    </span>
                  }
                />
                <StatRow
                  label="Status"
                  value={
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Paid
                    </span>
                  }
                />
                {(stats._x402?.transaction || stats._x402?.explorerTx) && (
                  <StatRow
                    label="Transaction"
                    value={
                      <a
                        href={stats._x402?.explorerTx || explorerTx(stats._x402?.transaction || "")}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-cyan-accent hover:underline"
                      >
                        {shortAddr(stats._x402?.transaction || "")}
                      </a>
                    }
                  />
                )}
                {stats._x402?.network && (
                  <StatRow label="Network" value={stats._x402.network} />
                )}
                {stats._source && (
                  <StatRow
                    label="Data source"
                    value={
                      <span className="text-xs text-ink-muted">
                        {stats._source}
                      </span>
                    }
                  />
                )}
              </div>
              {whitelisted && (
                <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3">
                  <p className="text-sm font-medium text-emerald-300">
                    You&apos;re whitelisted for this match&apos;s fan drop.
                  </p>
                  <button
                    className="btn-primary mt-2 w-full text-sm"
                    onClick={() => router.push("/drops")}
                  >
                    Claim your reward
                  </button>
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Idle state */}
      {status === "idle" && selected && (
        <Card className="border-dashed border-ink-border/50">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <svg className="h-10 w-10 text-ink-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
            </svg>
            <p className="text-sm text-ink-muted">
              Select a match and click{" "}
              <strong className="text-white">Get Premium Analytics</strong>{" "}
              to unlock AI-powered insights via x402.
            </p>
            <p className="text-xs text-ink-muted">
              You pay USDC on Injective via x402 to unlock live analytics — xG,
              possession, form, H2H, and match prediction — and get auto-whitelisted
              for this match&apos;s fan drop.
            </p>
          </div>
        </Card>
      )}
      </div>

      {/* Payment processing modal — sign → settle on-chain */}
      <TxModal
        open={payFlow.open}
        title="Processing payment"
        steps={payFlow.steps}
        onClose={() => setPayFlow({ open: false, steps: [] })}
      />

      {/* Payment success modal */}
      <AnimatePresence>
        {successModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setSuccessModal(null)}
          >
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-md rounded-2xl border border-emerald-500/25 bg-ink-card p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
                  <Check className="h-7 w-7 text-emerald-400" />
                </div>
                <h3 className="font-display text-xl font-bold text-white">
                  Payment Successful
                </h3>
                <p className="text-sm text-ink-muted">
                  You paid{" "}
                  <span className="font-semibold text-white">
                    {successModal.amountUsdc} USDC
                  </span>{" "}
                  via x402 for premium analytics on{" "}
                  <span className="font-semibold text-white">
                    {successModal.matchLabel}
                  </span>
                  .
                </p>
              </div>

              <div className="mt-5 space-y-2">
                {successModal.txHash && (
                  <div className="flex items-center justify-between rounded-lg border border-ink-border/60 bg-ink px-3 py-2">
                    <span className="text-xs text-ink-muted">Settlement tx</span>
                    <a
                      href={successModal.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-cyan-accent hover:underline"
                    >
                      {shortAddr(successModal.txHash)}
                    </a>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg border border-ink-border/60 bg-ink px-3 py-2">
                  <span className="text-xs text-ink-muted">Fan drop</span>
                  <span
                    className={`text-xs font-medium ${
                      successModal.whitelisted
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }`}
                  >
                    {successModal.whitelisted ? "Whitelisted" : "Whitelist pending"}
                  </span>
                </div>
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  className="btn-ghost flex-1 text-sm"
                  onClick={() => setSuccessModal(null)}
                >
                  View stats
                </button>
                <button
                  className="btn-primary flex-1 text-sm"
                  onClick={() => router.push("/drops")}
                >
                  Claim reward
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
