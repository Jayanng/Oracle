import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function shortAddr(addr?: string | null) {
  if (!addr) return "—";
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function eventIcon(eventType: string) {
  const t = (eventType || "").toLowerCase();
  if (t.includes("goal")) return "⚽";
  if (t.includes("card") && t.includes("red")) return "🟥";
  if (t.includes("card")) return "🟨";
  if (t.includes("final") || t.includes("ft")) return "🏁";
  if (t.includes("kick")) return "▶️";
  if (t.includes("sub")) return "🔄";
  if (t.includes("var")) return "📺";
  return "📌";
}

/** Parse score from oracle details JSON blob. */
export function parseScore(details: string): {
  home?: number;
  away?: number;
} {
  if (!details) return {};
  try {
    const j = JSON.parse(details) as Record<string, unknown>;
    if (typeof j.home === "number" && typeof j.away === "number") {
      return { home: j.home, away: j.away };
    }
    if (typeof j.score === "string") {
      const m = j.score.match(/(\d+)\s*[-:]\s*(\d+)/);
      if (m) return { home: Number(m[1]), away: Number(m[2]) };
    }
    if (typeof j.scoreHome === "number" && typeof j.scoreAway === "number") {
      return { home: j.scoreHome, away: j.scoreAway };
    }
  } catch {
    const m = details.match(/(\d+)\s*[-:]\s*(\d+)/);
    if (m) return { home: Number(m[1]), away: Number(m[2]) };
  }
  return {};
}
