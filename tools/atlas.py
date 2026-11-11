#!/usr/bin/env python3
"""Relocation Atlas build tool (stdlib only, Python 3.9+).

One city lives in one folder (see cities/nyc-demo):
  city.json      projection, bounds, colors, linked guides
  profile.json   who is moving: budget, value of time, weekly anchors, interests
  options.json   candidate neighborhoods with rent ranges
  routes.json    optional featured routes ('@home' = each option's location)
  layers/*.csv   researched places (schema in skills/relocation-atlas/references/schema.md)
  osm/*.json     OpenStreetMap extracts (fetched once, at build time, never per visitor)

Commands:
  atlas.py new <dir> --name "Lisbon" --bbox S,W,N,E      scaffold a city folder
  atlas.py osm-fetch <dir>                                 fetch streets/parks/rail/stations from Overpass (polite, cached)
  atlas.py geocode <dir>                                   fill missing lat/lon via Nominatim (1 req/s, cached)
  atlas.py validate <dir>                                  check layers, bounds, confidence, duplicates, excluded terms
  atlas.py options <dir>                                   rank candidate neighborhoods on rent + commute time
  atlas.py build <dir> [--out bundle.json]                 everything above into one portable bundle for the app
  atlas.py export <dir> --option <id> [--out-dir DIR]      KML (Google Earth) + My Maps CSV for one option
"""
import argparse, csv, glob, heapq, json, math, os, sys, time, urllib.parse, urllib.request
from xml.sax.saxutils import escape

UA = "relocation-atlas/0.1 (+https://github.com/drewnoel/relocation-atlas)"
CONFIDENCE = {"verified": 1.0, "verified-2026": 1.0, "verified-open-2026": 1.0, "listed": 0.8, "likely": 0.8, "verify": 0.5, "unverified": 0.4}
COLUMNS = ["name", "address", "layer", "kind", "tag", "label", "lat", "lon", "hours", "note", "source", "confidence", "rank"]
WALK_MAX_M = 1800          # longer than this, the planner tries transit
PACE = {"walk": 80, "highline": 65, "greenway": 160, "hop": 80}   # meters per minute (greenway = easy run)


# ---------------------------------------------------------------- io
def jload(p, default=None):
    if not os.path.exists(p):
        if default is not None: return default
        sys.exit(f"missing {p}")
    with open(p) as f: return json.load(f)

def load_city(d):
    c = jload(os.path.join(d, "city.json"))
    c["_dir"] = d
    return c

def load_places(d):
    rows = []
    for f in sorted(glob.glob(os.path.join(d, "layers", "*.csv"))):
        with open(f, newline="") as fh:
            for i, r in enumerate(csv.DictReader(fh)):
                r = {k: (v or "").strip() for k, v in r.items() if k}
                r["_file"] = f"{os.path.basename(f)}:{i + 2}"
                rows.append(r)
    return rows


# ---------------------------------------------------------------- projection (1 unit = 4 m, north-up, origin = NW corner)
class Proj:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = math.cos(math.radians(lat0)) * 111320 / 4
        self.ky = 110540 / 4
    def __call__(self, lat, lon):
        return round((lon - self.lon0) * self.kx, 1), round((self.lat0 - lat) * self.ky, 1)

def meters_ll(a, b):
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * k)


