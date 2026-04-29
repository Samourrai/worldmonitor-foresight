/**
 * foresight/ForesightPanel.ts
 * ──────────────────────────────────────────────────────────────────
 * WorldMonitor Panel class for the Foresight Tracker.
 *
 * Extends WorldMonitor's Panel base class and integrates with the
 * existing panel layout system (PanelLayoutManager).
 *
 * Registration: add to src/panels/index.ts
 *   import './foresight/ForesightPanel';
 *
 * The panel renders in collapsed form on the main dashboard grid
 * and opens a full-screen overlay for detailed tracking.
 * ──────────────────────────────────────────────────────────────────
 */

import { foresightStore } from './foresightStore';
import { variableSync } from './variableSync';
import { STEEP_META, MICMAC_META } from './types';
import { computeCompositeIntensity } from './signalMap';
import type { ForesightSubject, ForesightVariable, ForesightAnalysisRawResponse } from './types';

// ─── Panel base (WorldMonitor convention) ─────────────────────────
//
// WorldMonitor's Panel base class is defined in src/core/Panel.ts.
// We reference it here. Adjust the import path to match your fork.
//
// import { Panel } from '../core/Panel';
//
// For portability, we define a minimal compatible base interface:

interface PanelBase {
  id: string;
  content: HTMLElement;
  setContent(html: string): void;
  show(): void;
  hide(): void;
}

declare const Panel: {
  new(id: string, title: string, options?: Record<string, unknown>): PanelBase;
};

// ─── Foresight Panel ──────────────────────────────────────────────

export class ForesightPanel /* extends Panel */ {
  readonly id = 'foresight';
  private container: HTMLElement;
  private unsubscribers: Array<() => void> = [];

  constructor(container: HTMLElement) {
    // super('foresight', 'Foresight Tracker', { resizable: true, defaultCols: 2 });
    this.container = container;
    this.init();
  }

  private init(): void {
    this.render();
    this.bindStoreEvents();
  }

  // ── Store subscriptions ─────────────────────────────────────────

  private bindStoreEvents(): void {
    this.unsubscribers = [
      foresightStore.on('subject:added',    () => this.render()),
      foresightStore.on('subject:selected', () => this.render()),
      foresightStore.on('variable:updated', () => this.renderActiveSubject()),
      foresightStore.on('variable:alert',   ({ variable }) => this.showAlert(variable)),
      foresightStore.on('sync:completed',   () => this.renderSyncBadge()),
    ];
  }

  destroy(): void {
    this.unsubscribers.forEach(fn => fn());
    this.unsubscribers = [];
  }

  // ── Rendering ───────────────────────────────────────────────────

  private render(): void {
    const subject = foresightStore.getActiveSubject();

    if (!subject) {
      this.renderEmpty();
      return;
    }

    this.renderActiveSubject(subject);
  }

  private renderEmpty(): void {
    this.container.innerHTML = `
      <div class="fp-empty">
        <div class="fp-empty-icon">⬡</div>
        <div class="fp-empty-title">Foresight Tracker</div>
        <div class="fp-empty-sub">Aucun sujet de veille actif</div>
        <button class="fp-btn-primary" id="fp-open-analyzer">
          Définir un sujet →
        </button>
      </div>
    `;

    this.container
      .querySelector('#fp-open-analyzer')
      ?.addEventListener('click', () => this.openAnalyzer());
  }

  private renderActiveSubject(subject?: ForesightSubject): void {
    const subj = subject ?? foresightStore.getActiveSubject();
    if (!subj) { this.renderEmpty(); return; }

    const composite = subj.compositeIntensity ?? 0;
    const alerts = foresightStore.getActiveAlerts();
    const motricVariables = subj.variables.filter(v => v.micmac === 'motrice');

    this.container.innerHTML = `
      <div class="fp-panel">
        <!-- Header -->
        <div class="fp-header">
          <div class="fp-header-left">
            <span class="fp-badge ${subj.syncEnabled ? 'fp-badge--live' : ''}">
              ${subj.syncEnabled ? '● LIVE' : '○ PAUSED'}
            </span>
            <span class="fp-title">${escapeHtml(subj.label)}</span>
          </div>
          <div class="fp-header-right">
            ${alerts.length > 0
              ? `<span class="fp-alert-badge">${alerts.length} alerte${alerts.length > 1 ? 's' : ''}</span>`
              : ''}
            <button class="fp-btn-icon" id="fp-open-detail" title="Ouvrir le tracker complet">⊞</button>
            <button class="fp-btn-icon" id="fp-menu-toggle" title="Options">⋯</button>
          </div>
        </div>

        <!-- Composite score -->
        <div class="fp-composite">
          <div class="fp-composite-score ${intensityClass(composite)}">${composite}</div>
          <div class="fp-composite-label">Intensité composite</div>
          <div class="fp-composite-bar">
            <div class="fp-composite-fill" style="width:${composite}%;background:${intensityColor(composite)}"></div>
          </div>
        </div>

        <!-- Top motrice variables -->
        <div class="fp-var-list">
          <div class="fp-section-label">Variables motrices (${motricVariables.length})</div>
          ${motricVariables.slice(0, 4).map(v => renderVarRow(v)).join('')}
        </div>

        <!-- Footer actions -->
        <div class="fp-footer">
          <span class="fp-horizon">${subj.horizon} · ${subj.methodology}</span>
          <button class="fp-btn-link" id="fp-toggle-sync">
            ${subj.syncEnabled ? 'Pause sync' : 'Activer sync'}
          </button>
        </div>
      </div>
    `;

    // Bind events
    this.container.querySelector('#fp-open-detail')?.addEventListener('click', () => this.openDetailView());
    this.container.querySelector('#fp-toggle-sync')?.addEventListener('click', () => this.toggleSync(subj.id));
  }

