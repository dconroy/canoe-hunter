import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { AppConfig, Listing, ListingWithScore, ScoreResult } from './types.js';

export function shouldSendAlert(listing: Listing, score: ScoreResult, config: AppConfig): boolean {
  if (score.matchScore < config.alertScoreThreshold || !score.shouldAlert) {
    return false;
  }

  return listing.price === null || listing.price <= config.maxPrice;
}

export async function sendAlerts(item: ListingWithScore, config: AppConfig): Promise<string[]> {
  const channels: string[] = [];
  const message = formatAlertMessage(item);

  if (config.dryRun) {
    console.log('[DRY RUN] Would send alert:');
    console.log(message);
    return ['dry-run'];
  }

  if (hasEmailConfig(config)) {
    await sendEmail(item, config, message);
    channels.push('email');
  } else {
    console.warn('Email alert skipped because SMTP or recipient configuration is incomplete');
  }

  if (config.sms.enabled) {
    if (hasSmsConfig(config)) {
      await sendSms(item, config);
      channels.push('sms');
    } else {
      console.warn('SMS alert skipped because Twilio configuration is incomplete');
    }
  }

  return channels;
}

export function formatAlertMessage({ listing, score }: ListingWithScore): string {
  const price = listing.price === null ? 'Unknown price' : `$${listing.price}`;
  const reasons = score.reasonsForMatch.map((reason) => `- ${reason}`).join('\n') || '- None provided';
  const redFlags = score.redFlags.map((flag) => `- ${flag}`).join('\n') || '- None noted';
  const photoFindings = score.photoFindings.map((finding) => `- ${finding}`).join('\n') || '- None noted';
  const questions =
    score.questionsForSeller.map((question) => `- ${question}`).join('\n') || '- Ask about leaks and underside wear';
  const offerRange =
    score.offerRangeBottom === null && score.offerRangeTop === null
      ? 'No offer recommended'
      : `$${score.offerRangeBottom ?? score.offerRangeTop}-$${score.offerRangeTop ?? score.offerRangeBottom}`;
  const details = score.analysisDetails;

  return `
Strong canoe match found

${listing.title}
${price}${listing.location ? ` - ${listing.location}` : ''}
${listing.url}

Score: ${score.matchScore}/100
Make/model: ${score.makeModel}
Exact length: ${score.exactLength}
Beam width: ${score.beamWidth}
Keel: ${score.keel}
Exterior color: ${score.exteriorColor}
Material: ${score.materialGuess}
Estimated condition: ${score.estimatedCondition}
Estimated weight: ${score.estimatedWeight}
Distance: ${listing.distanceMiles === null ? 'Unknown' : `${listing.distanceMiles} miles`}
Photo quality: ${score.photoQualityScore}/100 (${score.photoCountAnalyzed} photos analyzed)
Photo assessment: ${score.photoQualityAssessment}
Offer range: ${offerRange}
Offer strategy: ${score.offerStrategy}
Price assessment: ${score.priceAssessment}

Boat fit:
Type: ${details.BOAT_TYPE ?? 'Unknown'}
Hull: ${details.HULL_SHAPE ?? 'Unknown'}
Stability: ${details.STABILITY_SCORE_1_10 ?? 'Unknown'}/10
Fishing friendly: ${details.FISHING_FRIENDLY ?? 'Unknown'}
Portage: ${details.PORTAGE_SCORE_1_10 ?? 'Unknown'}/10
Match: ${details.MATCH_SCORE_1_10 ?? 'Unknown'}/10

Photo findings:
${photoFindings}

Reasons:
${reasons}

Red flags:
${redFlags}

Questions for seller:
${questions}

Suggested message:
${score.suggestedSellerMessage}
`.trim();
}

async function sendEmail(item: ListingWithScore, config: AppConfig, text: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpPort === 465,
    auth:
      config.email.smtpUser && config.email.smtpPass
        ? {
            user: config.email.smtpUser,
            pass: config.email.smtpPass,
          }
        : undefined,
  });

  await transporter.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject: `Canoe Hunter: ${item.score.matchScore}/100 - ${item.listing.title}`,
    text,
  });
}

async function sendSms({ listing, score }: ListingWithScore, config: AppConfig): Promise<void> {
  const client = twilio(config.sms.accountSid, config.sms.authToken);
  const price = listing.price === null ? 'unknown price' : `$${listing.price}`;

  await client.messages.create({
    from: config.sms.from,
    to: config.sms.to,
    body: `Canoe Hunter ${score.matchScore}/100: ${listing.title} (${price}) ${listing.url}`,
  });
}

function hasEmailConfig(config: AppConfig): boolean {
  return Boolean(config.email.from && config.email.to && config.email.smtpHost);
}

function hasSmsConfig(config: AppConfig): boolean {
  return Boolean(config.sms.accountSid && config.sms.authToken && config.sms.from && config.sms.to);
}