# ---------------------------------------------------------------- street graph
class Streets:
    WALKABLE = {"residential", "secondary", "primary", "tertiary", "unclassified", "pedestrian", "living_street", "footway", "path"}
    def __init__(self, city, proj):
        self.proj, d = proj, city["_dir"]
        self.detail = jload(os.path.join(d, "osm", "streets-detail.json"), {"elements": []})["elements"]
        self.wide = jload(os.path.join(d, "osm", "streets-wide.json"), {"elements": []})["elements"]
        st = jload(os.path.join(d, "osm", "stations.json"), {"elements": []})["elements"]
        self.stations = [(e.get("tags", {}).get("name", "Station"), e["lat"], e["lon"]) for e in st if "lat" in e]
        special = city.get("special_paths", {})
        by_name = {v: k for k, v in special.items()}
        self.g = {"walk": {}}; self.g.update({k: {} for k in special}); self.node = {}
        ends = {k: set() for k in special}
        for e in self.detail + self.wide:
            t, ns, gs = e.get("tags", {}), e.get("nodes"), e.get("geometry")
            if not ns or not gs or len(ns) != len(gs): continue
            if t.get("name") in by_name:
                g = by_name[t["name"]]; ends[g] |= {ns[0], ns[-1]}
            elif t.get("highway") in self.WALKABLE: g = "walk"
            else: continue
            for a, b, qa, qb in zip(ns, ns[1:], gs, gs[1:]):
                self.node[a] = (qa["lat"], qa["lon"]); self.node[b] = (qb["lat"], qb["lon"])
                w = meters_ll(self.node[a], self.node[b])
                self.g[g].setdefault(a, []).append((b, w)); self.g[g].setdefault(b, []).append((a, w))
        for g, es in ends.items():       # OSM splits named paths into pieces: stitch ends within 40 m
            for a in es:
                for b in list(self.g[g]):
                    if b != a and meters_ll(self.node[a], self.node[b]) < 40:
                        w = meters_ll(self.node[a], self.node[b]); self.g[g][a].append((b, w)); self.g[g][b].append((a, w))
        self.main = {g: self._biggest(g) for g in self.g}

    def _biggest(self, g):
        seen, best = set(), set()
        for n in self.g[g]:
            if n in seen: continue
            comp, stack = set(), [n]
            while stack:
                u = stack.pop()
                if u in comp: continue
                comp.add(u); stack.extend(v for v, _ in self.g[g][u])
            seen |= comp
            if len(comp) > len(best): best = comp
        return best

    def nearest(self, g, ll):
        if not self.main.get(g): return None
        n = min(self.main[g], key=lambda n: (self.node[n][0] - ll[0]) ** 2 + ((self.node[n][1] - ll[1]) * math.cos(math.radians(ll[0]))) ** 2)
        return n if meters_ll(self.node[n], ll) < 400 else None

    def path(self, g, a, b):
        """Shortest path on graph g; falls back to a straight line when either end is off the network."""
        s, t = self.nearest(g, a), self.nearest(g, b)
        if s is None or t is None: return [list(a), list(b)], False
        dist, prev, pq = {s: 0}, {}, [(0, s)]
        while pq:
            dd, u = heapq.heappop(pq)
            if u == t: break
            if dd > dist[u]: continue
            for v, w in self.g[g][u]:
                if dd + w < dist.get(v, 1e18): dist[v] = dd + w; prev[v] = u; heapq.heappush(pq, (dd + w, v))
        if t not in dist: return [list(a), list(b)], False
        out = [t]
        while out[-1] != s: out.append(prev[out[-1]])
        return [list(a)] + [list(self.node[n]) for n in reversed(out)] + [list(b)], True

    def nearest_station(self, ll):
        if not self.stations: return None
        return min(self.stations, key=lambda s: meters_ll((s[1], s[2]), ll))


def path_m(pts): return sum(meters_ll(a, b) for a, b in zip(pts, pts[1:]))


