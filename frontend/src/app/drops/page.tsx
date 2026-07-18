"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useChainId,
  useConfig,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { parseUnits, pad, type Address } from "viem";
import { toast } from "sonner";
import {
  DROPS_ADDRESS,
  TREASURY_ADDRESS,
  USDC_ADDRESS,
  FAN_DROPS_ABI,
  TREASURY_ABI,
  ERC20_ABI,
  ORACLE_ABI,
  ORACLE_ADDRESS,
  CCTP_DOMAINS,
} from "@/lib/contracts";
import { shortAddr } from "@/lib/utils";
import { explorerAddress, explorerTx } from "@/lib/chain";
import { ensureInjectiveChain, isInjectiveChain } from "@/lib/ensureInjective";
import { INJECTIVE_EVM_CHAIN_ID } from "@/lib/wagmi";
import {
  fetchFixtures,
  type PublicFixture,
} from "@/lib/fixtures";
import { motion, AnimatePresence } from "framer-motion";

type Tab = "drops" | "sponsor" | "feeder";

interface DropInfo {
  dropId: number;
  matchId: number;
  eventType: string;
  minuteFrom: number;
  minuteTo: number;
  perWinnerAmount: bigint;
  maxWinners: number;
  claimedCount: number;
  funded: bigint;
  sponsor: Address;
  active: boolean;
}

