/**
 * foresight/signalMap.ts
 * ──────────────────────────────────────────────────────────────────
 * Maps foresight STEEP variables to WorldMonitor's live signal
 * categories. Used by variableSync.ts to pull relevant feed items
 * and update variable intensity scores in real time.
 *
 * WorldMonitor signal categories come from:
 *   - 15 news feed categories (435+ curated feeds)
 *   - 12 Country Intelligence Index signal categories
 *   - Finance radar (92 exchanges + commodities + crypto)
 *   - Infrastructure / maritime / aviation layers
 * ──────────────────────────────────────────────────────────────────
 */

import type {
  SteepDimension,
  MicmacType,
  SignalMapping,
  WorldMonitorSignalCategory,
  ForesightVariable,
} from './types';

// ─── Default mappings per STEEP dimension ────────────────────────
//
// These defaults are applied when Claude doesn't return specific
// signal categories for a variable. Claude's output takes precedence.

export const STEEP_DEFAULT_SIGNALS: Record<SteepDimension, WorldMonitorSignalCategory[]> = {
  S:  ['social-unrest', 'public-health', 'human-rights', 'governance-policy'],
  T:  ['tech-innovation', 'ai-regulation', 'cyber-security', 'infrastructure'],
  E:  ['economic-markets', 'trade-sanctions', 'financial-risk', 'energy'],
  En: ['climate-environment', 'natural-disaster', 'energy', 'maritime'],
  P:  ['geopolitics', 'governance-policy', 'military-conflict', 'trade-sanctions'],
};

// ─── Keyword → WorldMonitor category ────────────────────────────
//
// Claude returns free-text signal labels (e.g. "eu-ai-act", "oil-price").
// This dictionary normalises them to WorldMonitor category IDs.

export const KEYWORD_TO_CATEGORY: Record<string, WorldMonitorSignalCategory> = {
  // Geopolitics / military
  'geopolitics':         'geopolitics',
  'geopolitical':        'geopolitics',
  'military':            'military-conflict',
  'conflict':            'military-conflict',
  'war':                 'military-conflict',
  'nato':                'geopolitics',
  'sanctions':           'trade-sanctions',
  'trade-sanctions':     'trade-sanctions',
  'trade':               'trade-sanctions',

  // Technology
  'tech':                'tech-innovation',
  'technology':          'tech-innovation',
  'ai':                  'ai-regulation',
  'ai-regulation':       'ai-regulation',
  'eu-ai-act':           'ai-regulation',
  'cyber':               'cyber-security',
  'cybersecurity':       'cyber-security',
  'cyber-security':      'cyber-security',
  'infrastructure':      'infrastructure',
  'space':               'space',
  'semiconductors':      'tech-innovation',

  // Economy / Finance
  'economy':             'economic-markets',
  'economic':            'economic-markets',
  'markets':             'economic-markets',
  'finance':             'financial-risk',
  'financial-risk':      'financial-risk',
  'inflation':           'economic-markets',
  'interest-rates':      'economic-markets',
  'commodities':         'economic-markets',
  'oil':                 'energy',
  'oil-price':           'energy',
  'energy':              'energy',
  'renewable':           'energy',
  'crypto':              'financial-risk',

  // Environment
  'climate':             'climate-environment',
  'environment':         'climate-environment',
  'climate-environment': 'climate-environment',
  'disaster':            'natural-disaster',
  'natural-disaster':    'natural-disaster',
  'flood':               'natural-disaster',
  'drought':             'climate-environment',
  'maritime':            'maritime',
  'shipping':            'maritime',

  // Social / Political
  'social':              'social-unrest',
  'protest':             'social-unrest',
  'social-unrest':       'social-unrest',
  'health':              'public-health',
  'public-health':       'public-health',
  'pandemic':            'public-health',
  'governance':          'governance-policy',
  'policy':              'governance-policy',
  'regulation':          'governance-policy',
  'tech-policy':         'ai-regulation',
  'tech-regulation':     'ai-regulation',
  'human-rights':        'human-rights',
  'disinformation':      'disinformation',
  'aviation':            'aviation',
};

// ─── Resolve raw Claude signal strings ───────────────────────────

/**
 * Convert Claude's free-text worldmonitor_signals array to typed
 * WorldMonitorSignalCategory values. Unrecognised strings are dropped.
 */
export function resolveSignalCategories(
  rawSignals: string[]
): WorldMonitorSignalCategory[] {
  const resolved = new Set<WorldMonitorSignalCategory>();

  for (const raw of rawSignals) {
    const normalised = raw.toLowerCase().replace(/\s+/g, '-');

    // Direct match
    if (normalised in KEYWORD_TO_CATEGORY) {
      resolved.add(KEYWORD_TO_CATEGORY[normalised]);
      continue;
    }

    // Partial match — find the first key that appears in the signal string
    for (const [key, category] of Object.entries(KEYWORD_TO_CATEGORY)) {
      if (normalised.includes(key)) {
        resolved.add(category);
        break;
      }
    }
  }

  return Array.from(resolved);
}

