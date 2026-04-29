/**
 * foresight/foresightStore.ts
 * ──────────────────────────────────────────────────────────────────
 * Framework-agnostic store for the Foresight Tracker module.
 *
 * Design:
 *   - Singleton class with typed event emitter
 *   - Persists to localStorage (matches WorldMonitor's Panel persistence pattern)
 *   - Compatible with WorldMonitor's Vanilla TS Panel architecture
 *   - Optionally wrappable as a Zustand store for a React fork
 *     (see bottom of file for Zustand adapter pattern)
 *
 * Usage:
 *   import { foresightStore } from './foresightStore';
 *
 *   foresightStore.on('subject:added', ({ subject }) => render(subject));
 *   await foresightStore.addSubject(rawApiResponse);
 *   const active = foresightStore.getActiveSubject();
 * ──────────────────────────────────────────────────────────────────
 */

import type {
  ForesightStoreState,
  ForesightStoreEvents,
  ForesightSubject,
  ForesightVariable,
  ForesightAnalysisRawResponse,
  ScorePoint,
  MicmacType,
  SteepDimension,
  TrendDirection,
} from './types';
import {
  buildSignalMapping,
  computeCompositeIntensity,
  resolveSignalCategories,
} from './signalMap';

// ─── Constants ────────────────────────────────────────────────────

const STORAGE_KEY = 'wm_foresight_store_v1';
const MAX_HISTORY_POINTS = 365;   // keep up to 1 year of daily snapshots

// ─── Event Emitter ────────────────────────────────────────────────

type EventKey = keyof ForesightStoreEvents;
type EventPayload<K extends EventKey> = ForesightStoreEvents[K];
type Listener<K extends EventKey> = (payload: EventPayload<K>) => void;

class TypedEventEmitter {
  private listeners = new Map<string, Set<Listener<EventKey>>>();

  on<K extends EventKey>(event: K, listener: Listener<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as Listener<EventKey>);

    // Return unsubscribe function
    return () => this.off(event, listener);
  }

  off<K extends EventKey>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener as Listener<EventKey>);
  }

  emit<K extends EventKey>(event: K, payload: EventPayload<K>): void {
    this.listeners.get(event)?.forEach(fn => {
      try { fn(payload as EventPayload<EventKey>); }
      catch (err) { console.error(`[ForesightStore] Error in "${event}" listener:`, err); }
    });
  }
}

// ─── Utility: ID generation ───────────────────────────────────────

