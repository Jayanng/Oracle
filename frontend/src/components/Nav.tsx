"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  useConfig,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { toast } from "sonner";
import { cn, shortAddr } from "@/lib/utils";
import { ensureInjectiveChain, isInjectiveChain } from "@/lib/ensureInjective";
import { INJECTIVE_EVM_CHAIN_ID } from "@/lib/wagmi";

const links = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/agent", label: "Agent" },
  { href: "/explorer", label: "Explorer" },
  { href: "/rewards", label: "Rewards" },
];

export function Nav() {
  const path = usePathname();
  const config = useConfig();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const [walletOpen, setWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const onInjective = isInjectiveChain(chainId);

  // Close account menu on outside click / Escape
  useEffect(() => {
    if (!walletOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setWalletOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setWalletOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [walletOpen]);

  useEffect(() => {
    if (!isConnected) setWalletOpen(false);
  }, [isConnected]);

  async function handleConnect() {
    try {
      const connector = connectors[0];
      if (!connector) {
        toast.error("No wallet found. Install MetaMask or an EVM wallet.");
        return;
      }
      await connectAsync({
        connector,
        chainId: INJECTIVE_EVM_CHAIN_ID,
      });
      await ensureInjectiveChain(config);
      toast.success(`Connected on Injective EVM (${INJECTIVE_EVM_CHAIN_ID})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connect failed");
    }
  }

  async function handleSwitchToInjective() {
    try {
      await switchChainAsync({ chainId: INJECTIVE_EVM_CHAIN_ID });
      await ensureInjectiveChain(config);
      toast.success("Switched to Injective EVM Testnet");
    } catch {
      try {
        await ensureInjectiveChain(config);
        toast.success("Switched to Injective EVM Testnet");
      } catch (e2) {
        toast.error(
          e2 instanceof Error
            ? e2.message
            : "Could not switch network. Add Injective EVM Testnet (1439) in MetaMask."
        );
      }
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Address copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy address");
    }
  }

  function handleDisconnect() {
    disconnect();
    setWalletOpen(false);
    toast.message("Wallet disconnected");
  }

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
          {isConnected && (
            <button
              type="button"
              onClick={onInjective ? undefined : handleSwitchToInjective}
              className={cn(
                "pill text-[10px] sm:text-xs",
                onInjective
                  ? "bg-cyan-accent/15 text-cyan-accent"
                  : "cursor-pointer bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/40"
              )}
              title={
                onInjective
                  ? `Injective EVM testnet · chain ${chainId}`
                  : `Wrong network (chain ${chainId}). Click to switch to Injective ${INJECTIVE_EVM_CHAIN_ID}`
              }
            >
              {onInjective ? `INJ · ${chainId}` : `⚠ Not Injective · switch`}
            </button>
          )}

          {isConnected && address ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setWalletOpen((o) => !o)}
                className={cn(
                  "btn-ghost text-xs",
                  walletOpen && "border-cyan-accent/50 text-cyan-accent"
                )}
                aria-expanded={walletOpen}
                aria-haspopup="dialog"
              >
                {shortAddr(address)}
                <span className="ml-1 text-[10px] text-ink-muted" aria-hidden>
                  {walletOpen ? "▴" : "▾"}
                </span>
              </button>

              {walletOpen && (
                <>
                  {/* Mobile-friendly dim backdrop */}
                  <div
                    className="fixed inset-0 z-40 bg-black/40 sm:hidden"
                    onClick={() => setWalletOpen(false)}
                    aria-hidden
                  />
                  <div
                    role="dialog"
                    aria-label="Wallet account"
                    className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-ink-border bg-ink-card p-3 shadow-xl shadow-black/40"
                  >
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                      Connected account
                    </div>
                    <div className="rounded-lg border border-ink-border/80 bg-ink px-3 py-2">
                      <div className="font-mono text-sm text-white">
                        {shortAddr(address)}
                      </div>
                      <div className="mt-1 break-all font-mono text-[10px] leading-relaxed text-ink-muted">
                        {address}
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-ink-muted">
                      Network:{" "}
                      <span
                        className={
                          onInjective ? "text-cyan-accent" : "text-amber-300"
                        }
                      >
                        {onInjective
                          ? `Injective EVM · ${chainId}`
                          : `Chain ${chainId} (switch needed)`}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={copyAddress}
                        className="btn-ghost w-full justify-between text-xs"
                      >
                        <span>Copy address</span>
                        <span className="text-ink-muted">
                          {copied ? "Copied" : "⎘"}
                        </span>
                      </button>
                      {!onInjective && (
                        <button
                          type="button"
                          onClick={handleSwitchToInjective}
                          className="btn-ghost w-full text-xs text-amber-300"
                        >
                          Switch to Injective
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        className="w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              className="btn-primary text-xs"
              disabled={isPending}
              onClick={handleConnect}
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