// ─── Build SignalMapping for a variable ──────────────────────────

/**
 * Construct the full SignalMapping for a variable using:
 * 1. Claude's worldmonitor_signals (primary source)
 * 2. STEEP defaults as fallback
 * 3. MICMAC-adjusted weights (motrice variables get higher weights)
 */
export function buildSignalMapping(variable: {
  steep: SteepDimension;
  micmac: MicmacType;
  motricite: number;
  worldmonitor_signals?: string[];
  geoScope?: string[];
}): SignalMapping[] {
  const { steep, micmac, motricite, worldmonitor_signals = [], geoScope } = variable;

  // Resolve categories
  const fromClaude = resolveSignalCategories(worldmonitor_signals);
  const fromDefault = STEEP_DEFAULT_SIGNALS[steep];

  // Merge: Claude's output takes priority, defaults fill gaps
  const merged = Array.from(new Set([...fromClaude, ...fromDefault])).slice(0, 5);

  // MICMAC-adjusted base weight (motrice variables contribute more to composite score)
  const micmacMultiplier: Record<MicmacType, number> = {
    motrice:    1.0,
    relais:     0.75,
    dependante: 0.5,
    exclue:     0.2,
  };

  // Distribute weight across categories (primary gets higher share)
  const baseWeight = micmacMultiplier[micmac];
  const perCategoryWeight = baseWeight / merged.length;

  return merged.map((category, i) => ({
    categories: [category],
    geoScope,
    weight: i === 0 ? perCategoryWeight * 1.5 : perCategoryWeight,   // first category = primary
  }));
}

// ─── Composite intensity scoring ─────────────────────────────────

/**
 * Compute composite subject intensity — weighted average of
 * motrice variable scores (they drive the system, so they
 * contribute most to the overall signal).
 */
export function computeCompositeIntensity(
  variables: Pick<ForesightVariable, 'currentIntensity' | 'micmac' | 'motricite'>[]
): number {
  if (variables.length === 0) return 0;

  const weights: Record<MicmacType, number> = {
    motrice:    2.0,
    relais:     1.2,
    dependante: 0.6,
    exclue:     0.2,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const v of variables) {
    const w = weights[v.micmac] * (v.motricite / 10);
    weightedSum += v.currentIntensity * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

// ─── WorldMonitor API URL builders ───────────────────────────────
//
// WorldMonitor exposes Vercel Edge Functions at /api/*.
// These helpers build query URLs to pull category-specific items.

const WM_BASE = typeof window !== 'undefined'
  ? window.location.origin
  : 'https://worldmonitor.app';

export interface WMNewsItem {
  id: string;
  title: string;
  category: WorldMonitorSignalCategory;
  timestamp: string;
  severity?: number;   // 0–100 if available
  country?: string;
  source?: string;
}

/**
 * Fetch recent news items for a set of signal categories.
 * Wraps the existing WorldMonitor /api/news endpoint.
 */
export async function fetchSignalItems(
  categories: WorldMonitorSignalCategory[],
  options: {
    limit?: number;
    since?: string;      // ISO timestamp
    geoScope?: string[]; // ISO country codes
  } = {}
): Promise<WMNewsItem[]> {
  const { limit = 20, since, geoScope } = options;

  const params = new URLSearchParams({
    categories: categories.join(','),
    limit: String(limit),
  });

  if (since) params.set('since', since);
  if (geoScope?.length) params.set('countries', geoScope.join(','));

  try {
    const res = await fetch(`${WM_BASE}/api/news?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/**
 * Estimate a variable's intensity delta based on recent news volume
 * and severity for its mapped signal categories.
 *
 * Algorithm (simple baseline — replace with ML scoring if available):
 *   1. Count items per category in the last N hours
 *   2. Apply severity weighting if available
 *   3. Return a delta between -15 and +15 to apply to current score
 */
export function estimateIntensityDelta(
  items: WMNewsItem[],
  signalMappings: SignalMapping[],
  windowHours = 24
): number {
  if (items.length === 0) return 0;

  const now = Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;
  const recent = items.filter(
    item => now - new Date(item.timestamp).getTime() < windowMs
  );

  if (recent.length === 0) return 0;

  // Volume signal: normalize to -10..+10 based on item count
  const volumeSignal = Math.min(10, recent.length * 0.5);

  // Severity signal: average severity if provided
  const withSeverity = recent.filter(i => typeof i.severity === 'number');
  const avgSeverity = withSeverity.length > 0
    ? withSeverity.reduce((s, i) => s + (i.severity ?? 0), 0) / withSeverity.length
    : 50;

  // Severity above 50 pushes up, below 50 pulls down
  const severityDelta = ((avgSeverity - 50) / 50) * 5;

  return Math.round(volumeSignal + severityDelta);
}