function generateId(prefix = 'fs'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ─── Utility: Build initial history ──────────────────────────────

function buildInitialHistory(intensity: number, trend: TrendDirection): ScorePoint[] {
  const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const today = new Date();

  return MONTHS.map((_, i) => {
    const date = new Date(today);
    date.setMonth(today.getMonth() - (11 - i));

    const noise = (Math.random() - 0.5) * 14;
    const trendOffset =
      trend === 'rising'   ? -(11 - i) * 2.8 :
      trend === 'declining' ?  (11 - i) * 2.8 : 0;

    const score = i === 11
      ? intensity
      : Math.max(5, Math.min(98, intensity + trendOffset + noise));

    return {
      timestamp: date.toISOString(),
      score: Math.round(score),
    };
  });
}

// ─── Utility: Transform raw API response → ForesightSubject ──────

function transformRawResponse(
  raw: ForesightAnalysisRawResponse,
  userInput: string
): ForesightSubject {
  const subjectId = generateId('subj');
  const createdAt = now();

  const variables: ForesightVariable[] = raw.variables.map((v, i) => {
    const varId = `${subjectId}-v${i + 1}`;
    const intensity = Math.max(5, Math.min(98, v.current_intensity));

    return {
      id: varId,
      label: v.label,
      steep: v.steep as SteepDimension,
      micmac: v.micmac as MicmacType,
      motricite: v.motricite,
      dependance: v.dependance,
      rationale: v.rationale,
      currentIntensity: intensity,
      trend: v.trend as TrendDirection,
      isWeakSignal: v.is_weak_signal,
      signalMappings: buildSignalMapping({
        steep: v.steep as SteepDimension,
        micmac: v.micmac as MicmacType,
        motricite: v.motricite,
        worldmonitor_signals: v.worldmonitor_signals,
      }),
      history: buildInitialHistory(intensity, v.trend as TrendDirection),
      createdAt,
      updatedAt: createdAt,
    };
  });

  const wildCards = (raw.wild_cards ?? []).map((wc, i) => ({
    id: `${subjectId}-wc${i + 1}`,
    label: wc.label,
    impact: wc.impact,
  }));

  const compositeIntensity = computeCompositeIntensity(variables);

  return {
    id: subjectId,
    label: raw.subject || userInput,
    horizon: raw.horizon,
    methodology: raw.methodology,
    variables,
    drivingQuestions: raw.driving_questions ?? [],
    wildCards,
    compositeIntensity,
    createdAt,
    syncEnabled: false,
    syncIntervalMinutes: 60,
  };
}

// ─── Store Class ──────────────────────────────────────────────────

class ForesightStore extends TypedEventEmitter {
  private state: ForesightStoreState = {
    subjects: [],
    activeSubjectId: null,
    activeAlerts: [],
    lastSyncTimestamps: {},
    isAnalyzing: false,
    lastError: null,
  };

  constructor() {
    super();
    this.load();
  }

  // ── Persistence ─────────────────────────────────────────────────

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ForesightStoreState>;
        this.state = {
          ...this.state,
          subjects: parsed.subjects ?? [],
          activeSubjectId: parsed.activeSubjectId ?? null,
          activeAlerts: parsed.activeAlerts ?? [],
          lastSyncTimestamps: parsed.lastSyncTimestamps ?? {},
        };
      }
    } catch (err) {
      console.warn('[ForesightStore] Failed to load from localStorage:', err);
    }
  }

  private save(): void {
    try {
      const { subjects, activeSubjectId, activeAlerts, lastSyncTimestamps } = this.state;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ subjects, activeSubjectId, activeAlerts, lastSyncTimestamps })
      );
    } catch (err) {
      console.warn('[ForesightStore] Failed to save to localStorage:', err);
    }
  }

  // ── Selectors ───────────────────────────────────────────────────

  getState(): Readonly<ForesightStoreState> {
    return this.state;
  }

  getSubjects(): ForesightSubject[] {
    return this.state.subjects;
  }

  getSubjectById(id: string): ForesightSubject | undefined {
    return this.state.subjects.find(s => s.id === id);
  }

  getActiveSubject(): ForesightSubject | undefined {
    if (!this.state.activeSubjectId) return undefined;
    return this.getSubjectById(this.state.activeSubjectId);
  }

  getVariableById(subjectId: string, variableId: string): ForesightVariable | undefined {
    return this.getSubjectById(subjectId)?.variables.find(v => v.id === variableId);
  }

  getActiveAlerts(): ForesightVariable[] {
    const subject = this.getActiveSubject();
    if (!subject) return [];
    return subject.variables.filter(v => this.state.activeAlerts.includes(v.id));
  }

  isAnalyzing(): boolean {
    return this.state.isAnalyzing;
  }

  // ── Subject CRUD ─────────────────────────────────────────────────

  /**
   * Add a subject from a raw Claude API response.
   * Handles ID generation, history bootstrapping, and signal mapping.
   */
  addSubjectFromAnalysis(
    raw: ForesightAnalysisRawResponse,
    userInput: string
  ): ForesightSubject {
    const subject = transformRawResponse(raw, userInput);

    this.state = {
      ...this.state,
      subjects: [...this.state.subjects, subject],
      activeSubjectId: subject.id,
      isAnalyzing: false,
      lastError: null,
    };

    this.save();
    this.emit('subject:added', { subject });
    this.emit('subject:selected', { subjectId: subject.id });

    return subject;
  }

  removeSubject(subjectId: string): void {
    const exists = this.getSubjectById(subjectId);
    if (!exists) return;

    const nextActiveId = this.state.activeSubjectId === subjectId
      ? (this.state.subjects.find(s => s.id !== subjectId)?.id ?? null)
      : this.state.activeSubjectId;

    this.state = {
      ...this.state,
      subjects: this.state.subjects.filter(s => s.id !== subjectId),
      activeSubjectId: nextActiveId,
      activeAlerts: this.state.activeAlerts.filter(id =>
        !exists.variables.some(v => v.id === id)
      ),
    };

    this.save();
    this.emit('subject:removed', { subjectId });
    if (nextActiveId !== this.state.activeSubjectId) {
      this.emit('subject:selected', { subjectId: nextActiveId });
    }
  }

  setActiveSubject(subjectId: string | null): void {
    if (subjectId && !this.getSubjectById(subjectId)) return;
    this.state = { ...this.state, activeSubjectId: subjectId };
    this.save();
    this.emit('subject:selected', { subjectId });
  }

  // ── Variable Updates ─────────────────────────────────────────────

  /**
   * Update a variable's intensity score and append a history point.
   * Emits a 'variable:alert' event if the alert threshold is crossed.
   */
  updateVariableScore(
    subjectId: string,
    variableId: string,
    newScore: number,
    driver?: string,
    sourceEventIds?: string[]
  ): void {
    const subject = this.getSubjectById(subjectId);
    if (!subject) return;

    const varIndex = subject.variables.findIndex(v => v.id === variableId);
    if (varIndex === -1) return;

    const variable = subject.variables[varIndex];
    const clampedScore = Math.max(0, Math.min(100, Math.round(newScore)));
    const previousScore = variable.currentIntensity;

    // Build new history point
    const newPoint: ScorePoint = {
      timestamp: now(),
      score: clampedScore,
      driver,
      sourceEventIds,
    };

    // Prune history if at cap
    const history = [
      ...variable.history.slice(-(MAX_HISTORY_POINTS - 1)),
      newPoint,
    ];

    // Infer trend from last 3 points
    const trend = inferTrend(history);

    const updatedVariable: ForesightVariable = {
      ...variable,
      currentIntensity: clampedScore,
      trend,
      history,
      updatedAt: now(),
    };

    const updatedVariables = [...subject.variables];
    updatedVariables[varIndex] = updatedVariable;

    const updatedSubject: ForesightSubject = {
      ...subject,
      variables: updatedVariables,
      compositeIntensity: computeCompositeIntensity(updatedVariables),
      lastSyncedAt: now(),
    };

    this.state = {
      ...this.state,
      subjects: this.state.subjects.map(s => s.id === subjectId ? updatedSubject : s),
    };

    this.save();
    this.emit('variable:updated', { subjectId, variable: updatedVariable });

    // Alert: threshold crossed upward
    const threshold = variable.alertThreshold ?? 75;
    if (previousScore < threshold && clampedScore >= threshold) {
      this.state = {
        ...this.state,
        activeAlerts: [...new Set([...this.state.activeAlerts, variableId])],
      };
      this.save();
      this.emit('variable:alert', { subjectId, variable: updatedVariable, previousScore });
    }
  }

  dismissAlert(variableId: string): void {
    this.state = {
      ...this.state,
      activeAlerts: this.state.activeAlerts.filter(id => id !== variableId),
    };
    this.save();
  }

  // ── Analysis lifecycle ───────────────────────────────────────────

  setAnalyzing(value: boolean): void {
    this.state = { ...this.state, isAnalyzing: value, lastError: null };
  }

  setError(message: string): void {
    this.state = { ...this.state, isAnalyzing: false, lastError: message };
  }

  // ── Sync tracking ────────────────────────────────────────────────

  setSyncEnabled(subjectId: string, enabled: boolean): void {
    const subject = this.getSubjectById(subjectId);
    if (!subject) return;

    this.state = {
      ...this.state,
      subjects: this.state.subjects.map(s =>
        s.id === subjectId ? { ...s, syncEnabled: enabled } : s
      ),
    };
    this.save();
  }

  recordSyncTimestamp(subjectId: string): void {
    this.state = {
      ...this.state,
      lastSyncTimestamps: {
        ...this.state.lastSyncTimestamps,
        [subjectId]: now(),
      },
    };
    this.save();
  }

  // ── Reset ────────────────────────────────────────────────────────

  reset(): void {
    this.state = {
      subjects: [],
      activeSubjectId: null,
      activeAlerts: [],
      lastSyncTimestamps: {},
      isAnalyzing: false,
      lastError: null,
    };
    localStorage.removeItem(STORAGE_KEY);
    this.emit('store:reset', {});
  }
}

