# Where to get World Cup fixtures & events

Match **IDs stay on the backend** only. The UI shows **team names + date + status**.

## Recommended sources (2026)

| Source | Free? | Fixtures schedule | Live / past events (goals, cards) | Notes |
|--------|-------|-------------------|-----------------------------------|--------|
| **[API-Football](https://www.api-football.com/)** (`v3.football.api-sports.io`) | Free ~100 req/day | ✅ `fixtures?league=1&season=2026` (104 matches) | ✅ `fixtures/events?fixture={id}` | Official guide: [WC 2026 API guide](https://www.api-football.com/news/post/fifa-world-cup-2026-guide-to-using-data-with-api-sports). Header: `x-apisports-key` |
| **[worldcup26.ir](https://worldcup26.ir)** (open source) | Free, no key for public GET | ✅ `/get/games` | Scorers on finished games | [GitHub](https://github.com/rezarahiminia/worldcup2026). Good schedule + demo scores |
| **[Sportmonks](https://www.sportmonks.com/)** | Trial / paid | League **732**, season **26618** | In-play + events | Strong live product |
| **TheSportsDB** | Free key `3` | League **4429** (FIFA World Cup) | Limited event detail | Good for **2022** history: `eventsseason.php?id=4429&s=2022` |
| **openfootball** (GitHub JSON) | Free static files | 2022 full | Goals in JSON | Historical only — not live |

## What this repo uses

| Env | Purpose |
|-----|---------|
| `SPORTS_PROVIDER=worldcup26` (default) | Free WC 2026 schedule + finished match scorers from `worldcup26.ir` |
| `SPORTS_PROVIDER=api-football` + `SPORTS_API_KEY` | Production-grade fixtures/events |
| `SPORTS_PROVIDER=hybrid` | Prefer API-Football when key set, else worldcup26 |

Backend maps:

- Display: `Mexico vs South Africa · Jun 11`
- Internal on-chain `matchId`: numeric fixture id (never shown in UI)

## Past tournaments (history)

- **WC 2022 events:** API-Football `league=1&season=2022` + `fixtures/events`, or TheSportsDB season 2022.
- **WC 2018/2022:** [BALLDONTLIE FIFA](https://fifa.balldontlie.io/) (matches often paid).

## Get keys

1. **API-Football:** https://dashboard.api-football.com/register → dashboard key → `SPORTS_API_KEY=`
2. **Groq (agent LLM):** https://console.groq.com/keys → `GROQ_API_KEY=`

## Example API-Football calls

```bash
# Schedule
curl -H "x-apisports-key: $SPORTS_API_KEY" \
  "https://v3.football.api-sports.io/fixtures?league=1&season=2026"

# Events for one fixture
curl -H "x-apisports-key: $SPORTS_API_KEY" \
  "https://v3.football.api-sports.io/fixtures/events?fixture=1234567"
```

## Example free WC 2026

```bash
curl -s https://worldcup26.ir/get/games | head
curl -s https://worldcup26.ir/get/teams
curl -s https://worldcup26.ir/health
```
