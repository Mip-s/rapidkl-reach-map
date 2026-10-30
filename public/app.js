const WALK_MPS = 4.8 / 3.6; // 4.8 km/h
const CIRCUITY = 1.3; // street distance / straight-line distance for nearby walking links
const BANDS = [30, 60, 90, 120];
const $ = (id) => document.getElementById(id);

const net = await (await fetch("data/network.json")).json();
const ACRONYMS = new Set(["KL", "KLCC", "PWTC", "UOB", "TRX", "UPM", "USJ", "SS", "SA", "IOI", "BK5", "UITM", "OUG", "MRT", "LRT"]);
const stopById = new Map(net.stops.map((s) => [s.id, s]));

// Stations: stops joined by same-name interchanges are one station.
const parent = new Map(net.stops.map((s) => [s.id, s.id]));
const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
for (const { a, b } of net.interchanges) parent.set(find(a), find(b));
const stations = new Map();
for (const s of net.stops) {
  const key = find(s.id);
  if (!stations.has(key)) stations.set(key, { key, stops: [], lat: s.lat, lon: s.lon });
  stations.get(key).stops.push(s);
}
for (const st of stations.values()) {
  st.name = title(st.stops.map((s) => s.name).sort((a, b) => a.length - b.length)[0]);
  st.lines = [...new Set(st.stops.map((s) => s.line))];
}
function title(n) {
  return n
    .split(" ")
    .map((w) => (ACRONYMS.has(w.toUpperCase()) || /\d/.test(w) ? w.toUpperCase() : w.toLowerCase().replace(/(^|['-])([a-z])/g, (_, p, c) => p + c.toUpperCase())))
    .join(" ");
}

function shortestTimes(originKey, opt) {
  const dist = new Map(net.stops.map((s) => [s.id, Infinity]));
  const adj = new Map(net.stops.map((s) => [s.id, []]));
  const wait = (id) => (opt.wait ? net.lines[stopById.get(id).line].headway_s / 2 : 0);
  for (const e of net.edges) adj.get(e.a).push([e.b, e.s]);
  for (const { a, b } of net.interchanges) {
    adj.get(a).push([b, opt.transfer * 60 + wait(b)]);
    adj.get(b).push([a, opt.transfer * 60 + wait(a)]);
  }
  if (opt.near) {
    for (const { a, b, m } of net.candidates) {
      const walk = (m * CIRCUITY) / WALK_MPS;
      adj.get(a).push([b, walk + wait(b)]);
      adj.get(b).push([a, walk + wait(a)]);
    }
  }
  const prev = new Map();
  const kinds = new Map(); // "u>v" -> ride | change | walk
  for (const e of net.edges) kinds.set(`${e.a}>${e.b}`, "ride");
  for (const { a, b } of net.interchanges) { kinds.set(`${a}>${b}`, "change"); kinds.set(`${b}>${a}`, "change"); }
  if (opt.near) for (const { a, b } of net.candidates) { kinds.set(`${a}>${b}`, "walk"); kinds.set(`${b}>${a}`, "walk"); }
  const todo = new Set();
  for (const s of stations.get(originKey).stops) {
    dist.set(s.id, opt.firstWait ? wait(s.id) : 0);
    todo.add(s.id);
  }
  for (const id of dist.keys()) todo.add(id);
  while (todo.size) {
    let u = null;
    for (const id of todo) if (u === null || dist.get(id) < dist.get(u)) u = id;
    todo.delete(u);
    if (dist.get(u) === Infinity) break;
    for (const [v, w] of adj.get(u)) if (dist.get(u) + w < dist.get(v)) { dist.set(v, dist.get(u) + w); prev.set(v, u); }
  }
  const out = new Map();
  for (const st of stations.values()) out.set(st.key, Math.min(...st.stops.map((s) => dist.get(s.id))));
  return { times: out, dist, prev, kinds };
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const bandColor = (min) => {
  const i = BANDS.findIndex((b) => min <= b);
  return css(`--b${i < 0 ? 5 : i + 1}`);
};

// Map
const map = L.map("geo", { zoomControl: true }).setView([3.139, 101.6869], 11);
const osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const osm = (opts) => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: osmAttr, ...opts });
const bases = {
  "Minimal": osm({ className: "tiles-minimal" }),
  "Detailed (OpenStreetMap)": osm({}),
  "Blank": L.layerGroup(),
};
// Offline at load: no tiles to fetch, so start on the blank basemap.
(navigator.onLine ? bases["Minimal"] : bases["Blank"]).addTo(map);
L.control.layers(bases, null, { position: "topright", collapsed: true }).addTo(map);
map.attributionControl.addAttribution("Rail data: Prasarana via data.gov.my");

// Track segments between consecutive stations, so each can fade when out of reach.
const segments = [];
for (const [code, line] of Object.entries(net.lines)) {
  const nearest = (s) => {
    let best = 0, bd = Infinity;
    line.shape.forEach(([la, lo], i) => {
      const d = (la - s.lat) ** 2 + (lo - s.lon) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const onLine = net.stops.filter((s) => s.line === code).map((s) => ({ s, i: nearest(s) })).sort((x, y) => x.i - y.i);
  for (let k = 0; k + 1 < onLine.length; k++) {
    const A = onLine[k], B = onLine[k + 1];
    const pts = [[A.s.lat, A.s.lon], ...line.shape.slice(A.i + 1, B.i), [B.s.lat, B.s.lon]];
    const poly = L.polyline(pts, { color: line.color, weight: 5, opacity: 0.85 }).addTo(map);
    segments.push({ poly, pts, ids: [A.s.id, B.s.id], a: find(A.s.id), b: find(B.s.id), color: line.color });
  }
}
const markers = new Map();
for (const st of stations.values()) {
  const m = L.circleMarker([st.lat, st.lon], { radius: 6, weight: 2, color: "#fff", fillOpacity: 1 }).addTo(map);
  m.bindPopup(() => {
    const box = document.createElement("div");
    box.innerHTML = `<b>${st.name}</b><br>`;
    for (const [label, combo] of [["From here", originCombo], ["To here", destCombo]]) {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.style.margin = "6px 6px 0 0";
      btn.addEventListener("click", () => { combo.pick(st.key); map.closePopup(); });
      box.appendChild(btn);
    }
    return box;
  });
  markers.set(st.key, m);
}

// Controls
const sorted = [...stations.values()].sort((a, b) => a.name.localeCompare(b.name));
const lineNames = (s) => s.lines.map((c) => net.lines[c].name.replace(/ Line$/, "")).join(", ");
function makeCombo(input, hidden, list, onPick) {
  let matches = [];
  let active = -1;
  const show = () => { input.value = hidden.value ? stations.get(hidden.value).name : ""; };
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    matches = sorted.filter((s) => !q || s.name.toLowerCase().includes(q) || s.stops.some((p) => p.id.toLowerCase() === q) || lineNames(s).toLowerCase().includes(q));
    matches.sort((x, y) => !x.name.toLowerCase().startsWith(q) - !y.name.toLowerCase().startsWith(q) || x.name.localeCompare(y.name));
    active = matches.length ? 0 : -1;
    list.innerHTML = matches.length
      ? matches.map((s, i) => `<li role="option" data-k="${s.key}" class="${i === active ? "on" : ""}">${s.lines.map((c) => `<span class="chip" style="background:${net.lines[c].color}"></span>`).join("")}${s.name}<small>${lineNames(s)}</small></li>`).join("")
      : `<li>No station found</li>`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const pick = (key) => { hidden.value = key; show(); close(); onPick(key); };
  input.addEventListener("focus", () => { input.select(); render(); });
  input.addEventListener("click", () => { if (list.hidden) { input.select(); render(); } });
  input.addEventListener("input", () => {
    if (!input.value && input.dataset.optional) { hidden.value = ""; onPick(""); }
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) render();
      if (!matches.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      [...list.children].forEach((li, i) => li.classList.toggle("on", i === active));
      list.children[active].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(matches[active].key);
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault(); // a search input would otherwise clear itself
      show();
      close();
    }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-k]");
    if (li) { e.preventDefault(); pick(li.dataset.k); input.blur(); }
  });
  input.addEventListener("blur", () => { show(); close(); });
  return { pick, set: (key) => { hidden.value = key; show(); } };
}

const originCombo = makeCombo($("originSearch"), $("origin"), $("suggest"), () => update());
const destCombo = makeCombo($("destSearch"), $("dest"), $("suggestDest"), (key) => { update(); if (key) fitRoute(); });
originCombo.set([...stations.values()].find((s) => s.name === "KL Sentral")?.key ?? sorted[0].key);
for (const id of ["limit", "transfer", "wait", "near", "firstwait", "buffer", "bufferMin", "bufferPct"]) $(id).addEventListener("input", update);
for (const b of document.querySelectorAll(".presets button")) b.addEventListener("click", () => { $("limit").value = b.dataset.min; update(); });

// "2 hours 5 minutes", "1 hour", "45 minutes"
function dur(totalMin) {
  const m = Math.round(totalMin);
  const h = Math.floor(m / 60), r = m % 60;
  const parts = [];
  if (h) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (r || !h) parts.push(`${r} ${r === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}
const fmt = (sec) => dur(sec / 60);

const routeLayer = L.layerGroup().addTo(map);
let routeBounds = null;

function showRoute(sp, origin, destKey, { fixed, pct }) {
  routeLayer.clearLayers();
  routeBounds = null;
  const out = $("route");
  if (!destKey || destKey === origin) { out.hidden = true; out.innerHTML = ""; return; }
  const dest = stations.get(destKey);
  let end = null;
  for (const s of dest.stops) if (end === null || sp.dist.get(s.id) < sp.dist.get(end)) end = s.id;
  if (!Number.isFinite(sp.dist.get(end))) { out.hidden = false; out.textContent = `No rail route to ${dest.name}.`; return; }
  const path = [end];
  while (sp.prev.has(path[0])) path.unshift(sp.prev.get(path[0]));
  const ride = sp.dist.get(end);
  const total = ride + fixed + ride * pct;

  // Group the hops into steps: rides on one line, then a change or a walk.
  const steps = [];
  const latlngs = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const u = path[k], v = path[k + 1];
    const kind = sp.kinds.get(`${u}>${v}`);
    const su = stopById.get(u), sv = stopById.get(v);
    let pts = [[su.lat, su.lon], [sv.lat, sv.lon]];
    if (kind === "ride") {
      const seg = segments.find((g) => (g.ids[0] === u && g.ids[1] === v) || (g.ids[0] === v && g.ids[1] === u));
      if (seg) pts = seg.ids[0] === u ? seg.pts : [...seg.pts].reverse();
    }
    latlngs.push(...pts);
    const color = net.lines[sv.line].color;
    routeLayer.addLayer(L.polyline(pts, { color: "#000", weight: 10, opacity: 0.85, lineCap: "round" }));
    routeLayer.addLayer(L.polyline(pts, { color: kind === "ride" ? color : "#fff", weight: 6, opacity: 1, dashArray: kind === "ride" ? null : "2 9", lineCap: "round" }));
    const last = steps[steps.length - 1];
    if (kind === "ride" && last && last.type === "ride" && last.line === sv.line) { last.to = sv; last.n++; }
    else if (kind === "ride") steps.push({ type: "ride", line: sv.line, from: su, to: sv, n: 1 });
    else steps.push({ type: kind, from: su, to: sv });
  }
  routeBounds = L.latLngBounds(latlngs);
  const nm = (s) => title(s.name);
  const html = steps.map((s) => s.type === "ride"
    ? `<li><span class="chip" style="background:${net.lines[s.line].color}"></span><span>${net.lines[s.line].name}: ${nm(s.from)} to ${nm(s.to)} (${s.n} ${s.n === 1 ? "stop" : "stops"})</span></li>`
    : s.type === "change"
      ? `<li class="xfer">Change trains at ${nm(s.from)}</li>`
      : `<li class="xfer">Walk from ${nm(s.from)} to ${nm(s.to)}</li>`).join("");
  out.hidden = false;
  out.innerHTML = `<div class="rtotal">${stations.get(origin).name} to ${dest.name}: <b>${fmt(total)}</b></div>
    <div class="rsub">${fmt(ride)} on the network + ${fmt(total - ride)} allowance</div><ol>${html}</ol>`;
}
function fitRoute() { if (routeBounds) map.fitBounds(routeBounds, { padding: [40, 40], maxZoom: 14 }); }

function update() {
  const limit = +$("limit").value;
  $("limitText").textContent = dur(limit);
  const origin = $("origin").value;
  const sp = shortestTimes(origin, {
    transfer: Math.max(0, +$("transfer").value || 0),
    wait: $("wait").checked,
    near: $("near").checked,
    firstWait: $("firstwait").checked,
  });
  const times = sp.times;
  // Door-to-door allowance: fixed minutes (walk in, gates, walk out) plus a share of the ride time
  // (waits and delays add up on long trips). Not charged for the start station itself.
  const on = $("buffer").checked;
  const fixed = on ? Math.max(0, +$("bufferMin").value || 0) * 60 : 0;
  const pct = on ? Math.max(0, +$("bufferPct").value || 0) / 100 : 0;
  const rows = [];
  const secOf = new Map();
  for (const st of stations.values()) {
    const ride = times.get(st.key);
    const sec = st.key === origin ? 0 : ride + fixed + ride * pct;
    secOf.set(st.key, sec);
    const min = sec / 60;
    const m = markers.get(st.key);
    const inside = min <= limit;
    const isOrigin = st.key === origin;
    const isDest = st.key === $("dest").value;
    m.setStyle({
      fillColor: inside ? bandColor(min) : css("--out"),
      fillOpacity: inside ? 1 : 0.45,
      radius: isOrigin || isDest ? 10 : 6,
      color: isOrigin ? "#000" : isDest ? "#1a73e8" : "#fff",
    });
    m.bindTooltip(`${st.name}: ${isOrigin ? "start" : Number.isFinite(min) ? fmt(sec) : "unreachable"}`);
    if (isOrigin) m.bringToFront();
    if (Number.isFinite(min)) rows.push({ st, sec, inside });
  }
  for (const sg of segments) {
    const reach = secOf.get(sg.a) / 60 <= limit && secOf.get(sg.b) / 60 <= limit;
    sg.poly.setStyle(reach ? { color: sg.color, weight: 5, opacity: 0.9 } : { color: sg.color, weight: 3, opacity: 0.12 });
  }
  showRoute(sp, origin, $("dest").value, { fixed, pct });
  rows.sort((a, b) => a.sec - b.sec);
  const within = rows.filter((r) => r.inside && r.st.key !== origin).length;
  $("summary").textContent = `${within} stations within ${$("limitText").textContent}`;
  $("results").innerHTML = rows
    .filter((r) => r.inside && r.st.key !== origin)
    .map((r) => `<li data-k="${r.st.key}">${r.st.lines.map((c) => `<span class="chip" style="background:${net.lines[c].color}"></span>`).join("")}${r.st.name}<span class="t">${fmt(r.sec)}</span></li>`)
    .join("");
  for (const li of $("results").children) {
    li.addEventListener("click", () => { const s = stations.get(li.dataset.k); map.setView([s.lat, s.lon], 14); markers.get(s.key).openTooltip(); });
  }
}
update();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
