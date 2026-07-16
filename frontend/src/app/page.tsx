"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  Bot,
  CreditCard,
  Globe2,
  Layers,
  Zap,
} from "lucide-react";

export default function LandingPage() {
  const [health, setHealth] = useState<{
    feeder?: string;
    agent?: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const live =
    health?.feeder === "up" || health?.agent === "up"
      ? "online"
      : health
        ? "partial"
        : "checking";

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink-border">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(34,211,238,0.12),_transparent_55%)]" />
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:py-32">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <span className="pill bg-live/15 text-live">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
              {live === "online"
                ? "LIVE — services online"
                : live === "checking"
                  ? "Checking feeder…"
                  : "Demo mode · start services"}
            </span>
            <span className="pill bg-ink-card text-ink-muted">
              Injective EVM · chain 1439
            </span>
          </div>
          <h1 className="font-display max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Real-time World Cup events{" "}
            <span className="text-cyan-accent">on Injective.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-muted">
            An on-chain event oracle + MCP agent that autonomously pays for data
            (x402) and distributes cross-chain rewards (CCTP). The missing
            real-world event primitive for Injective builders.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/dashboard" className="btn-primary px-6 py-3">
              Launch Demo
            </Link>
            <Link href="/agent" className="btn-ghost px-6 py-3">
              Chat with CupAgent
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost px-6 py-3"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-b border-ink-border bg-ink-card/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-3 px-4 py-4 text-xs text-ink-muted">
          {[
            "Injective",
            "MCP Server",
            "x402",
            "Circle CCTP",
            "Agent Skills",
            "World Cup 2026",
          ].map((t) => (
            <span
              key={t}
              className="rounded-full border border-ink-border px-3 py-1"
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <h2 className="font-display text-2xl font-semibold sm:text-3xl">
          How it works
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              n: "01",
              title: "Sports API → on-chain oracle",
              body: "Feeder polls live fixtures (or simulator) and appends events via CupEventOracle.addEvent().",
              icon: Activity,
            },
            {
              n: "02",
              title: "MCP agent · natural language",
              body: "CupAgent exposes get_latest_event, list_events, settle_match, get_premium_stats as MCP tools.",
              icon: Bot,
            },
            {
              n: "03",
              title: "x402 pay · CCTP settle",
              body: "Agent pays for premium analytics over HTTP 402. Winners claim USDC and bridge via CCTP.",
              icon: CreditCard,
            },
          ].map((c) => (
            <div key={c.n} className="card">
              <div className="mb-3 flex items-center justify-between">
                <c.icon className="h-5 w-5 text-cyan-accent" />
                <span className="font-mono text-xs text-ink-muted">{c.n}</span>
              </div>
              <h3 className="font-display text-lg font-medium">{c.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-ink-border bg-ink-card/30 py-20">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="font-display text-2xl font-semibold sm:text-3xl">
            Built for builders
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "Event Oracle",
                desc: "Append-only, category-agnostic event log with role-gated feeders.",
                icon: Layers,
              },
              {
                title: "NL Agent",
                desc: "Chat that produces on-chain reads and writes in real time.",
                icon: Bot,
              },
              {
                title: "x402 Payments",
                desc: "Agent-to-service commerce with zero human in the loop.",
                icon: Zap,
              },
              {
                title: "CCTP Rewards",
                desc: "Burn USDC on Injective, mint on Sepolia via Circle CCTP V2.",
                icon: Globe2,
              },
            ].map((f) => (
              <div key={f.title} className="card">
                <f.icon className="mb-3 h-5 w-5 text-cyan-accent" />
                <h3 className="font-medium">{f.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture diagram */}
      <section className="mx-auto max-w-7xl px-4 py-20">
        <h2 className="font-display text-2xl font-semibold sm:text-3xl">
          Architecture
        </h2>
        <div className="card mt-8 overflow-x-auto font-mono text-[11px] leading-relaxed text-ink-muted sm:text-xs">
          <pre className="min-w-[640px] whitespace-pre text-left">
{`  Sports API / Simulator
           │ pull 30–60s
           ▼
       Data Feeder ──addEvent()──► CupEventOracle.sol (Injective EVM 1439)
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
         Next.js UI                 MCP Agent                 CupRewards
         (5 pages)              (LLM + tools)               + CCTP burn
                                        │
                                        ▼
                               x402 /premium-stats`}
          </pre>
        </div>
      </section>

      {/* Beyond WC */}
      <section className="border-t border-ink-border py-20">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="font-display text-2xl font-semibold">
            Beyond the World Cup
          </h2>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Generic infrastructure. After the final whistle it works for EPL,
            NFL, Olympics, tennis, esports, and elections — same contract,
            different category string.
          </p>
          <div className="mt-6 overflow-hidden rounded-xl border border-ink-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-card text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Example eventType</th>
                  <th className="px-4 py-3 font-medium">Use case</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["football", "goal / card / final", "WC, EPL, UCL"],
                  ["esports", "round_win / map_end", "prediction markets"],
                  ["election", "precinct_call", "governance / media"],
                  ["tennis", "set / match_end", "live odds feeds"],
                ].map(([c, e, u]) => (
                  <tr key={c} className="border-t border-ink-border">
                    <td className="px-4 py-3 font-mono text-cyan-accent">{c}</td>
                    <td className="px-4 py-3 text-ink-muted">{e}</td>
                    <td className="px-4 py-3">{u}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="border-t border-ink-border bg-gradient-to-b from-cyan-accent/5 to-transparent py-16 text-center">
        <h2 className="font-display text-2xl font-semibold">
          Open the live dashboard
        </h2>
        <p className="mt-2 text-ink-muted">
          Events stream in from the feeder simulator in under a minute.
        </p>
        <Link href="/dashboard" className="btn-primary mt-6 inline-flex px-8 py-3">
          Open Live Dashboard
        </Link>
      </section>
    </div>
  );
}