# ---------------------------------------------------------------- trip planner (walk, or walk + transit + walk)
def plan_trip(S, city, a, b, label_to=""):
    tr = city.get("transit", {})
    walk_pts, ok = S.path("walk", a, b)
    walk_m = path_m(walk_pts) if ok else meters_ll(a, b) * 1.3
    legs_walk = [{"mode": "walk", "label": f"Walk to {label_to}".strip(), "ll": walk_pts, "meters": round(walk_m), "min": max(1, round(walk_m / PACE["walk"]))}]
    if walk_m <= WALK_MAX_M or not S.stations:
        return legs_walk
    s1, s2 = S.nearest_station(a), S.nearest_station(b)
    if not s1 or s1 == s2 or meters_ll((s1[1], s1[2]), a) > tr.get("station_max_walk_m", 1200):
        return legs_walk
    p1, ok1 = S.path("walk", a, (s1[1], s1[2])); p2, ok2 = S.path("walk", (s2[1], s2[2]), b)
    m1 = path_m(p1) * (1 if ok1 else 1.3); m2 = path_m(p2) * (1 if ok2 else 1.3)
    ride = meters_ll((s1[1], s1[2]), (s2[1], s2[2])) * 1.2
    ride_min = round(tr.get("wait_min", 4) + ride / tr.get("speed_m_per_min", 500))
    total_transit = m1 / PACE["walk"] + ride_min + m2 / PACE["walk"]
    if total_transit >= walk_m / PACE["walk"]:
        return legs_walk
    return [
        {"mode": "walk", "label": f"Walk to {s1[0]}", "ll": p1, "meters": round(m1), "min": max(1, round(m1 / PACE["walk"]))},
        {"mode": "subway", "line": tr.get("label", "Transit"), "color": tr.get("color", "#0039A6"), "label": f"{tr.get('label', 'Transit')} {s1[0]} to {s2[0]} (estimate)",
         "ll": [[s1[1], s1[2]], [s2[1], s2[2]]], "stations": [s1[0], s2[0]], "meters": round(ride), "min": ride_min},
        {"mode": "walk", "label": f"Walk to {label_to}".strip(), "ll": p2, "meters": round(m2), "min": max(1, round(m2 / PACE["walk"]))},
    ]


# ---------------------------------------------------------------- options: rent + commute time, all-in monthly
def score_options(S, city, profile, options):
    tr = city.get("transit", {}); vot = float(profile.get("value_of_time_per_hour", 0)); budget = float(profile.get("budget_monthly_rent", 0))
    out = []
    for o in options["candidates"]:
        home = (o["lat"], o["lon"]); trips = []; weekly = 0; uses_transit = False
        for an in profile.get("anchors", []):
            legs = plan_trip(S, city, home, (an["lat"], an["lon"]), an["name"])
            mins = sum(L["min"] for L in legs); uses_transit |= any(L["mode"] == "subway" for L in legs)
            weekly += 2 * mins * an.get("per_week", 1)
            trips.append({"anchor": an["id"], "name": an["name"], "per_week": an.get("per_week", 1), "min": mins,
                          "mode": "transit" if any(L["mode"] == "subway" for L in legs) else "walk", "legs": legs})
        rent = (o["rent_low"] + o["rent_high"]) / 2
        time_cost = weekly * 52 / 12 / 60 * vot
        transit_cost = tr.get("monthly_pass", 0) if uses_transit else 0
        out.append({**o, "rent_mid": round(rent), "weekly_commute_min": weekly, "monthly_time_cost": round(time_cost),
                    "monthly_transit": transit_cost, "all_in_monthly": round(rent + time_cost + transit_cost),
                    "over_budget": budget > 0 and o["rent_low"] > budget, "stretch": budget > 0 and rent > budget, "trips": trips})
    out.sort(key=lambda r: (r["over_budget"], r["all_in_monthly"]))
    for i, r in enumerate(out):
        r["rank"] = i + 1
        hrs = r["weekly_commute_min"] / 60
        bits = [f"about {hrs:.1f} h a week getting around", f"rent around ${r['rent_mid']:,}"]
        if r["stretch"]: bits.append("a stretch on the stated budget")
        if r["over_budget"]: bits.append("over budget even at the low end")
        r["tradeoff"] = "; ".join(bits) + "."
    return out


