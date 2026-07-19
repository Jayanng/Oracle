"use client";

import { Trophy } from "lucide-react";

interface Team {
  flag: string;
  name: string;
}

interface GroupData {
  label: string;
  teams: Team[];
}

const groups: GroupData[] = [
  { label: "A", teams: [
    { flag: "🇲🇽", name: "Mexico" },
    { flag: "🇿🇦", name: "South Africa" },
    { flag: "🇰🇷", name: "South Korea" },
    { flag: "🇨🇿", name: "Czechia" },
  ]},
  { label: "B", teams: [
    { flag: "🇨🇦", name: "Canada" },
    { flag: "🇧🇦", name: "Bosnia" },
    { flag: "🇶🇦", name: "Qatar" },
    { flag: "🇨🇭", name: "Switzerland" },
  ]},
  { label: "C", teams: [
    { flag: "🇧🇷", name: "Brazil" },
    { flag: "🇲🇦", name: "Morocco" },
    { flag: "🇭🇹", name: "Haiti" },
    { flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", name: "Scotland" },
  ]},
  { label: "D", teams: [
    { flag: "🇺🇸", name: "USA" },
    { flag: "🇵🇾", name: "Paraguay" },
    { flag: "🇦🇺", name: "Australia" },
    { flag: "🇹🇷", name: "Türkiye" },
  ]},
  { label: "E", teams: [
    { flag: "🇩🇪", name: "Germany" },
    { flag: "🇨🇼", name: "Curaçao" },
    { flag: "🇨🇮", name: "Côte d'Ivoire" },
    { flag: "🇪🇨", name: "Ecuador" },
  ]},
  { label: "F", teams: [
    { flag: "🇳🇱", name: "Netherlands" },
    { flag: "🇯🇵", name: "Japan" },
    { flag: "🇸🇪", name: "Sweden" },
    { flag: "🇹🇳", name: "Tunisia" },
  ]},
  { label: "G", teams: [
    { flag: "🇧🇪", name: "Belgium" },
    { flag: "🇪🇬", name: "Egypt" },
    { flag: "🇮🇷", name: "Iran" },
    { flag: "🇳🇿", name: "New Zealand" },
  ]},
  { label: "H", teams: [
    { flag: "🇪🇸", name: "Spain" },
    { flag: "🇨🇻", name: "Cape Verde" },
    { flag: "🇸🇦", name: "Saudi Arabia" },
    { flag: "🇺🇾", name: "Uruguay" },
  ]},
  { label: "I", teams: [
    { flag: "🇫🇷", name: "France" },
    { flag: "🇸🇳", name: "Senegal" },
    { flag: "🇮🇶", name: "Iraq" },
    { flag: "🇳🇴", name: "Norway" },
  ]},
  { label: "J", teams: [
    { flag: "🇦🇷", name: "Argentina" },
    { flag: "🇩🇿", name: "Algeria" },
    { flag: "🇦🇹", name: "Austria" },
    { flag: "🇯🇴", name: "Jordan" },
  ]},
  { label: "K", teams: [
    { flag: "🇵🇹", name: "Portugal" },
    { flag: "🇨🇩", name: "DR Congo" },
    { flag: "🇺🇿", name: "Uzbekistan" },
    { flag: "🇨🇴", name: "Colombia" },
  ]},
  { label: "L", teams: [
    { flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", name: "England" },
    { flag: "🇭🇷", name: "Croatia" },
    { flag: "🇬🇭", name: "Ghana" },
    { flag: "🇵🇦", name: "Panama" },
  ]},
];

const leftGroups = groups.slice(0, 6);
const rightGroups = groups.slice(6, 12);

function GroupCard({ group }: { group: GroupData }) {
  return (
    <div className="rounded-lg border border-[#1E293B] bg-[#0F172A]/80 p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-[#4E46FF] text-[10px] font-bold text-black">
          {group.label}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">
          Group {group.label}
        </span>
      </div>
      <div className="space-y-1">
        {group.teams.map((t) => (
          <div
            key={t.name}
            className="flex items-center gap-1.5 rounded bg-[#1E293B]/40 px-2 py-1 text-[11px] text-[#CBD5E1]"
          >
            <span className="text-[13px] leading-none">{t.flag}</span>
            <span className="truncate">{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketStage({
  label,
  matches,
  side,
}: {
  label: string;
  matches: { teams?: [string, string] }[];
  side: "left" | "right";
}) {
  return (
    <div className="flex items-center gap-1">
      <div className={`flex flex-col gap-1.5 ${side === "right" ? "order-2" : ""}`}>
        {matches.map((m, i) => (
          <div
            key={i}
            className="flex w-20 flex-col rounded border border-[#1E293B] bg-[#0F172A]/60 px-1.5 py-1 sm:w-24"
          >
            <div className="flex items-center gap-1 text-[9px] leading-tight text-[#CBD5E1]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1E293B]" />
              <span className="truncate">{m.teams?.[0] || "TBD"}</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] leading-tight text-[#CBD5E1]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1E293B]" />
              <span className="truncate">{m.teams?.[1] || "TBD"}</span>
            </div>
          </div>
        ))}
      </div>
      <div
        className={`flex flex-col items-center gap-0.5 ${
          side === "left" ? "order-1" : "order-2"
        }`}
      >
        <span className="whitespace-nowrap text-[9px] font-bold tracking-wider text-[#4E46FF]">
          {label}
        </span>
      </div>
    </div>
  );
}

function BracketCenter() {
  const r32 = Array.from({ length: 8 }, () => ({}));
  const r16 = Array.from({ length: 4 }, () => ({}));
  const qf = Array.from({ length: 2 }, () => ({}));
  const sf = Array.from({ length: 1 }, () => ({}));

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Top half */}
      <div className="flex items-end gap-1">
        <BracketStage label="R32" matches={r32} side="left" />
        <div className="flex flex-col items-center gap-4">
          <BracketStage label="R16" matches={r16} side="left" />
          <div className="flex flex-col items-center gap-4">
            <BracketStage label="QF" matches={qf} side="left" />
            <div className="flex flex-col items-center gap-4">
              <BracketStage label="SF" matches={sf} side="left" />
            </div>
          </div>
        </div>
      </div>

      {/* Final - Trophy */}
      <div className="relative z-10 flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#4E46FF]/30 bg-[#4E46FF]/5">
          <Trophy className="h-8 w-8 text-[#4E46FF]" />
        </div>
        <span className="mt-1 text-[10px] font-bold tracking-[0.2em] text-[#4E46FF]">
          FINAL
        </span>
        <div className="mt-1 flex w-28 flex-col rounded-lg border border-[#4E46FF]/20 bg-[#0F172A]/80 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-[#CBD5E1]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1E293B]" />
            <span>Winner SF1</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-[#CBD5E1]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1E293B]" />
            <span>Winner SF2</span>
          </div>
        </div>
      </div>

      {/* Bottom half (mirrored) */}
      <div className="flex items-start gap-1">
        <BracketStage label="R32" matches={r32} side="right" />
        <div className="flex flex-col items-center gap-4">
          <BracketStage label="R16" matches={r16} side="right" />
          <div className="flex flex-col items-center gap-4">
            <BracketStage label="QF" matches={qf} side="right" />
            <div className="flex flex-col items-center gap-4">
              <BracketStage label="SF" matches={sf} side="right" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorldCupBracket() {
  return (
    <section className="relative overflow-hidden border-y border-[#1E293B] bg-[#0B0F19] py-16">
      {/* Grid BG */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(#4E46FF 1px, transparent 1px), linear-gradient(90deg, #4E46FF 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4">
        <div className="mb-10 text-center">
          <span className="inline-block rounded-full border border-[#4E46FF]/20 bg-[#4E46FF]/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#4E46FF]">
            FIFA World Cup 2026
          </span>
          <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
            Tournament Bracket
          </h2>
          <p className="mt-2 text-sm text-[#94A3B8]">
            48 teams · 12 groups · Road to the Final
          </p>
        </div>

        {/* Desktop: 3-column layout */}
        <div className="hidden gap-3 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          {/* Left groups */}
          <div className="grid grid-cols-2 gap-2 content-start">
            {leftGroups.map((g) => (
              <GroupCard key={g.label} group={g} />
            ))}
          </div>

          {/* Center bracket */}
          <div className="flex items-center">
            <BracketCenter />
          </div>

          {/* Right groups */}
          <div className="grid grid-cols-2 gap-2 content-start">
            {rightGroups.map((g) => (
              <GroupCard key={g.label} group={g} />
            ))}
          </div>
        </div>

        {/* Mobile: stacked */}
        <div className="flex flex-col gap-6 lg:hidden">
          <div className="grid grid-cols-2 gap-2">
            {groups.map((g) => (
              <GroupCard key={g.label} group={g} />
            ))}
          </div>
          <div className="flex justify-center">
            <div className="flex items-center gap-3 rounded-xl border border-[#1E293B] bg-[#0F172A]/60 px-6 py-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#4E46FF]/30 bg-[#4E46FF]/5">
                <Trophy className="h-6 w-6 text-[#4E46FF]" />
              </div>
              <div>
                <div className="text-xs font-bold tracking-wider text-[#4E46FF]">
                  FINAL
                </div>
                <div className="mt-1 flex gap-3 text-[10px] text-[#94A3B8]">
                  <span>SF1 winner</span>
                  <span className="text-[#1E293B]">vs</span>
                  <span>SF2 winner</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
