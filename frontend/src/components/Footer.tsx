"use client";

import { usePathname } from "next/navigation";


export function Footer() {
  const path = usePathname();
  if (path !== "/") return null;

  return (
    <footer className="border-t border-[var(--line)] bg-[var(--bg)]">
      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* Top row */}
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          {/* Brand */}
          <div className="max-w-xs">
            <div className="flex items-center gap-2">
              <img
                src="/header.png"
                alt="KICKOFF"
                className="h-10 w-auto sm:h-12"
              />
            </div>
            <p className="mt-3 text-xs text-[var(--ink-dim)] leading-relaxed">
              Real-world event oracle for Injective — live World Cup match events on-chain, exposed through an MCP-powered AI agent.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-10">
            {[
              {
                title: "Product",
                links: [
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Agent", href: "/agent" },
                  { label: "Drops", href: "/drops" },
                  { label: "Analytics", href: "/x402" },
                ],
              },
              {
                title: "Developers",
                links: [
                  { label: "Oracle Contract", href: "#" },
                  { label: "MCP Server", href: "#" },
                  { label: "x402 Docs", href: "#" },
                  { label: "GitHub", href: "#" },
                ],
              },
              {
                title: "Community",
                links: [
                  { label: "Injective", href: "https://injective.com" },
                  { label: "HackQuest", href: "#" },
                  { label: "Documentation", href: "/docs/architecture.md" },
                  { label: "License", href: "/LICENSE" },
                ],
              },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--ink-faint)]">
                  {col.title}
                </h4>
                <ul className="mt-3 space-y-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        className="text-xs text-[var(--ink-dim)] transition hover:text-white"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="mt-10 border-t border-[var(--line)]" />

        {/* Bottom row */}
        <div className="mt-6 flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-[10px] text-[var(--ink-faint)]">
            &copy; {new Date().getFullYear()} CupEvent Oracle. MIT License.
          </p>
          <div className="flex flex-wrap gap-2">
            {["MCP", "x402", "CCTP", "Agent Skills"].map((badge) => (
              <span
                key={badge}
                className="inline-block rounded-md border border-[var(--card-border)] px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]"
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
