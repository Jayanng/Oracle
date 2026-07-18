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
  useSwitchChain,
} from "wagmi";
import { parseUnits, pad, createPublicClient, http, type Address } from "viem";
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
  MESSAGE_TRANSMITTER_ADDRESS,
  MESSAGE_TRANSMITTER_ABI,
  CHAIN_CONFIG,
} from "@/lib/contracts";
import { shortAddr } from "@/lib/utils";
import { ensureInjectiveChain, isInjectiveChain } from "@/lib/ensureInjective";
import { TxModal, type TxStep } from "@/components/TxModal";
import { INJECTIVE_EVM_CHAIN_ID } from "@/lib/wagmi";
import {
  fetchFixtures,
  type PublicFixture,
} from "@/lib/fixtures";
import { motion } from "framer-motion";

type Tab = "drops" | "sponsor" | "feeder";

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
  const { switchChainAsync } = useSwitchChain();
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
  const [dropMatchIds, setDropMatchIds] = useState<Record<number, number>>({});
  const [eligibilityMap, setEligibilityMap] = useState<Record<number, boolean>>({});
  const [claimedMap, setClaimedMap] = useState<Record<number, boolean>>({});
  const [claimModal, setClaimModal] = useState<{ dropId: number; perWinnerAmount: bigint } | null>(null);
  const [claimDest, setClaimDest] = useState<number>(29); // Injective same-chain by default

  const [refreshKey, setRefreshKey] = useState(0);
  const [txFlow, setTxFlow] = useState<{ open: boolean; title: string; steps: TxStep[] }>({
    open: false,
    title: "",
    steps: [],
  });

  /** Stored once burn + attestation complete; user clicks Mint button to finish. */
  const [pendingMint, setPendingMint] = useState<{
    message: `0x${string}`;
    attestation: `0x${string}`;
    domain: number;
    label: string;
    chainId: number;
  } | null>(null);
  const [mintBusy, setMintBusy] = useState(false);
  const [requestingDrop, setRequestingDrop] = useState<number | null>(null);

  async function handleRequestAccess(dropId: number) {
    if (!address) return;
    setRequestingDrop(dropId);
    try {
      const r = await fetch("/api/whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropId, wallet: address }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Whitelist failed");
      toast.success(`Access granted for Drop #${dropId}!`);
      setEligibilityMap((m) => ({ ...m, [dropId]: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not request access");
    } finally {
      setRequestingDrop(null);
    }
  }

  function closeTxFlow() {
    setTxFlow((p) => ({ ...p, open: false }));
    setPendingMint(null);
  }

  function appendTxStep(step: TxStep) {
    setTxFlow((p) => ({ ...p, steps: [...p.steps, step] }));
  }

  function updateLastTxStep(update: Partial<TxStep>) {
    setTxFlow((p) => {
      const steps = [...p.steps];
      if (steps.length > 0) steps[steps.length - 1] = { ...steps[steps.length - 1], ...update };
      return { ...p, steps };
    });
  }

  /** Shared mint handler — called via TxModal action button after cross-chain burn. */
  async function handleMint() {
    const data = pendingMint;
    if (!data) return;
    setMintBusy(true);
    appendTxStep({ label: `Mint USDC on ${data.label}`, status: "pending", domain: data.domain });
    try {
      try {
        if (switchChainAsync) await switchChainAsync({ chainId: data.chainId });
      } catch { /* user may cancel MetaMask switch — proceed anyway */ }

      const mintHash = await writeContractAsync({
        chainId: data.chainId,
        address: MESSAGE_TRANSMITTER_ADDRESS,
        abi: MESSAGE_TRANSMITTER_ABI,
        functionName: "receiveMessage",
        args: [data.message, data.attestation],
      });
      updateLastTxStep({ txHash: mintHash, domain: data.domain });

      const destRpc = data.chainId === 11_155_111
        ? "https://rpc.sepolia.org"
        : "https://rpc.sepolia.org";
      try {
        const destPub = createPublicClient({ transport: http(destRpc) });
        const mr = await destPub.waitForTransactionReceipt({ hash: mintHash, timeout: 120_000 });
        if (mr.status !== "success") throw new Error("Mint reverted");
      } catch (e) {
        console.warn("Could not verify mint receipt:", e);
      }
      updateLastTxStep({ status: "confirmed" });
      setPendingMint(null);
      refetchBalance();
    } catch (e) {
      updateLastTxStep({ status: "error" });
      toast.error(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMintBusy(false);
    }
  }

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
        const matchIds: Record<number, number> = {};
        for (let i = 0; i < total; i++) {
          const dropRaw = (await pub.readContract({
            address: DROPS_ADDRESS,
            abi: FAN_DROPS_ABI,
            functionName: "drops",
            args: [BigInt(i)],
          })) as unknown as [bigint, string, number, number, bigint, number, number, bigint, string, boolean];
          if (dropRaw[9]) {
            active.push(i); // active flag
            matchIds[i] = Number(dropRaw[0]);
          }
        }
        setActiveDropIds(active);
        setDropMatchIds(matchIds);
      } catch (e) {
        console.warn("Could not load drops:", e);
      }
    };
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [hasDrops, pub, refreshKey]);

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

  // Only show drops for upcoming/LIVE fixtures, deduped by matchId (keep newest dropId)
  const visibleDropIds = useMemo(() => {
    const showableStatuses = new Set(["NS", "LIVE", "HT", "1H", "2H", "ET", "P"]);
    const byMatch = new Map<number, number>();
    for (const dropId of activeDropIds) {
      const matchId = dropMatchIds[dropId];
      if (matchId === undefined) continue;
      const fixture = fixtures.find((f) => f.id === matchId);
      // If fixtures haven't loaded yet, keep the drop; otherwise require an upcoming/LIVE status
      if (fixture && !showableStatuses.has(fixture.status)) continue;
      const existing = byMatch.get(matchId);
      if (existing === undefined || dropId > existing) byMatch.set(matchId, dropId);
    }
    return Array.from(byMatch.values()).sort((a, b) => a - b);
  }, [activeDropIds, dropMatchIds, fixtures]);

  // Actions
  async function handleClaim(dropId: number) {
    if (!address || !DROPS_ADDRESS) return;

    const label = claimDest === 29 ? "Claim Drop" : "Cross-Chain Claim";
    setTxFlow({ open: true, title: label, steps: [{ label, status: "pending" }] });
    try {
      await ensureInjectiveChain(config);
      if (claimDest === 29) {
        const hash = await writeContractAsync({
          chainId: INJECTIVE_EVM_CHAIN_ID,
          address: DROPS_ADDRESS,
          abi: FAN_DROPS_ABI,
          functionName: "claim",
          args: [BigInt(dropId)],
        });
        updateLastTxStep({ txHash: hash });
        if (pub) {
          const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error("Claim reverted on-chain");
        }
        updateLastTxStep({ status: "confirmed" });
      } else {
        const mintRecipient = pad(address, { size: 32 }) as `0x${string}`;
        const destConfig = CHAIN_CONFIG[claimDest];
        const destLabel = destConfig?.label || `domain ${claimDest}`;

        // Step 1: Burn USDC on Injective via CCTP
        updateLastTxStep({ label: `Burn USDC → ${destLabel}`, status: "pending" });
        const hash = await writeContractAsync({
          chainId: INJECTIVE_EVM_CHAIN_ID,
          address: DROPS_ADDRESS,
          abi: FAN_DROPS_ABI,
          functionName: "claimToChain",
          args: [BigInt(dropId), claimDest, mintRecipient],
        });
        updateLastTxStep({ txHash: hash });
        if (pub) {
          const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error("Cross-chain claim reverted on-chain");
        }
        updateLastTxStep({ status: "confirmed" });

        // Step 2: Poll Circle Attestation API for the burn message
        appendTxStep({ label: `Waiting for Circle attestation…`, status: "pending" });
        let attestationData: { message: string; attestation: string } | null = null;
        const maxPolls = 60;
        for (let attempt = 1; attempt <= maxPolls; attempt++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const res = await fetch(
              `/api/cctp/attestation?txHash=${hash}&sourceDomain=29`
            );
            const data = await res.json();
            const msg = data.messages?.[0];
            if (msg?.status === "complete" && msg.message && msg.attestation) {
              attestationData = { message: msg.message, attestation: msg.attestation };
              break;
            }
          } catch { /* retry */ }
        }
        if (!attestationData) {
          updateLastTxStep({ status: "error" });
          throw new Error("Attestation not ready after 3 minutes. Check Circle Iris API.");
        }
        updateLastTxStep({ status: "confirmed" });

        // Step 3: Store mint data — user clicks "Mint" action button in TxModal
        setPendingMint({
          message: attestationData.message as `0x${string}`,
          attestation: attestationData.attestation as `0x${string}`,
          domain: claimDest,
          label: destLabel,
          chainId: destConfig?.chainId ?? 11_155_111,
        });
      }
      setClaimModal(null);
      refetchBalance();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      updateLastTxStep({ status: "error" });
      toast.error(e instanceof Error ? e.message : "Claim failed");
    }
  }

  async function handleCreateDrop() {
    if (!address || !DROPS_ADDRESS) return;

    setTxFlow({ open: true, title: "Creating Drop", steps: [] });
    try {
      await ensureInjectiveChain(config);
      const amount = parseUnits(sponsorAmount, 6);
      const total = amount * BigInt(sponsorMaxWinners);
      const matchId = Number(sponsorMatch);

      // Step 1: Approve USDC
      appendTxStep({ label: "Approve USDC", status: "pending" });
      const approveHash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [DROPS_ADDRESS, total],
      });
      updateLastTxStep({ txHash: approveHash });
      if (pub) {
        const receipt = await pub.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
        if (receipt.status !== "success") throw new Error("Approve USDC reverted on-chain");
      }
      updateLastTxStep({ status: "confirmed" });

      // Step 2: Create drop
      appendTxStep({ label: "Create Drop", status: "pending" });
      const hash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: DROPS_ADDRESS,
        abi: FAN_DROPS_ABI,
        functionName: "createDrop",
        args: [BigInt(matchId), sponsorEvent, sponsorMinFrom, sponsorMinTo, amount, sponsorMaxWinners],
      });
      updateLastTxStep({ txHash: hash });
      if (pub) {
        const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== "success") throw new Error("Create drop reverted on-chain");
      }
      updateLastTxStep({ status: "confirmed" });

      // Step 3: Whitelist wallets if provided
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
          appendTxStep({ label: `Whitelist ${wallets.length} wallet(s)`, status: "pending" });
          const whitelistHash = await writeContractAsync({
            chainId: INJECTIVE_EVM_CHAIN_ID,
            address: DROPS_ADDRESS,
            abi: FAN_DROPS_ABI,
            functionName: "whitelist",
            args: [BigInt(dropId), wallets.map((w) => w as Address)],
          });
          updateLastTxStep({ txHash: whitelistHash });
          if (pub) {
            const receipt = await pub.waitForTransactionReceipt({ hash: whitelistHash, timeout: 120_000 });
            if (receipt.status !== "success") throw new Error("Whitelist reverted on-chain");
          }
          updateLastTxStep({ status: "confirmed" });
        }
      }

      refetchBalance();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      updateLastTxStep({ status: "error" });
      toast.error(e instanceof Error ? e.message : "Create drop failed");
    }
  }

  async function handleWithdraw() {
    if (!address || !TREASURY_ADDRESS) return;

    const label = withdrawDest === 29 ? "Withdraw" : "Cross-Chain Withdraw";
    setTxFlow({ open: true, title: label, steps: [{ label, status: "pending" }] });
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
        updateLastTxStep({ txHash: hash });
        if (pub) {
          const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error("Withdraw reverted on-chain");
        }
        updateLastTxStep({ status: "confirmed" });
      } else {
        const mintRecipient = pad(address, { size: 32 }) as `0x${string}`;
        const destConfig = CHAIN_CONFIG[withdrawDest];
        const destLabel = destConfig?.label || `domain ${withdrawDest}`;

        updateLastTxStep({ label: `Burn USDC → ${destLabel}`, status: "pending" });
        const hash = await writeContractAsync({
          chainId: INJECTIVE_EVM_CHAIN_ID,
          address: TREASURY_ADDRESS,
          abi: TREASURY_ABI,
          functionName: "withdrawToChain",
          args: [amount, withdrawDest, mintRecipient],
        });
        updateLastTxStep({ txHash: hash });
        if (pub) {
          const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error("Cross-chain withdraw reverted on-chain");
        }
        updateLastTxStep({ status: "confirmed" });

        // Step 2: Poll attestation
        appendTxStep({ label: `Waiting for Circle attestation…`, status: "pending" });
        let ad: { message: string; attestation: string } | null = null;
        for (let attempt = 1; attempt <= 60; attempt++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const res = await fetch(`/api/cctp/attestation?txHash=${hash}&sourceDomain=29`);
            const data = await res.json();
            const msg = data.messages?.[0];
            if (msg?.status === "complete" && msg.message && msg.attestation) {
              ad = { message: msg.message, attestation: msg.attestation };
              break;
            }
          } catch { /* retry */ }
        }
        if (!ad) {
          updateLastTxStep({ status: "error" });
          throw new Error("Attestation not ready after 3 minutes");
        }
        updateLastTxStep({ status: "confirmed" });

        // Step 3: Store mint data — user clicks "Mint" action button in TxModal
        setPendingMint({
          message: ad.message as `0x${string}`,
          attestation: ad.attestation as `0x${string}`,
          domain: withdrawDest,
          label: destLabel,
          chainId: destConfig?.chainId ?? 11_155_111,
        });
      }
      refetchBalance();
      refetchEarnings();
    } catch (e) {
      updateLastTxStep({ status: "error" });
      toast.error(e instanceof Error ? e.message : "Withdraw failed");
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "drops", label: "Reward Drops" },
    { key: "sponsor", label: "Sponsor a Drop" },
    { key: "feeder", label: "Feeder Earnings" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Rewards & Treasury</h1>
        <p className="mt-1 text-ink-muted">
          Buy premium stats via the Agent chat → get whitelisted for the match's drop →
          claim USDC on Injective or any chain via CCTP. Funded by oracle x402 revenue.
        </p>
      </div>

      {/* Wallet info bar */}
      {address && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-border bg-ink-card/50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Balance:</span>
            <span className="font-mono font-semibold text-cyan-accent">
              {usdcBal != null ? (Number(usdcBal) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} USDC
            </span>
          </div>
          <a
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 transition hover:bg-amber-500/20"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-droplets"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/></svg>
            Need USDC? Get testnet USDC from Circle faucet
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        </div>
      )}

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
          {visibleDropIds.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-ink-muted">No active drops yet. Sponsors can create drops in the &quot;Sponsor a Drop&quot; tab.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleDropIds.map((dropId) => (
                <DropCard
                  key={dropId}
                  dropId={dropId}
                  fixtures={fixtures}
                  eligible={eligibilityMap[dropId] ?? false}
                  alreadyClaimed={claimedMap[dropId] ?? false}
                  requesting={requestingDrop === dropId}
                  onClaim={() => setClaimModal({ dropId, perWinnerAmount: BigInt(0) })}
                  onRequestAccess={() => handleRequestAccess(dropId)}
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
              disabled={isPending || !sponsorMatch || txFlow.open}
              onClick={handleCreateDrop}
            >
              {isPending || txFlow.open ? "Creating…" : "Create Drop"}
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
              disabled={txFlow.open}
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
                setTxFlow({ open: true, title: "Whitelist Wallets", steps: [{ label: `Whitelist ${wallets.length} wallet(s) for drop #${dropIdNum}`, status: "pending" }] });
                try {
                  await ensureInjectiveChain(config);
                  const hash = await writeContractAsync({
                    chainId: INJECTIVE_EVM_CHAIN_ID,
                    address: DROPS_ADDRESS,
                    abi: FAN_DROPS_ABI,
                    functionName: "whitelist",
                    args: [BigInt(dropIdNum), wallets.map(w => w as Address)],
                  });
                  updateLastTxStep({ txHash: hash });
                  if (pub) {
                    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
                    if (receipt.status !== "success") throw new Error("Whitelist reverted on-chain");
                  }
                  updateLastTxStep({ status: "confirmed" });
                } catch (e) {
                  updateLastTxStep({ status: "error" });
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
                  disabled={isPending || txFlow.open}
                  onClick={handleWithdraw}
                >
                  {isPending || txFlow.open ? "Withdrawing…" : "Withdraw"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Transaction processing modal */}
      <TxModal
        open={txFlow.open}
        title={txFlow.title}
        steps={txFlow.steps}
        onClose={closeTxFlow}
        actionLabel={pendingMint ? `Mint USDC on ${pendingMint.label}` : undefined}
        onAction={pendingMint ? handleMint : undefined}
        actionBusy={mintBusy}
      />

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
              <button className="btn-ghost flex-1" disabled={txFlow.open} onClick={() => setClaimModal(null)}>
                Cancel
              </button>
              <button className="btn-primary flex-1" disabled={txFlow.open} onClick={() => handleClaim(claimModal.dropId)}>
                {txFlow.open ? "Processing…" : "Claim"}
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
  requesting,
  onClaim,
  onRequestAccess,
}: {
  dropId: number;
  fixtures: PublicFixture[];
  eligible: boolean;
  alreadyClaimed: boolean;
  requesting?: boolean;
  onClaim: () => void;
  onRequestAccess?: () => void;
}) {
  const { data: raw } = useReadContract({
    address: DROPS_ADDRESS || undefined,
    abi: FAN_DROPS_ABI,
    functionName: "drops",
    args: [BigInt(dropId)],
    query: { enabled: Boolean(DROPS_ADDRESS), refetchInterval: 15_000 },
  });

  const tuple = raw as readonly [bigint, string, number, number, bigint, number, number, bigint, string, boolean] | undefined;
  if (!tuple) return null;

  const matchId = Number(tuple[0]);
  const eventType = tuple[1];
  const minuteFrom = tuple[2];
  const minuteTo = tuple[3];
  const perWinnerAmount = tuple[4];
  const maxWinners = tuple[5];
  const claimedCount = tuple[6];
  const sponsor = tuple[8];
  const active = tuple[9];

  const fixture = fixtures.find((f) => f.id === matchId);
  const label = fixture?.label || `Match #${matchId}`;
  const progress = maxWinners > 0 ? (claimedCount / maxWinners) * 100 : 0;
  const perWinner = Number(perWinnerAmount) / 1e6;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-ink-muted">Drop #{dropId}</span>
        <span className={`pill ${active ? "bg-emerald-500/15 text-emerald-400" : "bg-ink-muted/15 text-ink-muted"}`}>
          {active ? "Active" : "Inactive"}
        </span>
      </div>
      <div>
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-ink-muted mt-1">
          Trigger: <span className="text-cyan-accent">{eventType}</span>
          {" · "}Min {minuteFrom}-{minuteTo === 0xFFFFFFFF ? "∞" : minuteTo}
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink-muted">Per winner</span>
        <span className="font-semibold">{perWinner.toFixed(2)} USDC</span>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
          <span>{claimedCount} / {maxWinners} claimed</span>
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
        <span className="text-ink-muted">Sponsor: {shortAddr(sponsor)}</span>
        {eligible && !alreadyClaimed && active && (
          <button className="btn-primary text-xs py-1 px-3" onClick={onClaim}>
            Claim
          </button>
        )}
        {alreadyClaimed && (
          <span className="text-emerald-400 text-xs">✅ Claimed</span>
        )}
        {!eligible && active && (
          <button
            className="text-xs font-medium text-cyan-accent hover:underline disabled:opacity-50"
            onClick={onRequestAccess}
            disabled={requesting}
          >
            {requesting ? "Requesting…" : "Request Access"}
          </button>
        )}
      </div>
    </motion.div>
  );
}
