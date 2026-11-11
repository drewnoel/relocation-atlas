---
name: relocation-atlas
description: Agentic relocation research. Interviews the person (quick, standard, detailed, or a consented sweep of their own context), turns commute and budget trade-offs into 2–3 ranked places to live, researches every layer that matters to them around the chosen base (daily essentials, weekly explorations, career, culture), validates it, and builds a portable map bundle with Top 10 daily spots, Top 10 weekly explorations and route flythroughs. Use when someone is moving, comparing neighborhoods, or says "help me figure out where to live in <city>".
---

# Relocation Atlas

You are running a research loop that ends in a durable asset: a **bundle** (one JSON file) the person can open in
the viewer, re-open next month, export to Google Earth (KML) or Google My Maps (CSV), and keep extending.

Tool: `python3 tools/atlas.py` (stdlib only), run from the root of the relocation-atlas clone. City folder: `cities/<slug>/` (copy `cities/nyc-demo` to see a finished one).
References: `references/intake.md` · `references/layers.md` · `references/research-brief.md` · `references/schema.md` ·
`references/method.md` · `references/privacy-and-terms.md`. Read the one you need when you reach that step, not all up front.

## The loop (goal → perceive → plan → act → verify → repeat; the person decides at the ★ gates)

**0. Goal.** State it back in one line: "Find you 2–3 places to live in <city> that fit <budget> and your week, then
build your daily and weekly map around the one you pick." Create `cities/<slug>/` with `atlas.py new`.

**1. Intake ★** (`references/intake.md`). Offer four ways in and let the person choose:
   - **Quick (≈2 min):** city, budget, where you'll work and how often, three things you do every week.
   - **Standard (≈5 min):** adds household, commute tolerance, value of an hour, interests by weight.
   - **Detailed (≈10 min):** adds non-negotiables, deal-breakers, a typical week hour by hour, people you'll visit.
   - **Context sweep (with permission):** read what the person already has (calendar via connector, a notes
     folder, an exported saved-places list, a résumé) to draft the profile, then show the draft for corrections.
     Ask before reading each source, read only what they point you to, and keep everything local. Never scrape
     a site or log in on their behalf (`references/privacy-and-terms.md`).
   Write `profile.json` (anchors with lat/lon and visits per week, interests 0–1, budget, value of time,
   `exclude_terms` for anything they never want on the map). Confirm it in one short table.

**2. Perceive the city.** Set `detail_bbox` to the core area that holds the likely neighborhoods and the anchors,
   `bounds` to the metro. Run `atlas.py osm-fetch` once (polite, cached; never per visitor). Geocode anchors.

**3. Hypothesize options.** Propose 4–6 candidate neighborhoods from the anchors (short commutes first, then
   cheaper rings one transit line out). For each, research a one-bedroom (or the household's size) rent range
   from at least two current sources and write it to `options.json` with the sources. Run `atlas.py options`.
   It ranks on **all-in monthly cost** = rent + value of time spent getting around + transit pass.

**4. Choose a base ★.** Show the top 3 as a compact table (all-in cost, rent, hours a week getting around,
   the trade-off sentence) plus one hypothetical each: "if you went in 2 days instead of 4", "if your budget
   rose $300", "if the gym moved near home". Re-run `options` for any hypothetical they want to see. The person
   picks one, or keeps all three in the bundle (the viewer switches between them).

**5. Research layers around the base** (`references/layers.md`, `references/research-brief.md`). Pick the layers
   that match the profile's interests (daily: coffee, groceries, gym, transit, cowork, health, services, outdoors;
   weekly: music, food, culture, views, nightlife or zero-proof, career, community). Run research in parallel
   subagents, one per layer group, each writing `layers/<topic>.csv` in the schema with a source and a confidence
   for every row. Prefer linking a well-maintained public guide over copying it; put those in `city.json` guides.

**6. Verify.** `atlas.py validate` must report 0 errors: required fields, inside the city bounds, known confidence,
   no duplicates, no excluded terms. Then spot-check: anything a source marks closed is dropped; anything older than
   about 18 months without a fresh source is `verify`. Fix and re-run until clean.

**7. Build and read the gaps.** `atlas.py build cities/<slug> --out app/data/<slug>/bundle.json`. Each option carries
   `top_daily`, `top_weekly` and `gaps` (must-have daily categories with nothing within 20 minutes on foot).
   **Loop:** if the chosen base has gaps, go back to step 5 for just those layers around that base. Stop when the
   chosen base has no gaps in categories weighted 0.5 or higher, or after two passes (then report what's thin).

**8. Taste pass ★.** Show the Top 10 daily and Top 10 weekly lists. Ask: "Anything here you'd never go to, or a
   favorite type of place missing?" Adjust interests or `exclude_terms`, rebuild. Add featured routes
   (`routes.json`) for the 3–5 trips they'll take most, with `@home` as the start.

**9. Deliver.** Serve locally (`python3 -m http.server -d app`) or deploy the `app/` folder to any static host.
   Publishing anywhere public is the person's call: ask first, and remove names, exact home addresses and
   personal notes before any public deploy (`references/privacy-and-terms.md`). Hand over the bundle file
   (`Save bundle` in the viewer) as the asset they keep.

## Rules
- **Nothing outbound without a yes:** no publishing, posting, emailing, booking or applying to listings.
- **Terms of service first.** Official APIs, public pages read normally, or files the person exports. No scraping
  listing sites, no logged-in automation, no bulk downloads. OpenStreetMap: Overpass and Nominatim at build time
  only, 1 request/second for Nominatim, identify the tool, cache everything, keep the ODbL attribution.
- **Every row has a source and a confidence.** Never invent an address, a rent or an opening hour; mark it `verify`.
- **Rents and commute times are estimates.** Say so wherever they appear.
- Keep the person's profile and bundle on their machine unless they choose otherwise.

## Done means
A bundle that validates, 2–3 ranked options with a stated trade-off each, a chosen base with no must-have gaps
(or a named list of thin spots), Top 10 daily and weekly lists the person has reviewed, and routes for their most
frequent trips. Report in five lines: the pick and why, the runner-up and what would flip it, the gaps, what to
re-check before signing a lease, and where the bundle file lives.
