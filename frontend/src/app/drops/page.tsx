"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
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
import { ensureInjectiveChain } from "@/lib/ensureInjective";
import { TxModal, type TxStep } from "@/components/TxModal";
import { INJECTIVE_EVM_CHAIN_ID, injRpc, injectiveEvmTestnet } from "@/lib/wagmi";
import {
  fetchFixtures,
  type PublicFixture,
} from "@/lib/fixtures";
import { motion } from "framer-motion";

type Tab = "drops" | "sponsor" | "feeder";

/** Raw `drops(uint256)` return tuple, in ABI order. */
type DropTuple = readonly [
  bigint,   // matchId
  string,   // eventType
  number,   // minuteFrom
  number,   // minuteTo
  bigint,   // perWinnerAmount
  number,   // maxWinners
  number,   // claimedCount
  bigint,   // funded
  string,   // sponsor
  boolean   // active
];

export default function DropsPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  useEffect(() => {
    if (!isConnected) router.replace("/");
  }, [isConnected, router]);

  const config = useConfig();
  const pub = usePublicClient();

  // Dedicated Injective read client — reads drops/eligibility from Injective EVM
  // regardless of which chain the user's wallet is currently on (MetaMask may be
  // on Ethereum/Sepolia). Without this, contract reads silently return nothing.
  const injPub = useMemo(
    () =>
      createPublicClient({
        chain: injectiveEvmTestnet,
        transport: http(injRpc),
      }),
    []
  );

  const [tab, setTab] = useState<Tab>("drops");
  const [fixtures, setFixtures] = useState<PublicFixture[]>([]);
  const { writeContractAsync, isPending } = useWriteContract();

  // Injective's Cosmos SDK layer tracks account "sequence" which can lag
  // MetaMask's cached nonce, producing "invalid sequence" broadcast errors
  // when sending several txs in a session. Fetch the latest pending nonce from
  // chain and pass it explicitly to every write so viem never reuses a stale one.
  const nextNonce = useCallback(async () => {
    if (!pub || !address) return undefined;
    try {
      return await pub.getTransactionCount({ address, blockTag: "pending" });
    } catch {
      return undefined;
    }
  }, [pub, address]);
  const { switchChainAsync } = useSwitchChain();

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
  const [dropData, setDropData] = useState<Record<number, DropTuple>>({});
  const [eligibilityMap, setEligibilityMap] = useState<Record<number, boolean>>({});
  const [claimedMap, setClaimedMap] = useState<Record<number, boolean>>({});
  const [claimModal, setClaimModal] = useState<{ dropId: number; perWinnerAmount: bigint } | null>(null);
  const [claimDest, setClaimDest] = useState<number>(29); // Injective same-chain by default

  const [dropsLoading, setDropsLoading] = useState(true); // initial contract read
  const [refreshKey, setRefreshKey] = useState(0);
  const [txFlow, setTxFlow] = useState<{ open: boolean; title: string; steps: TxStep[] }>({
    open: false,
    title: "",
    steps: [],
  });

  /** Stored once burn + attestation complete; user clicks Mint button to finish. */
  // Persisted in localStorage so cross-chain mints survive page navigations.
  // The user may cancel the Sepolia mint (no ETH), and we don't want them
  // to lose access to their funds. Read the persisted value on mount.
  const [pendingMint, setPendingMintRaw] = useState<{
    message: `0x${string}`;
    attestation: `0x${string}`;
    domain: number;
    label: string;
    chainId: number;
    dropId?: number;
  } | null>(null);
  const setPendingMint = useCallback(
    (val: typeof pendingMint) => {
      setPendingMintRaw(val);
      if (val) {
        localStorage.setItem("pendingMint", JSON.stringify(val));
      } else {
        localStorage.removeItem("pendingMint");
      }
    },
    []
  );
  // Recover pending mint from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pendingMint");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.message && parsed?.attestation) {
          setPendingMintRaw(parsed);
        }
      }
    } catch { /* ignore corrupt data */ }
  }, []);
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
      toast.success(`Access granted for Drop #${dropId}`);
      setEligibilityMap((m) => ({ ...m, [dropId]: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not request access");
    } finally {
      setRequestingDrop(null);
    }
  }

  function closeTxFlow() {
    setTxFlow((p) => ({ ...p, open: false }));
    // Deliberately keep pendingMint in state + localStorage so the user
    // can retry a cross-chain mint later (even after closing the modal
    // or navigating away). Only clear when the mint actually succeeds.
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

  /** Shared mint handler — called via TxModal action button or banner 'Mint' button. */
  async function handleMint() {
    const data = pendingMint;
    if (!data) return;
    // Open the TxModal so the user sees progress (even when retrying from banner)
    setTxFlow({
      open: true,
      title: `Mint USDC on ${data.label}`,
      steps: [{ label: `Mint USDC on ${data.label}`, status: "pending", domain: data.domain }],
    });
    setMintBusy(true);
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

      const destRpc =
        CHAIN_CONFIG[data.domain]?.rpc ||
        "https://ethereum-sepolia-rpc.publicnode.com";
      try {
        const destPub = createPublicClient({ transport: http(destRpc) });
        const mr = await destPub.waitForTransactionReceipt({ hash: mintHash, timeout: 120_000 });
        if (mr.status !== "success") throw new Error("Mint reverted");
      } catch (e) {
        console.warn("Could not verify mint receipt:", e);
      }
      updateLastTxStep({ status: "confirmed" });
      setPendingMint(null); // also clears localStorage
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
    chainId: INJECTIVE_EVM_CHAIN_ID,
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  // Feeder earnings
  const { data: earnedData, refetch: refetchEarnings } = useReadContract({
    chainId: INJECTIVE_EVM_CHAIN_ID,
    address: hasTreasury && address ? TREASURY_ADDRESS : undefined,
    abi: TREASURY_ABI,
    functionName: "earnedBy",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(hasTreasury && address), refetchInterval: 10_000 },
  });

  const { data: eventCount } = useReadContract({
    chainId: INJECTIVE_EVM_CHAIN_ID,
    address: hasTreasury && address ? TREASURY_ADDRESS : undefined,
    abi: TREASURY_ABI,
    functionName: "feederEventCount",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(hasTreasury && address), refetchInterval: 10_000 },
  });

  const { data: paidOut } = useReadContract({
    chainId: INJECTIVE_EVM_CHAIN_ID,
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

  const [dropsError, setDropsError] = useState<string | null>(null);

  // Load active drop IDs by scanning from 0 to nextDropId
  useEffect(() => {
    if (!hasDrops) {
      setDropsLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const nextId = (await injPub.readContract({
          address: DROPS_ADDRESS,
          abi: FAN_DROPS_ABI,
          functionName: "nextDropId",
        })) as bigint;
        const total = Number(nextId);

        // Read every drop in parallel (one round-trip instead of a serial
        // loop). A single failed read rejects its own promise; we capture that
        // rather than letting it blank the whole list.
        const settled = await Promise.all(
          Array.from({ length: total }, (_, i) =>
            injPub
              .readContract({
                address: DROPS_ADDRESS,
                abi: FAN_DROPS_ABI,
                functionName: "drops",
                args: [BigInt(i)],
              })
              .then((raw) => ({ i, raw: raw as unknown as DropTuple }))
              .catch(() => ({ i, raw: null }))
          )
        );
        if (cancelled) return;

        // If any individual read failed, this scan is incomplete — keep the
        // previous state rather than overwriting it with a partial list (which
        // is what made drops flicker / disappear on transient RPC hiccups).
        if (settled.some((s) => s.raw === null)) {
          setDropsError("Partial data from chain — retrying…");
          setDropsLoading(false);
          return;
        }

        const active: number[] = [];
        const matchIds: Record<number, number> = {};
        const data: Record<number, DropTuple> = {};
        for (const { i, raw } of settled) {
          if (!raw) continue;
          data[i] = raw;
          if (raw[9]) {
            active.push(i);
            matchIds[i] = Number(raw[0]);
          }
        }
        setActiveDropIds(active);
        setDropMatchIds(matchIds);
        setDropData(data);
        setDropsError(null);
        setDropsLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.warn("Could not load drops:", e);
        setDropsError(e instanceof Error ? e.message : "RPC error loading drops");
        // Keep dropsLoading=true so skeleton stays visible — don't flicker
        // to "No active drops" on transient RPC failures. The 20s interval
        // will retry.
      }
    };
    load();
    const t = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [hasDrops, injPub, refreshKey]);

  // Check eligibility for each active drop
  useEffect(() => {
    if (!hasDrops || !address || activeDropIds.length === 0) return;
    let cancelled = false;
    const check = async () => {
      const results = await Promise.all(
        activeDropIds.map((id) =>
          Promise.all([
            injPub.readContract({
              address: DROPS_ADDRESS,
              abi: FAN_DROPS_ABI,
              functionName: "eligible",
              args: [BigInt(id), address],
            }) as Promise<boolean>,
            injPub.readContract({
              address: DROPS_ADDRESS,
              abi: FAN_DROPS_ABI,
              functionName: "claimed",
              args: [BigInt(id), address],
            }) as Promise<boolean>,
          ])
            .then(([e, c]) => ({ id, e, c }))
            .catch(() => ({ id, e: null as boolean | null, c: null as boolean | null }))
        )
      );
      if (cancelled) return;
      // Merge into prior state — only overwrite entries we successfully read,
      // so a transient failure can't flip a "Claim" button back to
      // "Request Access".
      setEligibilityMap((prev) => {
        const next = { ...prev };
        for (const { id, e } of results) if (e !== null) next[id] = e;
        return next;
      });
      setClaimedMap((prev) => {
        const next = { ...prev };
        for (const { id, c } of results) if (c !== null) next[id] = c;
        return next;
      });
    };
    check();
    const t = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [hasDrops, address, injPub, activeDropIds]);

  // Show all active drops. Already-claimed drops show a "Claimed" label
// but remain visible so the user can see what they've already received.
const visibleDropIds = useMemo(() => {
  const byMatch = new Map<number, number>();
  for (const dropId of activeDropIds) {
    const matchId = dropMatchIds[dropId];
    if (matchId === undefined) continue;
    const existing = byMatch.get(matchId);
    if (existing === undefined || dropId > existing) byMatch.set(matchId, dropId);
  }
  return Array.from(byMatch.values()).sort((a, b) => a - b);
}, [activeDropIds, dropMatchIds]);

  // Actions
  async function handleClaim(dropId: number) {
    if (!address || !DROPS_ADDRESS) return;

    setClaimModal(null);
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
          nonce: await nextNonce(),
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
          nonce: await nextNonce(),
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
          updateLastTxStep({
            substatus: `Polling attestation ${attempt}/${maxPolls}`,
            estimatedSeconds: (maxPolls - attempt) * 3,
          });
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
        // Persisted in localStorage so it survives page navigations (user may
        // need to get Sepolia ETH for gas before they can mint).
        setPendingMint({
          message: attestationData.message as `0x${string}`,
          attestation: attestationData.attestation as `0x${string}`,
          domain: claimDest,
          label: destLabel,
          chainId: destConfig?.chainId ?? 11_155_111,
          dropId,
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
        nonce: await nextNonce(),
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
        nonce: await nextNonce(),
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
            nonce: await nextNonce(),
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
          nonce: await nextNonce(),
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
          nonce: await nextNonce(),
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
        const maxPolls = 60;
        for (let attempt = 1; attempt <= maxPolls; attempt++) {
          updateLastTxStep({
            substatus: `Polling attestation ${attempt}/${maxPolls}`,
            estimatedSeconds: (maxPolls - attempt) * 3,
          });
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
    <div className="relative">
      <div
        className="pointer-events-none fixed inset-0 bg-cover bg-center bg-no-repeat opacity-10"
        style={{ backgroundImage: "url('/field.png')" }}
      />

      {/* Sticky top bar — matches dashboard shell */}
      <div className="sticky top-0 z-30 border-b border-[#1E293B] bg-[#0B0F19]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between overflow-x-auto px-4 py-3">
          <div className="flex gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 rounded-lg px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${
                  tab === t.key
                    ? "bg-cyan-accent/20 text-cyan-accent ring-1 ring-cyan-accent/30"
                    : "text-ink-muted hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {address && (
            <div className="hidden shrink-0 items-center gap-2 pl-4 text-xs sm:flex">
              <span className="text-ink-muted">Balance</span>
              <span className="font-mono font-semibold text-cyan-accent">
                {usdcBal != null
                  ? (Number(usdcBal) / 1e6).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "—"}{" "}
                USDC
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 pb-8 pt-6">
        <div>
          <h1 className="font-display text-3xl font-bold">Rewards & Treasury</h1>
          <p className="mt-1 text-ink-muted">
            Buy premium stats via the Agent chat → get whitelisted for the
            match&apos;s drop → claim USDC on Injective or any chain via CCTP.
            Funded by oracle x402 revenue.
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

      {/* Tab 1: Active Drops */}
      {tab === "drops" && (
        <div>
          {/* Pending cross-chain mint banner — persists even after closing the modal */}
          {pendingMint && (
            <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20">
                  <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-amber-300">Cross-chain claim pending</h4>
                  <p className="mt-1 text-xs text-amber-200/80">
                    Your USDC was burned on Injective and the attestation is ready.{" "}
                    {pendingMint.dropId != null && <>Drop #{pendingMint.dropId}: </>}
                    Switch to <strong>{pendingMint.label}</strong> and mint your USDC to complete the claim.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/30"
                      onClick={handleMint}
                      disabled={mintBusy}
                    >
                      {mintBusy ? "Minting…" : `Mint on ${pendingMint.label}`}
                    </button>
                    <button
                      className="rounded-lg border border-ink-border/50 px-3 py-1.5 text-xs text-ink-muted transition hover:text-white"
                      onClick={() => {
                        setPendingMint(null);
                        setRefreshKey((k) => k + 1);
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {dropsLoading ? (
            <div className="space-y-4">
              {dropsError && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-center">
                  <p className="text-sm text-amber-300">
                    ⚠️ Could not load drops from chain: {dropsError}
                  </p>
                  <p className="mt-1 text-xs text-amber-200/70">
                    Retrying automatically every 20 seconds…
                  </p>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </div>
          ) : visibleDropIds.length === 0 ? (
            <div className="card py-12 text-center">
              <p className="text-ink-muted">No active drops yet. Sponsors can create drops in the &quot;Sponsor a Drop&quot; tab.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleDropIds.map((dropId) => (
                <DropCard
                  key={dropId}
                  dropId={dropId}
                  drop={dropData[dropId]}
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
                    nonce: await nextNonce(),
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
      </div>

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

      {/* Claim destination modal */}
      {claimModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="card w-full max-w-md space-y-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-lg">Claim Drop</h3>
              <button
                onClick={() => setClaimModal(null)}
                className="text-ink-muted hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="rounded-lg bg-cyan-accent/5 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Drop</span>
                <span className="font-mono font-medium">#{claimModal.dropId}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Reward</span>
                <span className="font-semibold text-emerald-400">
                  {(() => {
                    const d = dropData[claimModal.dropId];
                    return d ? `${(Number(d[4]) / 1e6).toFixed(2)} USDC` : "—";
                  })()}
                </span>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs text-ink-muted">Destination Chain</label>
              <select
                value={claimDest}
                onChange={(e) => setClaimDest(Number(e.target.value))}
                className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2.5 text-sm outline-none focus:border-cyan-accent transition-colors"
              >
                {CCTP_DOMAINS.map((d) => (
                  <option key={d.domain} value={d.domain}>
                    {d.label} {d.domain === 29 ? "(same-chain, no extra gas)" : ""}
                  </option>
                ))}
              </select>
              {claimDest !== 29 && (
                <p className="mt-1.5 text-xs text-amber-400/80 flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  You&apos;ll need gas on the destination chain to mint USDC
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                className="btn-ghost flex-1"
                disabled={txFlow.open}
                onClick={() => setClaimModal(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                disabled={txFlow.open}
                onClick={() => handleClaim(claimModal.dropId)}
              >
                {txFlow.open ? "Processing…" : "Claim"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}

/** Skeleton card shown while drops are loading from the chain */
function SkeletonCard() {
  return (
    <div className="card animate-pulse space-y-3">
      <div className="flex items-center justify-between">
        <div className="h-3 w-16 rounded bg-ink-border" />
        <div className="h-4 w-12 rounded-full bg-ink-border" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-40 rounded bg-ink-border" />
        <div className="h-3 w-32 rounded bg-ink-border/60" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-3 w-16 rounded bg-ink-border" />
        <div className="h-4 w-20 rounded bg-ink-border" />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="h-3 w-24 rounded bg-ink-border" />
          <div className="h-3 w-8 rounded bg-ink-border" />
        </div>
        <div className="h-2 rounded-full bg-ink-border" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-3 w-20 rounded bg-ink-border" />
        <div className="h-6 w-24 rounded-lg bg-ink-border" />
      </div>
    </div>
  );
}

function DropCard({
  dropId,
  drop,
  fixtures,
  eligible,
  alreadyClaimed,
  requesting,
  onClaim,
  onRequestAccess,
}: {
  dropId: number;
  drop?: DropTuple;
  fixtures: PublicFixture[];
  eligible: boolean;
  alreadyClaimed: boolean;
  requesting?: boolean;
  onClaim: () => void;
  onRequestAccess?: () => void;
}) {
  // Drop data comes from the parent (read via the dedicated Injective client),
  // so the card no longer does its own wallet-chain `drops` read. That read
  // returned undefined whenever MetaMask was on another chain (e.g. after a
  // cross-chain claim switches to Sepolia), causing `return null` below to make
  // every card vanish. Reading from the parent keeps cards rendered regardless
  // of the wallet's active chain.
  const tuple = drop;

  const matchId = tuple ? Number(tuple[0]) : 0;
  const eventType = tuple ? tuple[1] : "";
  const minuteFrom = tuple ? tuple[2] : 0;
  const minuteTo = tuple ? tuple[3] : 0;

  // Read the match's oracle events to mirror the contract's _oracleMatches gate:
  // the claim only succeeds once a matching event (eventType + minute window)
  // has fired. Until then the Claim button stays disabled ("numb").
  // Pinned to the Injective chain id so it doesn't follow the wallet's network.
  const { data: oracleEvents } = useReadContract({
    chainId: INJECTIVE_EVM_CHAIN_ID,
    address: ORACLE_ADDRESS || undefined,
    abi: ORACLE_ABI,
    functionName: "getEvents",
    args: [BigInt(matchId)],
    query: {
      enabled: Boolean(ORACLE_ADDRESS) && Boolean(tuple),
      refetchInterval: 15_000,
    },
  });

  if (!tuple) return null;

  const perWinnerAmount = tuple[4];
  const maxWinners = tuple[5];
  const claimedCount = tuple[6];
  const sponsor = tuple[8];
  const active = tuple[9];

  const evts =
    (oracleEvents as
      | readonly {
          eventType: string;
          minute: number;
        }[]
      | undefined) ?? [];
  const triggerFired = evts.some(
    (e) =>
      e.eventType === eventType &&
      Number(e.minute) >= minuteFrom &&
      Number(e.minute) <= minuteTo
  );

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
          triggerFired ? (
            <button className="btn-primary text-xs py-1 px-3" onClick={onClaim}>
              Claim
            </button>
          ) : (
            <span
              className="pill bg-ink-border/60 text-[11px] text-ink-muted"
              title={`Claim unlocks once a "${eventType}" event fires between minute ${minuteFrom} and ${minuteTo === 0xffffffff ? "∞" : minuteTo}`}
            >
              Awaiting {eventType}
            </span>
          )
        )}
        {alreadyClaimed && (
          <span className="text-emerald-400 text-xs">Claimed</span>
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
