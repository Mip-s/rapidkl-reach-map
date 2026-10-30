"""Build public/data/network.json from the Prasarana rapid-rail GTFS feed.

Source: https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl
Raw files are kept in data/gtfs/. Run: python3 scripts/build_network.py
"""
import csv, json, math, statistics, collections, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GTFS = os.path.join(ROOT, "data", "gtfs")
OUT = os.path.join(ROOT, "public", "data", "network.json")

# stops.txt route_id -> (stop_times.txt route_id, shape_id, display name, colour)
LINES = {
    "KJ":  ("KJL", "shp_KJ_0",  "Kelana Jaya Line", "#D50032", "LRT"),
    "AG":  ("AGL", "shp_AG_0",  "Ampang Line", "#E57200", "LRT"),
    "PH":  ("SPL", "shp_PH_0",  "Sri Petaling Line", "#76232F", "LRT"),
    "SA":  ("SAL", "shp_SA_0",  "Shah Alam Line", "#FF00FF", "LRT"),
    "MRT": ("KGL", "shp_MRT_0", "Kajang Line", "#047940", "MRT"),
    "PYL": ("PYL", "shp_PYL_0", "Putrajaya Line", "#FFCD00", "MRT"),
    "MR":  ("MRL", "shp_MR_0",  "KL Monorail", "#84BD00", "Monorail"),
}
# Distance under which two stops of different lines are listed as walk-link candidates.
CANDIDATE_M = 400


def rows(name):
    with open(os.path.join(GTFS, name), encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def secs(t):
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def haversine(a, b):
    r = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def base_name(name):
    """Drop sponsor suffixes such as 'KL SENTRAL - REDONE'."""
    return " ".join(name.split(" - ")[0].split()).strip()


def norm(name):
    return base_name(name).upper()


stops = {}
for r in rows("stops.txt"):
    if r["route_id"] in LINES and r["status"] == "valid":
        stops[r["stop_id"]] = {
            "id": r["stop_id"], "name": base_name(r["stop_name"]),
            "line": r["route_id"], "lat": float(r["stop_lat"]), "lon": float(r["stop_lon"]),
        }

# Ride edges: arrival-to-arrival time between consecutive stops (includes dwell at the first),
# median over all Monday-Friday trips, per direction.
by_trip = collections.defaultdict(list)
for r in rows("stop_times.txt"):
    if "_MonFri_" in r["trip_id"] and r["stop_id"] in stops:
        by_trip[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], secs(r["arrival_time"])))
samples = collections.defaultdict(list)
for trip in by_trip.values():
    trip.sort()
    for (_, a, ta), (_, b, tb) in zip(trip, trip[1:]):
        samples[(a, b)].append(tb - ta)
edges = [{"a": a, "b": b, "s": round(statistics.median(v))} for (a, b), v in sorted(samples.items())]

# Average wait when boarding = half the all-day average headway of the line (weekday).
freq = collections.defaultdict(list)
for r in rows("frequencies.txt"):
    if "_MonFri_" in r["trip_id"]:
        dur = secs(r["end_time"]) - secs(r["start_time"])
        freq[r["trip_id"].split("_")[0]].append((dur, int(r["headway_secs"])))
headway = {}
for code, (stcode, *_rest) in LINES.items():
    w = [(d, h) for k, v in freq.items() if k == stcode for d, h in v]
    headway[code] = round(sum(d for d, _ in w) / sum(d / h for d, h in w)) if w else 300

# Interchanges: same normalised name on different lines (certain), plus nearby stops (candidates).
groups = collections.defaultdict(list)
for s in stops.values():
    groups[norm(s["name"])].append(s["id"])
same_name = [ids for ids in groups.values() if len({stops[i]["line"] for i in ids}) > 1]
paired = set()
for ids in same_name:
    for i in ids:
        for j in ids:
            if i < j and stops[i]["line"] != stops[j]["line"]:
                paired.add((i, j))
candidates = []
ids = sorted(stops)
for i, a in enumerate(ids):
    for b in ids[i + 1:]:
        sa, sb = stops[a], stops[b]
        if sa["line"] == sb["line"] or (a, b) in paired:
            continue
        d = haversine((sa["lat"], sa["lon"]), (sb["lat"], sb["lon"]))
        if d <= CANDIDATE_M:
            candidates.append({"a": a, "b": b, "m": round(d)})

shapes = collections.defaultdict(list)
for r in rows("shapes.txt"):
    shapes[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))

lines = {}
for code, (_st, shp, name, colour, kind) in LINES.items():
    pts = [[round(la, 5), round(lo, 5)] for _, la, lo in sorted(shapes[shp])]
    lines[code] = {"name": name, "color": colour, "kind": kind, "headway_s": headway[code], "shape": pts[::2] + [pts[-1]]}

out = {
    "source": "Prasarana rapid-rail-kl GTFS via data.gov.my",
    "lines": lines,
    "stops": sorted(stops.values(), key=lambda s: s["id"]),
    "edges": edges,
    "interchanges": [{"a": a, "b": b} for a, b in sorted(paired)],
    "candidates": candidates,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(out, f, separators=(",", ":"))
print(len(stops), "stops;", len(edges), "edges;", len(paired), "name-matched pairs;", len(candidates), "candidates")
print("headways", headway)
for c in candidates:
    print(c["m"], "m", stops[c["a"]]["name"], c["a"], "<->", stops[c["b"]]["name"], c["b"])
