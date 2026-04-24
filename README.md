# Canoe Hunter

Canoe Hunter monitors Craigslist for canoe listings near a configured ZIP code, stores seen listings in SQLite, scores new listings with OpenAI, scans all listing photos when available, and sends alerts for strong matches.

It does not scrape Facebook Marketplace.

## Design Intent

The target is a "Beer-Forward Fishing Canoe": a stable, sturdy, lightweight, stashable, low-cost pond fishing platform for two people. The ideal boat can be rowed from either end with simple oarlocks, letting two people sit near opposite ends facing the middle so they can pass off rowing, keep forward movement, keep tension on multiple fishing lines, and handle wind without turning the outing into sporty paddling.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with:

- `OPENAI_API_KEY`
- SMTP settings for email alerts
- Optional Twilio settings if `ENABLE_SMS=true`

Dry-run mode is enabled by default, so alerts are logged instead of sent until `DRY_RUN=false`.

`MAX_RESULTS_PER_SEARCH` defaults to `10` to avoid crawling hundreds of stale or loosely related Craigslist results from a single query.

Craigslist distance search is configurable:

```env
SEARCH_POSTAL=12058
SEARCH_DISTANCE_MILES=75
```

## Run Once

```bash
npm run run-once
```

## Start Over

To clear local SQLite state without running a hunt:

```bash
npm run reset
```

To clear local state, start the dashboard, and run the scheduled hunter:

```bash
npm run dev:fresh
```

To clear local state and immediately run a fresh hunt:

```bash
npm run reset-and-run
```

`reset-and-run` is one-shot mode, so it does not start the dashboard.

This deletes local `listings`, `scores`, and `alerts` rows from the configured `DATABASE_PATH`. It does not change `.env`.

## Run On A Schedule

```bash
npm run dev
```

This also starts the dashboard at:

```text
http://localhost:3000
```

Change the port with:

```env
PORT=3000
```

For production:

```bash
npm run build
npm start
```

The default cron schedule is every 30 minutes:

```env
CRON_SCHEDULE=*/30 * * * *
```

## Cheap Deployment

GitHub Pages is not a fit for the hunter itself. Pages only hosts static files, so it cannot run a scheduled Node.js worker, keep private API keys, send email, or maintain a local SQLite database.

Cheap options that work well:

- A small VPS, such as Hetzner, DigitalOcean, Linode, or Fly.io with a persistent volume.
- A home server, old laptop, or Raspberry Pi that stays online.
- A platform with persistent disk support. SQLite needs the `DATABASE_PATH` file to survive restarts.

GitHub Actions can run on a schedule, but it is not ideal here because the runner filesystem is temporary. You would need to store the SQLite database somewhere durable, which defeats the simplicity of local SQLite.

On a VPS, run the app with a process manager such as `pm2` or `systemd`, and keep `DATABASE_PATH` pointed at a persistent location like `/var/lib/canoe-hunter/canoe-hunter.sqlite`.

## Dashboard

The app includes a small campy Adirondack-style dashboard. It shows recent listings, scores, alert status, and a manual "Run Hunt Now" button.

The dashboard is served by the same Node process as the scheduled hunter, so there is no separate frontend build or static hosting setup.

## Craigslist Politeness

The app adds a random 1 to 3 second delay between Craigslist requests and isolates failures so one unavailable region does not crash the whole run. Keep the search schedule reasonable. The default 30-minute cadence is intended for a small personal search.

It also caps each search term with `MAX_RESULTS_PER_SEARCH` and deduplicates URLs within each run.

## Search Coverage

Regions:

- `albany.craigslist.org`
- `hudsonvalley.craigslist.org`
- `westernmass.craigslist.org`
- `catskills.craigslist.org`
- `newyork.craigslist.org`
- `newhaven.craigslist.org`
- `hartford.craigslist.org`
- `vermont.craigslist.org`
- `scranton.craigslist.org`

Search terms focus on the must-have list: Coleman RamX/Ram-X, Sportspal, Radisson, Old Town Hunter 14, Old Town Stillwater 14, Old Town Osprey 140, Royalex, ABS, fiberglass, and 13-14 foot canoe variants.

The app also searches for light rowboats, aluminum rowboats, fiberglass rowboats, 13-14 foot rowboats, and rowboats with oarlocks.

Before fetching detail pages, the app filters out obvious non-matches:

- Wanted, WTB, ISO, and "looking for" posts.
- Kayaks, paddleboards, rafts, inflatables, dinghies, and jon boats.
- Titles that clearly say 15 feet or longer.
- Paddle-only or oar-only listings.
- Listings over `MAX_PRICE`.

## Alert Criteria

An alert is sent only when:

- OpenAI score is at least `ALERT_SCORE_THRESHOLD`, default `70`.
- OpenAI says `shouldAlert` is true.
- Price is at or below `MAX_PRICE`, default `300`.
- The listing has not already been alerted.

## Extracted Canoe Details

For each new listing, OpenAI extracts a canoe dossier from the posting text and all listing photos:

- Make/model
- Exact or estimated length
- Beam width
- Keel: yes, no, or unknown
- Exterior color
- Estimated condition
- Estimated or known weight
- List price
- Recommended bottom and top offer range
- Offer strategy
- Distance from `SEARCH_POSTAL`, when Craigslist exposes coordinates
- Photo findings, such as hull shape, keel, bottom wear, seats, paddles, material clues, or visible damage
- Photo quality score and assessment, based on whether the photos show useful angles like exterior hull, underside, wear areas, and accessories
- Full checklist fields for boat type, make, model, year, length, weight, negotiability, material, hull shape, stability, fishing layout, oars/oarlocks, condition, mod potential, extras, portage score, and match score

The dashboard displays every listing photo as a clickable gallery.

Each dashboard card also includes an `Export PDF` link that generates a camp-style field report for that listing.

The dashboard also has an `Export Top 10 PDF` link for a ranked summary of the best scored candidates.

## Example Alert Email

```text
Strong canoe match found

Old Town Hunter Canoe
$275 - Hudson
https://hudsonvalley.craigslist.org/...

Score: 86/100
Likely model: Old Town Hunter 14
Estimated length: 14 feet
Material: Royalex or ABS plastic
Price assessment: Under budget and worth contacting quickly

Reasons:
- Preferred model and length
- Price is under the configured maximum
- No leaks mentioned

Red flags:
- Seller did not describe underside condition

Questions for seller:
- Any leaks or serious underside wear?
- Do you know the exact model or material?

Suggested message:
Hi, is the canoe still available? I'm looking for a 13-14 foot canoe for pond fishing. Any leaks or serious wear on the underside? Also, do you happen to know the model or material? I can pick up quickly if it's a good fit. Thanks.
```
