import * as cheerio from 'cheerio';
import { config, searchRegions, searchTerms } from './config.js';
import { coordinatesForZip, distanceMilesBetween } from './geo.js';
import { Listing, ListingSummary, SearchTarget } from './types.js';
import { compactText, normalizeUrl, parsePrice, politeDelay, userAgent } from './utils.js';

const requestHeaders = {
  'user-agent': userAgent,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

type CraigslistJsonLdItem = {
  item?: {
    offers?: {
      availableAtOrFrom?: {
        geo?: {
          latitude?: number;
          longitude?: number;
        };
        address?: {
          addressLocality?: string;
          addressRegion?: string;
        };
      };
    };
  };
};

export function buildSearchTargets(): SearchTarget[] {
  return searchRegions.flatMap((region) => searchTerms.map((term) => ({ region, term })));
}

export function buildSearchUrl(target: SearchTarget): string {
  const url = new URL(`https://${target.region}/search/sss`);
  url.searchParams.set('query', target.term);
  url.searchParams.set('sort', 'date');
  url.searchParams.set('search_distance', config.searchDistanceMiles.toString());
  url.searchParams.set('postal', config.searchPostal);
  url.searchParams.set('max_price', config.maxPrice.toString());
  return url.toString();
}

export async function fetchListingSummariesForTarget(target: SearchTarget): Promise<ListingSummary[]> {
  const searchUrl = buildSearchUrl(target);
  console.log(`Searching ${target.region} for "${target.term}"`);

  const response = await fetch(searchUrl, { headers: requestHeaders });
  if (!response.ok) {
    throw new Error(`Craigslist search failed ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseSearchResults(html, target.region).filter(isRelevantSummary).slice(0, config.maxResultsPerSearch);
}

export async function fetchListingsForTarget(target: SearchTarget): Promise<Listing[]> {
  const summaries = await fetchListingSummariesForTarget(target);
  const listings: Listing[] = [];

  for (const summary of summaries) {
    await politeDelay();

    try {
      listings.push(await fetchListingDetails(summary));
    } catch (error) {
      console.warn(`Failed to fetch listing detail ${summary.url}:`, error);
      listings.push({ ...summary, description: null, imageUrls: [] });
    }
  }

  return listings;
}

export function parseSearchResults(html: string, source: string): ListingSummary[] {
  const $ = cheerio.load(html);
  const listings = new Map<string, ListingSummary>();
  const jsonLdItems = parseSearchJsonLd(html);
  const origin = coordinatesForZip(config.searchPostal);

  $('.cl-static-search-result, .cl-search-result, li.result-row, .result-info').each((index, element) => {
    const container = $(element);
    const link = container.find('a.cl-app-anchor, a.result-title, a.posting-title, a').first();
    const title = compactText(
      container.find('.title').first().text() || link.text() || container.find('.label').first().text(),
    );
    const href = link.attr('href');

    if (!title || !href) {
      return;
    }

    const url = normalizeUrl(href, source);
    const jsonLd = jsonLdItems[index];
    const coordinates = getJsonLdCoordinates(jsonLd);
    const jsonLdLocation = getJsonLdLocation(jsonLd);

    listings.set(url, {
      source,
      title,
      url,
      price: parsePrice(container.find('.price, .result-price').first().text()),
      location: cleanOptional(container.find('.location, .result-hood').first().text()) ?? jsonLdLocation,
      postedAt: container.find('time').first().attr('datetime') ?? null,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      distanceMiles: distanceMilesBetween(origin, coordinates),
    });
  });

  return [...listings.values()];
}

function parseSearchJsonLd(html: string): CraigslistJsonLdItem[] {
  const match = html.match(
    /<script type="application\/ld\+json" id="ld_searchpage_results" >\s*([\s\S]*?)\s*<\/script>/,
  );

  if (!match) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[1] ?? '{}');
    return Array.isArray(parsed.itemListElement) ? parsed.itemListElement : [];
  } catch {
    return [];
  }
}

function getJsonLdCoordinates(item: CraigslistJsonLdItem | undefined): { latitude: number; longitude: number } | null {
  const geo = item?.item?.offers?.availableAtOrFrom?.geo;

  if (typeof geo?.latitude !== 'number' || typeof geo.longitude !== 'number') {
    return null;
  }

  return {
    latitude: geo.latitude,
    longitude: geo.longitude,
  };
}

function getJsonLdLocation(item: CraigslistJsonLdItem | undefined): string | null {
  const address = item?.item?.offers?.availableAtOrFrom?.address;
  const locality = address?.addressLocality?.trim();
  const region = address?.addressRegion?.trim();

  if (locality && region) {
    return `${locality}, ${region}`;
  }

  return locality || region || null;
}

export function isRelevantSummary(summary: ListingSummary): boolean {
  if (summary.price !== null && summary.price > config.maxPrice) {
    return false;
  }

  const title = summary.title.toLowerCase();

  if (hasDealbreakerDamageLanguage(title)) {
    return false;
  }

  if (/\b(wanted|want to buy|wtb|iso|in search of|looking for)\b/.test(title)) {
    return false;
  }

  if (/\b(kayak|kayaks|paddleboard|sup|raft|inflatable|dinghy|jon boat)\b/.test(title)) {
    return false;
  }

  if (/\b(15|16|17|18|19|20)\s*(ft|foot|feet)\b/.test(title) || /\b(15|16|17|18|19|20)\s*'/.test(title)) {
    return false;
  }

  if (
    /\b(paddle|paddles|oar|oars)\b/.test(title) &&
    !/\b(canoe|rowboat|sportspal|radisson|ramx|ram-x|old town)\b/.test(title)
  ) {
    return false;
  }

  return /\b(canoe|rowboat|sportspal|radisson|ramx|ram-x|royalex|fiberglass|aluminum|alum|grumman|old town|hunter 14|stillwater|osprey 140)\b/.test(
    title,
  );
}

export function hasDealbreakerDamageLanguage(value: string | null | undefined): boolean {
  const text = (value ?? '').toLowerCase();

  return /\b(damaged?|damage|broken|cracked?|cracks?|hole|holes|leaks?|leaking|needs repair|repair needed|project|for parts|patched|patch|soft spots?|delamination|delaminated|serious wear|bad wear|unsafe)\b/.test(
    text,
  );
}

export async function fetchListingDetails(summary: ListingSummary): Promise<Listing> {
  const response = await fetch(summary.url, { headers: requestHeaders });
  if (!response.ok) {
    throw new Error(`Craigslist listing failed ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const description = cleanOptional($('#postingbody').text().replace('QR Code Link to This Post', ''));
  const imageUrls = new Set<string>();

  $('a.thumb, a.gallery-item, a[href*="images.craigslist.org"], img, [data-imgsrc], [data-full], [data-large]').each(
    (_, image) => {
      const element = $(image);
      const candidates = [
        element.attr('data-full'),
        element.attr('data-large'),
        element.attr('data-imgsrc'),
        element.attr('href'),
        element.attr('src'),
      ];

      for (const candidate of candidates) {
        const normalized = normalizeCraigslistImageUrl(candidate);

        if (normalized) {
          imageUrls.add(normalized);
        }
      }
    },
  );

  return {
    ...summary,
    description,
    imageUrls: [...imageUrls],
  };
}

function normalizeCraigslistImageUrl(value: string | undefined): string | null {
  if (!value?.startsWith('http') || !value.includes('images.craigslist.org')) {
    return null;
  }

  return value
    .replace(/_50x50c(?=\.(jpg|jpeg|png|webp)$)/i, '_600x450')
    .replace(/_300x300(?=\.(jpg|jpeg|png|webp)$)/i, '_600x450');
}

function cleanOptional(value: string | undefined | null): string | null {
  const cleaned = compactText(value ?? '').replace(/^\(|\)$/g, '');
  return cleaned.length > 0 ? cleaned : null;
}
