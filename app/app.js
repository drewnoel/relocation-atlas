/* Relocation Atlas viewer. Loads a bundle (data/<city>/bundle.json or a file you open) and renders it.
   Everything is computed at build time by tools/atlas.py; this page never calls a geocoder or map API. */
"use strict";
const NS = "http://www.w3.org/2000/svg", svg = document.getElementById("map");
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PALETTE = ["#0039A6", "#996633", "#00933C", "#FF6319", "#B933AD", "#C99A00", "#6CBE45", "#8E5DB8", "#E2477A", "#0E8C8C", "#808183", "#A3324A", "#2BA3A0", "#7A4FD6", "#C2571A", "#3D6FB6"];
const MODE_COLOR = { walk: "var(--route)", hop: "var(--route)", highline: "#00933C", greenway: "#6CBE45" };
const MODE_TAG = { walk: "Walk", hop: "Walk", highline: "High Line", greenway: "Run", subway: "Train" };
const SEC_PER_MIN = 2;      // 1x = one trip minute every 2 s of playback
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

let B = null, opt = 0, tab = "options", view = "near", vb = [0, 0, 100, 100], sel = null, colors = {};
let on = { daily: new Set(), explore: new Set() };
let route = null, track = null, t = 0, playing = false, speed = 3, last = 0, cam = null, stepTimer = null, lastK = 1;
let labelLayer, routeLayer, pinLayer, dotLayer;

function el(tag, at, parent) { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); (parent || svg).appendChild(e); return e; }
function fit(pts, pad) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  const w = Math.max(c - a, 200) + pad * 2, h = Math.max(d - b, 200) + pad * 2, s = Math.max(w, h); return [(a + c) / 2 - s / 2, (b + d) / 2 - s / 2, s, s]; }
const O = () => B.options[opt];
const scale = () => Math.max(1, vb[2] / 470);
function applyVB(b) { vb = b; svg.setAttribute("viewBox", b.map(v => v.toFixed(1)).join(" ")); svg.style.aspectRatio = "1/1"; }
function metersXY(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]) * 4; }
function away(p) { const m = metersXY([+p.x, +p.y], [O().x, O().y]) * 1.3, w = m / 80; return w <= 22 ? `${Math.round(w)} min walk` : `~${Math.round(10 + m / 500)} min by transit`; }
function fmt(m) { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`; }
const money = n => "$" + Math.round(n).toLocaleString("en-US");

// ------------------------------------------------------------ load
async function boot() {
  const q = new URLSearchParams(location.search), city = (q.get("city") || "nyc-demo").replace(/[^a-z0-9-]/gi, "");
  try { const r = await fetch(`data/${city}/bundle.json`); if (!r.ok) throw new Error(r.status); load(await r.json()); }
  catch (e) { $("title").textContent = "No bundle found"; $("sub").textContent = `Couldn't load data/${city}/bundle.json. Open a bundle file instead.`; }
}
function load(bundle) {
  if (!bundle || bundle.version !== 1 || !Array.isArray(bundle.options) || !bundle.options.length || !Array.isArray(bundle.places) || !bundle.base || !bundle.city) { alertBox("That file isn't a Relocation Atlas bundle."); return; }
  B = bundle; const c = B.city;
  const layers = [...new Set(B.places.map(p => p.layer))]; colors = {};
  const okColor = v => /^#[0-9a-f]{3,8}$/i.test(v || "") ? v : null;
  layers.forEach((l, i) => colors[l] = okColor((c.layer_colors || {})[l]) || PALETTE[i % PALETTE.length]);
  on = { daily: new Set(layers.filter(l => B.places.some(p => p.layer === l && p.kind === "daily"))), explore: new Set(layers.filter(l => B.places.some(p => p.layer === l && p.kind === "weekly"))) };
  const saved = store.get("ra-home-" + c.slug), si = B.options.findIndex(o => o.id === saved);
  opt = B.selected != null ? B.options.findIndex(o => o.id === B.selected) : (si >= 0 ? si : 0); if (opt < 0) opt = 0;
  document.title = `${c.name} · Relocation Atlas`;
  $("title").textContent = c.name; $("sub").textContent = c.subtitle || (B.profile && B.profile.persona) || "";
  $("foot").textContent = `${B.attribution || ""} Bundle built ${B.generated}. Commute times are estimates (walk 80 m/min; transit = wait + straight-line ride); rents are what the bundle's research found, so check live listings before you sign.`;
  $("guideList").innerHTML = (c.guides || []).map(([t, u, d]) => `<a href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(t)} ↗</b><span>${esc(d)}</span></a>`).join("");
  drawBase(); buildHomeSel(); buildOptions(); setTab(tabFromHash() || "options", true); fromHash();
}
function alertBox(msg) { $("drop").textContent = msg; $("drop").classList.add("on"); setTimeout(() => $("drop").classList.remove("on"), 2500); }

