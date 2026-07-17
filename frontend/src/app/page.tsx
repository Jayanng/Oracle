"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import {
  Activity,
  Bot,
  CreditCard,
  Globe2,
  Layers,
  Zap,
} from "lucide-react";

export default function LandingPage() {
  const router = useRouter();
  const { isConnected } = useAccount();

  useEffect(() => {
    if (isConnected) router.replace("/dashboard");
  }, [isConnected, router]);
  return (
    <div className="relative">
      {/* Full-screen background */}
      <div
        className="pointer-events-none fixed inset-0 bg-cover bg-center bg-no-repeat opacity-15"
        style={{ backgroundImage: "url('/worldcup-bg.png')" }}
      />

      {/* Hero */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden border-b border-ink-border">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(78,70,255,0.08),_transparent_60%)]" />
        <div className="relative mx-auto max-w-5xl px-4 text-center">

          <h1 className="font-display text-5xl font-bold leading-tight tracking-tight sm:text-7xl md:text-8xl">
            Real-time World Cup events{" "}
            <span className="text-[#4E46FF]">on Injective.</span>
          </h1>
          <p className="mx-auto mt-8 max-w-3xl text-base font-light leading-relaxed tracking-wide text-white/80 sm:text-lg md:text-xl">
            Bridging real-world sports to Injective EVM via AI agents that
            independently purchase premium analytics and settle cross-chain
            rewards
          </p>
        </div>
      </section>

      {/* Scrolling tech marquee */}
      <div className="overflow-hidden border-b border-[#1E293B] bg-[#4E46FF]/10 py-3">
        <div
          className="flex gap-12 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.15em] text-white"
          style={{
            animation: "marquee 30s linear infinite",
            width: "fit-content",
          }}
        >
          <span>Injective</span>
          <span>MCP Server</span>
          <span>x402</span>
          <span>Circle CCTP</span>
          <span>Agent Skills</span>
          <span>World Cup 2026</span>
          <span>Injective</span>
          <span>MCP Server</span>
          <span>x402</span>
          <span>Circle CCTP</span>
          <span>Agent Skills</span>
          <span>World Cup 2026</span>
        </div>
      </div>



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
              title: "x402 pay · CCTP bridge",
              body: "Agents pay for premium analytics over HTTP 402. Sponsors fund drops, fans claim free rewards cross-chain via CCTP. Feeders earn treasury revenue.",
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
                title: "Fan Drops + Feeder Economy",
                desc: "Sponsor-funded drops with zero user risk. Feeders earn x402 treasury revenue, withdraw cross-chain via CCTP.",
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
    </div>
  );
}
