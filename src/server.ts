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

  app.get('/report.pdf', async (request, response) => {
    const listingUrl = String(request.query.url ?? '');

    if (!listingUrl) {
      response.status(400).send('Missing listing URL');
      return;
    }

    const db = new CanoeHunterDb(config);
    const listing = db.listDashboardListings(500).find((item) => item.url === listingUrl);
    db.close();

    if (!listing) {
      response.status(404).send('Listing not found');
      return;
    }

    response.setHeader('content-type', 'application/pdf');
    response.setHeader('content-disposition', `attachment; filename="${safeFilename(listing.title)}.pdf"`);

    try {
      await renderListingPdf(listing, response);
    } catch (error) {
      console.error('Failed to render listing PDF:', error);
      response.end();
    }
  });

  app.get('/top-10.pdf', async (_request, response) => {
    const db = new CanoeHunterDb(config);
    const listings = db.listDashboardListings(500).filter((item) => item.matchScore !== null).slice(0, 10);
    db.close();

    response.setHeader('content-type', 'application/pdf');
    response.setHeader('content-disposition', 'attachment; filename="canoe-hunter-top-10.pdf"');

    try {
      await renderTopTenPdf(listings, response);
    } catch (error) {
      console.error('Failed to render top 10 PDF:', error);
      response.end();
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
    <div class="page">
      <header class="hero">
        <div class="hero-bar">
          <div class="hero-mark">
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <path d="M4 28 C 12 36 36 36 44 28 L 40 32 C 32 38 16 38 8 32 Z" fill="currentColor"/>
              <path d="M24 12 L24 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M20 16 L24 12 L28 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Canoe Hunter</span>
          </div>
          <span class="hero-status ${isRunning ? 'is-running' : ''}">
            <span class="hero-status-dot"></span>
            ${isRunning ? 'Hunt in progress' : 'Idle'}
          </span>
        </div>

        <div class="hero-grid">
          <div class="hero-content">
            <p class="hero-eyebrow">Field Office</p>
            <h1>Find a worthy canoe.<br>Skip the rest.</h1>
            <p class="hero-tagline">Quietly watching Craigslist for the right 13&ndash;14 ft fishing canoe within ${config.searchDistanceMiles} miles of ${escapeHtml(config.searchPostal)}, under $${config.maxPrice}. No leaks, no nonsense.</p>
            <div class="hero-actions">
              <form method="post" action="/run-now">
                <button class="button button-primary" type="submit" ${isRunning ? 'disabled' : ''}>
                  ${isRunning ? 'Hunting&hellip;' : 'Run Hunt Now'}
                </button>
              </form>
              <a class="button button-ghost" href="/top-10.pdf">Top 10 Report &rarr;</a>
            </div>
          </div>

          <aside class="hero-summary" aria-label="Hunt summary">
            ${heroFigure(listings.length, scored.length, topScore, alerted.length, config.dryRun)}
          </aside>
        </div>
      </header>

      <main>
        <section class="status-grid" aria-label="Hunt status">
          ${statCard('Listings Seen', listings.length.toString(), 'tracked across regions')}
          ${statCard('Scored', scored.length.toString(), 'judged by the camp oracle')}
          ${statCard('Top Score', `${topScore}<span class="stat-suffix">/100</span>`, 'best candidate today')}
          ${statCard('Alerts Sent', alerted.length.toString(), config.dryRun ? 'dry run only' : 'real notifications')}
          ${statCard('Status', isRunning ? 'Running' : 'Idle', isRunning ? 'auto-refresh in 10s' : 'next pass on schedule')}
        </section>

        <section class="notice">
          <div class="notice-mark">ADK</div>
          <div>
            <h2>The Brief</h2>
            <p>Targeting 13&ndash;14 ft canoes within ${config.searchDistanceMiles} miles of ${escapeHtml(config.searchPostal)}. Stable, sturdy, lightweight, fishable from either end. Aluminum tubs, leaks, inflatables, kayaks, and over-budget dreamboats get the cold beans treatment.</p>
          </div>
        </section>

        <section class="listings">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Recent Sightings</p>
              <h2>The Canoe Board</h2>
            </div>
            <div class="section-actions">
              <span class="badge">${listings.length} listings</span>
            </div>
          </div>
          ${listings.length > 0 ? listings.map(renderListingCard).join('') : emptyState()}
        </section>

        <footer class="page-footer">
          <span>Canoe Hunter &middot; Built with care, coffee, and SQLite</span>
          <form method="post" action="/shutdown">
            <button type="submit" class="footer-link">Shut down server</button>
          </form>
        </footer>
      </main>
    </div>
  </body>
</html>`;
}

function heroFigure(seen: number, scored: number, topScore: number, alerts: number, dryRun: boolean): string {
  return `
    <div class="hero-figure">
      <svg viewBox="0 0 320 200" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3a5a45"/>
            <stop offset="100%" stop-color="#1d3324"/>
          </linearGradient>
          <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2c4a35"/>
            <stop offset="100%" stop-color="#0f2418"/>
          </linearGradient>
        </defs>
        <rect width="320" height="200" fill="url(#sky)" rx="14"/>
        <circle cx="248" cy="58" r="22" fill="#f5e7c0" opacity="0.85"/>
        <circle cx="248" cy="58" r="22" fill="none" stroke="#f5e7c0" stroke-width="0.5" opacity="0.4"/>
        <path d="M0 145 L40 130 L80 138 L120 122 L160 132 L210 118 L260 128 L320 116 L320 200 L0 200 Z" fill="#1d3324" opacity="0.9"/>
        <path d="M30 130 L46 105 L62 130 Z M70 138 L88 110 L106 138 Z M130 124 L150 95 L170 124 Z M190 130 L208 100 L226 130 Z M252 122 L268 95 L284 122 Z" fill="#163f2d"/>
        <rect x="0" y="148" width="320" height="52" fill="url(#water)"/>
        <path d="M0 158 Q 80 154 160 158 T 320 158" stroke="#f5e7c0" stroke-width="0.5" fill="none" opacity="0.35"/>
        <path d="M0 168 Q 80 164 160 168 T 320 168" stroke="#f5e7c0" stroke-width="0.5" fill="none" opacity="0.25"/>
        <g transform="translate(110 162)">
          <path d="M0 8 C 12 18 88 18 100 8 L 92 12 C 78 18 22 18 8 12 Z" fill="#c89829"/>
          <path d="M50 0 L50 9" stroke="#3c2415" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="50" cy="9" r="2.4" fill="#3c2415"/>
        </g>
      </svg>
      <dl class="hero-stats">
        <div>
          <dt>Listings</dt>
          <dd>${seen}</dd>
        </div>
        <div>
          <dt>Scored</dt>
          <dd>${scored}</dd>
        </div>
        <div>
          <dt>Top score</dt>
          <dd>${topScore}<span>/100</span></dd>
        </div>
        <div>
          <dt>${dryRun ? 'Dry alerts' : 'Alerts'}</dt>
          <dd>${alerts}</dd>
        </div>
      </dl>
    </div>
  `;
}

function renderListingCard(listing: DashboardListing): string {
  const price = listing.price === null ? 'Price unknown' : `$${listing.price}`;
  const scoreClass = scoreTone(listing.matchScore);
  const heroImage = listing.imageUrls[0];
  const otherImages = listing.imageUrls.slice(1, 9);
  const reasons = listing.reasonsForMatch.slice(0, 4);
  const redFlags = listing.redFlags.slice(0, 4);
  const photoFindings = listing.photoFindings.slice(0, 4);
  const offerRange = formatOfferRange(listing.offerRangeBottom, listing.offerRangeTop);

  return `
    <article class="listing-card">
      <div class="listing-hero">
        ${
          heroImage
            ? `<img src="${escapeHtml(heroImage)}" alt="" loading="lazy">`
            : '<div class="hero-empty"><span>No photo</span></div>'
        }
        <div class="listing-hero-overlay">
          <div class="listing-hero-meta">
            <span class="region">${escapeHtml(listing.source.replace('.craigslist.org', ''))}</span>
            <span class="muted">${formatDate(listing.firstSeenAt)}</span>
          </div>
          <div class="score-pill ${scoreClass}">
            <small>Score</small>
            <strong>${listing.matchScore === null ? '--' : listing.matchScore}</strong>
            <span>${listing.shouldAlert ? 'Alert worthy' : listing.alertSentAt ? 'Alert sent' : 'Watch list'}</span>
          </div>
        </div>
      </div>

      <div class="listing-body">
        <div class="listing-headline">
          <h3><a href="${escapeHtml(listing.url)}" target="_blank" rel="noreferrer">${escapeHtml(listing.title)}</a></h3>
          <a class="ghost-link" href="/report.pdf?url=${encodeURIComponent(listing.url)}">Export PDF</a>
        </div>

        <div class="meta-row">
          <strong>${escapeHtml(price)}</strong>
          ${listing.location ? `<span>${escapeHtml(listing.location)}</span>` : ''}
          ${listing.distanceMiles !== null ? `<span>${listing.distanceMiles} mi away</span>` : ''}
          ${listing.exactLength ? `<span>${escapeHtml(listing.exactLength)}</span>` : listing.estimatedLength ? `<span>${escapeHtml(listing.estimatedLength)}</span>` : ''}
          ${listing.materialGuess ? `<span class="meta-accent">${escapeHtml(listing.materialGuess)}</span>` : ''}
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

        ${listing.priceAssessment ? `<p class="assessment">${escapeHtml(listing.priceAssessment)}</p>` : ''}
        ${listing.offerStrategy ? `<p class="muted-prose"><strong>Offer strategy.</strong> ${escapeHtml(listing.offerStrategy)}</p>` : ''}
        ${listing.photoQualityAssessment ? `<p class="muted-prose"><strong>Photos.</strong> ${escapeHtml(listing.photoQualityAssessment)}</p>` : ''}

        ${otherImages.length > 0 ? renderPhotoGallery(otherImages) : ''}
        ${renderAnalysisDetails(listing.analysisDetails)}
        ${renderPillList('Photo clues', photoFindings)}
        ${renderPillList('Why it might float', reasons)}
        ${renderPillList('Camp warnings', redFlags, 'warning')}
      </div>
    </article>
  `;
}

async function renderListingPdf(listing: DashboardListing, stream: NodeJS.WritableStream): Promise<void> {
  const heroImage = await fetchImageBuffer(listing.imageUrls[0]);
  const galleryImages = await fetchImageBuffers(listing.imageUrls.slice(1, 13));

  const doc = new PDFDocument({ margin: 0, size: 'LETTER', autoFirstPage: false });
  doc.pipe(stream);

  doc.addPage();
  drawPdfBackdrop(doc);

  const pageWidth = doc.page.width;
  const innerLeft = 56;
  const innerWidth = pageWidth - innerLeft * 2;

  const heroHeight = 220;
  drawHeroImage(doc, heroImage, innerLeft, 56, innerWidth, heroHeight);

  const headerY = 56 + heroHeight + 22;
  const textColumnWidth = innerWidth - 110;
  const subline = [
    listing.price === null ? 'Price unknown' : `$${listing.price}`,
    listing.location,
    listing.distanceMiles === null ? null : `${listing.distanceMiles} mi`,
    listing.exactLength ?? listing.estimatedLength,
    listing.materialGuess,
  ]
    .filter(Boolean)
    .join('  /  ');

  let y = drawHeader(doc, listing.title, subline, headerY, innerLeft, textColumnWidth, 'CANOE HUNTER FIELD REPORT');
  drawScoreBadge(doc, listing.matchScore, pageWidth - innerLeft - 90, headerY);
  y = Math.max(y, headerY + 96);
  drawDivider(doc, innerLeft, y, innerWidth);
  y += 14;

  y = pdfFactGrid(doc, y, innerLeft, innerWidth, [
    ['Make / Model', listing.makeModel ?? listing.likelyModel],
    ['Length', listing.exactLength ?? listing.estimatedLength],
    ['Beam', listing.beamWidth],
    ['Material', listing.materialGuess],
    ['Color', listing.exteriorColor],
    ['Weight', listing.estimatedWeight],
    ['Keel', listing.keel],
    ['Condition', listing.estimatedCondition],
    ['Distance', listing.distanceMiles === null ? null : `${listing.distanceMiles} miles`],
    ['Offer Range', formatOfferRange(listing.offerRangeBottom, listing.offerRangeTop)],
  ]);

  if (galleryImages.some((img) => img !== null)) {
    y = pdfImageGrid(doc, galleryImages, y + 14, innerLeft, innerWidth);
  }

  y += 6;
  if (listing.priceAssessment) {
    y = pdfParagraph(doc, 'Assessment', listing.priceAssessment, y + 6, innerLeft, innerWidth);
  }
  if (listing.offerStrategy) {
    y = pdfParagraph(doc, 'Offer Strategy', listing.offerStrategy, y + 6, innerLeft, innerWidth);
  }
  if (listing.photoQualityAssessment) {
    y = pdfParagraph(doc, 'Photo Notes', listing.photoQualityAssessment, y + 6, innerLeft, innerWidth);
  }

  y = pdfBullets(doc, 'Photo Findings', listing.photoFindings, y + 6, innerLeft, innerWidth);
  y = pdfBullets(doc, 'Why It Might Float', listing.reasonsForMatch, y + 6, innerLeft, innerWidth);
  y = pdfBullets(doc, 'Red Flags', listing.redFlags, y + 6, innerLeft, innerWidth);

  y = pdfAnalysisSections(doc, listing.analysisDetails, y + 10, innerLeft, innerWidth);

  drawPdfFooter(doc, listing.url);
  doc.end();
}

async function renderTopTenPdf(listings: DashboardListing[], stream: NodeJS.WritableStream): Promise<void> {
  const doc = new PDFDocument({ margin: 0, size: 'LETTER', autoFirstPage: false });
  doc.pipe(stream);

  doc.addPage();
  drawPdfBackdrop(doc);

  const innerLeft = 56;
  const innerWidth = doc.page.width - innerLeft * 2;

  doc.fillColor(PDF_COLORS.accent).fontSize(9).font('Helvetica-Bold').text('CANOE HUNTER', innerLeft, 64);
  doc.fillColor(PDF_COLORS.ink).font('Helvetica-Bold').fontSize(34).text('Top 10 Field Board', innerLeft, 80);
  doc.fillColor(PDF_COLORS.muted).fontSize(11).font('Helvetica').text(
    'Highest-scoring Beer-Forward Fishing Canoe candidates, ranked by match score.',
    innerLeft,
    122,
    { width: innerWidth },
  );

  drawDivider(doc, innerLeft, 154, innerWidth);

  let y = 174;

  if (listings.length === 0) {
    doc.fillColor(PDF_COLORS.ink).fontSize(13).font('Helvetica').text('No scored listings yet.', innerLeft, y);
    drawPdfFooter(doc, 'canoe-hunter');
    doc.end();
    return;
  }

  const heroBuffers: Array<Buffer | null> = await fetchImageBuffers(
    listings.map((listing) => listing.imageUrls[0]).filter((url): url is string => Boolean(url)),
  );

  let heroIndex = 0;

  listings.forEach((listing, index) => {
    if (y > doc.page.height - 110) {
      doc.addPage();
      drawPdfBackdrop(doc);
      y = 64;
    }

    const cardHeight = 86;
    doc.roundedRect(innerLeft, y, innerWidth, cardHeight, 10).fillAndStroke(PDF_COLORS.cardBg, PDF_COLORS.line);

    const thumb = listing.imageUrls[0] ? heroBuffers[heroIndex++] : null;
    if (thumb) {
      try {
        doc.save();
        doc.roundedRect(innerLeft + 8, y + 8, 78, cardHeight - 16, 6).clip();
        doc.image(thumb, innerLeft + 8, y + 8, { fit: [78, cardHeight - 16], align: 'center', valign: 'center' });
        doc.restore();
      } catch {
        // Skip if image cannot be embedded.
      }
    }

    const textLeft = innerLeft + 96;
    const textWidth = innerWidth - 96 - 90;
    doc.fillColor(PDF_COLORS.accent).fontSize(8).font('Helvetica-Bold').text(`#${String(index + 1).padStart(2, '0')}`, textLeft, y + 12);
    doc
      .fillColor(PDF_COLORS.ink)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(listing.title, textLeft, y + 24, { width: textWidth, height: 18, ellipsis: true });

    const facts = [
      listing.price === null ? 'Unknown price' : `$${listing.price}`,
      listing.location,
      listing.distanceMiles === null ? null : `${listing.distanceMiles} mi`,
      formatOfferRange(listing.offerRangeBottom, listing.offerRangeTop),
    ]
      .filter(Boolean)
      .join('  /  ');

    doc
      .fillColor(PDF_COLORS.muted)
      .fontSize(9)
      .font('Helvetica')
      .text(facts, textLeft, y + 44, { width: textWidth });

    const detail = [
      listing.makeModel ?? listing.likelyModel,
      listing.exactLength ?? listing.estimatedLength,
      listing.materialGuess,
      listing.estimatedCondition,
    ]
      .filter(Boolean)
      .join(' / ');

    doc.fillColor(PDF_COLORS.muted).fontSize(9).text(detail, textLeft, y + 60, { width: textWidth, height: 16, ellipsis: true });

    drawScoreBadge(doc, listing.matchScore, innerLeft + innerWidth - 78, y + 10, 68);

    y += cardHeight + 10;
  });

  for (const listing of listings) {
    const heroImage = await fetchImageBuffer(listing.imageUrls[0]);
    const galleryImages = await fetchImageBuffers(listing.imageUrls.slice(1, 10));

    doc.addPage();
    drawPdfBackdrop(doc);

    const sheetInnerLeft = 56;
    const sheetInnerWidth = doc.page.width - sheetInnerLeft * 2;
    const heroHeight = 200;

    drawHeroImage(doc, heroImage, sheetInnerLeft, 56, sheetInnerWidth, heroHeight);

    const sheetHeaderY = 56 + heroHeight + 18;
    const sheetTextWidth = sheetInnerWidth - 110;
    const subtitle = [
      listing.price === null ? 'Unknown price' : `$${listing.price}`,
      listing.location,
      listing.distanceMiles === null ? null : `${listing.distanceMiles} mi`,
      listing.exactLength ?? listing.estimatedLength,
      listing.materialGuess,
    ]
      .filter(Boolean)
      .join('  /  ');

    let detailY = drawHeader(doc, listing.title, subtitle, sheetHeaderY, sheetInnerLeft, sheetTextWidth, 'TOP 10 DETAIL SHEET');
    drawScoreBadge(doc, listing.matchScore, doc.page.width - sheetInnerLeft - 90, sheetHeaderY);
    detailY = Math.max(detailY, sheetHeaderY + 84);
    drawDivider(doc, sheetInnerLeft, detailY, sheetInnerWidth);
    detailY += 14;

    detailY = pdfFactGrid(doc, detailY, sheetInnerLeft, sheetInnerWidth, [
      ['Make / Model', listing.makeModel ?? listing.likelyModel],
      ['Length', listing.exactLength ?? listing.estimatedLength],
      ['Beam', listing.beamWidth],
      ['Material', listing.materialGuess],
      ['Color', listing.exteriorColor],
      ['Weight', listing.estimatedWeight],
      ['Condition', listing.estimatedCondition],
      ['Offer Range', formatOfferRange(listing.offerRangeBottom, listing.offerRangeTop)],
    ]);

    if (galleryImages.some((img) => img !== null)) {
      detailY = pdfImageGrid(doc, galleryImages, detailY + 12, sheetInnerLeft, sheetInnerWidth);
    }

    detailY = pdfAnalysisSections(doc, listing.analysisDetails, detailY + 8, sheetInnerLeft, sheetInnerWidth);
    detailY = pdfParagraph(doc, 'Notes', String(listing.analysisDetails.NOTES ?? listing.offerStrategy ?? 'No notes.'), detailY + 6, sheetInnerLeft, sheetInnerWidth);
    pdfBullets(doc, 'Red Flags', listing.redFlags, detailY + 6, sheetInnerLeft, sheetInnerWidth);

    drawPdfFooter(doc, listing.url);
  }

  doc.end();
}

