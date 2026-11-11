# What "agentic" means here

The bar: **the agent states a goal, perceives real data through tools, plans, acts, verifies its own output, and
loops until a stop condition. A person decides only at points of taste or judgment, and before anything
outbound or irreversible.**

| Requirement | Where it happens |
|---|---|
| Goal | Step 0 states it back to the person in one line |
| Perceive through tools | OpenStreetMap via `osm-fetch`, geocoding, web research subagents, consented context sweep through connectors or exports |
| Plan | Candidate neighborhoods from anchors; layer plan from weighted interests |
| Act | Writes `options.json`, `layers/*.csv`, `routes.json`; builds the bundle |
| Verify | `atlas.py validate` (required fields incl. a source per row, bounds, confidence, duplicates, excluded terms, rent sources) and `gaps` per base are enforced by code. Closure and staleness checks are instructions to the agent, and confidence is the researcher's own grade, so spot-check before you rely on a row. |
| Loop + stop condition | Re-research gaps around the chosen base until none remain in must-have categories (computed by `build`), or two passes (counted by the agent), then report what's thin |
| Human gates (taste/judgment) | Intake, choosing the base, the Top 10 taste pass |
| Human gates (outbound) | Any public deploy, anything that contacts a landlord, agent or listing |

What it does not do on its own: sign up for anything, contact anyone, publish, or read a source the person didn't name.
