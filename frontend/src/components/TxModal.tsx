"use client";

import { motion } from "framer-motion";
import { Loader2, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { explorerTx } from "@/lib/chain";

export interface TxStep {
  label: string;
  status: "pending" | "confirmed" | "error";
  txHash?: `0x${string}`;
}

export function TxModal({
  open,
  steps,
  onClose,
  title = "Transaction",
}: {
  open: boolean;
  steps: TxStep[];
  onClose: () => void;
  title?: string;
}) {
  if (!open) return null;

  const hasSteps = steps.length > 0;
  const allDone = hasSteps && steps.every((s) => s.status === "confirmed");
  const anyError = hasSteps && steps.some((s) => s.status === "error");
  const waiting = !hasSteps || steps.some((s) => s.status === "pending");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
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
                {step.txHash && (
                  <a
                    href={explorerTx(step.txHash)}
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
    </div>
  );
}
