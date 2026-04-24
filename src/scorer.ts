import OpenAI from 'openai';
import { AppConfig, Listing, ScoreResult } from './types.js';
import { truncate } from './utils.js';

const fallbackSellerMessage =
  "Hi, is the canoe still available? I'm looking for a 13-14 foot canoe for pond fishing. Any leaks or serious wear on the underside? Also, do you happen to know the model or material? I can pick up quickly if it's a good fit. Thanks.";

export class ListingScorer {
  private client: OpenAI;

  constructor(private config: AppConfig) {
    if (!config.openAiApiKey) {
      throw new Error('OPENAI_API_KEY is required to score listings');
    }

    this.client = new OpenAI({ apiKey: config.openAiApiKey });
  }

  async score(listing: Listing): Promise<ScoreResult> {
    const response = await this.client.chat.completions.create({
      model: this.config.openAiModel,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(this.config.maxPrice, this.config.searchPostal, this.config.searchDistanceMiles),
        },
        {
          role: 'user',
          content: buildUserContent(listing),
        },
      ],
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      throw new Error('OpenAI returned an empty scoring response');
    }

    return normalizeScore(JSON.parse(content));
  }
}

function buildUserContent(listing: Listing): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  const listingText = JSON.stringify(
    {
      source: listing.source,
      title: listing.title,
      url: listing.url,
      price: listing.price,
      location: listing.location,
      postedAt: listing.postedAt,
      distanceMiles: listing.distanceMiles,
      latitude: listing.latitude,
      longitude: listing.longitude,
      description: truncate(listing.description ?? '', 5000),
      imageCount: listing.imageUrls.length,
      imageUrls: listing.imageUrls.slice(0, 8),
    },
    null,
    2,
  );

  return [
    {
      type: 'text',
      text: `Extract canoe details from this Craigslist posting. Use the photos as evidence when available, but label anything inferred from photos as estimated.\n\n${listingText}`,
    },
    ...listing.imageUrls.slice(0, 4).map((url) => ({
      type: 'image_url' as const,
      image_url: {
        url,
        detail: 'low' as const,
      },
    })),
  ];
}

function buildSystemPrompt(maxPrice: number, searchPostal: string, searchDistanceMiles: number): string {
  return `
You are helping screen Craigslist canoe listings for a buyer near ZIP ${searchPostal}. Search radius is about ${searchDistanceMiles} miles.
Return only valid JSON with exactly these fields:
{
  "matchScore": number from 0 to 100,
  "likelyModel": string,
  "makeModel": string,
  "estimatedLength": string,
  "exactLength": string,
  "beamWidth": string,
  "keel": string,
  "estimatedCondition": string,
  "estimatedWeight": string,
  "exteriorColor": string,
  "listPrice": number or null,
  "offerRangeBottom": number or null,
  "offerRangeTop": number or null,
  "offerStrategy": string,
  "photoFindings": string[],
  "materialGuess": "Fiberglass" | "RamX" | "Royalex" | "ABS" | "Aluminum" | "Unknown",
  "priceAssessment": string,
  "reasonsForMatch": string[],
  "redFlags": string[],
  "questionsForSeller": string[],
  "shouldAlert": boolean,
  "suggestedSellerMessage": string
}

Buyer preferences:
- Price must be ${maxPrice} or less. A listing at ${maxPrice} must look like it is in good shape.
- Prefer 13 to 14 feet.
- Avoid 15+ foot models unless length is unclear and the rest of the listing is unusually promising.
- Must not obviously leak. Any known leak is a dealbreaker unless the seller explicitly says it has been professionally repaired and tested.
- No serious underside wear. Cracks, holes, soft spots, major gouges, delamination, oil-canning damage, patched damage, or "needs repair" are dealbreakers.
- Seats do not matter because the buyer will retrofit them.
- Paddles are a bonus.

Preferred models:
- 13'-14' plastic Coleman RamX.
- 14' Sportspal.
- 14' Radisson.
- Old Town Hunter 14, Royalex or ABS plastic.
- Old Town Stillwater 14, fiberglass composite.
- Old Town Osprey 140, Royalex or ABS plastic.
- 13-14' fiberglass models from random brands.

Extraction requirements:
- makeModel: specific make/model if known, otherwise best guess like "Unknown 13 ft fiberglass canoe".
- exactLength: exact length from text/photos if known. If estimated, say "estimated 13 ft" or "unknown".
- beamWidth: exact or estimated beam width. If not inferable, say "unknown".
- keel: "yes", "no", or "unknown". Use photos if a keel is visible.
- estimatedCondition: concise condition estimate from text and photos, including hull/bottom concerns.
- estimatedWeight: known or estimated weight, with uncertainty. Use model/material knowledge when useful.
- exteriorColor: exterior hull color from text/photos. Use simple color words like "green", "red", "tan", "blue", "white", "camo", or "unknown". If multiple colors are visible, return a short phrase like "green and tan".
- materialGuess: use exactly one of "Fiberglass", "RamX", "Royalex", "ABS", "Aluminum", or "Unknown". Do not return freeform material text. If a Coleman listing says Ram-X, RamX, RAMX, polyethylene, or plastic Ram-X, use "RamX". If it is metal/aluminium, use "Aluminum". If it is unclear, use "Unknown".
- listPrice: numeric listing price if present.
- offerRangeBottom and offerRangeTop: recommended opening/ceiling offer in dollars based on price, condition, distance, model desirability, and risk. For damaged or poor matches, keep offers low or null if not worth pursuing.
- offerStrategy: short plain-English rationale for the offer range.
- photoFindings: observable details from photos, such as hull shape, keel, bottom wear, seats, paddles, material clues, or damage. Do not invent photo details if images are absent or unclear.

Score strictly and obey these hard caps:
- 0-10: wanted/ISO posts, kayaks, inflatables, paddle-only listings, or listings that are not selling a canoe.
- 0-15: obvious leaks, holes, cracked hulls, serious underside wear, soft spots, delamination, or unsafe structural damage.
- 0-25: any listing that says it needs repair, has patched damage, has unknown leak status but visible damage, or sounds like a project boat.
- 0-35: aluminum canoes, 15+ foot canoes, or listings over ${maxPrice}.
- 0-45: vague listings with no useful condition, length, material, or model details.
- 70+: only clean, plausible 13-14 foot candidates under ${maxPrice} with no leak/damage concerns.

Do not give a damaged canoe a medium score just because it is cheap or a preferred model. Damage beats price and model. If leaks, cracks, holes, serious underside wear, or repair needs are mentioned, shouldAlert must be false.

Set shouldAlert true only when this is worth contacting the seller about. The suggestedSellerMessage should be short and human, close to:
"${fallbackSellerMessage}"
`.trim();
}

