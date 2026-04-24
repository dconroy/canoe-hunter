import dotenv from 'dotenv';
import { AppConfig } from './types.js';

dotenv.config();

function getNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a number`);
  }

  return parsed;
}

function getBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function getString(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config: AppConfig = {
  openAiApiKey: getString('OPENAI_API_KEY'),
  openAiModel: getString('OPENAI_MODEL', 'gpt-4o-mini'),
  databasePath: getString('DATABASE_PATH', './data/canoe-hunter.sqlite'),
  maxPrice: getNumber('MAX_PRICE', 300),
  maxResultsPerSearch: getNumber('MAX_RESULTS_PER_SEARCH', 10),
  searchPostal: getString('SEARCH_POSTAL', '12058'),
  searchDistanceMiles: getNumber('SEARCH_DISTANCE_MILES', 75),
  alertScoreThreshold: getNumber('ALERT_SCORE_THRESHOLD', 70),
  dryRun: getBoolean('DRY_RUN', true),
  email: {
    from: getString('EMAIL_FROM'),
    to: getString('EMAIL_TO'),
    smtpHost: getString('SMTP_HOST'),
    smtpPort: getNumber('SMTP_PORT', 587),
    smtpUser: getString('SMTP_USER'),
    smtpPass: getString('SMTP_PASS'),
  },
  sms: {
    enabled: getBoolean('ENABLE_SMS', false),
    accountSid: getString('TWILIO_ACCOUNT_SID'),
    authToken: getString('TWILIO_AUTH_TOKEN'),
    from: getString('TWILIO_FROM'),
    to: getString('TWILIO_TO'),
  },
  cronSchedule: getString('CRON_SCHEDULE', '*/30 * * * *'),
  port: getNumber('PORT', 3000),
};

export const searchRegions = [
  'albany.craigslist.org',
  'hudsonvalley.craigslist.org',
  'westernmass.craigslist.org',
  'catskills.craigslist.org',
  'newyork.craigslist.org',
  'newhaven.craigslist.org',
  'hartford.craigslist.org',
  'vermont.craigslist.org',
  'scranton.craigslist.org',
];

export const searchTerms = [
  'coleman ramx',
  'coleman ram-x',
  'ramx canoe',
  'ram-x canoe',
  'sportspal canoe',
  'radisson canoe',
  'old town hunter 14',
  'old town hunter canoe',
  'old town stillwater 14',
  'old town stillwater',
  'old town osprey 140',
  'osprey 140 canoe',
  'royalex canoe',
  'abs canoe',
  'fiberglass canoe 13',
  'fiberglass canoe 14',
  '13 fiberglass canoe',
  '14 fiberglass canoe',
  '13 foot canoe',
  '14 foot canoe',
  '13 ft canoe',
  '14 ft canoe',
];
