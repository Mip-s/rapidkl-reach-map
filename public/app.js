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
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Rail data: Prasarana via data.gov.my',
}).addTo(map);
for (const l of Object.values(net.lines)) {
  L.polyline(l.shape, { color: l.color, weight: 4, opacity: 0.65 }).addTo(map);
}
const markers = new Map();
for (const st of stations.values()) {
  const m = L.circleMarker([st.lat, st.lon], { radius: 6, weight: 2, color: "#fff", fillOpacity: 1 }).addTo(map);
  m.on("click", () => { $("origin").value = st.key; update(); });
  markers.set(st.key, m);
}

// Controls
const sorted = [...stations.values()].sort((a, b) => a.name.localeCompare(b.name));
$("origin").innerHTML = sorted
  .map((s) => `<option value="${s.key}">${s.name} (${s.lines.map((c) => net.lines[c].name.replace(/ Line$/, "")).join(", ")})</option>`)
  .join("");
$("origin").value = [...stations.values()].find((s) => s.name === "KL Sentral")?.key ?? sorted[0].key;
for (const id of ["origin", "limit", "transfer", "wait", "near", "firstwait"]) $(id).addEventListener("input", update);
for (const b of document.querySelectorAll(".presets button")) b.addEventListener("click", () => { $("limit").value = b.dataset.min; update(); });

function fmt(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

function update() {
  const limit = +$("limit").value;
  $("limitText").textContent = limit >= 60 && limit % 60 === 0 ? `${limit / 60} h` : `${limit} min`;
  const origin = $("origin").value;
  const times = shortestTimes(origin, {
    transfer: Math.max(0, +$("transfer").value || 0),
    wait: $("wait").checked,
    near: $("near").checked,
    firstWait: $("firstwait").checked,
  });
  const rows = [];
  for (const st of stations.values()) {
    const min = times.get(st.key) / 60;
    const m = markers.get(st.key);
    const inside = min <= limit;
    const isOrigin = st.key === origin;
    m.setStyle({
      fillColor: inside ? bandColor(min) : css("--out"),
      fillOpacity: inside ? 1 : 0.45,
      radius: isOrigin ? 10 : 6,
      color: isOrigin ? "#000" : "#fff",
    });
    m.bindTooltip(`${st.name}: ${isOrigin ? "start" : Number.isFinite(min) ? fmt(times.get(st.key)) : "unreachable"}`);
    if (isOrigin) m.bringToFront();
    if (Number.isFinite(min)) rows.push({ st, sec: times.get(st.key), inside });
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
