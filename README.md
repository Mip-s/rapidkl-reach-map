# RapidKL Reach Map

Pick an LRT, MRT or Monorail station and see the minimum rail time to every other station, on a real OpenStreetMap map.

## How times are computed
- Ride times: median stop-to-stop time from the weekday Prasarana GTFS timetable (`data/gtfs/`, source: https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl).
- Interchanges: stops with the same station name are joined; changing lines costs a walk (default 5 min) plus half the line's average headway.
- Nearby walking links (e.g. Merdeka - Plaza Rakyat): stops of different lines within 400 m, walked at 4.8 km/h with a 1.3x street factor. These are unverified candidates and can be switched off in the UI.
- Enter and exit allowance: 20 min + 20% of the ride time (both adjustable) is added to every destination, so times lean long. Calibrated on 72 usable Google Maps pairs (see Accuracy): at or above Google on 68 of 72.
- Shortest paths use Dijkstra in the browser.

## Rebuild the data
```
python3 scripts/build_network.py
```
Writes `public/data/network.json`. Scope: LRT, MRT, Monorail (BRT is excluded).

## Hosting (Cloudflare)
Static files only, no build step. `wrangler.jsonc` serves the `public` folder as Workers static assets.
- Workers (current Cloudflare flow): connect this repo, leave the build command empty, deploy command `npx wrangler deploy`.
- Pages (older flow): build command empty, output directory `public`.

## Accuracy
`data/accuracy/pairs.csv` holds 100 random station pairs; `data/accuracy/google_results.csv` holds the shortest rail-only Google Maps time for each ("Leave now", Fri 30 Oct 2026, about 10 am; buses, KTM Komuter and ETS excluded). 28 pairs were unusable (no rail-only route, or Google resolved a station name to the wrong place), leaving 72.
- Raw station-to-station times are a median 14 min below Google (Google counts walking in and out, waiting and real headways).
- Allowance 15 min + 10% was at or above Google on 49 of 72 pairs; 20 min + 20% covers 68 of 72 with a mean overshoot of about 14 min.
- The 4 remaining misses are 6 to 11 min under, on long multi-line trips.
- Google's own estimate already includes padding, so this errs long on purpose.
