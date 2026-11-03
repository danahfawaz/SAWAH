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
| Coverage | Riyadh and Ad Diriyah governorates, plus selected day-trip destinations in the Riyadh Region |

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

Unknown values are marked as unknown, never guessed. Every place keeps its source and verification date.

## Sources and licenses

| Source | License |
|---|---|
| OpenStreetMap | ODbL 1.0 — © OpenStreetMap contributors |
| Audiala Places | CC BY 4.0 — Data by Audiala (audiala.com) |
| Wikidata | CC0 |
| Official websites (e.g. Visit Saudi) | Facts checked by hand; no text copied |

Google Maps / Google Places content is not stored in this dataset. Because the dataset is built from OpenStreetMap, it is shared under the ODbL with the attributions above.

## Concept preview

An early web preview used to test the data is available at https://sawah-teal.vercel.app/. It is a concept only, not the final SAWAH application, which is still under development.