const PDF_COLORS = {
  paper: '#f7efde',
  card: '#ffffff',
  cardBg: '#fbf6ea',
  ink: '#2c2117',
  muted: '#6f5f4a',
  line: '#d8c9a5',
  accent: '#b54a1f',
  forest: '#2c4a35',
  forestDeep: '#1d3324',
  cream: '#fff8e6',
} as const;

function drawPdfBackdrop(doc: PDFKit.PDFDocument): void {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(PDF_COLORS.paper);
  doc.rect(0, 0, doc.page.width, 6).fill(PDF_COLORS.forest);
  doc.rect(0, doc.page.height - 6, doc.page.width, 6).fill(PDF_COLORS.accent);
}

function drawDivider(doc: PDFKit.PDFDocument, x: number, y: number, width: number): void {
  doc.lineWidth(0.6).strokeColor(PDF_COLORS.line).moveTo(x, y).lineTo(x + width, y).stroke();
}

function drawPdfFooter(doc: PDFKit.PDFDocument, url: string): void {
  const y = doc.page.height - 32;
  doc.fillColor(PDF_COLORS.muted).fontSize(8).font('Helvetica-Bold').text('CANOE HUNTER', 56, y);
  doc.fillColor(PDF_COLORS.muted).font('Helvetica').fontSize(8).text(url, 56, y + 11, { width: doc.page.width - 112 });
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  subline: string,
  y: number,
  x: number,
  width: number,
  eyebrow: string,
): number {
  doc.fillColor(PDF_COLORS.accent).fontSize(8).font('Helvetica-Bold').text(eyebrow, x, y, { width });
  let cursor = y + 14;

  doc.fillColor(PDF_COLORS.ink).font('Helvetica-Bold').fontSize(18);
  const titleHeight = doc.heightOfString(title, { width, lineGap: 2 });
  doc.text(title, x, cursor, { width, height: Math.min(titleHeight, 60), lineGap: 2, ellipsis: true });
  cursor += Math.min(titleHeight, 60) + 6;

  if (subline) {
    doc.fillColor(PDF_COLORS.muted).font('Helvetica').fontSize(10).text(subline, x, cursor, { width });
    cursor = doc.y;
  }

  return cursor + 8;
}