// ------------------------------------------------------------ base map
function drawBase() {
  svg.innerHTML = ""; const b = B.base;
  el("rect", { x: -40000, y: -40000, width: 120000, height: 120000, fill: "var(--block)" });
  el("path", { d: b.under.parks, fill: "var(--park)", stroke: "none" });
  el("path", { d: b.under.coast, fill: "none", stroke: "var(--water)", "stroke-width": 18, "stroke-linejoin": "round" });
  el("path", { d: b.under.major, fill: "none", stroke: "var(--major)", "stroke-width": 5, "stroke-linecap": "round" });
  el("path", { d: b.detail.parks, fill: "var(--park)", stroke: "none" });
  el("path", { d: b.detail.minor, fill: "none", stroke: "var(--street)", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" });
  el("path", { d: b.detail.major, fill: "none", stroke: "var(--major)", "stroke-width": 5.5, "stroke-linecap": "round", "stroke-linejoin": "round" });
  el("path", { d: b.rail, fill: "none", stroke: "var(--track)", "stroke-width": 2.5, "stroke-dasharray": "8 6" });
  labelLayer = el("g", {}); routeLayer = el("g", {}); pinLayer = el("g", {}); dotLayer = el("g", {});
  for (const l of b.labels) el("text", { x: l.x, y: l.y, class: "av", "text-anchor": "middle" }, labelLayer).textContent = l.t;
}
function views() {
  const o = O(), near = [[o.x, o.y], ...B.anchors.map(a => [a.x, a.y])];
  return { near: fit(near, 160), all: fit([[0, 0], B.base.detail_wh], 20), city: fit(B.places.map(p => [+p.x, +p.y]).concat(B.options.map(o => [o.x, o.y])), 120) };
}
function setView(v) { view = v; stopPlay(); applyVB(views()[v]); document.querySelectorAll(".vbtn").forEach(x => x.setAttribute("aria-pressed", x.dataset.v === v)); renderPins(); drawRoute(); }

// ------------------------------------------------------------ home base + options
function buildHomeSel() {
  const box = $("homesel"); box.querySelectorAll("button").forEach(b => b.remove());
  B.options.forEach((o, i) => { const b = document.createElement("button"); b.className = "rbtn"; b.textContent = `#${o.rank} ${o.name}`; b.setAttribute("aria-pressed", i === opt);
    b.onclick = () => setHome(i); box.appendChild(b); });
}
function setHome(i) { opt = i; store.set("ra-home-" + B.city.slug, O().id); route = null; stopPlay(); sel = null;
  $("homesel").querySelectorAll("button").forEach((b, j) => b.setAttribute("aria-pressed", j === opt));
  buildOptions(); buildRoutes(); renderTop(); setView(tab === "explore" ? "city" : "near"); render(); }
function buildOptions() {
  const p = B.profile || {};
  $("optIntro").textContent = `Ranked by all-in monthly cost: rent plus the value of your time getting around (${money(p.value_of_time_per_hour || 0)}/hour) plus transit. Budget: ${money(p.budget_monthly_rent || 0)} rent. Pick one as your home base; daily life and routes rebuild around it.`;
  $("opts").innerHTML = B.options.map((o, i) => `<div class="opt" role="button" tabindex="0" data-i="${i}" aria-pressed="${i === opt}">
      <span class="rk">#${o.rank}${o.over_budget ? " · over budget" : (o.stretch ? " · stretch" : "")}</span><h3>${esc(o.name)}</h3>
      <span class="big">${money(o.all_in_monthly)}<span class="lbl"> / mo all-in</span></span>
      <span>${esc(o.vibe || "")}</span>
      <table>${[[o.rent_illustrative ? "Rent (mid, illustrative)" : "Rent (mid)", money(o.rent_mid)], ["Time getting around", `${(o.weekly_commute_min / 60).toFixed(1)} h/wk`], ["Time, valued", money(o.monthly_time_cost)], ["Transit pass", money(o.monthly_transit)]]
        .map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}
        ${o.trips.map(tr => `<tr><td>${esc(tr.name)} ×${tr.per_week}</td><td>${tr.min} min ${tr.mode === "transit" ? "🚇" : "🚶"}</td></tr>`).join("")}</table>
    </div>`).join("");
  $("opts").querySelectorAll(".opt").forEach(b => { b.onclick = () => setHome(+b.dataset.i); b.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHome(+b.dataset.i); } }; });
}