# ---------------------------------------------------------------- top 10s
def top_places(places, home, profile, kind, n=10, per_group=3, decay_min=12.0, max_min=None):
    interests = profile.get("interests", {})
    scored = []
    for i, p in enumerate(places):
        if p.get("kind") != kind: continue
        w = interests.get(p.get("tag", ""), 0.3)
        if w <= 0: continue
        m = meters_ll(home, (float(p["lat"]), float(p["lon"]))) * 1.3
        walk_min = m / PACE["walk"]
        travel = walk_min if walk_min <= 22 else 10 + m / 500        # rough transit beyond ~22 min on foot
        rank_bonus = 1.0
        if p.get("rank", "").isdigit(): rank_bonus = 1.25 - min(int(p["rank"]), 50) / 100
        if max_min and travel > max_min: continue
        s = w * CONFIDENCE.get(p.get("confidence", ""), 0.6) * rank_bonus * math.exp(-travel / decay_min)
        scored.append((s, i, round(travel)))
    scored.sort(reverse=True)
    picked, count = [], {}
    group_key = "tag" if kind == "daily" else "layer"
    for s, i, t in scored:
        g = places[i].get(group_key, "")
        if count.get(g, 0) >= per_group: continue
        count[g] = count.get(g, 0) + 1
        picked.append({"i": i, "min": t, "score": round(s, 3)})
        if len(picked) == n: break
    return picked


# ---------------------------------------------------------------- validate
def validate(d, quiet=False):
    city, places = load_city(d), load_places(d)
    profile = jload(os.path.join(d, "profile.json"), {})
    S_, W_, N_, E_ = city["bounds"]; colors = city.get("layer_colors", {})
    terms = [t.lower() for t in profile.get("exclude_terms", []) if t]
    errs, warns, seen = [], [], {}
    for p in places:
        where = p["_file"]
        for c in ("name", "layer", "kind", "tag", "lat", "lon", "confidence", "source"):
            if not p.get(c): errs.append(f"{where}: missing {c}")
        try:
            lat, lon = float(p["lat"]), float(p["lon"])
            if not (S_ <= lat <= N_ and W_ <= lon <= E_): errs.append(f"{where}: {p['name']} is outside the city bounds")
        except ValueError:
            errs.append(f"{where}: bad lat/lon")
        if p.get("kind") not in ("daily", "weekly"): errs.append(f"{where}: kind must be daily or weekly")
        if p.get("confidence") not in CONFIDENCE: warns.append(f"{where}: unknown confidence '{p.get('confidence')}'")
        if p.get("layer") and p["layer"] not in colors: warns.append(f"{where}: layer '{p['layer']}' has no color in city.json")
        key = (p.get("name", "").lower(), p.get("layer"))
        if key in seen: warns.append(f"{where}: duplicate of {seen[key]}")
        seen[key] = where
        blob = " ".join(p.get(c, "") for c in ("name", "label", "note", "address")).lower()
        for t in terms:
            if t in blob: errs.append(f"{where}: matches excluded term '{t}'")
    for o in jload(os.path.join(d, "options.json"), {"candidates": []}).get("candidates", []):
        if not o.get("rent_sources") and not o.get("rent_illustrative"): warns.append(f"options.json: {o.get('id')} has no rent_sources")
    if not quiet:
        for e in errs: print("ERROR", e)
        for w in warns: print("warn ", w)
        print(f"{len(places)} places · {len(errs)} errors · {len(warns)} warnings")
    return errs, warns


