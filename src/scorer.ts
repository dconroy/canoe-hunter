import OpenAI from 'openai';
import { AppConfig, BoatAnalysisDetails, Listing, ScoreResult } from './types.js';
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
  const imageUrls = [...new Set(listing.imageUrls)];
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
      imageCount: imageUrls.length,
      imageUrls,
    },
    null,
    2,
  );

  return [
    {
      type: 'text',
      text: `Extract canoe details from this Craigslist posting. Analyze every attached photo for condition, visible damage, hull shape, material clues, color, gear, and listing quality. Label anything inferred from photos as estimated.\n\n${listingText}`,
    },
    ...imageUrls.map((url) => ({
      type: 'image_url' as const,
      image_url: {
        url,
        detail: 'auto' as const,
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
  "photoQualityScore": number from 0 to 100,
  "photoQualityAssessment": string,
  "photoCountAnalyzed": number,
  "materialGuess": "Fiberglass" | "RamX" | "Royalex" | "ABS" | "Aluminum" | "Unknown",
  "analysisDetails": {
    "BOAT_TYPE": string,
    "MAKE_BRAND": string,
    "MODEL": string,
    "YEAR": number or "unknown",
    "LENGTH_FT": number or null,
    "WEIGHT_LB": number or "estimate" or null,
    "PRICE_USD": number or null,
    "NEGOTIABLE": "yes" | "no" | "unknown",
    "MATERIAL": "aluminum" | "fiberglass" | "poly" | "other" | "unknown",
    "HULL_SHAPE": "flat" | "shallow-V" | "rounded" | "unknown",
    "KEEL": "yes" | "no" | "unknown",
    "SPONSONS": "yes" | "no" | "unknown",
    "PRIMARY_STABILITY": "poor" | "average" | "good" | "great" | "unknown",
    "SECONDARY_STABILITY": "poor" | "average" | "good" | "great" | "unknown",
    "STABILITY_SCORE_1_10": number or null,
    "INTERIOR_LAYOUT": "open" | "molded" | "other" | "unknown",
    "TWO_PERSON": "yes" | "no" | "conditional" | "unknown",
    "FACING_SEATS_POSSIBLE": "yes" | "no" | "unknown",
    "FISHING_FRIENDLY": "poor" | "average" | "good" | "great" | "unknown",
    "GEAR_SPACE": "limited" | "moderate" | "ample" | "unknown",
    "OARLOCKS": "yes" | "no" | "unknown",
    "OARS_INCLUDED": "yes" | "no" | "unknown",
    "DUAL_ROW_CAPABLE": "yes" | "no" | "modifiable" | "unknown",
    "PADDLES_INCLUDED": "yes" | "no" | "unknown",
    "CONDITION": "poor" | "fair" | "good" | "excellent" | "unknown",
    "HULL_INTEGRITY": "compromised" | "questionable" | "solid" | "unknown",
    "DENTS": "none" | "minor" | "moderate" | "severe" | "unknown",
    "CRACKS": "none" | "minor" | "major" | "unknown",
    "OIL_CANNING": "yes" | "no" | "unknown",
    "REPAIRS_VISIBLE": "yes" | "no" | "unknown",
    "REPAINTED_BOTTOM": "yes" | "no" | "unknown",
    "MODIFIABLE": "poor" | "average" | "good" | "great" | "unknown",
    "FLAT_FLOOR": "yes" | "no" | "unknown",
    "MOUNTING_POINTS": "yes" | "no" | "unknown",
    "FOAMABLE_INTERIOR": "yes" | "no" | "unknown",
    "INCLUDES_LIFE_JACKETS": "yes" | "no" | "unknown",
    "INCLUDES_TRAILER": "yes" | "no" | "unknown",
    "PORTAGE_SCORE_1_10": number or null,
    "MATCH_SCORE_1_10": number or null,
    "NOTES": string
  },
  "priceAssessment": string,
  "reasonsForMatch": string[],
  "redFlags": string[],
  "questionsForSeller": string[],
  "shouldAlert": boolean,
  "suggestedSellerMessage": string
}

Buyer preferences:
- Price must be ${maxPrice} or less. A listing at ${maxPrice} must look like it is in good shape.
- Target boat type is canoe or light rowboat.
- Use case: "Beer-Forward Fishing Canoe" - a stable, sturdy, lightweight, stashable, low-cost fishing platform for two people. The goal is not sporty paddling; it is relaxed pond fishing with four lines out, keeping movement and line tension, handling wind, and letting either person take over rowing.
- Ideal setup: two people sit near opposite ends facing the middle. Oarlocks can be installed on either side so either person can row/pass off oars without tangling lines.
- Prefer at least 13 feet; ideal is 14-15 feet if weight and handling stay reasonable.
- Target weight is 60 lb or less; ideal is 40-55 lb.
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
- Light rowboats are acceptable if stable, portable, fishable, and modifiable.
- Material preference for the broader target: aluminum > fiberglass > poly, while still recognizing RamX/Royalex/ABS canoe matches.
- Bonus for boats that look easy to stash, carry, drag gently to a pond, and modify with simple oarlocks/seat changes.

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
- photoFindings: observable details extracted from all provided photos, such as hull shape, keel, bottom wear, seats, paddles, material clues, exterior color, repairs, cracks, deep gouges, or visible damage. Be specific about which findings come from photos.
- photoQualityScore: 0-100 score for how useful the photos are for judging the canoe. Score high only when photos show multiple useful angles including exterior hull and bottom/underside. Score low when photos are missing, blurry, too few, mostly closeups, or fail to show condition-critical areas.
- photoQualityAssessment: concise explanation of the photoQualityScore and what important angles are missing.
- photoCountAnalyzed: number of photos you actually inspected.
- If only one usable photo is available, subtract 5 points from matchScore for uncertainty. Mention the single-photo penalty in redFlags or priceAssessment. Do not let this penalty override hard caps.
- analysisDetails: fill every key. Use "unknown" or null where evidence is missing. Infer carefully from text and photos, and do not invent certainty.

Checklist scoring guidance:
- Strong positives: canoe/light rowboat, flat or shallow-V hull, good/great primary stability, average/good secondary stability, open interior, two-person capable, facing seats possible, fishing friendly, moderate/ample gear space, oarlocks/oars, paddles, dual-row capable/modifiable, good/great modifiability, easy oarlock retrofit, can be rowed from either end, flat floor, mounting points, foamable interior, solid hull integrity, no cracks, no severe dents, no suspicious repainted bottom, portable/stashable weight.
- Strong negatives: compromised/questionable hull integrity, major cracks, severe dents, oil-canning, visible repairs, repainted bottom, poor stability, molded interior that prevents retrofit, too heavy to portage, poor fishing layout, not two-person capable.
- Portage score should combine weight, length, shape, and carry practicality.
- Match score 1-10 should summarize the buyer fit independent of the 0-100 alert score.
- Favor boats that solve the "two rowers facing inward while managing multiple fishing lines" use case. Penalize boats that only make sense as solo paddlers or have layouts that would tangle lines or block oarlock retrofit.

Distance scoring adjustment:
- Use distanceMiles from the listing when present.
- Add up to +10 points for close listings: +10 for 0-15 miles, +7 for 16-30 miles, +4 for 31-50 miles.
- Taper scores beyond 50 miles without over-penalizing otherwise strong listings: 0 for 51-75 miles, -2 for 76-100 miles, -5 for 101-130 miles, -8 for over 130 miles.
- If distance is unknown, apply no distance adjustment.
- Apply distance after evaluating model, price, condition, and photos, but never let distance override hard score caps or make a damaged/poor listing alert-worthy.
- Mention the distance adjustment in reasonsForMatch or redFlags when it materially changes the score.

Score strictly and obey these hard caps:
- 0-10: wanted/ISO posts, kayaks, inflatables, paddle-only listings, or listings that are not selling a canoe.
- 0-15: obvious leaks, holes, cracked hulls, serious underside wear, soft spots, delamination, or unsafe structural damage.
- 0-25: any listing that says it needs repair, has patched damage, has unknown leak status but visible damage, or sounds like a project boat.
- 0-35: listings over ${maxPrice}, non-portable boats, or boats with poor retrofit/fishing suitability.
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
    photoQualityScore: clampScore(raw.photoQualityScore),
    photoQualityAssessment: stringOrUnknown(raw.photoQualityAssessment),
    photoCountAnalyzed: nonNegativeInteger(raw.photoCountAnalyzed),
    materialGuess: normalizeMaterial(raw.materialGuess),
    analysisDetails: normalizeAnalysisDetails(raw.analysisDetails),
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

function normalizeAnalysisDetails(value: unknown): BoatAnalysisDetails {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const details: BoatAnalysisDetails = {};

  for (const key of analysisDetailKeys) {
    const raw = source[key];
    details[key] = typeof raw === 'number' || typeof raw === 'string' ? raw : raw === null ? null : 'unknown';
  }

  return details;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

const analysisDetailKeys = [
  'BOAT_TYPE',
  'MAKE_BRAND',
  'MODEL',
  'YEAR',
  'LENGTH_FT',
  'WEIGHT_LB',
  'PRICE_USD',
  'NEGOTIABLE',
  'MATERIAL',
  'HULL_SHAPE',
  'KEEL',
  'SPONSONS',
  'PRIMARY_STABILITY',
  'SECONDARY_STABILITY',
  'STABILITY_SCORE_1_10',
  'INTERIOR_LAYOUT',
  'TWO_PERSON',
  'FACING_SEATS_POSSIBLE',
  'FISHING_FRIENDLY',
  'GEAR_SPACE',
  'OARLOCKS',
  'OARS_INCLUDED',
  'DUAL_ROW_CAPABLE',
  'PADDLES_INCLUDED',
  'CONDITION',
  'HULL_INTEGRITY',
  'DENTS',
  'CRACKS',
  'OIL_CANNING',
  'REPAIRS_VISIBLE',
  'REPAINTED_BOTTOM',
  'MODIFIABLE',
  'FLAT_FLOOR',
  'MOUNTING_POINTS',
  'FOAMABLE_INTERIOR',
  'INCLUDES_LIFE_JACKETS',
  'INCLUDES_TRAILER',
  'PORTAGE_SCORE_1_10',
  'MATCH_SCORE_1_10',
  'NOTES',
];

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
