# Relocation Atlas

**Decide where to live by what your week actually costs, then get a map of your new life you can keep.**

Live demo (fictional persona; real New York places, illustrative rents): **https://relocation-atlas-orpin.vercel.app**

Relocation Atlas is a Claude Code skill plus a small static viewer. You tell it where you're moving, what you can
spend and what your week looks like. It proposes neighborhoods, prices each one as **rent + the value of your time
getting around + transit**, lets you pick a home base, then researches everything that matters to *you* around it:

- **Top 10 daily spots:** coffee, gym, groceries, transit, a place to work, all within a short walk
- **Top 10 weekly explorations:** music, views, food, culture, drinks (or zero-proof), career
- **Every layer on one map**, each with a source and a confidence, plus linked guides for things better kept by their editors
- **Route flythroughs** for the trips you'll make most, at 1–10× speed
- **A bundle file you keep:** reopen it later, export to Google Earth (KML) or Google My Maps (CSV), extend it

## Why another relocation tool
Neighborhood scores (Niche, AreaVibes), listing filters with commute time (Zillow, StreetEasy) and city
comparisons (Nomad List) are useful, and you should use them. What they don't give you is **your** answer in a
form you own: a ranked short list built from your anchors and your budget, a daily and weekly map built around the
place you pick, and a file you can keep working on. That's the gap this fills. It's also open: you can read every
assumption in `tools/atlas.py` and change it.

## Quickstart (about 10 minutes)
```bash
git clone https://github.com/drewnoel/relocation-atlas && cd relocation-atlas
cp -r skills/relocation-atlas ~/.claude/skills/          # install the skill for Claude Code
python3 -m http.server -d app 8000                         # open http://localhost:8000 to see the NYC demo
```
Then open Claude Code **in this cloned folder** (the skill calls `tools/atlas.py` relative to it) and say: **"Help me figure out where to live in Lisbon."** The skill offers a
quick, standard or detailed intake, or (with your permission) a sweep of context you point it to, and runs the loop.

Requirements: Python 3.9+ (standard library only), Claude Code. No API keys.

## How it works
```
intake ★ → profile.json ─┐
OpenStreetMap (build time) ├→ atlas.py options → 2–3 ranked bases ★ → layer research (parallel) → validate
candidate rents ──────────┘                                                    ↑                 │
                                                       research the gaps ←─────┴── build → Top 10s ★ → bundle.json → viewer
```
★ = the points where you decide (profile, which base, taste pass). Everything else the agent does, checks, and
loops on until the base you picked has no gaps in your must-have categories. Details: [docs/AGENTIC.md](docs/AGENTIC.md).

| Command | What it does |
|---|---|
| `atlas.py new cities/lisbon --name Lisbon --bbox S,W,N,E` | scaffold a city |
| `atlas.py osm-fetch cities/lisbon` | streets, parks, rail and stations from OpenStreetMap (once, cached) |
| `atlas.py geocode cities/lisbon` | fill coordinates (Nominatim, 1 request/second, cached) |
| `atlas.py validate cities/lisbon` | required fields, bounds, confidence, duplicates, excluded terms |
| `atlas.py options cities/lisbon` | rank candidate neighborhoods |
| `atlas.py build cities/lisbon --out app/data/lisbon/bundle.json` | the bundle the viewer opens (`?city=lisbon`) |

## Honest limits
- Commute times are estimates (street-graph walking; transit as wait + straight-line ride). Good for comparing
  neighborhoods, not for catching a train. The viewer links to live directions.
- Rents come from whatever the research finds; check live listings before you sign anything.
- Research quality depends on sources. Every row carries a source and a confidence so you can see which is which.
- The demo's Brooklyn option shows a real gap: daily essentials were only researched around the Manhattan options,
  which is exactly what the loop's gap pass is for.

## Privacy
Your profile, research and bundle stay on your machine. The viewer is a static page. Publishing a bundle is your
decision; the skill strips names, exact addresses and personal notes first. See
[privacy-and-terms](skills/relocation-atlas/references/privacy-and-terms.md).

## Credits
Base map © OpenStreetMap contributors, ODbL. Built by Drew Noel with Claude Code. MIT license.
