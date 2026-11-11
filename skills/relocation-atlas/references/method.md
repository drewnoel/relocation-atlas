# Method

## Commute model (tools/atlas.py `plan_trip`)
- Walk: shortest path on the OpenStreetMap street graph at 80 m/min.
- If the walk is over 1.8 km and the city has stations: walk to the nearest station, ride (straight line × 1.2 at
  the city's `speed_m_per_min`, plus `wait_min`), walk from the station nearest the destination. Keep whichever is faster.
- It is an estimate meant for ranking neighborhoods against each other. For the real trip, the viewer links to
  live directions.

## Ranking options
`all-in monthly = rent midpoint + (weekly minutes getting around × 52 / 12 / 60 × value of an hour) + transit pass if any trip uses transit`.
Options with even the low end of rent over budget sort last. A rent midpoint over budget is flagged "stretch".

## Top 10s
- Daily: interest weight × confidence × e^(−walk minutes / 12), only places within 20 minutes on foot,
  at most two per tag. Categories weighted ≥ 0.5 with nothing in reach become `gaps`, and the loop researches them.
- Weekly: interest weight × confidence × rank bonus × e^(−travel minutes / 40), at most two per layer.

## Hypotheticals
Edit a copy of profile.json or options.json (fewer office days, higher budget, a different anchor) and re-run
`atlas.py options`. Show the person the before/after table, not the raw output.