export default function DropsPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  useEffect(() => {
    if (!isConnected) router.replace("/");
  }, [isConnected, router]);

  const config = useConfig();
  const chainId = useChainId();
  const pub = usePublicClient();

  const [tab, setTab] = useState<Tab>("drops");
  const [fixtures, setFixtures] = useState<PublicFixture[]>([]);
  const { writeContractAsync, isPending } = useWriteContract();
  const onInjective = isInjectiveChain(chainId);

  const hasDrops = Boolean(DROPS_ADDRESS && DROPS_ADDRESS.length === 42);
  const hasTreasury = Boolean(TREASURY_ADDRESS && TREASURY_ADDRESS.length === 42);

  // Load fixtures
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchFixtures().then((list) => {
        if (cancelled) return;
        setFixtures(list);
      });
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // --- Tab 1: Active Drops ---
  const [activeDropIds, setActiveDropIds] = useState<number[]>([]);
  const [eligibilityMap, setEligibilityMap] = useState<Record<number, boolean>>({});
  const [claimedMap, setClaimedMap] = useState<Record<number, boolean>>({});
  const [claimModal, setClaimModal] = useState<{ dropId: number; perWinnerAmount: bigint } | null>(null);
  const [claimDest, setClaimDest] = useState<number>(29); // Injective same-chain by default

  // --- Tab 2: Sponsor ---
  const [sponsorMatch, setSponsorMatch] = useState("");
  const [sponsorEvent, setSponsorEvent] = useState("goal");
  const [sponsorMinFrom, setSponsorMinFrom] = useState(1);
  const [sponsorMinTo, setSponsorMinTo] = useState(120);
  const [sponsorAmount, setSponsorAmount] = useState("0.5");
  const [sponsorMaxWinners, setSponsorMaxWinners] = useState(20);
  const [sponsorWalletsText, setSponsorWalletsText] = useState("");

  // --- Tab 3: Feeder ---
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawDest, setWithdrawDest] = useState<number>(29);

  // USDC balance
  const { data: usdcBal, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  // Feeder earnings
  const { data: earnedData, refetch: refetchEarnings } = useReadContract({
    address: hasTreasury && address ? TREASURY_ADDRESS : undefined,
    abi: TREASURY_ABI,
    functionName: "earnedBy",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(hasTreasury && address), refetchInterval: 10_000 },
  });

  const { data: eventCount, refetch: refetchEventCount } = useReadContract({
    address: hasTreasury && address ? TREASURY_ADDRESS : undefined,
    abi: TREASURY_ABI,
    functionName: "feederEventCount",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(hasTreasury && address), refetchInterval: 10_000 },
  });

  const { data: paidOut } = useReadContract({
    address: hasTreasury && address ? TREASURY_ADDRESS : undefined,
    abi: TREASURY_ABI,
    functionName: "feederPaidOut",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(hasTreasury && address), refetchInterval: 10_000 },
  });

  const earnedUsdc = earnedData != null ? Number(earnedData) / 1e6 : 0;
  const feederEventCount = eventCount != null ? Number(eventCount) : 0;
  const feederPaidOut = paidOut != null ? Number(paidOut) / 1e6 : 0;

  const hasFeederEarnings = feederEventCount > 0;

  // Load active drop IDs by scanning from 0 to nextDropId
  useEffect(() => {
    if (!hasDrops || !pub) return;
    const load = async () => {
      try {
        const nextId = (await pub.readContract({
          address: DROPS_ADDRESS,
          abi: FAN_DROPS_ABI,
          functionName: "nextDropId",
        })) as bigint;
        const total = Number(nextId);
        const active: number[] = [];
        for (let i = 0; i < total; i++) {
          const dropRaw = (await pub.readContract({
            address: DROPS_ADDRESS,
            abi: FAN_DROPS_ABI,
            functionName: "drops",
            args: [BigInt(i)],
          })) as unknown as [bigint, string, number, number, bigint, number, number, bigint, string, boolean];
          if (dropRaw[9]) active.push(i); // active flag
        }
        setActiveDropIds(active);
      } catch (e) {
        console.warn("Could not load drops:", e);
      }
    };
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [hasDrops, pub]);

  // Check eligibility for each active drop
  useEffect(() => {
    if (!hasDrops || !address || !pub || activeDropIds.length === 0) return;
    const check = async () => {
      const eligMap: Record<number, boolean> = {};
      const claimMap: Record<number, boolean> = {};
      for (const id of activeDropIds) {
        try {
          const [e, c] = await Promise.all([
            pub.readContract({
              address: DROPS_ADDRESS,
              abi: FAN_DROPS_ABI,
              functionName: "eligible",
              args: [BigInt(id), address],
            }) as Promise<boolean>,
            pub.readContract({
              address: DROPS_ADDRESS,
              abi: FAN_DROPS_ABI,
              functionName: "claimed",
              args: [BigInt(id), address],
            }) as Promise<boolean>,
          ]);
          eligMap[id] = e;
          claimMap[id] = c;
        } catch { /* ignore */ }
      }
      setEligibilityMap(eligMap);
      setClaimedMap(claimMap);
    };
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [hasDrops, address, pub, activeDropIds]);

  // Actions
  async function handleClaim(dropId: number) {
    if (!address || !DROPS_ADDRESS) return;
    try {
      await ensureInjectiveChain(config);
      if (claimDest === 29) {
        // Same-chain
        const hash = await writeContractAsync({
          chainId: INJECTIVE_EVM_CHAIN_ID,
          address: DROPS_ADDRESS,
          abi: FAN_DROPS_ABI,
          functionName: "claim",
          args: [BigInt(dropId)],
        });
        toast.success(`Claimed! Tx: ${hash.slice(0, 12)}…`);
      } else {
        // Cross-chain via CCTP
        const mintRecipient = pad(address, { size: 32 }) as `0x${string}`;
        const hash = await writeContractAsync({
          chainId: INJECTIVE_EVM_CHAIN_ID,
          address: DROPS_ADDRESS,
          abi: FAN_DROPS_ABI,
          functionName: "claimToChain",
          args: [BigInt(dropId), claimDest, mintRecipient],
        });
        toast.success(`Cross-chain claim initiated! Tx: ${hash.slice(0, 12)}…`);
      }
      setClaimModal(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Claim failed");
    }
  }

  async function handleCreateDrop() {
    if (!address || !DROPS_ADDRESS) return;
    try {
      await ensureInjectiveChain(config);
      const amount = parseUnits(sponsorAmount, 6);
      const total = amount * BigInt(sponsorMaxWinners);
      const matchId = Number(sponsorMatch);

      // Approve USDC first
      const approveHash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [DROPS_ADDRESS, total],
      });
      if (pub) await pub.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });

      // Create drop
      const hash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: DROPS_ADDRESS,
        abi: FAN_DROPS_ABI,
        functionName: "createDrop",
        args: [BigInt(matchId), sponsorEvent, sponsorMinFrom, sponsorMinTo, amount, sponsorMaxWinners],
      });
      toast.success(`Drop created! Tx: ${hash.slice(0, 12)}…`);

      // Whitelist wallets if provided
      if (sponsorWalletsText.trim()) {
        const wallets = sponsorWalletsText
          .split("\n")
          .map((w) => w.trim())
          .filter((w) => w.startsWith("0x"));
        if (wallets.length > 0) {
          const nextId = (await pub!.readContract({
            address: DROPS_ADDRESS,
            abi: FAN_DROPS_ABI,
            functionName: "nextDropId",
          })) as bigint;
          const dropId = Number(nextId) - 1;
          const whitelistHash = await writeContractAsync({
            chainId: INJECTIVE_EVM_CHAIN_ID,
            address: DROPS_ADDRESS,
            abi: FAN_DROPS_ABI,
            functionName: "whitelist",
            args: [BigInt(dropId), wallets.map((w) => w as Address)],
          });
          toast.success(`Whitelisted ${wallets.length} wallet(s)!`);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create drop failed");
    }
  }

  async function handleWithdraw() {
    if (!address || !TREASURY_ADDRESS) return;
    try {
      await ensureInjectiveChain(config);
      const amount = parseUnits(withdrawAmount || String(earnedUsdc), 6);
      if (withdrawDest === 29) {
        const hash = await writeContractAsync({
          chainId: INJECTIVE_EVM_CHAIN_ID,
          address: TREASURY_ADDRESS,
          abi: TREASURY_ABI,
          functionName: "withdraw",
          args: [amount, address],
        });
        toast.success(`Withdrawn! Tx: ${hash.slice(0, 12)}…`);
      } else {
        const mintRecipient = pad(address, { size: 32 }) as `0x${string}`;
        const hash = await writeContractAsync({
          chainId: INJECTIVE_EVM_CHAIN_ID,
          address: TREASURY_ADDRESS,
          abi: TREASURY_ABI,
          functionName: "withdrawToChain",
          args: [amount, withdrawDest, mintRecipient],
        });
        toast.success(`Cross-chain withdrawal initiated! Tx: ${hash.slice(0, 12)}…`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Withdraw failed");
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "drops", label: "Active Drops" },
    { key: "sponsor", label: "Sponsor a Drop" },
    { key: "feeder", label: "Feeder Earnings" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Fan Drops & Feeder Marketplace</h1>
        <p className="mt-1 text-ink-muted">
          Sponsors fund USDC drops triggered by oracle events. Fans claim free rewards.
          Feeders earn treasury revenue from x402 queries.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 border-b border-ink-border pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-wider transition ${
              tab === t.key
                ? "bg-cyan-accent/20 text-cyan-accent ring-1 ring-cyan-accent/30"
                : "text-ink-muted hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Active Drops */}
      {tab === "drops" && (
        <div>
          {activeDropIds.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-ink-muted">No active drops yet. Sponsors can create drops in the &quot;Sponsor a Drop&quot; tab.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeDropIds.map((dropId) => (
                <DropCard
                  key={dropId}
                  dropId={dropId}
                  fixtures={fixtures}
                  eligible={eligibilityMap[dropId] ?? false}
                  alreadyClaimed={claimedMap[dropId] ?? false}
                  onClaim={() => setClaimModal({ dropId, perWinnerAmount: BigInt(0) })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Sponsor */}
      {tab === "sponsor" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-4">
            <h3 className="font-display font-semibold">Create a Drop</h3>
            <div>
              <label className="mb-1 block text-xs text-ink-muted">Match</label>
              <select
                value={sponsorMatch}
                onChange={(e) => setSponsorMatch(e.target.value)}
                className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
              >
                <option value="">Select match</option>
                {fixtures.map((f) => (
                  <option key={f.label} value={f.id}>
                    {f.label} {f.status !== "NS" ? `(${f.status})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-muted">Event Type</label>
              <select
                value={sponsorEvent}
                onChange={(e) => setSponsorEvent(e.target.value)}
                className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
              >
                {["goal", "card", "sub", "halftime", "final"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-ink-muted">Minute From</label>
                <input
                  type="number"
                  value={sponsorMinFrom}
                  onChange={(e) => setSponsorMinFrom(Number(e.target.value))}
                  className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink-muted">Minute To</label>
                <input
                  type="number"
                  value={sponsorMinTo}
                  onChange={(e) => setSponsorMinTo(Number(e.target.value))}
                  className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-muted">Per-Winner Amount (USDC)</label>
              <input
                type="number"
                step="0.1"
                value={sponsorAmount}
                onChange={(e) => setSponsorAmount(e.target.value)}
                className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-muted">Max Winners</label>
              <input
                type="number"
                value={sponsorMaxWinners}
                onChange={(e) => setSponsorMaxWinners(Number(e.target.value))}
                className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
              />
            </div>
            <div className="rounded-lg bg-cyan-accent/5 px-3 py-2 text-xs text-cyan-accent">
              Total cost: {(Number(sponsorAmount) * sponsorMaxWinners).toFixed(2)} USDC
            </div>
            <button
              className="btn-primary w-full"
              disabled={isPending || !sponsorMatch}
              onClick={handleCreateDrop}
            >
              {isPending ? "Creating…" : "Create Drop"}
            </button>
          </div>

          <div className="card space-y-4">
            <h3 className="font-display font-semibold">Whitelist Wallets</h3>
            <p className="text-xs text-ink-muted">
              After creating a drop, paste wallet addresses below (one per line) to whitelist them.
            </p>
            <textarea
              value={sponsorWalletsText}
              onChange={(e) => setSponsorWalletsText(e.target.value)}
              rows={6}
              placeholder="0x1234...&#10;0x5678...&#10;0x9abc..."
              className="w-full resize-none rounded-lg border border-ink-border bg-ink px-3 py-2 text-xs font-mono outline-none focus:border-cyan-accent"
            />
            <p className="text-xs text-ink-muted">
              You can also ask the agent: &quot;Whitelist wallets for drop #1&quot;
            </p>
            <div className="mb-2">
              <label className="mb-1 block text-xs text-ink-muted">Drop ID #</label>
              <input
                type="number"
                min={0}
                placeholder="e.g. 0 for first drop"
                className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
                id="whitelist-drop-id"
              />
            </div>
            <button
              className="btn-ghost w-full"
              onClick={async () => {
                if (!sponsorWalletsText.trim()) return;
                const wallets = sponsorWalletsText.split("\n").map(w => w.trim()).filter(w => w.startsWith("0x"));
                if (wallets.length === 0) return;
                const dropInput = (document.getElementById("whitelist-drop-id") as HTMLInputElement)?.value;
                const dropIdNum = parseInt(dropInput);
                if (isNaN(dropIdNum) || dropIdNum < 0) {
                  toast.error("Enter a valid Drop ID");
                  return;
                }
                try {
                  await ensureInjectiveChain(config);
                  const hash = await writeContractAsync({
                    chainId: INJECTIVE_EVM_CHAIN_ID,
                    address: DROPS_ADDRESS,
                    abi: FAN_DROPS_ABI,
                    functionName: "whitelist",
                    args: [BigInt(dropIdNum), wallets.map(w => w as Address)],
                  });
                  toast.success(`Whitelisted ${wallets.length} wallet(s) for drop #${dropIdNum}!`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Whitelist failed");
                }
              }}
            >
              Whitelist Wallets
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: Feeder Earnings */}
      {tab === "feeder" && (
        <div className="space-y-4">
          {!hasFeederEarnings ? (
            <div className="card py-12 text-center">
              <p className="text-ink-muted">No feeder earnings yet. Submit events via the feeder to earn x402 revenue.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-4">
                {[
                  ["Events Submitted", String(feederEventCount)],
                  ["Earned to Date", `${earnedUsdc.toFixed(2)} USDC`],
                  ["Available", `${Math.max(0, earnedUsdc - feederPaidOut).toFixed(2)} USDC`],
                  ["Total Withdrawn", `${feederPaidOut.toFixed(2)} USDC`],
                ].map(([k, v]) => (
                  <div key={k} className="card text-center py-4">
                    <div className="text-xs text-ink-muted">{k}</div>
                    <div className="font-display text-xl font-bold text-cyan-accent">{v}</div>
                  </div>
                ))}
              </div>

              <div className="card space-y-4">
                <h3 className="font-display font-semibold">Withdraw Earnings</h3>
                <div>
                  <label className="mb-1 block text-xs text-ink-muted">Amount (USDC)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder={`Max: ${Math.max(0, earnedUsdc - feederPaidOut).toFixed(2)}`}
                    className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink-muted">Destination</label>
                  <select
                    value={withdrawDest}
                    onChange={(e) => setWithdrawDest(Number(e.target.value))}
                    className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
                  >
                    {CCTP_DOMAINS.map((d) => (
                      <option key={d.domain} value={d.domain}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn-primary w-full"
                  disabled={isPending}
                  onClick={handleWithdraw}
                >
                  {isPending ? "Withdrawing…" : "Withdraw"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Claim modal */}
      {claimModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card w-full max-w-md space-y-4">
            <h3 className="font-display font-semibold">Claim Drop #{claimModal.dropId}</h3>
            <div>
              <label className="mb-1 block text-xs text-ink-muted">Destination Chain</label>
              <select
                value={claimDest}
                onChange={(e) => setClaimDest(Number(e.target.value))}
                className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
              >
                {CCTP_DOMAINS.map((d) => (
                  <option key={d.domain} value={d.domain}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setClaimModal(null)}>
                Cancel
              </button>
              <button className="btn-primary flex-1" onClick={() => handleClaim(claimModal.dropId)}>
                Claim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DropCard({
  dropId,
  fixtures,
  eligible,
  alreadyClaimed,
  onClaim,
}: {
  dropId: number;
  fixtures: PublicFixture[];
  eligible: boolean;
  alreadyClaimed: boolean;
  onClaim: () => void;
}) {
  // Read drop data via readContract
  const { data: dropData } = useReadContract({
    address: DROPS_ADDRESS || undefined,
    abi: FAN_DROPS_ABI,
    functionName: "drops",
    args: [BigInt(dropId)],
    query: { enabled: Boolean(DROPS_ADDRESS), refetchInterval: 15_000 },
  });

  const drop = dropData as unknown as DropInfo | undefined;
  if (!drop) return null;

  const fixture = fixtures.find((f) => f.id === drop.matchId);
  const label = fixture?.label || `Match #${drop.matchId}`;
  const progress = drop.maxWinners > 0 ? (drop.claimedCount / drop.maxWinners) * 100 : 0;
  const perWinner = Number(drop.perWinnerAmount) / 1e6;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-ink-muted">Drop #{dropId}</span>
        <span className={`pill ${drop.active ? "bg-emerald-500/15 text-emerald-400" : "bg-ink-muted/15 text-ink-muted"}`}>
          {drop.active ? "Active" : "Inactive"}
        </span>
      </div>
      <div>
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-ink-muted mt-1">
          Trigger: <span className="text-cyan-accent">{drop.eventType}</span>
          {" · "}Min {drop.minuteFrom}-{drop.minuteTo === 0xFFFFFFFF ? "∞" : drop.minuteTo}
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink-muted">Per winner</span>
        <span className="font-semibold">{perWinner.toFixed(2)} USDC</span>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
          <span>{drop.claimedCount} / {drop.maxWinners} claimed</span>
          <span>{progress.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-ink-border overflow-hidden">
          <div
            className="h-full rounded-full bg-cyan-accent transition-all"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">Sponsor: {shortAddr(drop.sponsor)}</span>
        {eligible && !alreadyClaimed && drop.active && (
          <button className="btn-primary text-xs py-1 px-3" onClick={onClaim}>
            Claim
          </button>
        )}
        {alreadyClaimed && (
          <span className="text-emerald-400 text-xs">✅ Claimed</span>
        )}
        {!eligible && drop.active && (
          <span className="text-amber-400 text-xs">Not whitelisted</span>
        )}
      </div>
    </motion.div>
  );
}
