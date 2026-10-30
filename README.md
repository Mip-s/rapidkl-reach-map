# RapidKL Reach Map

Pick an LRT, MRT or Monorail station and see the minimum rail time to every other station, on a real OpenStreetMap map.

## How times are computed
- Ride times: median stop-to-stop time from the weekday Prasarana GTFS timetable (`data/gtfs/`, source: https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl).
- Interchanges: stops with the same station name are joined; changing lines costs a walk (default 5 min) plus half the line's average headway.
- Nearby walking links (e.g. Merdeka - Plaza Rakyat): stops of different lines within 400 m, walked at 4.8 km/h with a 1.3x street factor. These are unverified candidates and can be switched off in the UI.
- Enter and exit allowance: 10 min (adjustable) is added to every destination, because door-to-door tools such as Google Maps count walking in and out. In a 10-pair check, station-to-station times were 3 to 21 min (median about 14) below Google Maps.
- Shortest paths use Dijkstra in the browser.

## Rebuild the data
```
python3 scripts/build_network.py
```
Writes `public/data/network.json`. Scope: LRT, MRT, Monorail (BRT is excluded).

## Hosting (Cloudflare Pages)
No build step. Build command: empty. Output directory: `public`.
