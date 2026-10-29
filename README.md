# SAWAH | سواح — Riyadh demo (real data)

The existing SAWAH demo (same UI, branding, components, animations and map style), now driven by the final Riyadh datasets (v1.10). Riyadh only.

## Run locally
```bash
node build.mjs            # reads ./data/*.csv  →  dist/index.html (+ dist/data.json, dist/data-report.json)
node tests/scenarios.mjs  # planner scenario tests A–E (exit code 1 on any failed check)
npx serve dist            # or just open dist/index.html in a browser
```
Needs Node 18+. No npm dependencies.

## Project layout
| Path | What it is |
|---|---|
| `data/` | The CSV files (source of truth) + `coordinate_overrides.csv` |
| `src/app.html` | The app (UI, map, planner questions, sheets). Has `/*__DATA__*/` and `/*__PLANNER__*/` markers |
| `src/planner.js` | Planning logic (pure JS, shared by the app and the tests) |
| `src/images.json` | Illustration images (Riyadh landmarks only) |
| `build.mjs` | CSV → data model → one self-contained `dist/index.html` |
| `tests/scenarios.mjs` | Scenario tests; last output in `tests/scenario_report.txt` |
| `vercel.json` | Vercel build settings |

## How the data files are loaded
`build.mjs` parses the CSVs at build time (nothing is hand-copied) and embeds the result in the page:

| File | Role in the app |
|---|---|
| `sawah_main_places_FINAL_v1.10.csv` | Explore (main discovery), place details, personalised ranking |
| `sawah_itinerary_eligible_FINAL_v1.10.csv` | If present, decides which places can be scheduled. If absent, the `itinerary_eligible` column of the main file is used (same 79 records) |
| `sawah_map_places_FINAL_v1.10.csv` | Map + "Nearby" (1,632 supporting places). Never scheduled as stops |
| `sawah_branch_locations_FINAL_v1.10.csv` | Branch coordinates, hours, booking per branch |
| `sawah_access_points_FINAL_v1.10.csv` | Access points for linear places (Sports Boulevard, Wadi Hanifa, Wadi Namar, Red Sands) |
| `sawah_hotels_FINAL_v1.10.csv` | Hotel anchors (tier: budget / mid-range / luxury) |
| `coordinate_overrides.csv` | Coordinates found for a branch that only had a Google place id (SASANI – Hittin, from its Michelin Guide page) |
| `place_notes.csv` | Notes written by the SAWAH team for a place: a custom booking-button label, an optional-extras note and an extra link (e.g. Red Sands: optional guided tour, quad bikes and their location), and `best_time` (`sunset`: the planner schedules the visit to arrive 30–90 min before sunset, e.g. Edge of the World) |

`dist/data-report.json` lists anything the build could not resolve. Currently: Bayt Al-Malaz (As Sahafah) and PUBLIC (Al Dhabab) have no static coordinates (only a Google place id). They stay in the data; the app shows "opens in Google Maps" for them and the planner prefers branches with known locations.

To update data: replace the CSVs in `data/`, run `node build.mjs`, redeploy.

## Recommendation / planning (src/planner.js)
Deterministic, no prewritten trips. For each day the planner fills: breakfast → morning activity → lunch → afternoon activity → optional evening activity (only if it matches an interest) → dinner. Only the meals the user picks in the planner (breakfast / lunch / dinner) are added. Each candidate is scored:

- **Interests** vs `interest_tags` (+3 per matched interest; free-text "other" interest searched in names, tags and descriptions)
- **Budget is a hard limit**: daily cap per person (Budget 150, Mid 450, Luxury no cap, or the custom amount) is never exceeded. Meals come before paid sightseeing; if a meal cannot fit, it is left out and the day shows why (remaining budget vs. cheapest open option). With a set amount or the Budget level, places with variable/unknown prices are not scheduled because the limit could not be guaranteed. Fewer stops is preferred over going over budget
- **Tier fit** with `budget_tier_display`; luxury tag rewarded only for high budgets
- **Opening hours** for the actual date (start date + day). Places are only scheduled when open for the whole visit; seasonal periods, "last order/entry" and Summer/Winter schedules are respected. Unknown/dynamic hours get a conservative window and a visible note
- **Operating status, data status** (`complete` rewarded, `needs_verification` penalised)
- **Distance / route**: travel time = city driving for the first 25 km, highway speed beyond; penalty per km from the previous stop (hotel when there is one); far day-trips only when an interest matches
- **Diversity**: penalty for repeating the same category in a day / trip
- **Group**: family-tagged places rewarded for families; venue restrictions (e.g. no under-15s, dinner 12+) excluded for families
- **Visit duration** from `estimated_visit_duration_min`

Costs: per person × people. `is_free`/`cost_type=free` → free. `time_dependent` (At-Turaif, Bujairi) → 0 before 17:00, 50 after. `cost_dynamic` (cinemas, zoo) → "price varies", not added to the total and counted separately. Malls/markets where browsing is the experience → "free to browse"; optional spending (`optional_spend_available`) is never added. Magic Planet is paid (`experience_cost_required=yes`). Hotels are anchors: their price is dynamic and never added.

Hotel anchor: chosen from the hotel tier that matches the plan (Budget or a set amount up to SAR 250 → budget hotels; up to 600 or Mid → mid-range; Luxury → luxury), never a pricier tier, nearest to the places that fit the user's interests.

## Google Maps links
"Open in Google Maps" (places, branches, nearby places) opens the place's official Google listing by name, so users see its photos and reviews there. When the data has a Google place id (`routing_provider_place_id`) the exact listing is used; otherwise the name is searched around the place's coordinates so the right branch comes up. Adding a Google place id column for every place would make every link exact. Google photos are not shown inside SAWAH (that would need the paid Google Places API).

## Multi-branch routing
Records with the same `brand_group_id` become one brand (shared menu, cost, cuisine, tags). The planner schedules the brand, then picks the branch that is open at the visit time and minimises distance from the previous stop **and** to the next stop (second pass after the day is built). Branches without coordinates are used only if no located branch is open. Linear destinations use the nearest valid access point the same way (Sands Sports Park segment only for adventure interest).

## Trip questions
The app opens on Explore. The planner asks: days, people, trip type (solo / family / friends — several allowed), start date, spending level (Budget / Mid / Luxury — several allowed; a typed amount is used on its own), hotel yes/no, meals (breakfast / lunch / dinner), interests. With several levels the daily cap is the highest chosen level and preferred price tiers span all chosen levels; the hotel follows the lowest chosen level. After a plan is saved the planner returns to the first question. There is no separate preference profile.

## Map
Real coordinates. Every place from the map dataset is shown with the same pin as SAWAH places (they are never added to plans); short names appear under pins and a name is hidden only where it would overlap another. "My location" uses the device GPS; if it is not available (e.g. blocked inside an embedded viewer) the user taps the map to set it. The three nearest places are then listed with distances.

## Deploy / redeploy (Vercel)
1. Push this folder to a GitHub repository.
2. In Vercel: **Add New → Project → Import** the repo. Settings come from `vercel.json` (build `node build.mjs`, output `dist`).
3. Every push redeploys. Or from a terminal: `npx vercel --prod`.

Any static host works too: upload `dist/index.html` (Netlify drop, GitHub Pages).