function drawHeroImage(doc: PDFKit.PDFDocument, image: Buffer | null, x: number, y: number, width: number, height: number): void {
  doc.save();
  doc.roundedRect(x, y, width, height, 10).fill(PDF_COLORS.forestDeep);
  doc.restore();

  if (image) {
    try {
      doc.save();
      doc.roundedRect(x, y, width, height, 10).clip();
      doc.image(image, x, y, { fit: [width, height], align: 'center', valign: 'center' });
      doc.restore();
    } catch {
      doc.restore();
      doc.fillColor(PDF_COLORS.cream).fontSize(11).font('Helvetica-Bold').text('Photo unavailable', x, y + height / 2 - 6, { width, align: 'center' });
    }
  } else {
    doc.fillColor(PDF_COLORS.cream).fontSize(11).font('Helvetica-Bold').text('No photo available', x, y + height / 2 - 6, { width, align: 'center' });
  }

  doc.lineWidth(0.6).strokeColor(PDF_COLORS.line).roundedRect(x, y, width, height, 10).stroke();
}

function drawScoreBadge(doc: PDFKit.PDFDocument, score: number | null, x: number, y: number, size = 78): void {
  doc.save();
  doc.lineWidth(1).strokeColor(PDF_COLORS.line).fillColor(PDF_COLORS.cream).roundedRect(x, y, size, size, 10).fillAndStroke();
  doc.fillColor(PDF_COLORS.accent).fontSize(7).font('Helvetica-Bold').text('SCORE', x, y + 12, { width: size, align: 'center' });
  doc.fillColor(PDF_COLORS.ink).fontSize(size > 70 ? 28 : 22).font('Helvetica-Bold').text(String(score ?? '--'), x, y + 24, { width: size, align: 'center' });
  doc.fillColor(PDF_COLORS.muted).fontSize(7).font('Helvetica').text('out of 100', x, y + size - 16, { width: size, align: 'center' });
  doc.restore();
}

