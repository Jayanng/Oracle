"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { explorerTx } from "@/lib/chain";

export interface TxStep {
  label: string;
  status: "pending" | "confirmed" | "error";
  txHash?: `0x${string}`;
  /** CCTP destination domain for per-chain explorer links. */
  domain?: number;
  /** Optional substatus to show granular progress (e.g., "Polling attempt 12/60...") */
  substatus?: string;
  /** Estimated duration in seconds (shown as "~Xs remaining") */
  estimatedSeconds?: number;
}

export function TxModal({
  open,
  steps,
  onClose,
  title = "Transaction",
  actionLabel,
  onAction,
  actionBusy,
}: {
  open: boolean;
  steps: TxStep[];
  onClose: () => void;
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
}) {
  const hasSteps = steps.length > 0;
  const anyError = hasSteps && steps.some((s) => s.status === "error");
  const waiting = !hasSteps || steps.some((s) => s.status === "pending");
  const showAction = onAction && !waiting && !anyError && !actionBusy;
  const allDone = hasSteps && steps.every((s) => s.status === "confirmed") && !showAction;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <motion.div
            layout
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="card w-full max-w-md space-y-5"
          >
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-lg">{title}</h3>
          {(allDone || anyError) && (
            <button
              onClick={onClose}
              className="text-ink-muted hover:text-white text-xl leading-none"
            >
              &times;
            </button>
          )}
        </div>

        {hasSteps && (
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Step {steps.filter((s) => s.status !== "pending").length + 1} of {steps.length}</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 rounded-full bg-ink-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-cyan-accent transition-all duration-500"
                  style={{ width: `${(steps.filter((s) => s.status !== "pending").length / steps.length) * 100}%` }}
                />
              </div>
              <span className="font-mono text-[11px]">{Math.round((steps.filter((s) => s.status !== "pending").length / steps.length) * 100)}%</span>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {!hasSteps && (
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-accent shrink-0" />
              <span className="text-sm text-ink-muted">Waiting for wallet...</span>
            </div>
          )}
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {step.status === "pending" && (
                  <Loader2 className="h-5 w-5 animate-spin text-cyan-accent" />
                )}
                {step.status === "confirmed" && (
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                )}
                {step.status === "error" && (
                  <XCircle className="h-5 w-5 text-red-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm font-medium ${
                    step.status === "error" ? "text-red-400" : ""
                  }`}
                >
                  {step.label}
                </div>
                {step.substatus && step.status === "pending" && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                    <span className="inline-block h-1 w-1 rounded-full bg-cyan-accent/50 animate-pulse" />
                    <span>{step.substatus}</span>
                    {step.estimatedSeconds != null && step.estimatedSeconds > 0 && (
                      <span className="text-cyan-accent/70 font-mono">
                        ~{step.estimatedSeconds}s
                      </span>
                    )}
                  </div>
                )}
                {step.txHash && (
                  <a
                    href={explorerTx(step.txHash, step.domain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-cyan-accent hover:underline font-mono"
                  >
                    {step.txHash.slice(0, 10)}...
                    {step.txHash.slice(-6)}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {showAction && (
          <button
            className="btn-primary w-full"
            onClick={onAction}
            disabled={actionBusy}
          >
            {actionBusy ? "Processing…" : actionLabel || "Continue"}
          </button>
        )}
        {allDone && (
          <button className="btn-primary w-full" onClick={onClose}>
            Done
          </button>
        )}
            {anyError && (
              <button className="btn-ghost w-full" onClick={onClose}>
                Dismiss
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
