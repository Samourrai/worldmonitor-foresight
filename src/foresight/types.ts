/**
 * foresight/types.ts
 * ──────────────────────────────────────────────────────────────────
 * Core type definitions for the WorldMonitor Foresight Tracker module.
 *
 * Architecture note: WorldMonitor is a Vanilla TypeScript SPA using a
 * Panel base class. These types are framework-agnostic and work both
 * in the vanilla codebase and in a React fork.
 *
 * Methodology: École française (Godet/LIPSOR) — STEEP scan + MICMAC
 * ──────────────────────────────────────────────────────────────────
 */

// ─── STEEP ────────────────────────────────────────────────────────

/** Five STEEP dimensions for environmental scanning */
export type SteepDimension = 'S' | 'T' | 'E' | 'En' | 'P';

export const STEEP_META: Record<SteepDimension, { label: string; color: string; description: string }> = {
  S:  { label: 'Social',          color: '#a78bfa', description: 'Démographie, comportements, culture, santé, inégalités' },
  T:  { label: 'Technologique',   color: '#22d3ee', description: 'Innovation, R&D, ruptures numériques, IA, énergie' },
  E:  { label: 'Économique',      color: '#fbbf24', description: 'Marchés, commerce, inflation, emploi, géoéconomie' },
  En: { label: 'Environnemental', color: '#34d399', description: 'Climat, ressources, biodiversité, risques naturels' },
  P:  { label: 'Politique',       color: '#f87171', description: 'Gouvernance, régulation, géopolitique, conflits' },
};

// ─── MICMAC ───────────────────────────────────────────────────────

/**
 * MICMAC variable classification.
 *
 * Quadrant logic (motricité × dépendance):
 *   motrice    → high motricité, low dépendance   (top-left)  — levers
 *   relais     → high motricité, high dépendance  (top-right) — amplifiers
 *   dependante → low motricité,  high dépendance  (bot-right) — outcomes
 *   exclue     → low motricité,  low dépendance   (bot-left)  — excluded
 */
export type MicmacType = 'motrice' | 'relais' | 'dependante' | 'exclue';

export const MICMAC_META: Record<MicmacType, { label: string; color: string; description: string }> = {
  motrice:    { label: 'Motrice',    color: '#fbbf24', description: 'Variable clé — levier d\'action prioritaire' },
  relais:     { label: 'Relais',     color: '#22d3ee', description: 'Amplificateur — forte influence et sensibilité' },
  dependante: { label: 'Dépendante', color: '#94a3b8', description: 'Résultat — indique l\'état du système' },
  exclue:     { label: 'Exclue',     color: '#374151', description: 'Variable autonome — peu d\'effet sur le système' },
};

// ─── Trend & Signal ───────────────────────────────────────────────

export type TrendDirection = 'rising' | 'stable' | 'declining';

export type SignalStrength = 'strong' | 'medium' | 'weak' | 'dormant';

/** A scored data point in the variable's history */
export interface ScorePoint {
  /** ISO 8601 date string */
  timestamp: string;
  /** Intensity score 0–100 */
  score: number;
  /** Optional brief description of what drove this score */
  driver?: string;
  /** WorldMonitor article / event IDs that contributed */
  sourceEventIds?: string[];
}

// ─── WorldMonitor Signal Mapping ──────────────────────────────────

/**
 * Signal category IDs that exist in WorldMonitor's feed system.
 * Derived from the 15 feed categories and Country Intelligence Index.
 */
export type WorldMonitorSignalCategory =
  | 'geopolitics'
  | 'military-conflict'
  | 'economic-markets'
  | 'tech-innovation'
  | 'cyber-security'
  | 'climate-environment'
  | 'energy'
  | 'trade-sanctions'
  | 'public-health'
  | 'social-unrest'
  | 'governance-policy'
  | 'infrastructure'
  | 'maritime'
  | 'aviation'
  | 'space'
  | 'ai-regulation'
  | 'financial-risk'
  | 'disinformation'
  | 'human-rights'
  | 'natural-disaster';

/** Mapping from a foresight variable to WorldMonitor live data streams */
export interface SignalMapping {
  /** Signal categories to monitor */
  categories: WorldMonitorSignalCategory[];
  /** Optional ISO 3166-1 alpha-2 country codes to scope the signal */
  geoScope?: string[];
  /** Optional keyword filters applied on top of category */
  keywords?: string[];
  /**
   * Weight of this category in composite intensity scoring (0–1).
   * All weights for a variable should sum to 1.
   */
  weight?: number;
}

// ─── Foresight Variable ───────────────────────────────────────────

/** Core unit of analysis — a single variable tracked over time */
export interface ForesightVariable {
  /** Unique identifier (e.g. "v-ai-regulation-eu") */
  id: string;

  /** Human-readable label (max 60 chars) */
  label: string;

  /** STEEP dimension */
  steep: SteepDimension;

  /** MICMAC classification */
  micmac: MicmacType;

  /**
   * Motricité score (1–10): how strongly this variable drives others.
   * High = lever. Used as Y-axis on MICMAC scatter plot.
   */
  motricite: number;

