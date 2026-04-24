import type { Server } from 'node:http';
import express from 'express';
import { AppConfig, DashboardListing } from './types.js';
import { CanoeHunterDb } from './db.js';

interface ServerOptions {
  config: AppConfig;
  getIsRunning: () => boolean;
  runHunt: () => Promise<void>;
  shutdown: () => void;
}

export function startServer({ config, getIsRunning, runHunt, shutdown }: ServerOptions): Server {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get('/', (_request, response) => {
    const db = new CanoeHunterDb(config);

    try {
      const listings = db.listDashboardListings(75);
      response.type('html').send(renderDashboard(listings, config, getIsRunning()));
    } finally {
      db.close();
    }
  });

  app.get('/api/listings', (_request, response) => {
    const db = new CanoeHunterDb(config);

    try {
      response.json(db.listDashboardListings(75));
    } finally {
      db.close();
    }
  });

  app.post('/run-now', (_request, response) => {
    runHunt().catch((error) => console.error('Manual canoe hunt failed:', error));
    response.redirect('/');
  });

  app.post('/shutdown', (_request, response) => {
    response.type('html').send('<p>Canoe Hunter is shutting down. You can close this tab.</p>');
    setTimeout(shutdown, 250);
  });

  app.get('/health', (_request, response) => {
    response.json({ ok: true, running: getIsRunning() });
  });

  return app.listen(config.port, () => {
    console.log(`Canoe Hunter dashboard paddling at http://localhost:${config.port}`);
  });
}

