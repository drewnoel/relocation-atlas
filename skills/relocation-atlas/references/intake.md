# Intake

Offer the four depths in one message and let the person pick. Ask in small batches (3–5 questions), never a wall.

## Quick (about 2 minutes)
1. Which city, and roughly when?
2. Monthly rent budget (and for how many bedrooms)?
3. Where will you work, and how many days a week in person?
4. Three things you do every week (gym, a run route, a friend's place, a class, kids' school...).

## Standard (about 5 minutes): Quick, plus
5. Who's moving with you?
6. Longest commute you'd accept, door to door?
7. What's an hour of your time worth to you? (Default: your hourly pay. It turns commute time into dollars.)
8. Rate these 0–3: coffee, gym, running/cycling, parks, groceries quality, coworking, live music, dancing,
   cocktails or zero-proof, food, museums and culture, nightlife, career events, community/faith, kids' activities.

## Detailed (about 10 minutes): Standard, plus
9. Non-negotiables (laundry in unit, elevator, pets, quiet street...).
10. Deal-breakers (anything you never want on your map: `exclude_terms`).
11. Walk me through a typical week, day by day.
12. People you'll visit often, and roughly where.

## Context sweep (with permission)
Draft the profile from what the person already has, then show the draft for corrections. Ask before each source:
- **Calendar** (via an official connector): recurring events reveal weekly anchors and how often they happen.
- **A notes or documents folder they name**: interests, routines, places they mention.
- **An exported saved-places list** (Google Takeout, Apple Maps export, a CSV): places they already like.
- **A résumé or LinkedIn data export** (their own download): industry, for the career layer.
Read only what they point to, keep it local, quote nothing back into the bundle except what they approve.
Never log in as them, scrape a site, or read a source they didn't name.

## Write profile.json
```json
{"persona": "...", "household": "...", "budget_monthly_rent": 3200, "value_of_time_per_hour": 40,
 "anchors": [{"id": "office", "name": "Office", "lat": 0, "lon": 0, "per_week": 3}],
 "interests": {"coffee": 1.0, "fitness": 0.8},
 "exclude_terms": []}
```
Interest tags must match the `tag` column used in the layers (see layers.md). Ratings 0–3 map to 0, 0.4, 0.7, 1.0.
