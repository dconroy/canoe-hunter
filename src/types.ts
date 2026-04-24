export interface AppConfig {
  openAiApiKey: string;
  openAiModel: string;
  databasePath: string;
  maxPrice: number;
  maxResultsPerSearch: number;
  searchPostal: string;
  searchDistanceMiles: number;
  alertScoreThreshold: number;
  dryRun: boolean;
  email: EmailConfig;
  sms: SmsConfig;
  cronSchedule: string;
  port: number;
}

export interface EmailConfig {
  from: string;
  to: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

export interface SmsConfig {
  enabled: boolean;
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
}

export interface SearchTarget {
  region: string;
  term: string;
}

export interface ListingSummary {
  source: string;
  title: string;
  url: string;
  price: number | null;
  location: string | null;
  postedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
}

export interface Listing extends ListingSummary {
  description: string | null;
  imageUrls: string[];
}

export interface StoredListing extends Listing {
  firstSeenAt: string;
  lastSeenAt: string;
}

export type BoatAnalysisDetails = Record<string, string | number | null>;

export interface ScoreResult {
  matchScore: number;
  likelyModel: string;
  makeModel: string;
  estimatedLength: string;
  exactLength: string;
  beamWidth: string;
  keel: string;
  estimatedCondition: string;
  estimatedWeight: string;
  exteriorColor: string;
  listPrice: number | null;
  offerRangeBottom: number | null;
  offerRangeTop: number | null;
  offerStrategy: string;
  photoFindings: string[];
  photoQualityScore: number;
  photoQualityAssessment: string;
  photoCountAnalyzed: number;
  materialGuess: string;
  analysisDetails: BoatAnalysisDetails;
  priceAssessment: string;
  reasonsForMatch: string[];
  redFlags: string[];
  questionsForSeller: string[];
  shouldAlert: boolean;
  suggestedSellerMessage: string;
}

export interface ListingWithScore {
  listing: Listing;
  score: ScoreResult;
}

export interface DashboardListing {
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
  imageUrls: string[];
  firstSeenAt: string;
  lastSeenAt: string;
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
  photoFindings: string[];
  photoQualityScore: number | null;
  photoQualityAssessment: string | null;
  photoCountAnalyzed: number | null;
  materialGuess: string | null;
  analysisDetails: BoatAnalysisDetails;
  priceAssessment: string | null;
  reasonsForMatch: string[];
  redFlags: string[];
  shouldAlert: boolean | null;
  scoredAt: string | null;
  alertChannel: string | null;
  alertSentAt: string | null;
}
