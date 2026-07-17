"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Bot, Send } from "lucide-react";
import { fetchFixtures, type PublicFixture } from "@/lib/fixtures";
import { explorerTx } from "@/lib/chain";
import { shortAddr } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

type TraceEntry = {
  tool: string;
  args: unknown;
  result: unknown;
  ms: number;
  at?: string;
};

/** Same-origin proxy — works in Codespaces (do not call localhost:4020 from browser) */
const CHAT_URL = "/api/chat";

function AgentInner() {
  const router = useRouter();
  const { isConnected } = useAccount();
  useEffect(() => {
    if (!isConnected) router.replace("/");
  }, [isConnected, router]);

  const params = useSearchParams();
  const q = params.get("q") || "";
  const [focus, setFocus] = useState(q);
  const [fixtures, setFixtures] = useState<PublicFixture[]>([]);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi — I'm **CupAgent**. Ask by **team names** (e.g. *latest event for Qatar vs Ecuador*). I never need you to type match IDs. Powered by Groq when configured.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [traceLog, setTraceLog] = useState<TraceEntry[]>([]);
  const [lastMode, setLastMode] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // IMPORTANT: fetchFixtures() returns PublicFixture[] — do not change that contract
  useEffect(() => {
    fetchFixtures().then((list) => {
      if (Array.isArray(list)) setFixtures(list);
    });
  }, []);

  useEffect(() => {
    if (q) setFocus(q);
  }, [q]);

  const chips = [
    focus
      ? `What was the latest event for ${focus}?`
      : "List World Cup fixtures",
    focus
      ? `Get premium stats for ${focus}`
      : "Show me finished matches",
    focus ? `Show me all events for ${focus}` : "Latest live match events",
    focus
      ? `Settle the prediction market for ${focus}`
      : "List fixtures that are live",
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
      const r = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await r.json().catch(() => ({} as Record<string, unknown>));
      // Prefer showing the agent answer even if status is non-2xx (tool soft-errors)
      if (typeof data.answer === "string" && data.answer.length > 0) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: data.answer as string },
        ]);
      } else if (!r.ok) {
        const errMsg =
          (data.error as string) ||
          (data.hint as string) ||
          `chat HTTP ${r.status}`;
        // 402 from x402 is payment, not "agent down"
        if (
          r.status === 402 ||
          /status code 402|payment required/i.test(errMsg)
        ) {
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              content:
                "💳 **x402 Payment Required (HTTP 402)** — the paywall responded correctly. " +
                "The agent must complete USDC payment on Injective (or set `X402_MODE=demo` on the x402 endpoint). " +
                "This does **not** mean the agent is offline.",
            },
          ]);
        } else {
          throw new Error(errMsg);
        }
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: data.answer || "(empty)" },
        ]);
      }
      if (data.mode) setLastMode(String(data.mode));
      if (Array.isArray(data.trace) && data.trace.length > 0) {
        const stamped = (data.trace as TraceEntry[]).map((t) => ({
          ...t,
          at: new Date().toISOString(),
        }));
        setTraceLog((prev) => [...stamped, ...prev].slice(0, 40));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const is402 = /402|payment required/i.test(msg);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: is402
            ? `💳 **x402 (HTTP 402)** — payment required for premium stats, not an agent outage. ${msg}`
            : `Could not reach agent via \`${CHAT_URL}\`. Is the agent running on :4020? (${msg})`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row">
      {/* Chat */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-ink-border bg-ink-card">
        <div className="flex items-center gap-3 border-b border-ink-border px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-accent/15 text-cyan-accent">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="font-display font-semibold">CupAgent</div>
            <div className="text-xs text-ink-muted">
              🟢 Online · MCP tools · Groq / deterministic
              {lastMode ? ` · ${lastMode}` : ""}
            </div>
          </div>
        </div>

        <div className="border-b border-ink-border px-4 py-2">
          <div className="text-xs text-ink-muted">
            Focus:{" "}
            <span className="text-cyan-accent">
              {focus || "any fixture (use team names)"}
            </span>
          </div>
          {fixtures.length > 0 && (
            <select
              className="mt-2 w-full rounded-lg border border-ink-border bg-ink px-2 py-1.5 text-xs"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
            >
              <option value="">Select fixture (optional)</option>
              {fixtures.slice(0, 80).map((f) => (
                <option key={f.label} value={f.label}>
                  {f.label} · {f.status}
                </option>
              ))}
            </select>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
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
            placeholder='e.g. "latest event for Australia vs Turkey"'
            className="flex-1 resize-none rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm outline-none focus:border-cyan-accent"
          />
          <button type="submit" className="btn-primary px-3" disabled={loading}>
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      {/* Batch 1: Action Log — uses existing chat `trace` field only */}
      <aside className="flex h-48 shrink-0 flex-col overflow-hidden rounded-xl border border-ink-border bg-ink-card lg:h-auto lg:w-[320px]">
        <div className="border-b border-ink-border px-4 py-3">
          <div className="font-display text-sm font-semibold">
            Agent Action Log
          </div>
          <div className="text-[11px] text-ink-muted">
            MCP tools · x402 · settle txs
          </div>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {traceLog.length === 0 && (
            <p className="py-8 text-center text-xs text-ink-muted">
              Tool calls appear here when CupAgent runs MCP tools.
            </p>
          )}
          {traceLog.map((t, i) => (
            <TraceCard key={`${t.tool}-${t.ms}-${i}-${t.at || i}`} entry={t} />
          ))}
        </div>
        {traceLog.length > 0 && (
          <button
            type="button"
            className="border-t border-ink-border px-3 py-2 text-xs text-ink-muted hover:text-white"
            onClick={() => setTraceLog([])}
          >
            Clear log
          </button>
        )}
      </aside>
    </div>
  );
}

function TraceCard({ entry }: { entry: TraceEntry }) {
  const r =
    entry.result && typeof entry.result === "object"
      ? (entry.result as Record<string, unknown>)
      : {};
  const x402 = r._x402 as
    | {
        paid?: boolean;
        protocol?: string;
        amount?: string | number;
        transaction?: string;
        network?: string;
      }
    | undefined;
  const hash =
    typeof r.hash === "string"
      ? r.hash
      : typeof x402?.transaction === "string"
        ? x402.transaction
        : undefined;
  const isPremium =
    entry.tool.includes("premium") || entry.tool.includes("stats");
  const isSettle = entry.tool.includes("settle");

  return (
    <div className="rounded-lg border border-ink-border/80 bg-ink/60 px-3 py-2 text-[11px]">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-cyan-accent">
          {isPremium ? (
            <CreditCard className="h-3.5 w-3.5" />
          ) : isSettle ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Wrench className="h-3.5 w-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] text-white">
            {entry.tool}
            <span className="ml-2 text-ink-muted">{entry.ms}ms</span>
          </div>
          {typeof r._fixture === "string" && (
            <div className="mt-0.5 text-[10px] text-ink-muted">
              {r._fixture}
            </div>
          )}
          {isPremium && (r._paid || x402?.paid) && (
            <div className="mt-1 rounded bg-cyan-accent/10 px-2 py-1 text-[10px] text-cyan-accent">
              💳 x402 paid
              {x402?.protocol ? ` · ${x402.protocol}` : ""}
              {x402?.network ? ` · ${x402.network}` : " · Injective"}
            </div>
          )}
          {hash && (
            <a
              href={explorerTx(hash)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[10px] text-cyan-accent hover:underline"
            >
              tx {shortAddr(hash)}
            </a>
          )}
          {r._error != null && (
            <div className="mt-1 text-[10px] text-amber-300">
              {String(r.message || r._error)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBody({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\n)/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) => {
        if (p === "\n") return <br key={i} />;
        if (p.startsWith("**") && p.endsWith("**"))
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`"))
          return (
            <code
              key={i}
              className="rounded bg-black/30 px-1 font-mono text-[12px]"
            >
              {p.slice(1, -1)}
            </code>
          );
        const linkMatch = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <a
              key={i}
              href={linkMatch[2]}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-accent underline decoration-dotted underline-offset-2 hover:text-cyan-300 font-mono text-[12px]"
            >
              {linkMatch[1]}
            </a>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

export default function AgentPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-ink-muted">Loading agent…</div>}
    >
      <AgentInner />
    </Suspense>
  );
}
