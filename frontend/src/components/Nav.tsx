"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { Menu, X, Trophy } from "lucide-react";

const publicLinks: { href: string; label: string }[] = [];

const protectedLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/agent", label: "Agent" },
  { href: "/explorer", label: "Explorer" },
  { href: "/drops", label: "Drops" },
  { href: "/x402", label: "Analytics" },
];

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const config = useConfig();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const [walletOpen, setWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const onInjective = isInjectiveChain(chainId);

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

  useEffect(() => {
    setMobileOpen(false);
  }, [path]);

  const links = isConnected ? protectedLinks : publicLinks;

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
      router.push("/dashboard");
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
    setMobileOpen(false);
    toast.message("Wallet disconnected");
  }

  return (
    <header className="sticky top-3 z-50 px-6">
      <div className="mx-auto max-w-7xl rounded-2xl border border-[#1E293B]/80 bg-[#0B0F19]/90 px-6 py-2 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4E46FF]/10 ring-1 ring-[#4E46FF]/30">
              <Trophy className="h-4 w-4 text-[#4E46FF]" />
            </div>
            <span className="text-sm font-bold tracking-wider text-white">
              KICKOFF
            </span>
          </Link>

          {/* Desktop nav */}
          {links.length > 0 && (
            <nav className="hidden items-center gap-1 md:flex">
              {links.map((l) => {
                const isHome = l.href === "/";
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748B] transition-all duration-200",
                      path === l.href
                        ? "text-[#4E46FF]"
                        : "hover:text-white",
                      !isHome &&
                        path === l.href &&
                        "bg-[#4E46FF]/5 ring-1 ring-[#4E46FF]/20"
                    )}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          )}

          {/* Right section */}
          <div className="flex items-center gap-2">
            {isConnected && address ? (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setWalletOpen((o) => !o)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all duration-200",
                    walletOpen
                      ? "border-[#4E46FF]/50 bg-[#4E46FF]/10 text-[#4E46FF]"
                      : "border-[#1E293B] text-[#64748B] hover:border-[#4E46FF]/30 hover:text-white"
                  )}
                  aria-expanded={walletOpen}
                  aria-haspopup="dialog"
                >
                  {shortAddr(address)}
                </button>

                {walletOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40 bg-black/40 sm:hidden"
                      onClick={() => setWalletOpen(false)}
                      aria-hidden
                    />
                    <div
                      role="dialog"
                      aria-label="Wallet account"
                      className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-[#1E293B] bg-[#0F172A] p-4 shadow-2xl shadow-black/60"
                    >
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                        Connected account
                      </div>
                      <div className="rounded-lg border border-[#1E293B] bg-[#0B0F19] px-3 py-2">
                        <div className="font-mono text-sm text-white">
                          {shortAddr(address)}
                        </div>
                        <div className="mt-1 break-all font-mono text-[10px] leading-relaxed text-[#64748B]">
                          {address}
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-[#64748B]">
                        Network:{" "}
                        <span
                          className={
                            onInjective ? "text-[#4E46FF]" : "text-amber-300"
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
                          className="flex w-full items-center justify-between rounded-lg border border-[#1E293B] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#64748B] transition hover:border-[#4E46FF]/30 hover:text-white"
                        >
                          <span>Copy address</span>
                          <span className="text-[#64748B]">
                            {copied ? "Copied" : "⎘"}
                          </span>
                        </button>
                        {!onInjective && (
                          <button
                            type="button"
                            onClick={handleSwitchToInjective}
                            className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300 transition hover:bg-amber-500/20"
                          >
                            Switch to Injective
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleDisconnect}
                          className="w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/20"
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
                className="rounded-lg border border-[#4E46FF]/30 bg-[#4E46FF]/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#4E46FF] transition-all duration-200 hover:bg-[#4E46FF]/20 hover:shadow-[0_0_20px_rgba(78,70,255,0.15)]"
                disabled={isPending}
                onClick={handleConnect}
              >
                {isPending ? "Connecting…" : "Connect Wallet"}
              </button>
            )}

            {/* Mobile burger */}
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1E293B] text-[#64748B] md:hidden"
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <X className="h-4 w-4" />
              ) : (
                <Menu className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/60 md:hidden"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-xl border border-[#1E293B] bg-[#0F172A] p-3 shadow-2xl shadow-black/60 md:hidden">
              <nav className="flex flex-col gap-1">
                {links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all duration-200",
                      path === l.href
                        ? "bg-[#4E46FF]/10 text-[#4E46FF]"
                        : "text-[#64748B] hover:text-white"
                    )}
                  >
                    {l.label}
                  </Link>
                ))}
                <hr className="my-2 border-[#1E293B]" />
                {isConnected && address && (
                  <div className="space-y-1">
                    <div className="px-3 py-1.5 font-mono text-[11px] text-[#64748B]">
                      {shortAddr(address)}
                    </div>
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      className="w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/20"
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </nav>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