  private renderSyncBadge(): void {
    const badge = this.container.querySelector('.fp-badge');
    if (badge) {
      badge.textContent = '● SYNC';
      setTimeout(() => {
        const b = this.container.querySelector('.fp-badge');
        if (b) b.textContent = '● LIVE';
      }, 2000);
    }
  }

  // ── Actions ─────────────────────────────────────────────────────

  private openAnalyzer(): void {
    // Dispatch a custom event that the main app can handle
    // (opens the ForesightTracker React component / overlay)
    window.dispatchEvent(new CustomEvent('wm:foresight:open-analyzer'));
  }

  private openDetailView(): void {
    window.dispatchEvent(new CustomEvent('wm:foresight:open-detail', {
      detail: { subjectId: foresightStore.getState().activeSubjectId },
    }));
  }

  private toggleSync(subjectId: string): void {
    const subject = foresightStore.getSubjectById(subjectId);
    if (!subject) return;

    if (subject.syncEnabled) {
      variableSync.stopSync(subjectId);
    } else {
      variableSync.startSync(subjectId);
    }
    this.render();
  }

  private showAlert(variable: ForesightVariable): void {
    const notification = document.createElement('div');
    notification.className = 'fp-alert-toast';
    notification.innerHTML = `
      <span class="fp-alert-icon">⬡</span>
      <span><strong>${escapeHtml(variable.label)}</strong><br>
      Seuil d'alerte atteint · ${variable.currentIntensity}/100</span>
      <button class="fp-alert-dismiss">×</button>
    `;

    notification.querySelector('.fp-alert-dismiss')?.addEventListener('click', () => {
      notification.remove();
      foresightStore.dismissAlert(variable.id);
    });

    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 8000);
  }
}

// ─── Template helpers ─────────────────────────────────────────────

function renderVarRow(v: ForesightVariable): string {
  const cfg = STEEP_META[v.steep];
  const trendArrow = v.trend === 'rising' ? '↗' : v.trend === 'declining' ? '↘' : '→';
  const trendColor = v.trend === 'rising' ? '#34d399' : v.trend === 'declining' ? '#f87171' : '#94a3b8';

  return `
    <div class="fp-var-row" data-var-id="${v.id}">
      <span class="fp-var-tag" style="background:${cfg.color}20;color:${cfg.color}">${v.steep}</span>
      <span class="fp-var-label">${escapeHtml(v.label)}</span>
      <span class="fp-var-trend" style="color:${trendColor}">${trendArrow}</span>
      <span class="fp-var-score ${intensityClass(v.currentIntensity)}">${v.currentIntensity}</span>
    </div>
  `;
}

function intensityClass(score: number): string {
  if (score > 70) return 'fp--high';
  if (score > 40) return 'fp--mid';
  return 'fp--low';
}