function normalizeScore(raw: Partial<ScoreResult>): ScoreResult {
  return {
    matchScore: clampScore(raw.matchScore),
    likelyModel: stringOrUnknown(raw.likelyModel),
    makeModel: stringOrUnknown(raw.makeModel),
    estimatedLength: stringOrUnknown(raw.estimatedLength),
    exactLength: stringOrUnknown(raw.exactLength),
    beamWidth: stringOrUnknown(raw.beamWidth),
    keel: normalizeKeel(raw.keel),
    estimatedCondition: stringOrUnknown(raw.estimatedCondition),
    estimatedWeight: stringOrUnknown(raw.estimatedWeight),
    exteriorColor: stringOrUnknown(raw.exteriorColor),
    listPrice: nullableDollars(raw.listPrice),
    offerRangeBottom: nullableDollars(raw.offerRangeBottom),
    offerRangeTop: nullableDollars(raw.offerRangeTop),
    offerStrategy: stringOrUnknown(raw.offerStrategy),
    photoFindings: arrayOfStrings(raw.photoFindings),
    materialGuess: normalizeMaterial(raw.materialGuess),
    priceAssessment: stringOrUnknown(raw.priceAssessment),
    reasonsForMatch: arrayOfStrings(raw.reasonsForMatch),
    redFlags: arrayOfStrings(raw.redFlags),
    questionsForSeller: arrayOfStrings(raw.questionsForSeller),
    shouldAlert: Boolean(raw.shouldAlert),
    suggestedSellerMessage: raw.suggestedSellerMessage?.trim() || fallbackSellerMessage,
  };
}

function clampScore(value: unknown): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function stringOrUnknown(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'Unknown';
}

function normalizeKeel(value: unknown): string {
  const normalized = stringOrUnknown(value).toLowerCase();

  if (['yes', 'no', 'unknown'].includes(normalized)) {
    return normalized;
  }

  return 'unknown';
}

function normalizeMaterial(value: unknown): string {
  const normalized = stringOrUnknown(value).toLowerCase().replace(/[^a-z0-9]/g, '');

  if (normalized.includes('fiberglass') || normalized.includes('fibreglass') || normalized === 'glass') {
    return 'Fiberglass';
  }

  if (normalized.includes('ramx') || normalized.includes('ram')) {
    return 'RamX';
  }

  if (normalized.includes('royalex')) {
    return 'Royalex';
  }

  if (normalized === 'abs' || normalized.includes('absplastic')) {
    return 'ABS';
  }

  if (normalized.includes('aluminum') || normalized.includes('aluminium') || normalized === 'metal') {
    return 'Aluminum';
  }

  return 'Unknown';
}

function nullableDollars(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
