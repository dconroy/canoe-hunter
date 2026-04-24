import type { Server } from 'node:http';
import express from 'express';
import PDFDocument from 'pdfkit';
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

  app.get('/report.pdf', (request, response) => {
    const listingUrl = String(request.query.url ?? '');

    if (!listingUrl) {
      response.status(400).send('Missing listing URL');
      return;
    }

    const db = new CanoeHunterDb(config);

    try {
      const listing = db.listDashboardListings(500).find((item) => item.url === listingUrl);

      if (!listing) {
        response.status(404).send('Listing not found');
        return;
      }

      response.setHeader('content-type', 'application/pdf');
      response.setHeader('content-disposition', `attachment; filename="${safeFilename(listing.title)}.pdf"`);
      renderListingPdf(listing, response);
    } finally {
      db.close();
    }
  });

  app.get('/top-10.pdf', (_request, response) => {
    const db = new CanoeHunterDb(config);

    try {
      const listings = db.listDashboardListings(500).filter((item) => item.matchScore !== null).slice(0, 10);
      response.setHeader('content-type', 'application/pdf');
      response.setHeader('content-disposition', 'attachment; filename="canoe-hunter-top-10.pdf"');
      renderTopTenPdf(listings, response);
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
            <a class="top-report-link" href="/top-10.pdf">Export Top 10 PDF</a>
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
          <a class="report-link" href="/report.pdf?url=${encodeURIComponent(listing.url)}">Export PDF</a>
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
          ${detailItem('Photo Quality', formatPhotoQuality(listing))}
          ${detailItem('Offer Range', offerRange)}
          ${detailItem('Distance', listing.distanceMiles === null ? null : `${listing.distanceMiles} miles`)}
        </div>
        <p class="assessment">${escapeHtml(listing.priceAssessment ?? 'Not scored yet. Waiting by the fire.')}</p>
        ${listing.photoQualityAssessment ? `<p class="offer-strategy">${escapeHtml(listing.photoQualityAssessment)}</p>` : ''}
        ${listing.offerStrategy ? `<p class="offer-strategy">${escapeHtml(listing.offerStrategy)}</p>` : ''}
        ${renderPhotoGallery(listing.imageUrls)}
        ${renderAnalysisDetails(listing.analysisDetails)}
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

function renderListingPdf(listing: DashboardListing, stream: NodeJS.WritableStream): void {
  const doc = new PDFDocument({ margin: 42, size: 'LETTER' });
  const price = listing.price === null ? 'Unknown price' : `$${listing.price}`;
  const offerRange = formatOfferRange(listing.offerRangeBottom, listing.offerRangeTop) ?? 'No offer recommended';

  doc.pipe(stream);
  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8e3bd');
  doc.lineWidth(4).strokeColor('#3c2415').roundedRect(28, 28, doc.page.width - 56, doc.page.height - 56, 18).stroke();
  doc.fillColor('#163f2d').fontSize(11).font('Helvetica-Bold').text('CANOE HUNTER FIELD REPORT', 48, 50);
  doc.fillColor('#3c2415').fontSize(28).font('Helvetica-Bold').text(listing.title, 48, 72, { width: 420 });
  doc.fillColor('#624126').fontSize(11).font('Helvetica-Bold').text(`${price}  |  ${listing.location ?? 'Unknown location'}  |  ${listing.distanceMiles ?? 'Unknown'} miles`, 48, 110);

  doc.roundedRect(468, 54, 82, 82, 12).fillAndStroke('#f7bd54', '#3c2415');
  doc.fillColor('#3c2415').fontSize(9).font('Helvetica-Bold').text('SCORE', 486, 72, { width: 48, align: 'center' });
  doc.fontSize(28).text(String(listing.matchScore ?? '--'), 486, 88, { width: 48, align: 'center' });

  let y = 150;
  y = pdfSection(doc, 'Core Fit', y, [
    ['Make / Model', listing.makeModel ?? listing.likelyModel],
    ['Length', listing.exactLength ?? listing.estimatedLength],
    ['Weight', listing.estimatedWeight],
    ['Material', listing.materialGuess],
    ['Color', listing.exteriorColor],
    ['Keel', listing.keel],
    ['Condition', listing.estimatedCondition],
    ['Offer Range', offerRange],
  ]);

  y = pdfSection(doc, 'Beer-Forward Fishing Analysis', y + 8, [
    ['Boat Type', listing.analysisDetails.BOAT_TYPE],
    ['Hull Shape', listing.analysisDetails.HULL_SHAPE],
    ['Stability', listing.analysisDetails.STABILITY_SCORE_1_10],
    ['Fishing Friendly', listing.analysisDetails.FISHING_FRIENDLY],
    ['Two Person', listing.analysisDetails.TWO_PERSON],
    ['Facing Seats', listing.analysisDetails.FACING_SEATS_POSSIBLE],
    ['Oarlocks', listing.analysisDetails.OARLOCKS],
    ['Dual Row', listing.analysisDetails.DUAL_ROW_CAPABLE],
    ['Portage', listing.analysisDetails.PORTAGE_SCORE_1_10],
    ['Match', listing.analysisDetails.MATCH_SCORE_1_10],
  ]);

  y = pdfAnalysisSections(doc, listing.analysisDetails, y + 8);
  y = pdfParagraph(doc, 'Price / Offer Notes', listing.offerStrategy ?? listing.priceAssessment ?? 'No notes.', y + 8);
  y = pdfParagraph(doc, 'Photo Quality', listing.photoQualityAssessment ?? 'No photo assessment.', y + 8);
  y = pdfBullets(doc, 'Photo Findings', listing.photoFindings, y + 8);
  y = pdfBullets(doc, 'Red Flags', listing.redFlags, y + 8);

  doc.fillColor('#315f72').fontSize(9).text(listing.url, 48, doc.page.height - 58, { width: 500 });
  doc.end();
}

function renderTopTenPdf(listings: DashboardListing[], stream: NodeJS.WritableStream): void {
  const doc = new PDFDocument({ margin: 42, size: 'LETTER' });

  doc.pipe(stream);
  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8e3bd');
  doc.lineWidth(4).strokeColor('#3c2415').roundedRect(28, 28, doc.page.width - 56, doc.page.height - 56, 18).stroke();
  doc.fillColor('#163f2d').fontSize(11).font('Helvetica-Bold').text('CANOE HUNTER', 48, 50);
  doc.fillColor('#3c2415').fontSize(30).font('Helvetica-Bold').text('Top 10 Field Board', 48, 70);
  doc.fillColor('#624126').fontSize(11).font('Helvetica').text('Highest-scoring Beer-Forward Fishing Canoe candidates.', 48, 108);

  let y = 140;

  if (listings.length === 0) {
    doc.fillColor('#3c2415').fontSize(14).text('No scored listings yet.', 48, y);
    doc.end();
    return;
  }

  listings.forEach((listing, index) => {
    if (y > 680) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8e3bd');
      y = 48;
    }

    const price = listing.price === null ? 'Unknown price' : `$${listing.price}`;
    const offerRange = formatOfferRange(listing.offerRangeBottom, listing.offerRangeTop) ?? 'No offer';

    doc.roundedRect(48, y, 500, 72, 10).fillAndStroke('rgba(255, 242, 214, 0.8)', '#3c2415');
    doc.fillColor('#a73525').fontSize(9).font('Helvetica-Bold').text(`#${index + 1}`, 62, y + 12);
    doc.fillColor('#3c2415').fontSize(14).font('Helvetica-Bold').text(listing.title, 92, y + 10, { width: 330 });
    doc.fillColor('#624126').fontSize(9).font('Helvetica-Bold').text(
      `${price} | ${listing.location ?? 'Unknown'} | ${listing.distanceMiles ?? 'Unknown'} mi | offer ${offerRange}`,
      92,
      y + 30,
      { width: 350 },
    );
    doc.fillColor('#3c2415').fontSize(9).font('Helvetica').text(
      `${listing.makeModel ?? 'Unknown model'}; ${listing.exactLength ?? listing.estimatedLength ?? 'unknown length'}; ${listing.materialGuess ?? 'unknown material'}; ${listing.estimatedCondition ?? 'unknown condition'}`,
      92,
      y + 46,
      { width: 350 },
    );
    doc.fillColor('#3c2415').fontSize(9).font('Helvetica-Bold').text('SCORE', 470, y + 13, { width: 50, align: 'center' });
    doc.fontSize(24).text(String(listing.matchScore ?? '--'), 470, y + 28, { width: 50, align: 'center' });
    y += 84;
  });

  listings.forEach((listing) => {
    doc.addPage();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8e3bd');
    doc.lineWidth(3).strokeColor('#3c2415').roundedRect(28, 28, doc.page.width - 56, doc.page.height - 56, 18).stroke();
    doc.fillColor('#163f2d').fontSize(10).font('Helvetica-Bold').text('TOP 10 DETAIL SHEET', 48, 48);
    doc.fillColor('#3c2415').fontSize(22).font('Helvetica-Bold').text(listing.title, 48, 66, { width: 420 });
    doc.fillColor('#624126').fontSize(10).text(
      `${listing.price === null ? 'Unknown price' : `$${listing.price}`} | ${listing.location ?? 'Unknown'} | ${listing.distanceMiles ?? 'Unknown'} miles | Score ${listing.matchScore ?? '--'}`,
      48,
      94,
    );

    let detailY = 124;
    detailY = pdfSection(doc, 'Core Fit', detailY, [
      ['Make / Model', listing.makeModel ?? listing.likelyModel],
      ['Length', listing.exactLength ?? listing.estimatedLength],
      ['Weight', listing.estimatedWeight],
      ['Material', listing.materialGuess],
      ['Color', listing.exteriorColor],
      ['Condition', listing.estimatedCondition],
      ['Offer Range', formatOfferRange(listing.offerRangeBottom, listing.offerRangeTop)],
    ]);
    detailY = pdfAnalysisSections(doc, listing.analysisDetails, detailY + 8);
    detailY = pdfParagraph(doc, 'Notes', String(listing.analysisDetails.NOTES ?? listing.offerStrategy ?? 'No notes.'), detailY + 8);
    pdfBullets(doc, 'Red Flags', listing.redFlags, detailY + 8);
  });

  doc.end();
}

function pdfAnalysisSections(
  doc: PDFKit.PDFDocument,
  details: DashboardListing['analysisDetails'],
  y: number,
): number {
  const sections = analysisSections();

  for (const section of sections) {
    const rows = section.keys
      .map((key) => [labelize(key), details[key]] as [string, unknown])
      .filter(([, value]) => valueToDisplay(value));

    if (rows.length === 0) {
      continue;
    }

    if (y > 650) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8e3bd');
      y = 48;
    }

    y = pdfSection(doc, section.title, y, rows) + 4;
  }

  return y;
}

function pdfSection(doc: PDFKit.PDFDocument, title: string, y: number, rows: Array<[string, unknown]>): number {
  doc.fillColor('#a73525').fontSize(10).font('Helvetica-Bold').text(title.toUpperCase(), 48, y);
  y += 18;

  for (const [label, rawValue] of rows) {
    const value = valueToDisplay(rawValue);
    if (!value) {
      continue;
    }

    doc.fillColor('#624126').fontSize(8).font('Helvetica-Bold').text(label.toUpperCase(), 48, y);
    doc.fillColor('#3c2415').fontSize(11).font('Helvetica-Bold').text(value, 155, y, { width: 380 });
    y += 18;
  }

  return y;
}

function pdfParagraph(doc: PDFKit.PDFDocument, title: string, text: string, y: number): number {
  doc.fillColor('#a73525').fontSize(10).font('Helvetica-Bold').text(title.toUpperCase(), 48, y);
  y += 16;
  doc.fillColor('#3c2415').fontSize(11).font('Helvetica').text(text, 48, y, { width: 500 });
  return doc.y + 6;
}

function pdfBullets(doc: PDFKit.PDFDocument, title: string, items: string[], y: number): number {
  if (items.length === 0) {
    return y;
  }

  doc.fillColor('#a73525').fontSize(10).font('Helvetica-Bold').text(title.toUpperCase(), 48, y);
  y += 16;

  for (const item of items.slice(0, 6)) {
    doc.fillColor('#3c2415').fontSize(10).font('Helvetica').text(`- ${item}`, 58, y, { width: 480 });
    y = doc.y + 4;
  }

  return y;
}

function renderAnalysisDetails(details: DashboardListing['analysisDetails']): string {
  const sections = analysisSections();

  const renderedSections = sections
    .map((section) => {
      const items = section.keys
        .map((key) => analysisItem(key, details[key]))
        .filter(Boolean)
        .join('');

      if (!items) {
        return '';
      }

      return `
        <details class="analysis-section">
          <summary>${escapeHtml(section.title)}</summary>
          <div class="analysis-grid">${items}</div>
        </details>
      `;
    })
    .join('');

  const notes = valueToDisplay(details.NOTES);

  return `
    <div class="analysis-details">
      ${renderedSections}
      ${notes ? `<p class="analysis-notes"><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ''}
    </div>
  `;
}

function analysisItem(key: string, value: unknown): string {
  const display = valueToDisplay(value);

  if (!display) {
    return '';
  }

  return `
    <div>
      <span>${escapeHtml(labelize(key))}</span>
      <strong>${escapeHtml(display)}</strong>
    </div>
  `;
}

function analysisSections(): Array<{ title: string; keys: string[] }> {
  return [
    {
      title: 'Boat Fit',
      keys: ['BOAT_TYPE', 'MAKE_BRAND', 'MODEL', 'YEAR', 'LENGTH_FT', 'WEIGHT_LB', 'PRICE_USD', 'NEGOTIABLE'],
    },
    {
      title: 'Hull And Stability',
      keys: [
        'MATERIAL',
        'HULL_SHAPE',
        'KEEL',
        'SPONSONS',
        'PRIMARY_STABILITY',
        'SECONDARY_STABILITY',
        'STABILITY_SCORE_1_10',
      ],
    },
    {
      title: 'Fishing Layout',
      keys: [
        'INTERIOR_LAYOUT',
        'TWO_PERSON',
        'FACING_SEATS_POSSIBLE',
        'FISHING_FRIENDLY',
        'GEAR_SPACE',
        'OARLOCKS',
        'OARS_INCLUDED',
        'DUAL_ROW_CAPABLE',
        'PADDLES_INCLUDED',
      ],
    },
    {
      title: 'Condition',
      keys: [
        'CONDITION',
        'HULL_INTEGRITY',
        'DENTS',
        'CRACKS',
        'OIL_CANNING',
        'REPAIRS_VISIBLE',
        'REPAINTED_BOTTOM',
      ],
    },
    {
      title: 'Mod Potential',
      keys: [
        'MODIFIABLE',
        'FLAT_FLOOR',
        'MOUNTING_POINTS',
        'FOAMABLE_INTERIOR',
        'INCLUDES_LIFE_JACKETS',
        'INCLUDES_TRAILER',
        'PORTAGE_SCORE_1_10',
        'MATCH_SCORE_1_10',
      ],
    },
  ];
}

function valueToDisplay(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const display = String(value).trim();
  return display.length > 0 && display.toLowerCase() !== 'unknown' ? display : null;
}

function labelize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function renderPhotoGallery(imageUrls: string[]): string {
  if (imageUrls.length === 0) {
    return '';
  }

  return `
    <div class="photo-gallery" aria-label="Listing photos">
      ${imageUrls
        .map(
          (url, index) => `
            <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="Open photo ${index + 1}">
              <img src="${escapeHtml(url)}" alt="Listing photo ${index + 1}">
            </a>
          `,
        )
        .join('')}
    </div>
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

function formatPhotoQuality(listing: DashboardListing): string | null {
  if (listing.photoQualityScore === null) {
    return null;
  }

  const count = listing.photoCountAnalyzed ?? listing.imageUrls.length;
  return `${listing.photoQualityScore}/100 (${count} photos)`;
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

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'canoe-report';
}

function styles(): string {
  return `
    :root {
      color-scheme: light;
      --bark: #3c2415;
      --bark-soft: #624126;
      --camp-red: #b3261e;
      --hunter-orange: #ff8a16;
      --gold: #ffd24a;
      --canoe: #c9682d;
      --cream: #fff2d6;
      --paper: #f8e3bd;
      --pine: #163f2d;
      --pine-soft: #2f6b49;
      --lake: #315f72;
      --shadow: rgba(35, 21, 10, 0.22);
      --arcade-glow: rgba(255, 210, 74, 0.7);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--bark);
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at 78% 7%, rgba(255, 138, 22, 0.3), transparent 18rem),
        radial-gradient(circle at 15% 12%, rgba(255, 242, 214, 0.95), transparent 24rem),
        repeating-radial-gradient(circle at 80% 20%, transparent 0 34px, rgba(60, 36, 21, 0.1) 35px 37px, transparent 38px 68px),
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
        radial-gradient(circle at 50% 8%, rgba(255, 210, 74, 0.16), transparent 12rem),
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
        radial-gradient(circle at 12% 16%, rgba(255, 210, 74, 0.85), transparent 5rem),
        linear-gradient(135deg, rgba(22, 63, 45, 0.96), rgba(49, 95, 114, 0.92)),
        repeating-linear-gradient(45deg, rgba(167, 53, 37, 0.13) 0 16px, rgba(22, 63, 45, 0.13) 16px 32px);
      box-shadow: 10px 12px 0 var(--shadow), 0 0 0 6px rgba(255, 210, 74, 0.25), 0 0 28px var(--arcade-glow);
      overflow: hidden;
      position: relative;
    }

    .hero::after {
      content: "";
      position: absolute;
      right: 28px;
      top: 22px;
      width: 74px;
      height: 74px;
      border: 5px solid rgba(255, 210, 74, 0.7);
      border-radius: 50%;
      background:
        linear-gradient(90deg, transparent 47%, rgba(255, 210, 74, 0.75) 48% 52%, transparent 53%),
        linear-gradient(0deg, transparent 47%, rgba(255, 210, 74, 0.75) 48% 52%, transparent 53%);
      opacity: 0.75;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--gold);
      font-family: Arial, sans-serif;
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      text-shadow: 2px 2px 0 var(--bark);
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
      color: var(--cream);
      text-shadow: 4px 4px 0 var(--bark), 7px 7px 0 var(--hunter-orange), 0 0 18px rgba(255, 210, 74, 0.55);
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
      color: var(--cream);
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
      background: linear-gradient(180deg, var(--gold), var(--hunter-orange) 46%, var(--camp-red));
      box-shadow: 5px 6px 0 var(--bark), 0 0 14px rgba(255, 210, 74, 0.45);
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
        linear-gradient(90deg, rgba(255, 138, 22, 0.22), rgba(255, 242, 214, 0.92)),
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
      background:
        radial-gradient(circle at 50% 50%, var(--gold) 0 9px, transparent 10px),
        radial-gradient(circle, var(--hunter-orange), var(--pine));
      box-shadow: inset 0 0 0 5px rgba(255, 242, 214, 0.22);
    }

    .section-heading {
      margin-bottom: 18px;
    }

    .top-report-link {
      display: inline-block;
      padding: 9px 12px;
      border: 3px solid var(--bark);
      border-radius: 999px;
      color: var(--cream);
      font: 900 0.78rem Arial, sans-serif;
      letter-spacing: 0.08em;
      text-decoration: none;
      text-transform: uppercase;
      background: linear-gradient(180deg, var(--gold), var(--hunter-orange) 54%, var(--camp-red));
      box-shadow: 4px 5px 0 var(--shadow);
    }

    .listing-card {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin-bottom: 20px;
      padding: 16px;
      border-radius: 24px;
    }

    .listing-image {
      height: clamp(170px, 28vw, 280px);
      overflow: hidden;
      border: 4px solid var(--bark);
      border-radius: 18px;
      background: linear-gradient(135deg, var(--lake), var(--pine-soft));
      position: relative;
    }

    .listing-image::after {
      content: "LOCK ON";
      position: absolute;
      right: 12px;
      bottom: 10px;
      padding: 5px 8px;
      border: 2px solid var(--gold);
      border-radius: 999px;
      color: var(--gold);
      font: 900 0.68rem Arial, sans-serif;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      background: rgba(60, 36, 21, 0.72);
      text-shadow: 1px 1px 0 var(--bark);
    }

    .listing-image img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
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
      background: linear-gradient(180deg, var(--pine-soft), var(--pine));
      box-shadow: 0 0 0 2px rgba(255, 210, 74, 0.28);
    }

    .report-link {
      margin-left: auto;
      padding: 4px 9px;
      border: 2px solid var(--bark);
      border-radius: 999px;
      color: var(--bark);
      font-family: Arial, sans-serif;
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-decoration: none;
      text-transform: uppercase;
      background: linear-gradient(180deg, rgba(255, 210, 74, 0.95), rgba(255, 242, 214, 0.86));
      box-shadow: 2px 3px 0 var(--shadow);
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

    .analysis-details {
      margin: 12px 0;
    }

    .analysis-section {
      margin-bottom: 8px;
      border: 2px solid rgba(60, 36, 21, 0.2);
      border-radius: 13px;
      background: rgba(255, 255, 255, 0.3);
    }

    .analysis-section summary {
      cursor: pointer;
      padding: 9px 11px;
      color: var(--pine);
      font: 900 0.76rem Arial, sans-serif;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .analysis-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 7px;
      padding: 0 10px 10px;
    }

    .analysis-grid div {
      padding: 8px;
      border-radius: 10px;
      background: rgba(255, 242, 214, 0.72);
    }

    .analysis-grid span {
      display: block;
      color: var(--camp-red);
      font: 900 0.62rem Arial, sans-serif;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .analysis-grid strong {
      display: block;
      margin-top: 3px;
      font-size: 0.9rem;
      line-height: 1.15;
    }

    .analysis-notes {
      margin: 8px 0 0;
      color: var(--bark-soft);
      font-size: 0.95rem;
      line-height: 1.35;
    }

    .photo-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
      gap: 8px;
      margin: 12px 0;
    }

    .photo-gallery a {
      display: block;
      overflow: hidden;
      aspect-ratio: 4 / 3;
      border: 3px solid rgba(60, 36, 21, 0.4);
      border-radius: 12px;
      background: var(--lake);
    }

    .photo-gallery img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 140ms ease;
    }

    .photo-gallery a:hover img {
      transform: scale(1.06);
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
      background: linear-gradient(180deg, var(--pine-soft), var(--pine));
    }

    .pill-group.warning em {
      background: linear-gradient(180deg, var(--hunter-orange), var(--camp-red));
    }

    .score-card {
      display: flex;
      justify-content: center;
      gap: 16px;
      align-items: center;
      min-height: auto;
      padding: 14px;
      border: 4px solid var(--bark);
      border-radius: 18px;
      text-align: center;
      background:
        radial-gradient(circle at 50% 50%, rgba(255, 210, 74, 0.32), transparent 3rem),
        var(--paper);
    }

    .score-card strong {
      display: block;
      margin: 0;
      font-size: 3rem;
      line-height: 1;
    }

    .score-hot {
      background: linear-gradient(180deg, var(--gold), var(--hunter-orange), var(--canoe));
      box-shadow: inset 0 0 0 4px rgba(255, 242, 214, 0.35), 0 0 18px rgba(255, 138, 22, 0.35);
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
