"use client";

import { useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import {
  ORACLE_ABI,
  ORACLE_ADDRESS,
  metaFor,
  type OracleEvent,
} from "@/lib/contracts";
import { eventIcon, shortAddr } from "@/lib/utils";
import { explorerAddress } from "@/lib/chain";

export default function ExplorerPage() {
  const [filterType, setFilterType] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<number | null>(null);
  const [detail, setDetail] = useState<OracleEvent | null>(null);

  const hasOracle = Boolean(ORACLE_ADDRESS && ORACLE_ADDRESS.length === 42);

  const { data: matchIds } = useReadContract({
    address: hasOracle ? ORACLE_ADDRESS : undefined,
    abi: ORACLE_ABI,
    functionName: "allMatchIds",
    query: { enabled: hasOracle, refetchInterval: 10_000 },
  });

  const ids = useMemo(() => {
    const fromChain = (matchIds as bigint[] | undefined)?.map(Number) || [];
    if (fromChain.length === 0) return [2026001];
    return fromChain;
  }, [matchIds]);

  const active = selectedMatch ?? ids[0];

  const { data: events } = useReadContract({
    address: hasOracle ? ORACLE_ADDRESS : undefined,
    abi: ORACLE_ABI,
    functionName: "getEvents",
    args: [BigInt(active)],
    query: { enabled: hasOracle, refetchInterval: 8_000 },
  });

  const list = ((events as OracleEvent[] | undefined) || []).filter((e) => {
    if (filterType !== "all" && !e.eventType.toLowerCase().includes(filterType))
      return false;
    if (search && !`${e.matchId} ${e.eventType} ${e.details}`.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Oracle Explorer</h1>
        <p className="mt-1 text-ink-muted">
          Inspect every on-chain event. Reusable by any dApp on Injective.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search match / type / details"
          className="rounded-lg border border-ink-border bg-ink-card px-3 py-2 text-sm outline-none focus:border-cyan-accent"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-ink-border bg-ink-card px-3 py-2 text-sm"
        >
          <option value="all">All types</option>
          <option value="goal">Goals</option>
          <option value="card">Cards</option>
          <option value="final">Finals</option>
          <option value="kick">Kickoff</option>
        </select>
        {hasOracle && (
          <a
            href={explorerAddress(ORACLE_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-cyan-accent"
          >
            Contract {shortAddr(ORACLE_ADDRESS)}
          </a>
        )}
      </div>

      {/* Match grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ids.map((id) => {
          const m = metaFor(id);
          return (
            <button
              key={id}
              onClick={() => setSelectedMatch(id)}
              className={`card text-left transition ${
                active === id ? "ring-1 ring-cyan-accent" : "hover:border-cyan-accent/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold">
                  {m.homeFlag} {m.home} vs {m.away} {m.awayFlag}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-ink-muted">matchId {id}</div>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-ink-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink-card text-ink-muted">
            <tr>
              <th className="px-4 py-3">Match</th>
              <th className="px-4 py-3">Min</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                  No events. Deploy contracts + run feeder simulator.
                </td>
              </tr>
            )}
            {[...list].reverse().map((e, i) => (
              <tr
                key={i}
                onClick={() => setDetail(e)}
                className="cursor-pointer border-t border-ink-border hover:bg-ink-card/60"
              >
                <td className="px-4 py-3 font-mono text-xs">{Number(e.matchId)}</td>
                <td className="px-4 py-3">{e.minute}&apos;</td>
                <td className="px-4 py-3">
                  {eventIcon(e.eventType)} {e.eventType}
                </td>
                <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-ink-muted">
                  {e.details}
                </td>
                <td className="px-4 py-3 text-xs text-ink-muted">
                  {e.timestamp
                    ? new Date(Number(e.timestamp) * 1000).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Use this oracle */}
      <section className="card space-y-4">
        <h2 className="font-display text-xl font-semibold">Use this oracle</h2>
        <p className="text-sm text-ink-muted">
          Any team can query CupEventOracle today. Complementary to Pyth / Chainlink
          price feeds — discrete, categorical real-world events.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-medium text-cyan-accent">Solidity</div>
            <pre className="overflow-x-auto rounded-lg bg-ink p-4 font-mono text-[11px] leading-relaxed text-ink-muted">{`interface ICupEventOracle {
  function getLatestEvent(uint256 matchId)
    external view returns (
      uint256, uint64, uint32,
      string memory, string memory,
      string memory, address
    );
}

// eventType == "final", details JSON: {"home":1,"away":1}
`}</pre>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-cyan-accent">viem</div>
            <pre className="overflow-x-auto rounded-lg bg-ink p-4 font-mono text-[11px] leading-relaxed text-ink-muted">{`const events = await publicClient.readContract({
  address: ORACLE,
  abi: oracleAbi,
  functionName: "getEvents",
  args: [2026001n],
});`}</pre>
          </div>
        </div>
      </section>

      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="card max-h-[80vh] w-full max-w-lg overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-lg font-semibold">Event detail</h3>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-xs">
              {JSON.stringify(
                {
                  matchId: Number(detail.matchId),
                  minute: detail.minute,
                  category: detail.category,
                  eventType: detail.eventType,
                  details: detail.details,
                  timestamp: Number(detail.timestamp),
                  updater: detail.updater,
                },
                null,
                2
              )}
            </pre>
            <button
              className="btn-ghost mt-4 w-full"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(detail, (_, v) =>
                  typeof v === "bigint" ? v.toString() : v
                , 2));
              }}
            >
              Copy as JSON
            </button>
            <button className="btn-primary mt-2 w-full" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