// ------------------------------------------------------------ places
const kindForTab = () => tab === "daily" ? "daily" : "weekly";
const visiblePlaces = () => tab === "options" ? [] : B.places.map((p, i) => [p, i]).filter(([p]) => p.kind === kindForTab() && on[tab].has(p.layer));
function statusPill(c) { const m = { listed: ["saved", "Listed"], "verified-open-2026": ["ok", "Verified"], "verified-2026": ["ok", "Verified"], verified: ["ok", "Verified"], likely: ["mid", "Likely"], unverified: ["warn", "Unverified"], verify: ["warn", "Verify"] }[c] || ["mid", c]; return `<span class="pill ${m[0]}">${esc(m[1])}</span>`; }
function gmaps(p) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.name.replace(/\s*\(.*\)/, "") + ", " + (p.address || "").replace(/\s*\(.*?\)/g, "")); }
function renderDetail() {
  const d = $("detail"), p = B.places[sel];
  if (tab === "options") { const o = O(); d.innerHTML = `<span class="lbl">Home base</span><h2>${esc(o.name)}</h2><div>${esc(o.tradeoff)}</div><div class="meta"><span>${o.trips.length} weekly anchors</span><span>${o.routes.length} routes</span></div>`; return; }
  if (p == null) { d.innerHTML = `<span class="lbl">${tab === "daily" ? "Daily life" : "Explore"}</span><h2>Pick a pin, a row or a route</h2><div class="meta">Distances update to whichever home base you pick.</div>`; return; }
  d.innerHTML = `<span class="lbl" style="color:${colors[p.layer]}">${esc(p.layer)} · ${esc(p.label)}</span><h2>${esc(p.name)}</h2>
   <div class="meta">${statusPill(p.confidence)}<span>${esc(p.address)}</span><span>${away(p)} from ${esc(O().name)}</span></div>
   ${p.hours ? `<div class="meta">Hours: ${esc(p.hours)}</div>` : ""}${p.note ? `<div>${esc(p.note)}</div>` : ""}
   <div class="meta"><a href="${gmaps(p)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>${/^https?:/.test(p.source) ? `<a href="${esc(p.source)}" target="_blank" rel="noopener">Source ↗</a>` : ""}</div>`;
}
function renderPins() {
  pinLayer.innerHTML = ""; const k = scale();
  const topSet = new Set(tab === "options" ? [] : (tab === "daily" ? O().top_daily : O().top_weekly).map(x => x.i));
  for (const [p, i] of visiblePlaces()) { const x = +p.x, y = +p.y, c = colors[p.layer];
    const g = el("g", { class: "pin" + (i === sel ? " sel" : ""), tabindex: 0, role: "button", "aria-label": p.name }, pinLayer);
    el("circle", { cx: x, cy: y, r: 16 * k, fill: "transparent", class: "hit" }, g);
    el("circle", { cx: x, cy: y, r: (i === sel ? 9 : (topSet.has(i) ? 8 : 6)) * k, fill: c, "stroke-width": (topSet.has(i) ? 3 : 2) * k }, g);
    g.addEventListener("click", () => pick(i)); g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(i); } }); }
  for (const a of B.anchors) { el("rect", { x: a.x - 7 * k, y: a.y - 7 * k, width: 14 * k, height: 14 * k, rx: 2 * k, fill: "var(--fg)", stroke: "var(--surface)", "stroke-width": 2 * k }, pinLayer);
    const L = a.x > vb[0] + vb[2] * .62; el("text", { x: a.x + (L ? -11 : 11) * k, y: a.y + 4 * k, class: "plabel", "text-anchor": L ? "end" : "start", "font-size": 11 * k, "stroke-width": 3 * k }, pinLayer).textContent = a.name; }
  B.options.forEach((o, i) => { const cur = i === opt;
    const g = el("g", { class: "pin", role: "button", tabindex: 0, "aria-label": "Home base " + o.name }, pinLayer);
    el("rect", { x: o.x - (cur ? 11 : 8) * k, y: o.y - (cur ? 11 : 8) * k, width: (cur ? 22 : 16) * k, height: (cur ? 22 : 16) * k, rx: 4 * k, fill: cur ? "#EE352E" : "var(--muted)", "stroke-width": 2.5 * k }, g);
    const L = o.x > vb[0] + vb[2] * .62; el("text", { x: o.x + (L ? -15 : 15) * k, y: o.y + 5 * k, class: "plabel", "text-anchor": L ? "end" : "start", "font-size": (cur ? 14 : 11) * k, "stroke-width": 3 * k }, g).textContent = (cur ? "Home: " : `#${o.rank} `) + o.name;
    g.addEventListener("click", () => setHome(i)); });
}
function renderList() {
  const list = $("list"); list.innerHTML = "";
  if (tab === "options") { list.innerHTML = B.options.map((o, i) => `<div class="row${i === opt ? " sel" : ""}" data-i="${i}" tabindex="0"><span class="dot" style="background:${i === opt ? "#EE352E" : "var(--muted)"}"></span><div><div class="n">#${o.rank} ${esc(o.name)}</div><div class="l">${esc(o.tradeoff)}</div></div><span class="w">${money(o.all_in_monthly)}</span></div>`).join("");
    list.querySelectorAll(".row").forEach(r => r.onclick = () => setHome(+r.dataset.i)); return; }
  const vis = visiblePlaces();
  for (const layer of Object.keys(colors)) { const items = vis.filter(([p]) => p.layer === layer); if (!items.length) continue;
    const h = document.createElement("div"); h.className = "grp"; h.innerHTML = `<span class="dot" style="background:${colors[layer]}"></span>${esc(layer)}`; list.appendChild(h);
    items.sort((a, b) => metersXY([+a[0].x, +a[0].y], [O().x, O().y]) - metersXY([+b[0].x, +b[0].y], [O().x, O().y]));
    for (const [p, i] of items) { const r = document.createElement("div"); r.className = "row" + (i === sel ? " sel" : ""); r.tabIndex = 0;
      r.innerHTML = `<span class="dot" style="background:${colors[layer]};width:10px;height:10px"></span><div><div class="n">${esc(p.name)}</div><div class="l">${esc(p.label)}${p.confidence === "verify" || p.confidence === "unverified" ? " · check" : ""}</div></div><span class="w">${esc(away(p).replace(" walk", "").replace(" by transit", " 🚇"))}</span>`;
      r.onclick = () => pick(i); r.onkeydown = e => { if (e.key === "Enter") pick(i); }; list.appendChild(r); } }
  if (!list.children.length) list.innerHTML = `<div class="row" style="cursor:default"><span></span><div class="l">No layers on. Use “All on”.</div><span></span></div>`;
}
function render() { renderPins(); renderList(); renderDetail(); }
function pick(i) { sel = i; const p = B.places[i]; if (p && view === "near" && metersXY([+p.x, +p.y], [O().x, O().y]) > vb[2] * 2) setView("city"); render(); }
function buildChips() {
  const chips = $("chips"); chips.innerHTML = ""; if (tab === "options") return;
  const layers = Object.keys(colors).filter(l => B.places.some(p => p.layer === l && p.kind === kindForTab()));
  const all = document.createElement("button"); all.className = "chip all";
  const sync = () => { const full = layers.every(l => on[tab].has(l)); all.textContent = full ? "All off" : "All on"; all.setAttribute("aria-pressed", String(full)); };
  all.onclick = () => { const full = layers.every(l => on[tab].has(l)); on[tab] = full ? new Set() : new Set(layers); chips.querySelectorAll(".chip[data-l]").forEach(b => b.setAttribute("aria-pressed", on[tab].has(b.dataset.l))); sync(); render(); };
  chips.appendChild(all);
  for (const layer of layers) { const b = document.createElement("button"); b.className = "chip"; b.dataset.l = layer; b.setAttribute("aria-pressed", on[tab].has(layer));
    b.innerHTML = `<span class="dot" style="background:${colors[layer]}"></span>${esc(layer)}`;
    b.onclick = () => { on[tab].has(layer) ? on[tab].delete(layer) : on[tab].add(layer); b.setAttribute("aria-pressed", on[tab].has(layer)); sync(); render(); }; chips.appendChild(b); }
  sync();
}
function renderTop() {
  if (tab === "options") return;
  const o = O(), list = tab === "daily" ? o.top_daily : o.top_weekly;
  $("topH").textContent = tab === "daily" ? `Top 10 daily spots from ${o.name}` : `Top 10 weekly explorations from ${o.name}`;
  $("topList").innerHTML = list.map(x => { const p = B.places[x.i]; return `<li data-i="${x.i}"><span><b>${esc(p.name)}</b><br><span class="lbl">${esc(p.layer)}</span></span><span class="w">${x.min} min</span></li>`; }).join("") || `<li>Nothing within reach yet.</li>`;
  $("topList").querySelectorAll("li[data-i]").forEach(li => li.onclick = () => pick(+li.dataset.i));
  const gaps = tab === "daily" ? (o.gaps || []) : [];
  $("topSide").innerHTML = tab === "daily"
    ? `<span class="lbl">How these were picked</span><div>Your interests × how sure the research is × how close it is on foot (nothing over 20 minutes). At most two per category, so the list stays varied.</div>${gaps.length ? `<div class="gap">Research gaps near ${esc(o.name)}: ${gaps.map(esc).join(", ")}. The skill's next loop researches these layers around this home base.</div>` : `<div class="lbl" style="color:var(--ok)">No gaps in your must-have categories.</div>`}`
    : `<span class="lbl">How these were picked</span><div>Your interests × the source ranking × confidence, with a gentler distance penalty: a great spot is worth a train ride once a week. At most two per layer.</div>`;
}

