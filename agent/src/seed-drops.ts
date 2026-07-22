/**
 * One-time seed script: creates a drop for every World Cup fixture.
 * Funded from the agent wallet. Run before the demo.
 *
 * Usage: npx tsx src/seed-drops.ts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { tools } from "./tools.js";
import { loadFixtures } from "./fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const PER_WINNER_USDC = "0.02";  // 0.02 USDC per winner per successful analysis
const MAX_WINNERS = 5;            // 5 winners per drop = 0.10 USDC per drop
const EVENT_TYPE = "goal";
const MINUTE_FROM = 1;
const MINUTE_TO = 120;

async function main() {
  const fixtures = await loadFixtures(true);
  const upcoming = fixtures.filter((f) => f.status === "NS" || f.status === "LIVE").slice(0, 3);
  console.log(`Loaded ${fixtures.length} fixtures, seeding ${upcoming.length} upcoming matches`);

  for (const f of upcoming) {
    try {
      const result = await tools.createDrop({
        matchId: f.id,
        eventType: EVENT_TYPE,
        minuteFrom: MINUTE_FROM,
        minuteTo: MINUTE_TO,
        perWinnerAmountUsdc: PER_WINNER_USDC,
        maxWinners: MAX_WINNERS,
      });
      console.log(`  ✅ Drop #${result.dropId} for fixture #${f.id} (${f.label}): ${result.totalFunded}`);
    } catch (e) {
      console.error(`  ❌ Fixture #${f.id} (${f.label}): ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("\nDone. Drops ready for demo.");
}

main().catch(console.error);
