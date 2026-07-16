"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { cn, shortAddr } from "@/lib/utils";

const links = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/agent", label: "Agent" },
  { href: "/explorer", label: "Explorer" },
  { href: "/rewards", label: "Rewards" },
];

export function Nav() {
  const path = usePathname();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <header className="sticky top-0 z-50 border-b border-ink-border/80 bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            <span className="text-cyan-accent">Cup</span>Event
            <span className="text-ink-muted"> Oracle</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm text-ink-muted transition hover:text-white",
                  path === l.href && "bg-ink-card text-cyan-accent"
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <button
              onClick={() => disconnect()}
              className="btn-ghost text-xs"
              title={address}
            >
              {shortAddr(address)}
            </button>
          ) : (
            <button
              className="btn-primary text-xs"
              disabled={isPending}
              onClick={() => connect({ connector: connectors[0] })}
            >
              {isPending ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-ink-border/50 px-2 py-1 md:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "whitespace-nowrap rounded-md px-2 py-1 text-xs text-ink-muted",
              path === l.href && "bg-ink-card text-cyan-accent"
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
