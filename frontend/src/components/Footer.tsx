"use client";

import { usePathname } from "next/navigation";

export function Footer() {
  const path = usePathname();
  if (path !== "/") return null;

  return (
    <footer className="border-t border-[#1E293B] bg-[#0B0F19] py-12">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div>
            <span className="text-sm font-bold tracking-wider text-white">
              KICKOFF
            </span>
            <p className="mt-1 text-xs text-[#64748B]">
              Real-world events on Injective.
            </p>
          </div>
          <div className="flex gap-6 text-xs text-[#64748B]">
            <a href="/dashboard" className="transition hover:text-white">
              Dashboard
            </a>
            <a href="/agent" className="transition hover:text-white">
              Agent
            </a>
            <a href="/explorer" className="transition hover:text-white">
              Explorer
            </a>
            <a href="/rewards" className="transition hover:text-white">
              Rewards
            </a>
          </div>
        </div>
        <div className="mt-8 border-t border-[#1E293B] pt-6 text-center text-[10px] text-[#475569]">
          <p>MCP · x402 · CCTP · Agent Skills</p>
        </div>
      </div>
    </footer>
  );
}