function pdfFactGrid(
  doc: PDFKit.PDFDocument,
  y: number,
  x: number,
  width: number,
  rows: Array<[string, unknown]>,
): number {
  const visible = rows.filter(([, value]) => valueToDisplay(value));

  if (visible.length === 0) {
    return y;
  }

  const columns = 4;
  const gap = 8;
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const cellHeight = 38;

  visible.forEach(([label, value], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = x + column * (cellWidth + gap);
    const cellY = y + row * (cellHeight + gap);

    doc.lineWidth(0.5).strokeColor(PDF_COLORS.line).fillColor(PDF_COLORS.cardBg).roundedRect(cellX, cellY, cellWidth, cellHeight, 6).fillAndStroke();
    doc.fillColor(PDF_COLORS.accent).fontSize(7).font('Helvetica-Bold').text(label.toUpperCase(), cellX + 8, cellY + 6, { width: cellWidth - 16 });
    doc.fillColor(PDF_COLORS.ink).fontSize(11).font('Helvetica-Bold').text(valueToDisplay(value) ?? '', cellX + 8, cellY + 18, {
      width: cellWidth - 16,
      height: cellHeight - 22,
      ellipsis: true,
    });
  });

  const rowsCount = Math.ceil(visible.length / columns);
  return y + rowsCount * (cellHeight + gap);
}

