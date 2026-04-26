import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { AppConfig, BoatAnalysisDetails, DashboardListing, Listing, ScoreResult, StoredListing } from './types.js';
import { asJsonArray, nowIso, parseJsonArray } from './utils.js';

type ListingRow = {
  source: string;
  title: string;
  url: string;
  price: number | null;
  location: string | null;
  postedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  description: string | null;
  imageUrls: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

type DashboardListingRow = ListingRow & {
  matchScore: number | null;
  likelyModel: string | null;
  makeModel: string | null;
  estimatedLength: string | null;
  exactLength: string | null;
  beamWidth: string | null;
  keel: string | null;
  estimatedCondition: string | null;
  estimatedWeight: string | null;
  exteriorColor: string | null;
  listPrice: number | null;
  offerRangeBottom: number | null;
  offerRangeTop: number | null;
  offerStrategy: string | null;
  photoFindings: string | null;
  photoQualityScore: number | null;
  photoQualityAssessment: string | null;
  photoCountAnalyzed: number | null;
  materialGuess: string | null;
  analysisDetails: string | null;
  priceAssessment: string | null;
  reasonsForMatch: string | null;
  redFlags: string | null;
  shouldAlert: number | null;
  scoredAt: string | null;
  alertChannel: string | null;
  alertSentAt: string | null;
};

export class CanoeHunterDb {
  private db: Database.Database;

  constructor(config: AppConfig) {
    const dbDir = path.dirname(config.databasePath);
    fs.mkdirSync(dbDir, { recursive: true });

    this.db = new Database(config.databasePath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT,
        title TEXT,
        url TEXT UNIQUE,
        price INTEGER NULL,
        location TEXT NULL,
        postedAt TEXT NULL,
        latitude REAL NULL,
        longitude REAL NULL,
        distanceMiles INTEGER NULL,
        description TEXT NULL,
        imageUrls TEXT NULL,
        firstSeenAt TEXT NOT NULL,
        lastSeenAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listingUrl TEXT UNIQUE,
        matchScore INTEGER,
        likelyModel TEXT,
        makeModel TEXT,
        estimatedLength TEXT,
        exactLength TEXT,
        beamWidth TEXT,
        keel TEXT,
        estimatedCondition TEXT,
        estimatedWeight TEXT,
        exteriorColor TEXT,
        listPrice INTEGER NULL,
        offerRangeBottom INTEGER NULL,
        offerRangeTop INTEGER NULL,
        offerStrategy TEXT,
        photoFindings TEXT,
        photoQualityScore INTEGER,
        photoQualityAssessment TEXT,
        photoCountAnalyzed INTEGER,
        materialGuess TEXT,
        analysisDetails TEXT,
        priceAssessment TEXT,
        reasonsForMatch TEXT,
        redFlags TEXT,
        questionsForSeller TEXT,
        shouldAlert INTEGER,
        suggestedSellerMessage TEXT,
        scoredAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listingUrl TEXT UNIQUE,
        channel TEXT,
        sentAt TEXT NOT NULL
      );
    `);

    this.addColumnIfMissing('listings', 'latitude', 'REAL NULL');
    this.addColumnIfMissing('listings', 'longitude', 'REAL NULL');
    this.addColumnIfMissing('listings', 'distanceMiles', 'INTEGER NULL');
    this.addColumnIfMissing('scores', 'makeModel', 'TEXT');
    this.addColumnIfMissing('scores', 'exactLength', 'TEXT');
    this.addColumnIfMissing('scores', 'beamWidth', 'TEXT');
    this.addColumnIfMissing('scores', 'keel', 'TEXT');
    this.addColumnIfMissing('scores', 'estimatedCondition', 'TEXT');
    this.addColumnIfMissing('scores', 'estimatedWeight', 'TEXT');
    this.addColumnIfMissing('scores', 'exteriorColor', 'TEXT');
    this.addColumnIfMissing('scores', 'listPrice', 'INTEGER NULL');
    this.addColumnIfMissing('scores', 'offerRangeBottom', 'INTEGER NULL');
    this.addColumnIfMissing('scores', 'offerRangeTop', 'INTEGER NULL');
    this.addColumnIfMissing('scores', 'offerStrategy', 'TEXT');
    this.addColumnIfMissing('scores', 'photoFindings', 'TEXT');
    this.addColumnIfMissing('scores', 'photoQualityScore', 'INTEGER');
    this.addColumnIfMissing('scores', 'photoQualityAssessment', 'TEXT');
    this.addColumnIfMissing('scores', 'photoCountAnalyzed', 'INTEGER');
    this.addColumnIfMissing('scores', 'analysisDetails', 'TEXT');
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;

    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  upsertListing(listing: Listing): { isNew: boolean; listing: StoredListing } {
    const existing = this.getListing(listing.url);
    const timestamp = nowIso();

    if (existing) {
      this.db
        .prepare(
          `
          UPDATE listings
          SET source = @source,
              title = @title,
              price = @price,
              location = @location,
              postedAt = @postedAt,
              latitude = @latitude,
              longitude = @longitude,
              distanceMiles = @distanceMiles,
              description = COALESCE(@description, description),
              imageUrls = CASE WHEN @imageUrls = '[]' THEN imageUrls ELSE @imageUrls END,
              lastSeenAt = @lastSeenAt
          WHERE url = @url
        `,
        )
        .run({
          ...listing,
          imageUrls: asJsonArray(listing.imageUrls),
          lastSeenAt: timestamp,
        });

      return {
        isNew: false,
        listing: {
          ...listing,
          firstSeenAt: existing.firstSeenAt,
          lastSeenAt: timestamp,
        },
      };
    }

    this.db
      .prepare(
        `
        INSERT INTO listings (
          source,
          title,
          url,
          price,
          location,
          postedAt,
          latitude,
          longitude,
          distanceMiles,
          description,
          imageUrls,
          firstSeenAt,
          lastSeenAt
        ) VALUES (
          @source,
          @title,
          @url,
          @price,
          @location,
          @postedAt,
          @latitude,
          @longitude,
          @distanceMiles,
          @description,
          @imageUrls,
          @firstSeenAt,
          @lastSeenAt
        )
      `,
      )
      .run({
        ...listing,
        imageUrls: asJsonArray(listing.imageUrls),
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
      });

    return {
      isNew: true,
      listing: {
        ...listing,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
      },
    };
  }

  getListing(url: string): StoredListing | null {
    const row = this.db.prepare('SELECT * FROM listings WHERE url = ?').get(url) as ListingRow | undefined;
    return row ? this.rowToListing(row) : null;
  }

  hasScore(listingUrl: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM scores WHERE listingUrl = ?').get(listingUrl);
    return Boolean(row);
  }

  saveScore(listingUrl: string, score: ScoreResult): void {
    this.db
      .prepare(
        `
        INSERT INTO scores (
          listingUrl,
          matchScore,
          likelyModel,
          makeModel,
          estimatedLength,
          exactLength,
          beamWidth,
          keel,
          estimatedCondition,
          estimatedWeight,
          exteriorColor,
          listPrice,
          offerRangeBottom,
          offerRangeTop,
          offerStrategy,
          photoFindings,
          photoQualityScore,
          photoQualityAssessment,
          photoCountAnalyzed,
          materialGuess,
          analysisDetails,
          priceAssessment,
          reasonsForMatch,
          redFlags,
          questionsForSeller,
          shouldAlert,
          suggestedSellerMessage,
          scoredAt
        ) VALUES (
          @listingUrl,
          @matchScore,
          @likelyModel,
          @makeModel,
          @estimatedLength,
          @exactLength,
          @beamWidth,
          @keel,
          @estimatedCondition,
          @estimatedWeight,
          @exteriorColor,
          @listPrice,
          @offerRangeBottom,
          @offerRangeTop,
          @offerStrategy,
          @photoFindings,
          @photoQualityScore,
          @photoQualityAssessment,
          @photoCountAnalyzed,
          @materialGuess,
          @analysisDetails,
          @priceAssessment,
          @reasonsForMatch,
          @redFlags,
          @questionsForSeller,
          @shouldAlert,
          @suggestedSellerMessage,
          @scoredAt
        )
        ON CONFLICT(listingUrl) DO UPDATE SET
          matchScore = excluded.matchScore,
          likelyModel = excluded.likelyModel,
          makeModel = excluded.makeModel,
          estimatedLength = excluded.estimatedLength,
          exactLength = excluded.exactLength,
          beamWidth = excluded.beamWidth,
          keel = excluded.keel,
          estimatedCondition = excluded.estimatedCondition,
          estimatedWeight = excluded.estimatedWeight,
          exteriorColor = excluded.exteriorColor,
          listPrice = excluded.listPrice,
          offerRangeBottom = excluded.offerRangeBottom,
          offerRangeTop = excluded.offerRangeTop,
          offerStrategy = excluded.offerStrategy,
          photoFindings = excluded.photoFindings,
          photoQualityScore = excluded.photoQualityScore,
          photoQualityAssessment = excluded.photoQualityAssessment,
          photoCountAnalyzed = excluded.photoCountAnalyzed,
          materialGuess = excluded.materialGuess,
          analysisDetails = excluded.analysisDetails,
          priceAssessment = excluded.priceAssessment,
          reasonsForMatch = excluded.reasonsForMatch,
          redFlags = excluded.redFlags,
          questionsForSeller = excluded.questionsForSeller,
          shouldAlert = excluded.shouldAlert,
          suggestedSellerMessage = excluded.suggestedSellerMessage,
          scoredAt = excluded.scoredAt
      `,
      )
      .run({
        listingUrl,
        matchScore: score.matchScore,
        likelyModel: score.likelyModel,
        makeModel: score.makeModel,
        estimatedLength: score.estimatedLength,
        exactLength: score.exactLength,
        beamWidth: score.beamWidth,
        keel: score.keel,
        estimatedCondition: score.estimatedCondition,
        estimatedWeight: score.estimatedWeight,
        exteriorColor: score.exteriorColor,
        listPrice: score.listPrice,
        offerRangeBottom: score.offerRangeBottom,
        offerRangeTop: score.offerRangeTop,
        offerStrategy: score.offerStrategy,
        photoFindings: asJsonArray(score.photoFindings),
        photoQualityScore: score.photoQualityScore,
        photoQualityAssessment: score.photoQualityAssessment,
        photoCountAnalyzed: score.photoCountAnalyzed,
        materialGuess: score.materialGuess,
        analysisDetails: JSON.stringify(score.analysisDetails),
        priceAssessment: score.priceAssessment,
        reasonsForMatch: asJsonArray(score.reasonsForMatch),
        redFlags: asJsonArray(score.redFlags),
        questionsForSeller: asJsonArray(score.questionsForSeller),
        shouldAlert: score.shouldAlert ? 1 : 0,
        suggestedSellerMessage: score.suggestedSellerMessage,
        scoredAt: nowIso(),
      });
  }

  hasAlert(listingUrl: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM alerts WHERE listingUrl = ?').get(listingUrl);
    return Boolean(row);
  }

  saveAlert(listingUrl: string, channel: string): void {
    this.db
      .prepare(
        `
        INSERT OR IGNORE INTO alerts (listingUrl, channel, sentAt)
        VALUES (?, ?, ?)
      `,
      )
      .run(listingUrl, channel, nowIso());
  }

  reset(): void {
    const resetTables = this.db.transaction(() => {
      this.db.prepare('DELETE FROM alerts').run();
      this.db.prepare('DELETE FROM scores').run();
      this.db.prepare('DELETE FROM listings').run();
      this.db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('alerts', 'scores', 'listings')").run();
    });

    resetTables();
  }

  listDashboardListings(limit = 50): DashboardListing[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          listings.source,
          listings.title,
          listings.url,
          listings.price,
          listings.location,
          listings.postedAt,
          listings.latitude,
          listings.longitude,
          listings.distanceMiles,
          listings.description,
          listings.imageUrls,
          listings.firstSeenAt,
          listings.lastSeenAt,
          scores.matchScore,
          scores.likelyModel,
          scores.makeModel,
          scores.estimatedLength,
          scores.exactLength,
          scores.beamWidth,
          scores.keel,
          scores.estimatedCondition,
          scores.estimatedWeight,
          scores.exteriorColor,
          scores.listPrice,
          scores.offerRangeBottom,
          scores.offerRangeTop,
          scores.offerStrategy,
          scores.photoFindings,
          scores.photoQualityScore,
          scores.photoQualityAssessment,
          scores.photoCountAnalyzed,
          scores.materialGuess,
          scores.analysisDetails,
          scores.priceAssessment,
          scores.reasonsForMatch,
          scores.redFlags,
          scores.shouldAlert,
          scores.scoredAt,
          alerts.channel AS alertChannel,
          alerts.sentAt AS alertSentAt
        FROM listings
        LEFT JOIN scores ON scores.listingUrl = listings.url
        LEFT JOIN alerts ON alerts.listingUrl = listings.url
        WHERE lower(listings.title) NOT GLOB '*damag*'
          AND lower(listings.title) NOT GLOB '*broken*'
          AND lower(listings.title) NOT GLOB '*crack*'
          AND lower(listings.title) NOT GLOB '*leak*'
          AND lower(listings.title) NOT GLOB '*needs repair*'
          AND lower(listings.title) NOT GLOB '*repair needed*'
          AND lower(listings.title) NOT GLOB '*project*'
          AND lower(listings.title) NOT GLOB '*for parts*'
          AND lower(listings.title) NOT GLOB '*patched*'
          AND lower(listings.title) NOT GLOB '*soft spot*'
          AND lower(listings.title) NOT GLOB '*delaminat*'
          AND replace(replace(lower(listings.title), '-', ' '), '_', ' ') NOT GLOB '*jon boat*'
          AND replace(lower(listings.title), '-', ' ') NOT GLOB '*jonboat*'
          AND replace(replace(lower(listings.title), '-', ' '), '_', ' ') NOT GLOB '*jonny boat*'
          AND replace(lower(listings.title), '-', ' ') NOT GLOB '*jonnyboat*'
          AND replace(replace(lower(listings.title), '-', ' '), '_', ' ') NOT GLOB '*john boat*'
          AND replace(lower(listings.title), '-', ' ') NOT GLOB '*johnboat*'
          AND replace(replace(lower(listings.title), '-', ' '), '_', ' ') NOT GLOB '*johnny boat*'
          AND replace(lower(listings.title), '-', ' ') NOT GLOB '*johnnyboat*'
          AND lower(listings.title) NOT GLOB '*fishing boat*'
          AND replace(replace(lower(listings.title), '-', ' '), '_', ' ') NOT GLOB '*v bottom*'
          AND replace(lower(listings.title), '-', ' ') NOT GLOB '*vbottom*'
          AND replace(replace(lower(listings.title), '-', ' '), '_', ' ') NOT GLOB '*v hull*'
          AND replace(lower(listings.title), '-', ' ') NOT GLOB '*vhull*'
          AND lower(listings.title) NOT GLOB '*bass boat*'
          AND lower(listings.title) NOT GLOB '*bass tracker*'
          AND lower(listings.title) NOT GLOB '*skiff*'
          AND lower(listings.title) NOT GLOB '*pontoon*'
          AND lower(listings.title) NOT GLOB '*sailboat*'
          AND lower(listings.title) NOT GLOB '*sail boat*'
          AND lower(listings.title) NOT GLOB '*dinghy*'
          AND lower(listings.title) NOT GLOB '*dingy*'
          AND lower(listings.title) NOT GLOB '*motorboat*'
          AND lower(listings.title) NOT GLOB '*motor boat*'
          AND lower(listings.title) NOT GLOB '*rowboat*'
          AND lower(listings.title) NOT GLOB '*row boat*'
          AND lower(listings.title) NOT GLOB '*dory*'
          AND lower(listings.title) NOT GLOB '*pram*'
          AND lower(listings.title) NOT GLOB '*runabout*'
          AND lower(listings.title) NOT GLOB '*bowrider*'
          AND lower(listings.title) NOT GLOB '*bayliner*'
          AND lower(listings.title) NOT GLOB '*jet ski*'
          AND lower(listings.title) NOT GLOB '*jetski*'
          AND listings.imageUrls IS NOT NULL
          AND listings.imageUrls != ''
          AND listings.imageUrls != '[]'
          AND (scores.matchScore IS NULL OR scores.matchScore > 0)
        ORDER BY scores.matchScore IS NULL, scores.matchScore DESC, listings.firstSeenAt DESC
        LIMIT ?
      `,
      )
      .all(limit) as DashboardListingRow[];

    return rows.map((row) => ({
      ...this.rowToListing(row),
      matchScore: row.matchScore,
      likelyModel: row.likelyModel,
      makeModel: row.makeModel,
      estimatedLength: row.estimatedLength,
      exactLength: row.exactLength,
      beamWidth: row.beamWidth,
      keel: row.keel,
      estimatedCondition: row.estimatedCondition,
      estimatedWeight: row.estimatedWeight,
      exteriorColor: row.exteriorColor,
      listPrice: row.listPrice,
      offerRangeBottom: row.offerRangeBottom,
      offerRangeTop: row.offerRangeTop,
      offerStrategy: row.offerStrategy,
      photoFindings: parseJsonArray(row.photoFindings),
      photoQualityScore: row.photoQualityScore,
      photoQualityAssessment: row.photoQualityAssessment,
      photoCountAnalyzed: row.photoCountAnalyzed,
      materialGuess: row.materialGuess,
      analysisDetails: parseJsonObject(row.analysisDetails),
      priceAssessment: row.priceAssessment,
      reasonsForMatch: parseJsonArray(row.reasonsForMatch),
      redFlags: parseJsonArray(row.redFlags),
      shouldAlert: row.shouldAlert === null ? null : Boolean(row.shouldAlert),
      scoredAt: row.scoredAt,
      alertChannel: row.alertChannel,
      alertSentAt: row.alertSentAt,
    }));
  }

  private rowToListing(row: ListingRow): StoredListing {
    return {
      source: row.source,
      title: row.title,
      url: row.url,
      price: row.price,
      location: row.location,
      postedAt: row.postedAt,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceMiles: row.distanceMiles,
      description: row.description,
      imageUrls: parseJsonArray(row.imageUrls),
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    };
  }
}

function parseJsonObject(value: string | null): BoatAnalysisDetails {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
