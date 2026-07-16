import type { Fixture } from "./types.js";

/**
 * Stage rank: Final first → group stage last (descending UX).
 * Higher = shown higher in the list.
 */
function stageRank(f: Fixture): number {
  const s = (f.stage || f.group || "").toLowerCase();
  if (s === "final" || s.includes("final") && !s.includes("semi") && !s.includes("quarter")) {
    if (s === "final" || s === "finals") return 1000;
  }
  if (s === "third" || s === "3rd" || s.includes("third")) return 900;
  if (s === "sf" || s.includes("semi")) return 800;
  if (s === "qf" || s.includes("quarter")) return 700;
  if (s === "r16" || s.includes("round of 16") || s.includes("1/8")) return 600;
  if (s === "r32" || s.includes("round of 32") || s.includes("1/16")) return 500;

  // Group stage: matchday 3 before 2 before 1
  // Prefer numeric id 1–72 as progression if stage is group
  if (s === "group" || /^[a-l]$/i.test(s) || s.startsWith("group")) {
    const md = parseMatchday(f);
    return 100 + md * 10; // md3=130, md2=120, md1=110
  }

  // API-Football style: "Group Stage - 3", "Round of 16", etc.
  if (s.includes("group stage")) {
    const md = parseMatchday(f) || extractTrailingNumber(s) || 1;
    return 100 + md * 10;
  }
  if (s.includes("round of 32")) return 500;
  if (s.includes("round of 16")) return 600;
  if (s.includes("quarter")) return 700;
  if (s.includes("semi")) return 800;
  if (s.includes("3rd") || s.includes("third")) return 900;
  if (s.includes("final")) return 1000;

  return 50;
}

function parseMatchday(f: Fixture): number {
  // worldcup26 puts matchday in group field sometimes as "1" for group — use id ranges
  // ids 1-24 ≈ md1, 25-48 md2, 49-72 md3 for 72 group games
  if (f.stage === "group" || f.stage === "group") {
    const id = f.matchId;
    if (id >= 1 && id <= 24) return 1;
    if (id >= 25 && id <= 48) return 2;
    if (id >= 49 && id <= 72) return 3;
  }
  const g = String(f.group || "");
  const m = g.match(/(\d+)/);
  if (m && Number(m[1]) <= 3) return Number(m[1]);
  return extractTrailingNumber(f.stage || "") || 1;
}

function extractTrailingNumber(s: string): number | null {
  const m = s.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

function kickoffTs(f: Fixture): number {
  if (!f.kickoffUtc) return 0;
  // worldcup26: "06/13/2026 21:00" or ISO
  const iso = Date.parse(f.kickoffUtc);
  if (!Number.isNaN(iso)) return iso;
  const m = f.kickoffUtc.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/
  );
  if (m) {
    return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5]);
  }
  return 0;
}

/** Final → … → Group Stage Matchday 1 (descending tournament order) */
export function sortFixturesTournamentDesc(fixtures: Fixture[]): Fixture[] {
  return [...fixtures].sort((a, b) => {
    const ra = stageRank(a);
    const rb = stageRank(b);
    if (rb !== ra) return rb - ra;
    // Within same stage: later matches first (desc id / date)
    if (b.matchId !== a.matchId) return b.matchId - a.matchId;
    return kickoffTs(b) - kickoffTs(a);
  });
}