function intensityColor(score: number): string {
  if (score > 70) return '#f87171';
  if (score > 40) return '#fbbf24';
  return '#34d399';
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── CSS (injected once) ──────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById('fp-styles')) return;

  const style = document.createElement('style');
  style.id = 'fp-styles';
  style.textContent = `
    .fp-panel { font-family: 'Space Mono', monospace; color: #e2e8f0; height: 100%; display: flex; flex-direction: column; gap: 12px; padding: 12px; }
    .fp-header { display: flex; justify-content: space-between; align-items: center; }
    .fp-header-left, .fp-header-right { display: flex; align-items: center; gap: 8px; }
    .fp-title { font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
    .fp-badge { font-size: 9px; letter-spacing: .12em; padding: 2px 6px; border-radius: 3px; background: #1e2736; color: #475569; }
    .fp-badge--live { background: #0a2015; color: #34d399; }
    .fp-alert-badge { font-size: 9px; background: #2a0a0a; color: #f87171; padding: 2px 6px; border-radius: 3px; }
    .fp-btn-icon { background: transparent; border: 1px solid #1e2736; color: #64748b; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 13px; }
    .fp-btn-icon:hover { border-color: #475569; color: #94a3b8; }
    .fp-btn-primary { background: #fbbf24; color: #050810; border: none; padding: 8px 16px; border-radius: 6px; font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; cursor: pointer; }
    .fp-btn-link { background: transparent; border: none; color: #475569; font-family: 'Space Mono', monospace; font-size: 10px; cursor: pointer; }
    .fp-btn-link:hover { color: #94a3b8; }
    .fp-composite { text-align: center; }
    .fp-composite-score { font-size: 36px; font-weight: 700; }
    .fp-composite-score.fp--high { color: #f87171; }
    .fp-composite-score.fp--mid  { color: #fbbf24; }
    .fp-composite-score.fp--low  { color: #34d399; }
    .fp-composite-label { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #475569; margin-bottom: 6px; }
    .fp-composite-bar { height: 3px; background: #1e2736; border-radius: 2px; overflow: hidden; }
    .fp-composite-fill { height: 100%; border-radius: 2px; transition: width .4s ease; }
    .fp-section-label { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #374151; margin-bottom: 8px; }
    .fp-var-list { flex: 1; overflow-y: auto; }
    .fp-var-row { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-bottom: 1px solid #0f1420; }
    .fp-var-row:last-child { border-bottom: none; }
    .fp-var-tag { font-size: 8px; padding: 1px 4px; border-radius: 2px; flex-shrink: 0; }
    .fp-var-label { flex: 1; font-size: 11px; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fp-var-trend { font-size: 11px; flex-shrink: 0; }
    .fp-var-score { font-size: 13px; font-weight: 700; flex-shrink: 0; width: 28px; text-align: right; }
    .fp-var-score.fp--high { color: #f87171; }
    .fp-var-score.fp--mid  { color: #fbbf24; }
    .fp-var-score.fp--low  { color: #34d399; }
    .fp-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #1e2736; padding-top: 8px; }
    .fp-horizon { font-size: 9px; color: #374151; }
    .fp-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 10px; text-align: center; }
    .fp-empty-icon { font-size: 32px; color: #374151; }
    .fp-empty-title { font-size: 13px; font-weight: 700; color: #64748b; }
    .fp-empty-sub { font-size: 11px; color: #374151; }
    .fp-alert-toast { position: fixed; bottom: 24px; right: 24px; background: #1a0a2e; border: 1px solid #a78bfa40; border-radius: 8px; padding: 12px 16px; display: flex; align-items: flex-start; gap: 10px; font-family: 'Space Mono', monospace; font-size: 11px; color: #e2e8f0; max-width: 320px; z-index: 9999; box-shadow: 0 4px 24px #000a; animation: fp-slide-in .3s ease; }
    .fp-alert-icon { color: #a78bfa; font-size: 16px; flex-shrink: 0; }
    .fp-alert-dismiss { background: transparent; border: none; color: #475569; cursor: pointer; font-size: 16px; margin-left: auto; }
    @keyframes fp-slide-in { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  `;

  document.head.appendChild(style);
}

// Auto-inject styles when module loads
injectStyles();


// ─── Module barrel index ──────────────────────────────────────────
// (Would live in foresight/index.ts in the actual repo)
// ─────────────────────────────────────────────────────────────────
//
// export { foresightStore }   from './foresightStore';
// export { variableSync }     from './variableSync';
// export { ForesightPanel }   from './ForesightPanel';
// export * from './types';
// export * from './signalMap';
//
//
// ─── Integration checklist ────────────────────────────────────────
//
//  1. Drop the /foresight folder into src/
//
//  2. Register the panel in src/panels/index.ts:
//       import { ForesightPanel } from './foresight/ForesightPanel';
//       panelLayoutManager.register('foresight', ForesightPanel);
//
//  3. Add a route / nav item for the full ForesightTracker.jsx view
//
//  4. Listen for overlay events in src/main.ts:
//       window.addEventListener('wm:foresight:open-analyzer', () => {
//         overlayManager.open('foresight-analyzer');
//       });
//
//  5. Wire the Claude API key (already present in WorldMonitor's
//     AI integration — reuse the existing provider pattern)
//
//  6. Optional: enable live sync in the panel footer toggle, which
//     calls variableSync.startSync() and polls /api/news
