import { setTimeout } from 'node:timers/promises';

export const userAgent =
  'canoe-hunter/1.0 (+https://github.com/your-username/canoe-hunter; personal Craigslist alert bot)';

export function nowIso(): string {
  return new Date().toISOString();
}

export function parsePrice(raw: string | undefined | null): number | null {
  if (!raw) {
    return null;
  }

  const match = raw.replaceAll(',', '').match(/\$?\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

export function normalizeUrl(url: string, source: string): string {
  return new URL(url, `https://${source}`).toString().split('#')[0];
}

export async function politeDelay(): Promise<void> {
  const delayMs = 1000 + Math.floor(Math.random() * 2000);
  await setTimeout(delayMs);
}

export function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function asJsonArray(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

export function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
