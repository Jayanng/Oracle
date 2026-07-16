"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, Send, Wrench, CreditCard } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };
type TraceItem = {
  tool: string;
  args: unknown;
  result: unknown;
  ms?: number;
};

const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:4020";

function AgentInner() {
  const params = useSearchParams();
  const matchId = Number(params.get("matchId") || process.env.NEXT_PUBLIC_FIXTURE_ID || "2026001");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi — I'm **CupAgent**. I read CupEventOracle on Injective, buy premium stats via **x402**, and can settle prediction markets. Try a chip below.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const chips = [
    `What was the latest event in match ${matchId}?`,
    `Get premium stats for match ${matchId}`,
    `Settle the prediction market for match ${matchId}`,
    `Show me all goals in match ${matchId}`,
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch(`${AGENT_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "chat failed");
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.answer || "(empty)" },
      ]);
      if (Array.isArray(data.trace)) {
        setTrace((t) => [...data.trace, ...t].slice(0, 40));
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Could not reach agent at \`${AGENT_URL}\`. Start it with \`npm run dev:agent\`. (${e instanceof Error ? e.message : e})`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-ink-border bg-ink-card">
        <div className="flex items-center gap-3 border-b border-ink-border px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-accent/15 text-cyan-accent">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="font-display font-semibold">CupAgent</div>
            <div className="text-xs text-ink-muted">
              🟢 Online · MCP tools · gpt-4o-mini / deterministic
            </div>
          </div>
        </div>

        <div className="border-b border-ink-border px-4 py-2">
          <div className="text-xs text-ink-muted">
            Focused on match <span className="text-cyan-accent">#{matchId}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c}
                onClick={() => send(c)}
                className="rounded-full border border-ink-border px-3 py-1 text-xs text-ink-muted transition hover:border-cyan-accent/50 hover:text-cyan-accent"
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-cyan-accent text-ink"
                    : "border border-ink-border bg-ink"
                }`}
              >
                <MessageBody text={m.content} />
              </div>
            </div>
          ))}
          {loading && (
            <div className="text-xs text-ink-muted">CupAgent is thinking…</div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          className="flex gap-2 border-t border-ink-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about on-chain match events…"
            className="flex-1 resize-none rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm outline-none focus:border-cyan-accent"
          />
          <button type="submit" className="btn-primary px-3" disabled={loading}>
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      {/* Action log */}
      <aside className="flex w-full flex-col rounded-xl border border-ink-border bg-ink-card lg:w-[320px]">
        <div className="border-b border-ink-border px-4 py-3 font-display text-sm font-semibold">
          Agent Action Log
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {trace.length === 0 && (
            <p className="text-xs text-ink-muted">
              Tool calls appear here — including x402 payment traces.
            </p>
          )}
          {trace.map((t, i) => (
            <div
              key={i}
              className="rounded-lg border border-ink-border/80 bg-ink px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2 font-medium text-cyan-accent">
                {t.tool === "get_premium_stats" ? (
                  <CreditCard className="h-3.5 w-3.5" />
                ) : (
                  <Wrench className="h-3.5 w-3.5" />
                )}
                {t.tool}
                {t.ms != null && (
                  <span className="ml-auto font-mono text-[10px] text-ink-muted">
                    {t.ms}ms
                  </span>
                )}
              </div>
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[10px] text-ink-muted">
                {JSON.stringify({ args: t.args, result: summarize(t.result) }, null, 2)}
              </pre>
              {t.tool === "get_premium_stats" && (
                <div className="mt-1 text-[10px] text-emerald-400">
                  💳 x402: 402 → signed Payment → 200
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function summarize(r: unknown) {
  if (r && typeof r === "object" && "_x402" in (r as object)) {
    const o = r as { _x402?: unknown; xg?: unknown; narrative?: string };
    return { xg: o.xg, narrative: o.narrative, _x402: o._x402 };
  }
  return r;
}

function MessageBody({ text }: { text: string }) {
  // minimal markdown: **bold**, `code`, newlines
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) => {
        if (p === "\n") return <br key={i} />;
        if (p.startsWith("**") && p.endsWith("**"))
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`"))
          return (
            <code key={i} className="rounded bg-black/30 px-1 font-mono text-[12px]">
              {p.slice(1, -1)}
            </code>
          );
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

export default function AgentPage() {
  return (
    <Suspense fallback={<div className="p-8 text-ink-muted">Loading agent…</div>}>
      <AgentInner />
    </Suspense>
  );
}
