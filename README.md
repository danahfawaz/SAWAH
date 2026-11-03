# SAWAH | سواح — Riyadh Tourism Dataset

The Riyadh tourism dataset prepared by the SAWAH team for **SAWAH – Smart Tourism Guide for Saudi Arabia** (graduation project). It supports personalized recommendations and trip planning.

**Version:** v1.10 (October 2026) · **City:** Riyadh

## Dataset at a glance

| Item | Value |
|---|---|
| All places in Riyadh | 1,977 |
| Main destinations (curated for trip planning) | 85, in 19 categories |
| Map and nearby places (restaurants, cafés, services, transport) | 1,716 |
| Hotels | 9 |
| Coverage | Riyadh and Diriyah governorates, plus selected day-trip destinations in the Riyadh Region |

## Files (`data/`)

| File | Content |
|---|---|
| `sawah_places_master_FINAL_v1.10.csv` | All places, one row per place |
| `sawah_main_places_FINAL_v1.10.csv` | The 85 main destinations used for recommendations and trip plans |
| `sawah_map_places_FINAL_v1.10.csv` | Places for the map and "nearby" suggestions |
| `sawah_hotels_FINAL_v1.10.csv` | Hotels with price tier (budget / mid-range / luxury) |
| `sawah_branch_locations_FINAL_v1.10.csv` | Branch locations for places with more than one branch |
| `sawah_access_points_FINAL_v1.10.csv` | Entry points for long places (e.g. Wadi Hanifa, Sports Boulevard) |
| `coordinate_overrides.csv`, `place_notes.csv` | Small fixes and notes added by the team |

## Main fields

| Group | Examples |
|---|---|
| Identity | `poi_id`, `name_ar`, `name_en`, `category`, `interest_tags` |
| Location | `latitude`, `longitude`, `address_ar`, `address_en` |
| Planning | `opening_hours`, `estimated_visit_duration_min`, `estimated_cost_sar`, `budget_tier_display` |
| Quality | `data_status`, `missing_fields`, `last_verified` |
| Source | `source_names`, `source_urls`, `license_status` |

Unknown values are marked as unknown, never guessed. Every place keeps its source and verification date in its own row.

## What we took from other sources

| Source | License | What we took |
|---|---|---|
| OpenStreetMap — © OpenStreetMap contributors | ODbL 1.0 | Base list of places (1,928 of 1,977), coordinates, many Arabic/English names, categories, addresses and districts. Used for 45 of the 85 main destinations |
| Wikidata | CC0 | Wikidata IDs, some names, short descriptions and official websites (126 places) |
| Audiala Places — Data by Audiala (audiala.com) | CC BY 4.0 | Wikidata IDs, English names and a few extra places (20 places) |
| Official websites and guides (e.g. Visit Saudi, MICHELIN Guide, venue websites) | Their own terms | Facts only, checked by hand (names, opening hours, prices, addresses); no text copied |
| Public business listings (e.g. Restaurant Guru, Yandex Maps) | Their own terms | A few facts checked by hand for single places; no bulk download |

No data was downloaded or stored in bulk from Google Maps / Google Places.

## What the SAWAH team collected by hand

| Work | Details |
|---|---|
| Selection of main destinations | The 85 main destinations were chosen and researched by the team; 40 of them do not come from OpenStreetMap at all |
| Opening hours and prices | Collected by the team from official pages, menus and venue information for the main destinations (none taken from OpenStreetMap) |
| Descriptions | Short English summaries written by the team from checked facts, with Arabic versions |
| Planning fields | Visit duration rules, categories, interest tags, budget tiers, hotel tiers, booking notes and planner notes |
| Locations | Branch locations, entry points for long places (e.g. Wadi Hanifa) and coordinate fixes |
| Quality work | Removing duplicates, marking unknown values, and checking every main destination by hand |

## Copyright and use

© 2026 SAWAH team. All rights reserved.

The selection of main destinations, the data collected by hand, the added fields, the descriptions and the notes in this dataset are the work of the SAWAH team. This dataset is shared only for the academic evaluation of the SAWAH graduation project. It may not be copied, shared, published or used, in whole or in part, without written permission from the SAWAH team.

Data from the sources above remains under their own licenses: OpenStreetMap data under the ODbL 1.0 (© OpenStreetMap contributors, openstreetmap.org/copyright), Audiala data under CC BY 4.0, and Wikidata under CC0.

## Concept preview

An early web preview used to test the data is available at https://sawah-teal.vercel.app/. It is a concept only, not the final SAWAH application, which is still under development.
