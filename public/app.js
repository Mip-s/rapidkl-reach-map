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
    for (const [v, w] of adj.get(u)) if (dist.get(u) + w < dist.get(v)) dist.set(v, dist.get(u) + w);
  }
  const out = new Map();
  for (const st of stations.values()) out.set(st.key, Math.min(...st.stops.map((s) => dist.get(s.id))));
  return out;
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
    segments.push({ poly, a: find(A.s.id), b: find(B.s.id), color: line.color });
  }
}
const markers = new Map();
for (const st of stations.values()) {
  const m = L.circleMarker([st.lat, st.lon], { radius: 6, weight: 2, color: "#fff", fillOpacity: 1 }).addTo(map);
  m.on("click", () => setOrigin(st.key));
  markers.set(st.key, m);
}

// Controls
const sorted = [...stations.values()].sort((a, b) => a.name.localeCompare(b.name));
const lineNames = (s) => s.lines.map((c) => net.lines[c].name.replace(/ Line$/, "")).join(", ");
const search = $("originSearch");
const box = $("suggest");
let matches = [];
let active = -1;

function setOrigin(key) {
  $("origin").value = key;
  search.value = stations.get(key).name;
  closeSuggest();
  update();
}
function closeSuggest() {
  box.hidden = true;
  search.setAttribute("aria-expanded", "false");
  active = -1;
}
function renderSuggest() {
  const q = search.value.trim().toLowerCase();
  matches = sorted.filter((s) => !q || s.name.toLowerCase().includes(q) || s.stops.some((p) => p.id.toLowerCase() === q) || lineNames(s).toLowerCase().includes(q));
  matches.sort((a, b) => !a.name.toLowerCase().startsWith(q) - !b.name.toLowerCase().startsWith(q) || a.name.localeCompare(b.name));
  active = matches.length ? 0 : -1;
  box.innerHTML = matches.length
    ? matches.map((s, i) => `<li role="option" data-k="${s.key}" class="${i === active ? "on" : ""}">${s.lines.map((c) => `<span class="chip" style="background:${net.lines[c].color}"></span>`).join("")}${s.name}<small>${lineNames(s)}</small></li>`).join("")
    : `<li>No station found</li>`;
  box.hidden = false;
  search.setAttribute("aria-expanded", "true");
}
search.addEventListener("focus", () => { search.select(); renderSuggest(); });
search.addEventListener("click", () => { if (box.hidden) { search.select(); renderSuggest(); } });
search.addEventListener("input", renderSuggest);
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (box.hidden) renderSuggest();
    if (!matches.length) return;
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    [...box.children].forEach((li, i) => li.classList.toggle("on", i === active));
    box.children[active].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && active >= 0) {
    e.preventDefault();
    setOrigin(matches[active].key);
    search.blur();
  } else if (e.key === "Escape") {
    e.preventDefault(); // a search input would otherwise clear itself
    search.value = stations.get($("origin").value).name;
    closeSuggest();
  }
});
box.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li[data-k]");
  if (li) { e.preventDefault(); setOrigin(li.dataset.k); search.blur(); }
});
search.addEventListener("blur", () => {
  if ($("origin").value) search.value = stations.get($("origin").value).name;
  closeSuggest();
});
$("origin").value = [...stations.values()].find((s) => s.name === "KL Sentral")?.key ?? sorted[0].key;
search.value = stations.get($("origin").value).name;
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

function update() {
  const limit = +$("limit").value;
  $("limitText").textContent = dur(limit);
  const origin = $("origin").value;
  const times = shortestTimes(origin, {
    transfer: Math.max(0, +$("transfer").value || 0),
    wait: $("wait").checked,
    near: $("near").checked,
    firstWait: $("firstwait").checked,
  });
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
    m.setStyle({
      fillColor: inside ? bandColor(min) : css("--out"),
      fillOpacity: inside ? 1 : 0.45,
      radius: isOrigin ? 10 : 6,
      color: isOrigin ? "#000" : "#fff",
    });
    m.bindTooltip(`${st.name}: ${isOrigin ? "start" : Number.isFinite(min) ? fmt(sec) : "unreachable"}`);
    if (isOrigin) m.bringToFront();
    if (Number.isFinite(min)) rows.push({ st, sec, inside });
  }
  for (const sg of segments) {
    const reach = secOf.get(sg.a) / 60 <= limit && secOf.get(sg.b) / 60 <= limit;
    sg.poly.setStyle(reach ? { color: sg.color, weight: 5, opacity: 0.9 } : { color: sg.color, weight: 3, opacity: 0.12 });
  }
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