function pdfAnalysisSections(
  doc: PDFKit.PDFDocument,
  details: DashboardListing['analysisDetails'],
  y: number,
  x: number,
  width: number,
): number {
  const sections = analysisSections();

  for (const section of sections) {
    const rows = section.keys
      .map((key) => [labelize(key), details[key]] as [string, unknown])
      .filter(([, value]) => valueToDisplay(value));

    if (rows.length === 0) {
      continue;
    }

    if (y > doc.page.height - 120) {
      doc.addPage();
      drawPdfBackdrop(doc);
      y = 56;
    }

    doc.fillColor(PDF_COLORS.accent).fontSize(8).font('Helvetica-Bold').text(section.title.toUpperCase(), x, y);
    y += 14;
    y = pdfFactGrid(doc, y, x, width, rows) + 4;
  }

  return y;
}

function pdfParagraph(doc: PDFKit.PDFDocument, title: string, text: string, y: number, x: number, width: number): number {
  if (y > doc.page.height - 80) {
    doc.addPage();
    drawPdfBackdrop(doc);
    y = 56;
  }

  doc.fillColor(PDF_COLORS.accent).fontSize(8).font('Helvetica-Bold').text(title.toUpperCase(), x, y);
  doc.fillColor(PDF_COLORS.ink).fontSize(10.5).font('Helvetica').text(text, x, y + 14, { width });
  return doc.y + 4;
}

function pdfBullets(doc: PDFKit.PDFDocument, title: string, items: string[], y: number, x: number, width: number): number {
  if (items.length === 0) {
    return y;
  }

  if (y > doc.page.height - 80) {
    doc.addPage();
    drawPdfBackdrop(doc);
    y = 56;
  }

  doc.fillColor(PDF_COLORS.accent).fontSize(8).font('Helvetica-Bold').text(title.toUpperCase(), x, y);
  y += 14;

  for (const item of items.slice(0, 6)) {
    if (y > doc.page.height - 60) {
      doc.addPage();
      drawPdfBackdrop(doc);
      y = 56;
    }

    doc.circle(x + 3, y + 5, 1.6).fill(PDF_COLORS.accent);
    doc.fillColor(PDF_COLORS.ink).fontSize(10).font('Helvetica').text(item, x + 12, y, { width: width - 12 });
    y = doc.y + 4;
  }

  return y;
}

