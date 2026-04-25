import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { Server } from 'node:http';
import { sendAlerts, shouldSendAlert } from './alerts.js';
import { config } from './config.js';
import { fetchListingDetails, fetchListingSummariesForTarget, buildSearchTargets } from './craigslist.js';
import { CanoeHunterDb } from './db.js';
import { ListingScorer } from './scorer.js';
import { startServer } from './server.js';
import { Listing, ListingSummary } from './types.js';
import { politeDelay } from './utils.js';

const runOnce = process.argv.includes('--once');
const resetRequested = process.argv.includes('--reset');
const resetOnly = process.argv.includes('--reset-only');
let isRunning = false;
let server: Server | null = null;
let scheduledTask: ScheduledTask | null = null;
let isShuttingDown = false;

async function runHunt(): Promise<void> {
  if (isRunning) {
    console.log('Previous hunt is still running; skipping this schedule tick');
    return;
  }

  isRunning = true;
  const db = new CanoeHunterDb(config);
  const scorer = new ListingScorer(config);
  const targets = buildSearchTargets();
  const processedUrls = new Set<string>();

  let seenCount = 0;
  let newCount = 0;
  let alertCount = 0;

  try {
    console.log(`Starting canoe hunt across ${targets.length} searches`);

    for (const target of targets) {
      try {
        await politeDelay();
        const summaries = await fetchListingSummariesForTarget(target);
        let duplicateCount = 0;
        let alreadyStoredCount = 0;
        let uniqueCount = 0;

        for (const summary of summaries) {
          if (processedUrls.has(summary.url)) {
            duplicateCount += 1;
            continue;
          }

          processedUrls.add(summary.url);
          uniqueCount += 1;
          const existing = db.getListing(summary.url);
          if (existing) {
            alreadyStoredCount += 1;
          }

          const listing = existing ? summaryToListing(summary) : await fetchNewListingDetails(summary);

          if (listing.imageUrls.length === 0) {
            console.log(`Skipping photoless listing: ${listing.title}`);
            continue;
          }

          const { isNew } = db.upsertListing(listing);
          seenCount += 1;

          if (!isNew || db.hasScore(listing.url)) {
            continue;
          }

          newCount += 1;
          console.log(`Scoring new listing: ${listing.title}`);

          try {
            const score = await scorer.score(listing);
            db.saveScore(listing.url, score);

            if (shouldSendAlert(listing, score, config) && !db.hasAlert(listing.url)) {
              const channels = await sendAlerts({ listing, score }, config);

              if (channels.length > 0 && !config.dryRun) {
                db.saveAlert(listing.url, channels.join(','));
              }

              alertCount += channels.length > 0 ? 1 : 0;
            }
          } catch (error) {
            console.warn(`Failed to score listing ${listing.url}:`, error);
          }
        }

        console.log(
          `Search complete for ${target.region} "${target.term}": ${summaries.length} summaries, ${uniqueCount} unique this run, ${duplicateCount} duplicates, ${alreadyStoredCount} already stored`,
        );
      } catch (error) {
        console.warn(`Search failed for ${target.region} "${target.term}":`, error);
      }
    }
  } finally {
    db.close();
    isRunning = false;
    console.log(`Hunt complete. Seen: ${seenCount}. New: ${newCount}. Alerts: ${alertCount}.`);
  }
}

async function fetchNewListingDetails(summary: ListingSummary): Promise<Listing> {
  await politeDelay();

  try {
    return await fetchListingDetails(summary);
  } catch (error) {
    console.warn(`Using summary only because detail fetch failed for ${summary.url}:`, error);
    return summaryToListing(summary);
  }
}

function summaryToListing(summary: ListingSummary): Listing {
  return {
    ...summary,
    description: null,
    imageUrls: [],
  };
}

function resetDatabase(): void {
  const db = new CanoeHunterDb(config);

  try {
    db.reset();
    console.log('Reset complete. Cleared listings, scores, and alerts.');
  } finally {
    db.close();
  }
}

function shutdown(): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log('Shutting down Canoe Hunter...');
  scheduledTask?.stop();

  if (server) {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  } else {
    process.exit(0);
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

if (resetRequested || resetOnly) {
  resetDatabase();
}

if (resetOnly) {
  console.log('Reset-only mode complete. Exiting.');
} else if (runOnce) {
  runHunt().catch((error) => {
    console.error('Canoe hunt failed:', error);
    process.exitCode = 1;
  });
} else {
  console.log(`Scheduling canoe hunt with cron: ${config.cronSchedule}`);
  server = startServer({ config, getIsRunning: () => isRunning, runHunt, shutdown });
  runHunt().catch((error) => console.error('Initial canoe hunt failed:', error));
  scheduledTask = cron.schedule(config.cronSchedule, () => {
    runHunt().catch((error) => console.error('Scheduled canoe hunt failed:', error));
  });
}