// ------------------------------------------------------------ routes + flythroughs
function buildRoutes() {
  const rs = $("routes"); rs.querySelectorAll("button").forEach(b => b.remove());
  for (const r of O().routes) { const b = document.createElement("button"); b.className = "rbtn"; b.dataset.r = r.id; b.setAttribute("aria-pressed", "false"); b.textContent = r.title; b.onclick = () => openRoute(r.id, true); rs.appendChild(b); }
}
function prepare(r) { const segs = []; let tm = 0;
  r.legs.forEach((L, li) => { const P = L.pts; let len = 0; const cum = [0];
    for (let i = 1; i < P.length; i++) { len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); cum.push(len); }
    segs.push({ li, t0: tm, t1: tm + L.min, P, cum, len, mode: L.mode }); tm += L.min; });
  return { segs, total: tm }; }
function posAt(tt) { const s = track.segs.find(s => tt <= s.t1) || track.segs[track.segs.length - 1];
  if (s.len === 0) return { x: s.P[0][0], y: s.P[0][1], s };
  const f = Math.min(1, Math.max(0, (tt - s.t0) / (s.t1 - s.t0 || 1))) * s.len; let i = 1; while (i < s.cum.length - 1 && s.cum[i] < f) i++;
  const a = s.P[i - 1], b = s.P[i], u = (f - s.cum[i - 1]) / ((s.cum[i] - s.cum[i - 1]) || 1); return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, s }; }