function pdfImageGrid(doc: PDFKit.PDFDocument, images: Array<Buffer | null>, y: number, x: number, width: number): number {
  const valid = images.filter((image): image is Buffer => Boolean(image));

  if (valid.length === 0) {
    return y;
  }

  const columns = 3;
  const gap = 10;
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const cellHeight = Math.round((cellWidth * 3) / 4);
  const titleHeight = 18;
  const bottomMargin = 50;

  const drawTitle = (atY: number): number => {
    doc.fillColor(PDF_COLORS.accent).fontSize(8).font('Helvetica-Bold').text('LISTING PHOTOS', x, atY);
    return atY + titleHeight;
  };

  const ensureSpaceForRow = (atY: number, withTitle: boolean): number => {
    const required = (withTitle ? titleHeight : 0) + cellHeight;
    if (atY + required > doc.page.height - bottomMargin) {
      doc.addPage();
      drawPdfBackdrop(doc);
      return withTitle ? drawTitle(56) : 56;
    }
    return withTitle ? drawTitle(atY) : atY;
  };

  let cursor = ensureSpaceForRow(y, true);

  for (let i = 0; i < valid.length; i += columns) {
    if (i > 0) {
      cursor = ensureSpaceForRow(cursor, false);
    }

    const rowImages = valid.slice(i, i + columns);
    rowImages.forEach((image, indexInRow) => {
      const cellX = x + indexInRow * (cellWidth + gap);
      try {
        doc.save();
        doc.roundedRect(cellX, cursor, cellWidth, cellHeight, 8).clip();
        doc.image(image, cellX, cursor, { width: cellWidth, height: cellHeight, align: 'center', valign: 'center' });
        doc.restore();
        doc.lineWidth(0.5).strokeColor(PDF_COLORS.line).roundedRect(cellX, cursor, cellWidth, cellHeight, 8).stroke();
      } catch {
        doc.lineWidth(0.5).strokeColor(PDF_COLORS.line).fillColor(PDF_COLORS.cardBg).roundedRect(cellX, cursor, cellWidth, cellHeight, 8).fillAndStroke();
        doc.fillColor(PDF_COLORS.muted).fontSize(8).font('Helvetica').text('Photo unavailable', cellX, cursor + cellHeight / 2 - 4, { width: cellWidth, align: 'center' });
      }
    });

    cursor += cellHeight + gap;
  }

  return cursor;
}

