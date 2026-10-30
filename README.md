# RapidKL Reach Map

Pick an LRT, MRT or Monorail station and see the minimum rail time to every other station, on a real OpenStreetMap map.

## How times are computed
- Ride times: median stop-to-stop time from the weekday Prasarana GTFS timetable (`data/gtfs/`, source: https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl).
- Interchanges: stops with the same station name are joined; changing lines costs a walk (default 5 min) plus half the line's average headway.
- Nearby walking links (e.g. Merdeka - Plaza Rakyat): stops of different lines within 400 m, walked at 4.8 km/h with a 1.3x street factor. These are unverified candidates and can be switched off in the UI.
- Enter and exit allowance: 15 min + 10% of the ride time (both adjustable) is added to every destination, so times lean long. Google Maps counts walking in and out, and in a 20-pair check (ten line-end pairs and ten others) this setting was at or above Google on 18 of 20 pairs. Unmodified station-to-station times were 1 to 24 min below Google.
- Shortest paths use Dijkstra in the browser.

## Rebuild the data
```
python3 scripts/build_network.py
```
Writes `public/data/network.json`. Scope: LRT, MRT, Monorail (BRT is excluded).

## Hosting (Cloudflare Pages)
No build step. Build command: empty. Output directory: `public`.