# ---------------------------------------------------------------- base map svg paths
def base_svg(S, city, proj):
    S_, W_, N_, E_ = city["detail_bbox"]
    def inbox(q): return S_ <= q["lat"] <= N_ and W_ <= q["lon"] <= E_
    def simplify(pts, tol):
        out = [pts[0]]
        for p in pts[1:-1]:
            if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) >= tol: out.append(p)
        return out + [pts[-1]] if len(pts) > 1 else out
    major, minor, parks = [], [], []
    for e in S.detail:
        g, t = e.get("geometry"), e.get("tags", {})
        if not g: continue
        p = "M" + " ".join(f"{x:g},{y:g}" for x, y in (proj(q["lat"], q["lon"]) for q in g))
        if t.get("leisure") == "park": parks.append(p + "Z")
        elif t.get("highway") in ("primary", "secondary", "trunk"): major.append(p)
        elif t.get("highway"): minor.append(p)
    wmaj, coast, rail, wpark = [], [], [], []
    for e in S.wide:
        g, t = e.get("geometry"), e.get("tags", {})
        if not g: continue
        pts = simplify([proj(q["lat"], q["lon"]) for q in g], 6)
        p = "M" + " ".join(f"{x:.0f},{y:.0f}" for x, y in pts)
        if t.get("natural") == "coastline": coast.append(p)
        elif t.get("railway") in ("subway", "light_rail", "tram", "rail"): rail.append(p)
        elif t.get("leisure") == "park": wpark.append(p + "Z")
        elif t.get("highway") in ("primary", "secondary", "trunk") and not all(inbox(q) for q in g): wmaj.append(p)
    labels = []
    for nm, short, tlat in city.get("street_labels", []):
        nodes = [q for e in S.detail if e.get("tags", {}).get("name") == nm and e.get("geometry") for q in e["geometry"]]
        if not nodes: continue
        q = min(nodes, key=(lambda q: abs(q["lon"] - city.get("label_lon_for_streets", q["lon"]))) if tlat is None else (lambda q: abs(q["lat"] - tlat)))
        x, y = proj(q["lat"], q["lon"]); labels.append({"t": short, "x": x, "y": y})
    W, H = proj(S_, E_)
    return {"under": {"parks": "".join(wpark), "coast": "".join(coast), "major": "".join(wmaj)},
            "detail": {"parks": "".join(parks), "minor": "".join(minor), "major": "".join(major)},
            "rail": "".join(rail), "labels": labels, "detail_wh": [W, H]}


# ---------------------------------------------------------------- build
def project_legs(legs, proj):
    out = []
    for L in legs:
        L = dict(L); L["pts"] = [list(proj(*p)) for p in L.pop("ll")]
        out.append(L)
    return out

def featured_routes(S, city, d, option, proj):
    R = jload(os.path.join(d, "routes.json"), {"routes": []})["routes"]; home = [option["lat"], option["lon"]]; out = []
    for r in R:
        if r.get("options") and option["id"] not in r["options"]: continue
        legs = []
        for L in r["legs"]:
            m = L["mode"]; L = json.loads(json.dumps(L))
            if m == "subway":
                pts = [[s[1], s[2]] for s in L["stops"]]; L["meters"] = round(path_m(pts))
                L["min"] = round(4 + L["meters"] / 500 + 0.5 * (len(pts) - 1)); L["stations"] = [s[0] for s in L["stops"]]
                L["station_pts"] = [list(proj(s[1], s[2])) for s in L["stops"]]; L.pop("stops")
            else:
                a = home if L["from"] == "@home" else L["from"]; b = home if L["to"] == "@home" else L["to"]
                pts = [a, b] if m == "hop" else S.path(m if m in S.g else "walk", a, b)[0]
                L["meters"] = round(path_m(pts)); L["min"] = max(1, round(L["meters"] / PACE.get(m, 80)))
                L.pop("from"); L.pop("to")
            L["ll"] = pts; legs.append(L)
        gm = [home_addr(option) if x == "@home" else x for x in r.get("gm", [])]
        out.append({**{k: v for k, v in r.items() if k not in ("legs", "options", "gm")}, "gm": gm,
                    "legs": project_legs(legs, proj), "total_min": sum(L["min"] for L in legs),
                    "miles": round(sum(L["meters"] for L in legs) / 1609, 1), "kind": "featured"})
    return out

def home_addr(o): return f"{o['lat']},{o['lon']}"