async function fetchImageBuffer(url: string | undefined): Promise<Buffer | null> {
  if (!url || !url.startsWith('http')) {
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'canoe-hunter/1.0 personal Craigslist alert bot' },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/jpeg') && !contentType.startsWith('image/png')) {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

async function fetchImageBuffers(urls: Array<string | undefined>): Promise<Array<Buffer | null>> {
  return Promise.all(urls.map((url) => fetchImageBuffer(url)));
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
          <summary><span class="analysis-arrow">+</span>${escapeHtml(section.title)}</summary>
          <div class="analysis-grid">${items}</div>
        </details>
      `;
    })
    .join('');

  const notes = valueToDisplay(details.NOTES);

  return `
    <div class="analysis-details">
      ${renderedSections}
      ${notes ? `<p class="analysis-notes"><strong>Notes &middot;</strong> ${escapeHtml(notes)}</p>` : ''}
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
              <img src="${escapeHtml(url)}" alt="Listing photo ${index + 1}" loading="lazy">
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
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${value}</strong>
      <small class="stat-note">${escapeHtml(note)}</small>
    </article>
  `;
}

function renderPillList(label: string, items: string[], tone = ''): string {
  if (items.length === 0) {
    return '';
  }

  return `
    <div class="pill-group ${tone}">
      <span class="pill-label">${escapeHtml(label)}</span>
      <div class="pill-items">
        ${items.map((item) => `<em>${escapeHtml(item)}</em>`).join('')}
      </div>
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
      --paper: #f7efde;
      --paper-soft: #f1e6cd;
      --card: #ffffff;
      --ink: #2c2117;
      --ink-soft: #4a3d2b;
      --muted: #6f5f4a;
      --line: #d8c9a5;
      --line-strong: #b6a47e;
      --accent: #b54a1f;
      --accent-soft: #d97a3f;
      --forest: #2c4a35;
      --forest-deep: #1d3324;
      --forest-soft: #557560;
      --gold: #c89829;
      --warning: #b53b1c;
      --shadow-sm: 0 1px 2px rgba(44, 33, 23, 0.06), 0 2px 6px rgba(44, 33, 23, 0.05);
      --shadow-md: 0 4px 12px rgba(44, 33, 23, 0.08), 0 12px 32px rgba(44, 33, 23, 0.08);
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
    }

    body {
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--paper);
      background-image:
        radial-gradient(circle at 12% 8%, rgba(255, 248, 230, 0.7), transparent 35%),
        radial-gradient(circle at 88% 92%, rgba(44, 74, 53, 0.06), transparent 40%);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }

    a {
      color: var(--accent);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    h1,
    h2,
    h3,
    h4 {
      font-family: "Iowan Old Style", "Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      color: var(--ink);
      letter-spacing: -0.01em;
      margin: 0;
    }

    h1 {
      font-size: clamp(2.4rem, 5vw, 3.6rem);
      line-height: 1.05;
      font-weight: 800;
    }

    h2 {
      font-size: 1.75rem;
      font-weight: 700;
      line-height: 1.15;
    }

    h3 {
      font-size: 1.25rem;
      font-weight: 600;
      line-height: 1.25;
    }

    p {
      margin: 0;
    }

    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px clamp(20px, 4vw, 40px);
    }

    .hero {
      padding: clamp(24px, 3vw, 32px) clamp(28px, 4vw, 44px) clamp(28px, 4vw, 40px);
      border-radius: 22px;
      background: linear-gradient(150deg, var(--forest-deep) 0%, var(--forest) 100%);
      color: var(--paper);
      box-shadow: var(--shadow-md);
      position: relative;
      overflow: hidden;
    }

    .hero::before {
      content: "";
      position: absolute;
      inset: 0;
      background-image:
        radial-gradient(circle at 88% 12%, rgba(255, 248, 230, 0.06), transparent 35%),
        radial-gradient(circle at 0% 100%, rgba(181, 74, 31, 0.14), transparent 40%);
      pointer-events: none;
    }

    .hero-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 28px;
      position: relative;
    }

    .hero-mark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--paper);
      font-family: "Iowan Old Style", "Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      font-weight: 600;
      font-size: 1.05rem;
      letter-spacing: 0.04em;
    }

    .hero-mark svg {
      width: 32px;
      height: 32px;
      color: var(--gold);
    }

    .hero-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(247, 239, 222, 0.08);
      border: 1px solid rgba(247, 239, 222, 0.18);
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(247, 239, 222, 0.85);
      font-weight: 600;
    }

    .hero-status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: rgba(247, 239, 222, 0.55);
    }

    .hero-status.is-running .hero-status-dot {
      background: var(--gold);
      box-shadow: 0 0 0 4px rgba(200, 152, 41, 0.25);
      animation: pulse 1.6s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }

    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr);
      gap: 36px;
      align-items: end;
      position: relative;
    }

    .hero-content {
      position: relative;
      max-width: 560px;
    }

    .hero-eyebrow {
      font-size: 0.72rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--gold);
      margin-bottom: 14px;
      font-weight: 700;
    }

    .hero h1 {
      color: var(--paper);
      margin-bottom: 18px;
      font-size: clamp(2.2rem, 4.4vw, 3.2rem);
    }

    .hero-tagline {
      font-size: 1rem;
      color: rgba(247, 239, 222, 0.82);
      max-width: 520px;
      margin-bottom: 26px;
      line-height: 1.6;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }

    .hero-summary {
      position: relative;
    }

    .hero-figure {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .hero-figure svg {
      width: 100%;
      height: auto;
      max-height: 200px;
      border-radius: 14px;
      display: block;
      box-shadow: inset 0 0 0 1px rgba(247, 239, 222, 0.1);
    }

    .hero-stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin: 0;
      padding: 14px;
      border-radius: 12px;
      background: rgba(247, 239, 222, 0.06);
      border: 1px solid rgba(247, 239, 222, 0.12);
    }

    .hero-stats > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      align-items: flex-start;
    }

    .hero-stats dt {
      font-size: 0.62rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(247, 239, 222, 0.65);
      font-weight: 600;
    }

    .hero-stats dd {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--paper);
      line-height: 1;
    }

    .hero-stats dd span {
      font-size: 0.7rem;
      color: rgba(247, 239, 222, 0.55);
      font-weight: 500;
      margin-left: 2px;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 20px;
      border: none;
      border-radius: 999px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif;
      font-size: 0.92rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      text-decoration: none;
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
    }

    .button:hover {
      text-decoration: none;
      transform: translateY(-1px);
    }

    .button-primary {
      background: var(--accent);
      color: var(--paper);
      box-shadow: 0 4px 12px rgba(181, 74, 31, 0.32);
    }

    .button-primary:hover {
      background: var(--accent-soft);
    }

    .button-primary:disabled {
      cursor: wait;
      opacity: 0.7;
      transform: none;
    }

    .button-ghost {
      background: rgba(247, 239, 222, 0.12);
      color: var(--paper);
      border: 1px solid rgba(247, 239, 222, 0.24);
    }

    .button-ghost:hover {
      background: rgba(247, 239, 222, 0.2);
    }

    .footer-link {
      background: none;
      border: none;
      color: var(--muted);
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
      font-family: inherit;
      transition: color 120ms ease, background 120ms ease;
    }

    .footer-link:hover {
      color: var(--accent);
      background: var(--paper-soft);
    }

    main {
      display: flex;
      flex-direction: column;
      gap: 32px;
      margin-top: 36px;
    }

    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
    }

    .stat-card {
      padding: 18px 20px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .stat-label {
      font-size: 0.7rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
    }

    .stat-value {
      font-family: "Iowan Old Style", "Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      font-size: 2rem;
      font-weight: 700;
      color: var(--ink);
      line-height: 1;
    }

    .stat-suffix {
      font-size: 0.95rem;
      color: var(--muted);
      margin-left: 4px;
      font-weight: 500;
    }

    .stat-note {
      font-size: 0.78rem;
      color: var(--muted);
    }

    .notice {
      display: flex;
      align-items: flex-start;
      gap: 18px;
      padding: 24px;
      background: var(--paper-soft);
      border: 1px solid var(--line);
      border-radius: 18px;
    }

    .notice-mark {
      flex: 0 0 auto;
      width: 56px;
      height: 56px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--forest);
      color: var(--paper);
      font-family: "Iowan Old Style", "Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      font-weight: 700;
      font-size: 0.95rem;
      letter-spacing: 0.08em;
    }

    .notice h2 {
      font-size: 1.4rem;
      margin-bottom: 6px;
    }

    .notice p {
      color: var(--ink-soft);
      font-size: 0.95rem;
    }

    .section-heading {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
      margin-bottom: 18px;
    }

    .section-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--paper-soft);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 700;
    }

    .eyebrow {
      font-size: 0.7rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
      margin-bottom: 6px;
    }

    .listings {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .listing-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      transition: box-shadow 160ms ease, transform 160ms ease;
    }

    .listing-card:hover {
      box-shadow: var(--shadow-md);
    }

    .listing-hero {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 7;
      background: var(--forest-deep);
      overflow: hidden;
    }

    .listing-hero img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .hero-empty {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      color: var(--paper);
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-size: 0.85rem;
    }

    .listing-hero-overlay {
      position: absolute;
      inset: 0;
      padding: 16px 18px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      background: linear-gradient(180deg, rgba(28, 21, 12, 0) 50%, rgba(28, 21, 12, 0.65) 100%);
    }

    .listing-hero-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--paper);
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 600;
    }

    .listing-hero-meta .muted {
      opacity: 0.78;
      letter-spacing: 0.04em;
      text-transform: none;
      font-weight: 500;
    }

    .region {
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(247, 239, 222, 0.18);
      backdrop-filter: blur(6px);
      color: var(--paper);
      font-weight: 700;
      font-size: 0.7rem;
      letter-spacing: 0.12em;
    }

    .score-pill {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 10px 18px;
      border-radius: 12px;
      background: rgba(247, 239, 222, 0.95);
      box-shadow: var(--shadow-sm);
      min-width: 96px;
      color: var(--ink);
      backdrop-filter: blur(8px);
    }

    .score-pill small {
      font-size: 0.62rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
    }

    .score-pill strong {
      font-family: "Iowan Old Style", "Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      font-size: 2rem;
      font-weight: 700;
      line-height: 1;
      margin: 2px 0 4px;
    }

    .score-pill span {
      font-size: 0.7rem;
      color: var(--muted);
      letter-spacing: 0.04em;
      font-weight: 500;
    }

    .score-pill.score-hot {
      background: linear-gradient(180deg, #fff8e6, #f4d29a);
    }

    .score-pill.score-hot strong {
      color: var(--accent);
    }

    .score-pill.score-warm {
      background: linear-gradient(180deg, #faf0d9, #e9d5a8);
    }

    .score-pill.score-cold,
    .score-pill.score-muted {
      background: linear-gradient(180deg, #f1ebd9, #ddd2b8);
    }

    .listing-body {
      padding: 24px clamp(20px, 3vw, 32px) 28px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .listing-headline {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
    }

    .listing-headline h3 a {
      color: var(--ink);
    }

    .listing-headline h3 a:hover {
      color: var(--accent);
      text-decoration: none;
    }

    .ghost-link {
      flex: 0 0 auto;
      padding: 8px 14px;
      border-radius: 999px;
      background: var(--paper-soft);
      border: 1px solid var(--line);
      color: var(--ink-soft);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      transition: background 120ms ease, color 120ms ease;
    }

    .ghost-link:hover {
      background: var(--forest);
      color: var(--paper);
      border-color: var(--forest);
      text-decoration: none;
    }

    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .meta-row strong,
    .meta-row span {
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--paper-soft);
      border: 1px solid var(--line);
      font-size: 0.78rem;
      letter-spacing: 0.02em;
      color: var(--ink-soft);
      font-weight: 500;
    }

    .meta-row strong {
      background: var(--ink);
      color: var(--paper);
      border-color: var(--ink);
      font-weight: 700;
    }

    .meta-row .meta-accent {
      background: rgba(181, 74, 31, 0.1);
      color: var(--accent);
      border-color: rgba(181, 74, 31, 0.25);
      font-weight: 600;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }

    .detail-grid div {
      padding: 12px 14px;
      background: var(--paper-soft);
      border: 1px solid var(--line);
      border-radius: 10px;
    }

    .detail-grid span {
      display: block;
      font-size: 0.66rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
      margin-bottom: 4px;
    }

    .detail-grid strong {
      display: block;
      font-size: 0.92rem;
      color: var(--ink);
      font-weight: 600;
      line-height: 1.3;
    }

    .assessment {
      font-family: "Iowan Old Style", "Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      font-size: 1.05rem;
      color: var(--ink);
      line-height: 1.55;
      padding: 16px 20px;
      background: linear-gradient(180deg, var(--paper-soft), transparent);
      border-left: 3px solid var(--accent);
      border-radius: 6px;
    }

    .muted-prose {
      color: var(--ink-soft);
      font-size: 0.92rem;
      line-height: 1.6;
    }

    .muted-prose strong {
      color: var(--ink);
      font-weight: 700;
    }

    .photo-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 8px;
    }

    .photo-gallery a {
      display: block;
      overflow: hidden;
      aspect-ratio: 4 / 3;
      border-radius: 10px;
      background: var(--forest-deep);
      border: 1px solid var(--line);
    }

    .photo-gallery img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 200ms ease;
    }

    .photo-gallery a:hover img {
      transform: scale(1.05);
    }

    .analysis-details {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .analysis-section {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--paper-soft);
      overflow: hidden;
    }

    .analysis-section[open] {
      background: var(--card);
    }

    .analysis-section summary {
      cursor: pointer;
      list-style: none;
      padding: 12px 16px;
      color: var(--ink);
      font-size: 0.78rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .analysis-section summary::-webkit-details-marker {
      display: none;
    }

    .analysis-arrow {
      display: inline-grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--accent);
      color: var(--paper);
      font-size: 0.85rem;
      line-height: 1;
      transition: transform 200ms ease;
    }

    .analysis-section[open] .analysis-arrow {
      transform: rotate(45deg);
    }

    .analysis-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
      padding: 0 16px 16px;
    }

    .analysis-grid div {
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--paper-soft);
      border: 1px solid var(--line);
    }

    .analysis-grid span {
      display: block;
      font-size: 0.62rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
      margin-bottom: 3px;
    }

    .analysis-grid strong {
      display: block;
      font-size: 0.88rem;
      color: var(--ink);
      font-weight: 600;
      line-height: 1.25;
    }

    .analysis-notes {
      margin-top: 4px;
      font-size: 0.92rem;
      color: var(--ink-soft);
      line-height: 1.55;
    }

    .pill-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .pill-label {
      font-size: 0.7rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
    }

    .pill-items {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .pill-items em {
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(44, 74, 53, 0.1);
      color: var(--forest-deep);
      font-style: normal;
      font-size: 0.82rem;
      font-weight: 500;
    }

    .pill-group.warning .pill-label {
      color: var(--warning);
    }

    .pill-group.warning .pill-items em {
      background: rgba(181, 59, 28, 0.1);
      color: var(--warning);
    }

    .empty-state {
      padding: 48px;
      border-radius: 18px;
      background: var(--card);
      border: 1px solid var(--line);
      text-align: center;
      box-shadow: var(--shadow-sm);
    }

    .empty-state h3 {
      margin-bottom: 8px;
    }

    .empty-state p {
      color: var(--muted);
    }

    .page-footer {
      margin-top: 16px;
      padding: 24px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      color: var(--muted);
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      border-top: 1px solid var(--line);
    }

    @media (max-width: 860px) {
      .hero-grid {
        grid-template-columns: 1fr;
        gap: 24px;
        align-items: stretch;
      }

      .hero-stats {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    @media (max-width: 720px) {
      .listing-hero {
        aspect-ratio: 4 / 3;
      }

      .hero-actions {
        width: 100%;
      }

      .hero-stats {
        grid-template-columns: repeat(2, 1fr);
      }

      .listing-headline {
        flex-direction: column;
        align-items: stretch;
      }

      .ghost-link {
        align-self: flex-start;
      }

      .page-footer {
        flex-direction: column;
        text-align: center;
      }
    }
  `;
}
