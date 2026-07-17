"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { fetchFixtures, statusLabel, type PublicFixture } from "@/lib/fixtures";
import { explorerTx } from "@/lib/chain";
import { shortAddr } from "@/lib/utils";

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
  argentina: "🇦🇷",
  brazil: "🇧🇷",
  france: "🇫🇷",
  germany: "🇩🇪",
  italy: "🇮🇹",
  spain: "🇪🇸",
  england: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  portugal: "🇵🇹",
  netherlands: "🇳🇱",
  belgium: "🇧🇪",
  croatia: "🇭🇷",
  uruguay: "🇺🇾",
  mexico: "🇲🇽",
  "united states": "🇺🇸",
  canada: "🇨🇦",
  japan: "🇯🇵",
  "south korea": "🇰🇷",
  australia: "🇦🇺",
  morocco: "🇲🇦",
  senegal: "🇸🇳",
  nigeria: "🇳🇬",
  cameroon: "🇨🇲",
  ghana: "🇬🇭",
  tunisia: "🇹🇳",
  algeria: "🇩🇿",
  egypt: "🇪🇬",
  "saudi arabia": "🇸🇦",
  iran: "🇮🇷",
  qatar: "🇶🇦",
  ecuador: "🇪🇨",
  peru: "🇵🇪",
  colombia: "🇨🇴",
  chile: "🇨🇱",
  paraguay: "🇵🇾",
  denmark: "🇩🇰",
  sweden: "🇸🇪",
  norway: "🇳🇴",
  switzerland: "🇨🇭",
  poland: "🇵🇱",
  serbia: "🇷🇸",
  ukraine: "🇺🇦",
  turkey: "🇹🇷",
  wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  hungary: "🇭🇺",
  austria: "🇦🇹",
  "czech republic": "🇨🇿",
  slovakia: "🇸🇰",
  romania: "🇷🇴",
  bulgaria: "🇧🇬",
  greece: "🇬🇷",
  russia: "🇷🇺",
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
  const { isConnected } = useAccount();
  useEffect(() => {
    if (!isConnected) router.replace("/");
  }, [isConnected, router]);

  const [fixtures, setFixtures] = useState<PublicFixture[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [selected, setSelected] = useState<PublicFixture | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [stats, setStats] = useState<PremiumStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFixtures().then((list) => {
      setFixtures(list);
      if (list.length > 0 && !selectedKey) {
        setSelectedKey(list[0]?.label || "");
      }
    });
  }, []);

  useEffect(() => {
    const fx = fixtures.find((f) => f.label === selectedKey) || null;
    setSelected(fx);
    setStats(null);
    setStatus("idle");
    setError(null);
  }, [selectedKey, fixtures]);

  const doFetchPremium = useCallback(async () => {
    if (!selected) return;
    setStatus("loading");
    setError(null);
    setStats(null);
    try {
      const r = await fetch("/api/x402", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: selected.id, label: selected.label }),
      });
      const data = await r.json();
      if (data.error) {
        setError(data.error);
        setStatus("error");
        return;
      }
      const result = data.result || data;
      if (result._error === "x402") {
        setError(result.message || "x402 payment failed");
        setStatus("error");
        return;
      }
      setStats(result as PremiumStats);
      setStatus("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setStatus("error");
    }
  }, [selected]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Premium Analytics</h1>
        <p className="mt-1 text-ink-muted">
          AI-powered match analysis delivered via x402 payments on Injective.
        </p>
      </div>

      {/* Fixture selector */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Select match</h2>
          <span className="text-xs text-ink-muted">{fixtures.length} fixtures</span>
        </div>
        {fixtures.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {fixtures.map((fx) => {
              const isSelected = selected?.label === fx.label;
              return (
                <button
                  key={fx.label}
                  onClick={() => setSelectedKey(fx.label)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                    isSelected
                      ? "border-cyan-accent/50 bg-cyan-accent/10 ring-1 ring-cyan-accent/30"
                      : "border-ink-border bg-ink/60 hover:border-cyan-accent/20 hover:bg-ink"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{flagFor(fx.home)}</span>
                    <span className="font-medium text-white/90">{fx.home}</span>
                    <span className="text-[10px] text-cyan-accent font-bold">vs</span>
                    <span className="font-medium text-white/90">{fx.away}</span>
                    <span className={fx.status === "LIVE" || fx.status === "HT" ? "ml-2 rounded-full bg-live/15 px-2 py-0.5 text-[10px] text-live font-medium" : "ml-2 rounded-full bg-ink-border px-2 py-0.5 text-[10px] text-ink-muted"}>
                      {statusLabel(fx.status)}
                    </span>
                  </div>
                  {fx.kickoffUtcLabel && (
                    <div className="mt-0.5 text-[10px] text-ink-muted">
                      {fx.kickoffUtcLabel}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-ink-muted">
            No fixtures available. Ensure the feeder is running.
          </p>
        )}
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
                        ? "⭐ High"
                        : stats.prediction.confidence === "medium"
                          ? "⚡ Medium"
                          : "🤝 Low"}
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
                        {shortAddr(stats._x402?.transaction || "")} ↗
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
              The agent pays USDC on Injective to fetch live analytics — xG,
              possession, form, H2H, and match prediction.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