def anchor_routes(trips, option, proj):
    out = []
    for t in trips:
        legs = project_legs(t["legs"], proj)
        for L in legs:
            if L["mode"] == "subway": L["station_pts"] = [L["pts"][0], L["pts"][-1]]
        out.append({"id": f"to-{t['anchor']}", "title": f"To {t['name']}", "when": f"{t['per_week']}× a week", "dest": t["name"],
                    "blurb": f"Estimated door to door from {option['name']}.", "kind": "anchor",
                    "gm": [home_addr(option), f"{t['legs'][-1]['ll'][-1][0]},{t['legs'][-1]['ll'][-1][1]}", "transit" if t["mode"] == "transit" else "walking"],
                    "legs": legs, "total_min": t["min"], "miles": round(sum(L["meters"] for L in t["legs"]) / 1609, 1)})
    return out

def build(d, out_path=None):
    city, profile, options = load_city(d), jload(os.path.join(d, "profile.json")), jload(os.path.join(d, "options.json"))
    errs, _ = validate(d, quiet=True)
    if errs: print("\n".join(errs[:20])); sys.exit(f"validate failed with {len(errs)} errors; fix them first")
    proj = Proj(*city["projection_origin"]); S = Streets(city, proj)
    places = load_places(d)
    for p in places:
        p.pop("_file", None); p["x"], p["y"] = proj(float(p["lat"]), float(p["lon"]))
    ranked = score_options(S, city, profile, options)
    for o in ranked:
        home = (o["lat"], o["lon"]); o["x"], o["y"] = proj(*home)
        o["top_daily"] = top_places(places, home, profile, "daily", per_group=2, decay_min=12, max_min=20)
        near = {p.get("tag") for p in places if p.get("kind") == "daily"
                and meters_ll(home, (float(p["lat"]), float(p["lon"]))) * 1.3 / PACE["walk"] <= 20}
        daily_tags = {"coffee", "fitness", "groceries", "transit", "services", "health", "outdoors", "cowork"}
        o["gaps"] = sorted(t for t, w in profile.get("interests", {}).items() if w >= 0.5 and t in daily_tags and t not in near)
        o["top_weekly"] = top_places(places, home, profile, "weekly", per_group=2, decay_min=40)
        o["routes"] = anchor_routes(o["trips"], o, proj) + featured_routes(S, city, d, o, proj)
        for t in o["trips"]: t.pop("legs")
    an = [dict(a, x=proj(a["lat"], a["lon"])[0], y=proj(a["lat"], a["lon"])[1]) for a in profile.get("anchors", [])]
    bundle = {"version": 1, "generated": time.strftime("%Y-%m-%d"), "city": {k: v for k, v in city.items() if not k.startswith("_")},
              "profile": {k: profile.get(k) for k in ("persona", "household", "budget_monthly_rent", "value_of_time_per_hour", "interests")},
              "anchors": an, "base": base_svg(S, city, proj), "places": places, "options": ranked,
              "attribution": "Base map © OpenStreetMap contributors (ODbL). Place research cites a source per row."}
    out_path = out_path or os.path.join(d, "bundle.json")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w") as f: json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
    print(f"bundle {out_path} · {os.path.getsize(out_path) // 1024} KB · {len(places)} places · {len(ranked)} options")
    for o in ranked:
        print(f"  #{o['rank']} {o['name']}: rent ~${o['rent_mid']:,} · {o['weekly_commute_min']} min/wk · all-in ~${o['all_in_monthly']:,}/mo · {len(o['routes'])} routes")
    return bundle