function drawRoute() {
  routeLayer.innerHTML = ""; dotLayer.innerHTML = ""; if (!route) return; const k = scale();
  route.legs.forEach(L => { const d = "M" + L.pts.map(p => p.join(",")).join(" L");
    if (L.mode === "subway") { el("path", { d, fill: "none", stroke: /^#[0-9a-f]{3,8}$/i.test(L.color || "") ? L.color : "#0039A6", "stroke-width": 7, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }, routeLayer);
      (L.station_pts || []).forEach((s, j) => { el("circle", { cx: s[0], cy: s[1], r: 4.5 * k, fill: "var(--surface)", stroke: /^#[0-9a-f]{3,8}$/i.test(L.color || "") ? L.color : "#0039A6", "stroke-width": 2.5 * k }, routeLayer);
        el("text", { x: s[0] + 8 * k, y: s[1] + 4 * k, class: "stn", "font-size": 11 * k, "stroke-width": 3 * k }, routeLayer).textContent = (L.stations || [])[j] || ""; }); }
    else el("path", { d, fill: "none", stroke: MODE_COLOR[L.mode] || "var(--route)", "stroke-width": L.mode === "walk" || L.mode === "hop" ? 4 : 6, "stroke-dasharray": L.mode === "hop" ? "2 6" : (L.mode === "walk" ? "7 5" : "none"), "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }, routeLayer); });
  const p = posAt(t); el("circle", { cx: p.x, cy: p.y, r: 13 * k, fill: "var(--fg)", opacity: .15 }, dotLayer); el("circle", { cx: p.x, cy: p.y, r: 7 * k, fill: "var(--fg)", stroke: "var(--surface)", "stroke-width": 2.5 * k }, dotLayer);
}
function frameCam(snap) { const p = posAt(t), w = p.s.mode === "subway" ? 1150 : (p.s.mode === "greenway" ? 520 : 380);
  if (!cam || snap) cam = [p.x, p.y, w]; else cam = [cam[0] + (p.x - cam[0]) * .08, cam[1] + (p.y - cam[1]) * .08, cam[2] + (w - cam[2]) * .04];
  applyVB([cam[0] - cam[2] / 2, cam[1] - cam[2] / 2, cam[2], cam[2]]); }
function tick(now) { if (!playing) return; const dt = Math.min(.1, (now - last) / 1000); last = now;
  t = Math.min(track.total, t + dt * speed / SEC_PER_MIN); frameCam(false);
  if (Math.abs(scale() - lastK) / lastK > .12) { lastK = scale(); renderPins(); }
  drawRoute(); updatePlayer();
  if (t >= track.total) { playing = false; updatePlayer(); setTimeout(() => { if (!playing) overview(); }, 1200); return; }
  requestAnimationFrame(tick); }
function play() { if (!route) return; if (t >= track.total) t = 0; playing = true; lastK = scale();
  if (REDUCED) { stepLegs(); return; } frameCam(true); last = performance.now(); requestAnimationFrame(tick); updatePlayer(); }
function stepLegs() { clearTimeout(stepTimer); if (!playing) return; const s = track.segs.find(s => s.t1 > t + 1e-6); if (!s) { playing = false; updatePlayer(); overview(); return; }
  t = s.t1; applyVB(fit(s.P.length > 1 ? s.P : [s.P[0], [s.P[0][0] + 1, s.P[0][1] + 1]], 90)); renderPins(); drawRoute(); updatePlayer(); stepTimer = setTimeout(stepLegs, 3000 / speed); }
function stopPlay() { playing = false; clearTimeout(stepTimer); }
function overview() { if (!route) return; applyVB(fit(route.legs.flatMap(L => L.pts), 90)); renderPins(); drawRoute(); }
function updatePlayer() { const box = $("player"); if (!route) { box.hidden = true; return; }
  const cur = posAt(t).s.li;
  box.querySelector("#pp").textContent = playing ? "Pause" : (t > 0 && t < track.total ? "Resume" : "Play flythrough");
  box.querySelector("#clk").textContent = `${fmt(t)} / ${fmt(track.total)}`;
  box.querySelector(".bar i").style.width = (100 * t / track.total) + "%";
  box.querySelectorAll(".legs li").forEach((li, i) => li.classList.toggle("cur", i === cur && t > 0)); }
function openRoute(id, autoplay) {
  const r = O().routes.find(r => r.id === id); if (!r) return; if (tab === "options") setTab("daily", true);
  stopPlay(); route = r; track = prepare(r); t = 0; cam = null; sel = null;
  document.querySelectorAll("#routes .rbtn").forEach(b => b.setAttribute("aria-pressed", b.dataset.r === id));
  const box = $("player"); box.hidden = false;
  const gm = r.gm && r.gm.length === 3 ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(r.gm[0])}&destination=${encodeURIComponent(r.gm[1])}&travelmode=${encodeURIComponent(r.gm[2])}` : "";
  const end = r.legs[r.legs.length - 1].pts.slice(-1)[0];
  box.innerHTML = `<span class="lbl">${esc(r.when || "")} · from ${esc(O().name)}</span><h2>${esc(r.title)}</h2>
    <div class="meta"><span>≈ ${fmt(r.total_min)}</span><span>${r.miles} mi</span><span>to ${esc(r.dest || "")}</span></div>
    <div>${esc(r.blurb || "")}</div>${r.caveat ? `<div class="caveat">${esc(r.caveat)}</div>` : ""}
    <div class="ctrl"><button class="pbtn" id="pp">Play flythrough</button><button class="pbtn ghost" id="rs">Restart</button>
      <label class="spd" for="speed">Speed <input type="range" id="speed" min="1" max="10" step="1" value="${speed}"><b id="spv">${speed}×</b></label><span class="clock" id="clk"></span></div>
    <div class="bar"><i></i></div><div class="lbl">1× = one trip minute every 2 s · 10× = a 30-min trip in 6 s</div>
    <ol class="legs">${r.legs.map((L, i) => `<li data-i="${i}"><span class="mtag" style="background:${L.mode === "subway" ? (/^#[0-9a-f]{3,8}$/i.test(L.color || "") ? L.color : "#0039A6") : (L.mode === "highline" ? "#00933C" : (L.mode === "greenway" ? "#3E8E1F" : "#5D646B"))}">${esc(L.mode === "subway" ? (L.line || "Train") : MODE_TAG[L.mode] || L.mode)}</span><span>${esc(L.label)}</span><span class="w">${L.min} min</span></li>`).join("")}</ol>
    <div class="meta">${gm ? `<a href="${gm}" target="_blank" rel="noopener">Live directions ↗</a>` : ""}<button class="rbtn" id="cp">Copy link</button><span id="cpm" class="lbl"></span></div>`;
  box.querySelector("#pp").onclick = () => { playing ? (stopPlay(), updatePlayer()) : play(); };
  box.querySelector("#rs").onclick = () => { stopPlay(); t = 0; play(); };
  box.querySelector("#speed").oninput = e => { speed = +e.target.value; box.querySelector("#spv").textContent = speed + "×"; };
  box.querySelectorAll(".legs li").forEach(li => li.onclick = () => { const s = track.segs.find(s => s.li === +li.dataset.i); t = s.t0; frameCam(true); renderPins(); drawRoute(); updatePlayer(); });
  const link = location.origin + location.pathname + location.search + "#route-" + r.id;
  box.querySelector("#cp").onclick = () => { const m = box.querySelector("#cpm"); if (!navigator.clipboard) { m.textContent = link; return; } navigator.clipboard.writeText(link).then(() => m.textContent = "Copied", () => m.textContent = link); };
  setHash("route-" + r.id); render(); overview(); updatePlayer(); if (autoplay) play();
}

// ------------------------------------------------------------ tabs + hash
function setTab(tb, keepHash) { tab = tb; sel = null; stopPlay(); route = null;
  ["options", "daily", "explore"].forEach(x => $("tab-" + x).setAttribute("aria-selected", x === tb));
  $("optionsSec").hidden = tb !== "options"; $("topSec").hidden = tb === "options"; $("routes").hidden = tb === "options";
  $("guides").hidden = tb !== "explore"; $("player").hidden = true; $("chips").hidden = tb === "options";
  if (!keepHash) setHash(tb === "options" ? "" : tb);
  buildChips(); buildRoutes(); renderTop(); setView(tb === "explore" ? "city" : "near"); render(); }
function setHash(h) { try { if (h) location.hash = h; else history.replaceState(null, "", location.pathname + location.search); } catch (e) {} }
function tabFromHash() { const h = location.hash.slice(1); return ["daily", "explore"].includes(h) ? h : (h.startsWith("route-") ? "daily" : null); }
function fromHash() { if (!B) return; const h = location.hash.slice(1);
  if (h.startsWith("route-")) { if (!route || route.id !== h.slice(6)) openRoute(h.slice(6), false); }
  else if (["daily", "explore"].includes(h)) { if (tab !== h) setTab(h, true); }
  else if (!h && tab !== "options") setTab("options", true); }
["options", "daily", "explore"].forEach(x => $("tab-" + x).onclick = () => setTab(x));
document.querySelectorAll(".vbtn").forEach(b => b.onclick = () => setView(b.dataset.v));
window.addEventListener("hashchange", fromHash);

// ------------------------------------------------------------ save / open (the bundle is the durable asset)
function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
const xmlEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
$("exJson").onclick = () => download(`${B.city.slug}-${O().id}.atlas.json`, JSON.stringify({ ...B, selected: O().id }), "application/json");
$("exKml").onclick = () => { const o = O(), top = new Set([...o.top_daily, ...o.top_weekly].map(x => x.i)), byL = {};
  B.places.forEach((p, i) => (byL[p.layer] = byL[p.layer] || []).push([p, i]));
  const pm = (n, d, lat, lon) => `<Placemark><name>${xmlEsc(n)}</name><description>${xmlEsc(d)}</description><Point><coordinates>${lon},${lat},0</coordinates></Point></Placemark>`;
  let k = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(B.city.name)}: ${xmlEsc(o.name)}</name>` + pm("Home base: " + o.name, o.vibe || "", o.lat, o.lon);
  k += `<Folder><name>Top 10s</name>${[...top].map(i => pm(B.places[i].name, B.places[i].layer, B.places[i].lat, B.places[i].lon)).join("")}</Folder>`;
  for (const [l, ps] of Object.entries(byL)) k += `<Folder><name>${xmlEsc(l)}</name>${ps.map(([p]) => pm(p.name, p.note || "", p.lat, p.lon)).join("")}</Folder>`;
  download(`${B.city.slug}-${o.id}.kml`, k + "</Document></kml>", "application/vnd.google-earth.kml+xml"); };
$("exCsv").onclick = () => { const o = O(), q = s => `"${String(s ?? "").replace(/"/g, '""')}"`, top = new Set([...o.top_daily, ...o.top_weekly].map(x => x.i));
  const rows = [["Name", "Latitude", "Longitude", "Layer", "Description"], ["Home base: " + o.name, o.lat, o.lon, "Home base", o.vibe || ""], ...B.places.map((p, i) => [p.name, p.lat, p.lon, (top.has(i) ? "★ " : "") + p.layer, p.note || ""])];
  download(`${B.city.slug}-${o.id}-mymaps.csv`, rows.map(r => r.map(q).join(",")).join("\n"), "text/csv"); };
function openFile(f) { if (!f) return; const rd = new FileReader(); rd.onload = () => { try { load(JSON.parse(rd.result)); } catch (e) { alertBox("Couldn't read that file as JSON."); } }; rd.readAsText(f); }
$("imp").onchange = e => openFile(e.target.files[0]);
document.addEventListener("dragover", e => { e.preventDefault(); $("drop").classList.add("on"); });
document.addEventListener("dragleave", () => $("drop").classList.remove("on"));
document.addEventListener("drop", e => { e.preventDefault(); $("drop").classList.remove("on"); openFile(e.dataTransfer.files[0]); });

boot();