function renderDashboard(listings: DashboardListing[], config: AppConfig, isRunning: boolean): string {
  const scored = listings.filter((listing) => listing.matchScore !== null);
  const alerted = listings.filter((listing) => listing.alertSentAt !== null);
  const topScore = scored.reduce((best, listing) => Math.max(best, listing.matchScore ?? 0), 0);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${isRunning ? '<meta http-equiv="refresh" content="10">' : ''}
    <title>Canoe Hunter</title>
    <style>${styles()}</style>
  </head>
  <body>
    <div class="sky">
      <header class="hero">
        <div>
          <p class="eyebrow">Hudson Valley Classified Recon</p>
          <h1>Canoe Hunter</h1>
          <p class="tagline">A campy little Craigslist lookout for pond-fishing canoes, porch coffee, and suspiciously good deals under $${config.maxPrice}.</p>
        </div>
        <div class="hero-actions">
          <form method="post" action="/run-now">
            <button class="run-button" type="submit" ${isRunning ? 'disabled' : ''}>
              ${isRunning ? 'Paddling...' : 'Run Hunt Now'}
            </button>
          </form>
          <form method="post" action="/shutdown">
            <button class="shutdown-button" type="submit">Shut Down</button>
          </form>
        </div>
      </header>

      <main>
        <section class="status-grid" aria-label="Hunt status">
          ${statCard('Listings Seen', listings.length.toString(), 'fresh tracks in the mud')}
          ${statCard('Scored', scored.length.toString(), 'judged by the camp oracle')}
          ${statCard('Top Score', `${topScore}/100`, 'best canoe-shaped blip')}
          ${statCard('Alerts Sent', alerted.length.toString(), config.dryRun ? 'dry-run smoke signals' : 'real smoke signals')}
          ${statCard('Hunt Status', isRunning ? 'Running' : 'Idle', isRunning ? 'page refreshes every 10s' : 'waiting for next paddle')}
        </section>

        <section class="notice">
          <div class="patch">ADK</div>
          <div>
            <h2>Camp Rules</h2>
            <p>Targeting 13-14 foot canoes within ${config.searchDistanceMiles} miles of ${escapeHtml(config.searchPostal)}. Aluminum tubs, leaky hulls, inflatables, kayaks, and over-budget dreamboats get the cold beans treatment.</p>
          </div>
        </section>

        <section class="listings">
          <div class="section-heading">
            <p class="eyebrow">Recent Sightings</p>
            <h2>The Canoe Board</h2>
          </div>
          ${listings.length > 0 ? listings.map(renderListingCard).join('') : emptyState()}
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function renderListingCard(listing: DashboardListing): string {
  const price = listing.price === null ? 'Price unknown' : `$${listing.price}`;
  const scoreClass = scoreTone(listing.matchScore);
  const image = listing.imageUrls[0];
  const reasons = listing.reasonsForMatch.slice(0, 3);
  const redFlags = listing.redFlags.slice(0, 3);
  const photoFindings = listing.photoFindings.slice(0, 3);
  const offerRange = formatOfferRange(listing.offerRangeBottom, listing.offerRangeTop);

  return `
    <article class="listing-card">
      <div class="listing-image ${image ? '' : 'empty-image'}">
        ${image ? `<img src="${escapeHtml(image)}" alt="">` : '<span>Canoe<br>Wanted</span>'}
      </div>
      <div class="listing-body">
        <div class="listing-topline">
          <span class="region">${escapeHtml(listing.source.replace('.craigslist.org', ''))}</span>
          <span>${formatDate(listing.firstSeenAt)}</span>
        </div>
        <h3><a href="${escapeHtml(listing.url)}" target="_blank" rel="noreferrer">${escapeHtml(listing.title)}</a></h3>
        <div class="meta-row">
          <strong>${escapeHtml(price)}</strong>
          ${listing.location ? `<span>${escapeHtml(listing.location)}</span>` : ''}
          ${listing.distanceMiles !== null ? `<span>${listing.distanceMiles} mi away</span>` : ''}
          ${listing.exactLength ? `<span>${escapeHtml(listing.exactLength)}</span>` : listing.estimatedLength ? `<span>${escapeHtml(listing.estimatedLength)}</span>` : ''}
          ${listing.materialGuess ? `<span>${escapeHtml(listing.materialGuess)}</span>` : ''}
        </div>
        <div class="detail-grid">
          ${detailItem('Make / Model', listing.makeModel ?? listing.likelyModel)}
          ${detailItem('Length', listing.exactLength ?? listing.estimatedLength)}
          ${detailItem('Beam', listing.beamWidth)}
          ${detailItem('Keel', listing.keel)}
          ${detailItem('Color', listing.exteriorColor)}
          ${detailItem('Weight', listing.estimatedWeight)}
          ${detailItem('Condition', listing.estimatedCondition)}
          ${detailItem('Offer Range', offerRange)}
          ${detailItem('Distance', listing.distanceMiles === null ? null : `${listing.distanceMiles} miles`)}
        </div>
        <p class="assessment">${escapeHtml(listing.priceAssessment ?? 'Not scored yet. Waiting by the fire.')}</p>
        ${listing.offerStrategy ? `<p class="offer-strategy">${escapeHtml(listing.offerStrategy)}</p>` : ''}
        ${renderPillList('Photo Clues', photoFindings)}
        ${renderPillList('Why It Might Float', reasons)}
        ${renderPillList('Camp Warnings', redFlags, 'warning')}
      </div>
      <aside class="score-card ${scoreClass}">
        <span>Score</span>
        <strong>${listing.matchScore === null ? '--' : listing.matchScore}</strong>
        <small>${listing.shouldAlert ? 'Alert worthy' : listing.alertSentAt ? 'Alert sent' : 'Watch list'}</small>
      </aside>
    </article>
  `;
}

function detailItem(label: string, value: string | null | undefined): string {
  if (!value || value.toLowerCase() === 'unknown') {
    return '';
  }

  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function formatOfferRange(bottom: number | null, top: number | null): string | null {
  if (bottom === null && top === null) {
    return null;
  }

  if (bottom !== null && top !== null) {
    return `$${bottom}-$${top}`;
  }

  return `$${bottom ?? top}`;
}

function statCard(label: string, value: string, note: string): string {
  return `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function renderPillList(label: string, items: string[], tone = ''): string {
  if (items.length === 0) {
    return '';
  }

  return `
    <div class="pill-group ${tone}">
      <span>${escapeHtml(label)}</span>
      ${items.map((item) => `<em>${escapeHtml(item)}</em>`).join('')}
    </div>
  `;
}

function emptyState(): string {
  return `
    <div class="empty-state">
      <h3>No sightings yet</h3>
      <p>Start the hunter, pour camp coffee, and check back after the first Craigslist loop.</p>
    </div>
  `;
}

function scoreTone(score: number | null): string {
  if (score === null) {
    return 'score-muted';
  }

  if (score >= 70) {
    return 'score-hot';
  }

  if (score >= 45) {
    return 'score-warm';
  }

  return 'score-cold';
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Date unknown';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function styles(): string {
  return `
    :root {
      color-scheme: light;
      --bark: #3c2415;
      --bark-soft: #624126;
      --camp-red: #a73525;
      --canoe: #c9682d;
      --cream: #fff2d6;
      --paper: #f8e3bd;
      --pine: #163f2d;
      --pine-soft: #2f6b49;
      --lake: #315f72;
      --shadow: rgba(35, 21, 10, 0.22);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--bark);
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at 15% 12%, rgba(255, 242, 214, 0.95), transparent 24rem),
        linear-gradient(135deg, rgba(22, 63, 45, 0.13) 25%, transparent 25%) 0 0 / 34px 34px,
        linear-gradient(225deg, rgba(167, 53, 37, 0.12) 25%, transparent 25%) 0 0 / 34px 34px,
        var(--paper);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(180deg, rgba(49, 95, 114, 0.18), transparent 26rem),
        repeating-linear-gradient(90deg, transparent 0 70px, rgba(60, 36, 21, 0.035) 70px 72px);
    }

    .sky {
      min-height: 100vh;
      padding: 28px;
      position: relative;
    }

    .hero,
    main {
      max-width: 1180px;
      margin: 0 auto;
    }

    .hero {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: center;
      padding: 38px;
      border: 6px solid var(--bark);
      border-radius: 28px;
      background:
        linear-gradient(135deg, rgba(255, 242, 214, 0.92), rgba(248, 227, 189, 0.86)),
        repeating-linear-gradient(45deg, rgba(167, 53, 37, 0.13) 0 16px, rgba(22, 63, 45, 0.13) 16px 32px);
      box-shadow: 10px 12px 0 var(--shadow);
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--camp-red);
      font-family: Arial, sans-serif;
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    h1,
    h2,
    h3,
    p {
      margin-top: 0;
    }

    h1 {
      margin-bottom: 10px;
      font-size: clamp(3rem, 9vw, 6.8rem);
      line-height: 0.86;
      letter-spacing: -0.08em;
      text-transform: uppercase;
      text-shadow: 4px 4px 0 rgba(167, 53, 37, 0.22);
    }

    h2 {
      margin-bottom: 8px;
      font-size: clamp(1.8rem, 4vw, 3rem);
      line-height: 1;
    }

    h3 {
      margin-bottom: 12px;
      font-size: 1.55rem;
      line-height: 1.05;
    }

    a {
      color: var(--pine);
    }

    .tagline {
      max-width: 720px;
      margin-bottom: 0;
      color: var(--bark-soft);
      font-size: 1.18rem;
      line-height: 1.45;
    }

    .run-button {
      min-width: 170px;
      padding: 16px 20px;
      border: 4px solid var(--bark);
      border-radius: 999px;
      color: var(--cream);
      cursor: pointer;
      font: 900 0.95rem Arial, sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: linear-gradient(180deg, var(--canoe), var(--camp-red));
      box-shadow: 5px 6px 0 var(--bark);
    }

    .run-button:disabled {
      cursor: wait;
      opacity: 0.7;
    }

    .hero-actions {
      display: grid;
      gap: 12px;
    }

    .shutdown-button {
      width: 100%;
      padding: 12px 16px;
      border: 3px solid var(--bark);
      border-radius: 999px;
      color: var(--bark);
      cursor: pointer;
      font: 900 0.78rem Arial, sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: rgba(255, 242, 214, 0.86);
      box-shadow: 4px 5px 0 var(--shadow);
    }

    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin: 28px 0;
    }

    .stat-card,
    .notice,
    .listing-card,
    .empty-state {
      border: 4px solid var(--bark);
      background: rgba(255, 242, 214, 0.92);
      box-shadow: 7px 8px 0 var(--shadow);
    }

    .stat-card {
      padding: 20px;
      border-radius: 22px;
    }

    .stat-card span,
    .stat-card small,
    .score-card span,
    .score-card small {
      display: block;
      font-family: Arial, sans-serif;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .stat-card strong {
      display: block;
      margin: 8px 0;
      font-size: 2.5rem;
      line-height: 1;
    }

    .stat-card small,
    .score-card small {
      color: var(--bark-soft);
      font-size: 0.7rem;
    }

    .notice {
      display: flex;
      gap: 18px;
      align-items: center;
      margin-bottom: 34px;
      padding: 22px;
      border-radius: 26px;
      background:
        linear-gradient(90deg, rgba(22, 63, 45, 0.12), rgba(255, 242, 214, 0.92)),
        var(--cream);
    }

    .notice p {
      margin-bottom: 0;
      line-height: 1.5;
    }

    .patch {
      display: grid;
      width: 76px;
      height: 76px;
      flex: 0 0 auto;
      place-items: center;
      border: 4px solid var(--bark);
      border-radius: 50%;
      color: var(--cream);
      font: 900 1.2rem Arial, sans-serif;
      background: radial-gradient(circle, var(--lake), var(--pine));
      box-shadow: inset 0 0 0 5px rgba(255, 242, 214, 0.22);
    }

    .section-heading {
      margin-bottom: 18px;
    }

    .listing-card {
      display: grid;
      grid-template-columns: 172px 1fr 120px;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 20px;
      padding: 16px;
      border-radius: 24px;
    }

    .listing-image {
      min-height: 150px;
      overflow: hidden;
      border: 4px solid var(--bark);
      border-radius: 18px;
      background: linear-gradient(135deg, var(--lake), var(--pine-soft));
    }

    .listing-image img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .empty-image {
      display: grid;
      place-items: center;
      color: var(--cream);
      font: 900 1rem Arial, sans-serif;
      letter-spacing: 0.1em;
      text-align: center;
      text-transform: uppercase;
    }

    .listing-topline,
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      color: var(--bark-soft);
      font-family: Arial, sans-serif;
      font-size: 0.82rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .region {
      padding: 4px 9px;
      border-radius: 999px;
      color: var(--cream);
      background: var(--pine);
    }

    .meta-row {
      margin-bottom: 12px;
    }

    .meta-row span,
    .meta-row strong {
      padding: 5px 9px;
      border: 2px solid rgba(60, 36, 21, 0.22);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.38);
    }

    .assessment {
      margin-bottom: 12px;
      line-height: 1.45;
    }

    .offer-strategy {
      margin-bottom: 12px;
      color: var(--bark-soft);
      font-size: 0.95rem;
      line-height: 1.45;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px;
      margin: 12px 0;
    }

    .detail-grid div {
      padding: 9px;
      border: 2px solid rgba(60, 36, 21, 0.18);
      border-radius: 13px;
      background: rgba(255, 255, 255, 0.36);
    }

    .detail-grid span {
      display: block;
      color: var(--camp-red);
      font: 900 0.66rem Arial, sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .detail-grid strong {
      display: block;
      margin-top: 3px;
      font-size: 0.95rem;
      line-height: 1.2;
    }

    .pill-group {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 8px;
      font-family: Arial, sans-serif;
    }

    .pill-group span {
      width: 100%;
      color: var(--pine);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .pill-group em {
      padding: 6px 9px;
      border-radius: 999px;
      color: var(--cream);
      font-size: 0.82rem;
      font-style: normal;
      font-weight: 800;
      background: var(--pine-soft);
    }

    .pill-group.warning em {
      background: var(--camp-red);
    }

    .score-card {
      display: grid;
      place-items: center;
      align-content: center;
      min-height: 150px;
      padding: 14px;
      border: 4px solid var(--bark);
      border-radius: 18px;
      text-align: center;
      background: var(--paper);
    }

    .score-card strong {
      display: block;
      margin: 8px 0;
      font-size: 3rem;
      line-height: 1;
    }

    .score-hot {
      background: linear-gradient(180deg, #f7bd54, var(--canoe));
    }

    .score-warm {
      background: linear-gradient(180deg, #f8dc8f, #d99845);
    }

    .score-cold,
    .score-muted {
      background: linear-gradient(180deg, #d8e1cd, #9db5a0);
    }

    .empty-state {
      padding: 38px;
      border-radius: 24px;
      text-align: center;
    }

    @media (max-width: 860px) {
      .hero,
      .notice {
        align-items: flex-start;
        flex-direction: column;
      }

      .status-grid,
      .listing-card {
        grid-template-columns: 1fr;
      }

      .listing-image,
      .score-card {
        min-height: 120px;
      }
    }
  `;
}