# ---------------------------------------------------------------- export (KML + My Maps CSV)
def export(d, option_id, out_dir, bundle=None):
    slug = load_city(d)["slug"]
    cands = [bundle] if bundle else [os.path.join(d, "bundle.json"), os.path.join("app", "data", slug, "bundle.json")]
    path = next((c for c in cands if c and os.path.exists(c)), None)
    if not path: sys.exit("no bundle found; run build first or pass --bundle")
    b = jload(path); o = next((x for x in b["options"] if x["id"] == option_id), None)
    if not o: sys.exit(f"no option {option_id}")
    os.makedirs(out_dir, exist_ok=True); P = b["places"]
    keep = {t["i"] for t in o["top_daily"] + o["top_weekly"]}
    with open(os.path.join(out_dir, f"{option_id}-mymaps.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["Name", "Latitude", "Longitude", "Layer", "Description"])
        w.writerow([f"Home base: {o['name']}", o["lat"], o["lon"], "Home base", o.get("vibe", "")])
        for i, p in enumerate(P): w.writerow([p["name"], p["lat"], p["lon"], ("★ " if i in keep else "") + p["layer"], p.get("note", "")])
    k = ['<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>', f"<name>{escape(b['city']['name'])}: {escape(o['name'])}</name>"]
    k.append(f"<Placemark><name>Home base: {escape(o['name'])}</name><Point><coordinates>{o['lon']},{o['lat']},0</coordinates></Point></Placemark>")
    layers = {}
    for p in P: layers.setdefault(p["layer"], []).append(p)
    for lay, ps in layers.items():
        k.append(f"<Folder><name>{escape(lay)}</name>")
        for p in ps: k.append(f"<Placemark><name>{escape(p['name'])}</name><description>{escape(p.get('note', ''))}</description><Point><coordinates>{p['lon']},{p['lat']},0</coordinates></Point></Placemark>")
        k.append("</Folder>")
    k.append("</Document></kml>")
    with open(os.path.join(out_dir, f"{option_id}.kml"), "w") as f: f.write("".join(k))
    print(f"wrote {option_id}.kml + {option_id}-mymaps.csv to {out_dir}")


# ---------------------------------------------------------------- fetchers (build-time only, polite, cached)
def http(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r: return json.loads(r.read().decode())

def osm_fetch(d):
    city = load_city(d); s, w, n, e = city["detail_bbox"]; S2, W2, N2, E2 = city["bounds"]; os.makedirs(os.path.join(d, "osm"), exist_ok=True)
    q = {
        "streets-detail.json": f'[out:json][timeout:120];(way["highway"~"^(primary|secondary|tertiary|residential|unclassified|pedestrian|living_street|trunk|footway)$"]({s},{w},{n},{e});way["leisure"="park"]({s},{w},{n},{e}););out geom;',
        "streets-wide.json": f'[out:json][timeout:180];(way["highway"~"^(primary|trunk|secondary)$"]({S2},{W2},{N2},{E2});way["natural"="coastline"]({S2},{W2},{N2},{E2});way["railway"~"^(subway|light_rail|tram)$"]({S2},{W2},{N2},{E2});way["leisure"="park"]["name"]({S2},{W2},{N2},{E2}););out geom;',
        "stations.json": f'[out:json][timeout:60];(node["railway"="station"]["station"~"^(subway|light_rail)$"]({S2},{W2},{N2},{E2});node["public_transport"="station"]["subway"="yes"]({S2},{W2},{N2},{E2}););out;',
    }
    for fn, query in q.items():
        p = os.path.join(d, "osm", fn)
        if os.path.exists(p): print(f"cached {fn}"); continue
        print(f"fetching {fn} from Overpass ..."); data = http("https://overpass-api.de/api/interpreter", urllib.parse.urlencode({"data": query}).encode())
        with open(p, "w") as f: json.dump(data, f)
        print(f"  {len(data.get('elements', []))} elements"); time.sleep(5)

def geocode(d):
    cache_p = os.path.join(d, "geocache.json"); cache = jload(cache_p, {}); n = 0
    for f in sorted(glob.glob(os.path.join(d, "layers", "*.csv"))):
        with open(f, newline="") as fh: rows = list(csv.DictReader(fh))
        changed = False
        for r in rows:
            if r.get("lat") and r.get("lon") or not r.get("address"): continue
            a = r["address"]
            if a not in cache:
                time.sleep(1.1)       # Nominatim usage policy: max 1 request per second, identify yourself
                S_, W_, N_, E_ = load_city(d)["bounds"]
                res = http("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": a, "format": "json", "limit": 1, "viewbox": f"{W_},{N_},{E_},{S_}", "bounded": 1}))
                cache[a] = [float(res[0]["lat"]), float(res[0]["lon"])] if res else None; n += 1
            if cache[a]: r["lat"], r["lon"] = cache[a]; changed = True
        if changed:
            with open(f, "w", newline="") as fh:
                w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    with open(cache_p, "w") as f: json.dump(cache, f, indent=0)
    print(f"geocoded {n} new addresses (cache: {len(cache)})")

def new_city(d, name, bbox):
    s, w, n, e = [float(x) for x in bbox.split(",")]
    os.makedirs(os.path.join(d, "layers"), exist_ok=True); os.makedirs(os.path.join(d, "osm"), exist_ok=True)
    cy, cx = (s + n) / 2, (w + e) / 2; ds, dw = (n - s) / 6, (e - w) / 6
    city = {"slug": os.path.basename(os.path.abspath(d)), "name": name, "subtitle": "", "projection_origin": [cy + ds, cx - dw],
            "detail_bbox": [cy - ds, cx - dw, cy + ds, cx + dw], "bounds": [s, w, n, e], "special_paths": {},
            "transit": {"label": "Metro", "monthly_pass": 0, "wait_min": 5, "speed_m_per_min": 450, "station_max_walk_m": 1200},
            "street_labels": [], "layer_colors": {}, "guides": []}
    for fn, obj in (("city.json", city), ("profile.json", {"persona": "", "budget_monthly_rent": 0, "value_of_time_per_hour": 30, "anchors": [], "interests": {}, "exclude_terms": []}),
                    ("options.json", {"candidates": []}), ("routes.json", {"routes": []})):
        p = os.path.join(d, fn)
        if not os.path.exists(p):
            with open(p, "w") as f: json.dump(obj, f, indent=1)
    with open(os.path.join(d, "layers", "_template.csv"), "w") as f: f.write(",".join(COLUMNS) + "\n")
    print(f"scaffolded {d}: set detail_bbox to your core neighborhoods, then osm-fetch")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new"); n.add_argument("dir"); n.add_argument("--name", required=True); n.add_argument("--bbox", required=True)
    for c in ("osm-fetch", "geocode", "validate", "options"): sub.add_parser(c).add_argument("dir")
    b = sub.add_parser("build"); b.add_argument("dir"); b.add_argument("--out")
    x = sub.add_parser("export"); x.add_argument("dir"); x.add_argument("--option", required=True); x.add_argument("--out-dir", default="exports"); x.add_argument("--bundle")
    a = ap.parse_args(argv)
    if a.cmd == "new": new_city(a.dir, a.name, a.bbox)
    elif a.cmd == "osm-fetch": osm_fetch(a.dir)
    elif a.cmd == "geocode": geocode(a.dir)
    elif a.cmd == "validate": sys.exit(1 if validate(a.dir)[0] else 0)
    elif a.cmd == "options":
        city = load_city(a.dir); proj = Proj(*city["projection_origin"]); S = Streets(city, proj)
        for o in score_options(S, city, jload(os.path.join(a.dir, "profile.json")), jload(os.path.join(a.dir, "options.json"))):
            print(f"#{o['rank']} {o['name']}: {o['tradeoff']} all-in ≈ ${o['all_in_monthly']:,}/mo")
            for t in o["trips"]: print(f"     {t['name']}: {t['min']} min ({t['mode']}) × {t['per_week']}/wk")
    elif a.cmd == "build": build(a.dir, a.out)
    elif a.cmd == "export": export(a.dir, a.option, a.out_dir, a.bundle)

if __name__ == "__main__":
    main()