// ─── Trend inference ──────────────────────────────────────────────

function inferTrend(history: ScorePoint[]): TrendDirection {
  if (history.length < 3) return 'stable';

  const last3 = history.slice(-3).map(p => p.score);
  const delta = last3[2] - last3[0];

  if (delta > 6) return 'rising';
  if (delta < -6) return 'declining';
  return 'stable';
}

// ─── Singleton export ─────────────────────────────────────────────

/** Global singleton — import this directly in Panel classes */
export const foresightStore = new ForesightStore();


// ══════════════════════════════════════════════════════════════════
//
//  ZUSTAND ADAPTER (React fork only)
//  ───────────────────────────────────────────────────────────────
//  If you're building a React fork of WorldMonitor, you can wrap
//  the vanilla store with Zustand for component reactivity.
//
//  Install: npm install zustand
//  Then uncomment and use useForesightStore() in React components.
//
// ══════════════════════════════════════════════════════════════════

/*
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ZustandForesightState extends ForesightStoreState {
  // Actions
  addSubjectFromAnalysis: (raw: ForesightAnalysisRawResponse, userInput: string) => ForesightSubject;
  removeSubject: (subjectId: string) => void;
  setActiveSubject: (subjectId: string | null) => void;
  updateVariableScore: (subjectId: string, variableId: string, score: number, driver?: string) => void;
  dismissAlert: (variableId: string) => void;
  setAnalyzing: (value: boolean) => void;
  setError: (message: string) => void;
  setSyncEnabled: (subjectId: string, enabled: boolean) => void;
  reset: () => void;

  // Derived selectors
  getActiveSubject: () => ForesightSubject | undefined;
  getSubjectById: (id: string) => ForesightSubject | undefined;
}

export const useForesightStore = create<ZustandForesightState>()(
  persist(
    (set, get) => ({
      subjects: [],
      activeSubjectId: null,
      activeAlerts: [],
      lastSyncTimestamps: {},
      isAnalyzing: false,
      lastError: null,

      addSubjectFromAnalysis: (raw, userInput) => {
        const subject = transformRawResponse(raw, userInput);
        set(s => ({
          subjects: [...s.subjects, subject],
          activeSubjectId: subject.id,
          isAnalyzing: false,
          lastError: null,
        }));
        return subject;
      },

      removeSubject: (subjectId) => {
        set(s => {
          const nextActiveId = s.activeSubjectId === subjectId
            ? (s.subjects.find(sub => sub.id !== subjectId)?.id ?? null)
            : s.activeSubjectId;
          return {
            subjects: s.subjects.filter(sub => sub.id !== subjectId),
            activeSubjectId: nextActiveId,
          };
        });
      },

      setActiveSubject: (subjectId) => set({ activeSubjectId: subjectId }),

      updateVariableScore: (subjectId, variableId, newScore, driver) => {
        set(s => {
          const subject = s.subjects.find(sub => sub.id === subjectId);
          if (!subject) return s;

          const varIdx = subject.variables.findIndex(v => v.id === variableId);
          if (varIdx === -1) return s;

          const variable = subject.variables[varIdx];
          const clampedScore = Math.max(0, Math.min(100, Math.round(newScore)));
          const newPoint: ScorePoint = { timestamp: now(), score: clampedScore, driver };
          const history = [...variable.history.slice(-(MAX_HISTORY_POINTS - 1)), newPoint];
          const trend = inferTrend(history);

          const updatedVar = { ...variable, currentIntensity: clampedScore, trend, history, updatedAt: now() };
          const updatedVars = [...subject.variables];
          updatedVars[varIdx] = updatedVar;

          const updatedSubject = {
            ...subject,
            variables: updatedVars,
            compositeIntensity: computeCompositeIntensity(updatedVars),
            lastSyncedAt: now(),
          };

          let activeAlerts = s.activeAlerts;
          if ((variable.alertThreshold ?? 75) <= clampedScore && variable.currentIntensity < (variable.alertThreshold ?? 75)) {
            activeAlerts = [...new Set([...activeAlerts, variableId])];
          }

          return {
            subjects: s.subjects.map(sub => sub.id === subjectId ? updatedSubject : sub),
            activeAlerts,
          };
        });
      },

      dismissAlert: (variableId) =>
        set(s => ({ activeAlerts: s.activeAlerts.filter(id => id !== variableId) })),

      setAnalyzing: (value) => set({ isAnalyzing: value, lastError: null }),

      setError: (message) => set({ isAnalyzing: false, lastError: message }),

      setSyncEnabled: (subjectId, enabled) =>
        set(s => ({
          subjects: s.subjects.map(sub =>
            sub.id === subjectId ? { ...sub, syncEnabled: enabled } : sub
          ),
        })),

      reset: () => set({
        subjects: [], activeSubjectId: null, activeAlerts: [],
        lastSyncTimestamps: {}, isAnalyzing: false, lastError: null,
      }),

      getActiveSubject: () => {
        const { subjects, activeSubjectId } = get();
        return subjects.find(s => s.id === activeSubjectId);
      },

      getSubjectById: (id) => get().subjects.find(s => s.id === id),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        subjects: state.subjects,
        activeSubjectId: state.activeSubjectId,
        activeAlerts: state.activeAlerts,
        lastSyncTimestamps: state.lastSyncTimestamps,
      }),
    }
  )
);
*/