  /**
   * Dépendance score (1–10): how strongly this variable is driven by others.
   * High = outcome. Used as X-axis on MICMAC scatter plot.
   */
  dependance: number;

  /** Analyst rationale for including this variable (1-3 sentences) */
  rationale: string;

  /** Foresight analyst's horizon for this variable */
  horizon?: '1-5 ans' | '5-15 ans' | '15-30 ans';

  /** Current intensity score 0–100 */
  currentIntensity: number;

  /** Short-term momentum direction */
  trend: TrendDirection;

  /**
   * True if this is an emerging / weak signal.
   * Weak signals: low current intensity but potentially high future impact.
   */
  isWeakSignal: boolean;

  /** Alert threshold — triggers notification when crossed */
  alertThreshold?: number;

  /** WorldMonitor data stream mappings */
  signalMappings: SignalMapping[];

  /** Historical score points (chronological, oldest first) */
  history: ScorePoint[];

  /** ISO 8601 creation date */
  createdAt: string;

  /** ISO 8601 last update date */
  updatedAt: string;
}

// ─── Wild Card ────────────────────────────────────────────────────

/** Low-probability / high-impact discontinuity */
export interface WildCard {
  id: string;
  label: string;
  impact: string;
  /** Estimated probability (0–1) — typically < 0.05 */
  probability?: number;
  /** Potential impact score 0–10 */
  impactScore?: number;
  /** Which variables this wild card would most affect */
  affectedVariableIds?: string[];
}

// ─── Foresight Subject ────────────────────────────────────────────

/** A complete foresight subject with all its variables */
export interface ForesightSubject {
  /** Unique identifier */
  id: string;

  /** User-entered subject label */
  label: string;

  /** Recommended analysis horizon */
  horizon: string;

  /** Methodology applied (e.g. "STEEP + MICMAC lite") */
  methodology: string;

  /** All tracked variables */
  variables: ForesightVariable[];

  /** Strategic questions to guide scenario analysis */
  drivingQuestions: string[];

  /** Identified wild cards */
  wildCards: WildCard[];

  /**
   * Composite subject intensity: weighted average of motrice variables.
   * Computed property — recalculated on each store update.
   */
  compositeIntensity?: number;

  /** ISO 8601 date of initial analysis */
  createdAt: string;

  /** ISO 8601 date of last variable update */
  lastSyncedAt?: string;

  /** Whether live sync with WorldMonitor feeds is active */
  syncEnabled: boolean;

  /** Polling interval in minutes (default: 60) */
  syncIntervalMinutes?: number;
}

// ─── Store State ──────────────────────────────────────────────────

export interface ForesightStoreState {
  subjects: ForesightSubject[];
  activeSubjectId: string | null;
  /** IDs of variables with alerts triggered */
  activeAlerts: string[];
  /** Last sync timestamp per subject */
  lastSyncTimestamps: Record<string, string>;
  /** Loading state for async operations */
  isAnalyzing: boolean;
  /** Error message if last operation failed */
  lastError: string | null;
}

// ─── Store Events ─────────────────────────────────────────────────

/** Events emitted by ForesightStore — subscribe via store.on() */
export interface ForesightStoreEvents {
  'subject:added':    { subject: ForesightSubject };
  'subject:removed':  { subjectId: string };
  'subject:selected': { subjectId: string | null };
  'variable:updated': { subjectId: string; variable: ForesightVariable };
  'variable:alert':   { subjectId: string; variable: ForesightVariable; previousScore: number };
  'sync:started':     { subjectId: string };
  'sync:completed':   { subjectId: string; updatedCount: number };
  'sync:failed':      { subjectId: string; error: string };
  'store:reset':      Record<string, never>;
}

// ─── Analysis Request / Response ─────────────────────────────────

/** Payload sent to the AI analysis endpoint */
export interface ForesightAnalysisRequest {
  subjectText: string;
  language?: 'fr' | 'en' | 'ar';
}

/**
 * Raw response shape from Claude API — matches the JSON prompt schema.
 * Validated and transformed into ForesightSubject before storage.
 */
export interface ForesightAnalysisRawResponse {
  subject: string;
  horizon: string;
  methodology: string;
  variables: Array<{
    id: string;
    label: string;
    steep: SteepDimension;
    micmac: MicmacType;
    motricite: number;
    dependance: number;
    worldmonitor_signals: string[];
    rationale: string;
    current_intensity: number;
    trend: TrendDirection;
    is_weak_signal: boolean;
  }>;
  driving_questions: string[];
  wild_cards: Array<{ label: string; impact: string }>;
}

// ─── Utility types ────────────────────────────────────────────────

/** Variable filter presets for the UI list */
export type VariableFilter = MicmacType | SteepDimension | 'weak-signal' | 'alert' | 'all';

/** Sort options for variable list */
export type VariableSort = 'intensity-desc' | 'intensity-asc' | 'motricite-desc' | 'label-asc';

/** For the MICMAC scatter plot — pre-computed display shape */
export interface MicmacPlotPoint {
  id: string;
  label: string;
  x: number;          // dependance
  y: number;          // motricite
  micmac: MicmacType;
  steep: SteepDimension;
  intensity: number;
  isWeakSignal: boolean;
}
