# Foresight Tracker — Integration Guide
**WorldMonitor fork · Vanilla TypeScript · Vercel Edge Functions**

---

## Prerequisites

- Node.js ≥ 20 (check `.nvmrc` in repo)
- Anthropic API key → https://console.anthropic.com
- Your GitHub account (to fork)

---

## STEP 1 — Fork & clone

```bash
# 1a. Fork on GitHub UI (koala73/worldmonitor → your account)
# Then:

git clone https://github.com/YOUR_USERNAME/worldmonitor.git
cd worldmonitor

# 1b. Create a feature branch
git checkout -b feature/foresight-tracker

# 1c. Install dependencies
npm install
```

---

## STEP 2 — Environment variables

```bash
# 2a. Copy the example env file
cp .env.example .env.local

# 2b. Add your Anthropic API key to .env.local
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env.local
```

> `.env.local` is already in `.gitignore` — never commit API keys.

For Vercel deployment later:
```bash
vercel env add ANTHROPIC_API_KEY
```

---

## STEP 3 — Add the Foresight module files

```bash
# 3a. Create the module directory
mkdir -p src/foresight
```

Copy the 4 generated files into `src/foresight/`:

```
src/foresight/
  types.ts           ← TypeScript interfaces
  signalMap.ts       ← Variable → WorldMonitor signal mapping
  foresightStore.ts  ← Vanilla TS store with event emitter
  ForesightPanel.ts  ← Panel class (edit needed — see Step 4)
```

Copy the edge function:
```bash
# 3b. Add the edge function
cp foresight-analyze.js api/foresight-analyze.js
```

---

## STEP 4 — Fix the Panel import

Open `src/foresight/ForesightPanel.ts` and replace the placeholder
Panel declaration with the real import. First, find the Panel class:

```bash
grep -r "export class Panel" src/
# Likely: src/components/Panel.ts
```

Then update the top of `ForesightPanel.ts`:

```typescript
// REMOVE the placeholder interface and declare block:
// interface PanelBase { ... }
// declare const Panel: { ... }

// ADD the real import (adjust path if needed):
import { Panel } from '../components/Panel';

// Then make ForesightPanel extend it:
export class ForesightPanel extends Panel {
  constructor() {
    super('foresight', 'Foresight', { resizable: true });
    // The Panel base sets up this.content — bind events after super()
    this.bindStoreEvents();
    this.render();
  }

  // Replace this.container with this.content everywhere in the file
  // (Panel base exposes this.content, not this.container)
}
```

> **How to find the Panel API**: run `grep -n "setContent\|this.content\|constructor" src/components/Panel.ts`
> and match parameters to what existing panels use (e.g. `src/components/*Panel.ts`).

---

## STEP 5 — Update the client-side API call

The `ForesightTracker.jsx` artifact calls the Anthropic API directly from
the browser. For WorldMonitor, the call must go through the Edge Function.

In `ForesightPanel.ts`, find the analysis call and replace the direct
Anthropic endpoint with the local edge function:

```typescript
// BEFORE (browser-direct, do not use in WorldMonitor):
const response = await fetch('https://api.anthropic.com/v1/messages', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-20250514', ... }),
});

// AFTER (via edge function):
const response = await fetch('/api/foresight-analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ subjectText: userInput, language: 'fr' }),
});
const { ok, result } = await response.json();
// result is the ForesightAnalysisRawResponse
foresightStore.addSubjectFromAnalysis(result, userInput);
```

---

## STEP 6 — Register the panel in main.ts

Open `src/main.ts`. Find the Phase 6 UI block (search for `SignalModal`
or `IntelligenceGapBadge` — they're registered there).

```typescript
// src/main.ts — inside App.init() Phase 6

import { ForesightPanel } from './foresight/ForesightPanel';

// In the Phase 6 block, after existing panel registrations:
const foresightContainer = document.createElement('div');
foresightContainer.id = 'foresight-panel-root';
document.getElementById('panels-container')?.appendChild(foresightContainer);
new ForesightPanel(foresightContainer);
```

> **Tip**: search for how another compact panel (e.g. the cyber or climate panel)
> is instantiated — follow the same pattern exactly.

---

## STEP 7 — Add a nav entry (optional but recommended)

Search for the nav/sidebar registration pattern:

```bash
grep -rn "nav\|sidebar\|panel-toggle" src/components/ | head -20
```

Add a Foresight nav item following the same pattern. Typically:

```typescript
// In wherever nav items are defined (e.g. src/config/panels.ts or similar):
{
  id: 'foresight',
  label: 'Foresight',
  icon: '⬡',
  panel: 'foresight',
}
```

---

## STEP 8 — TypeScript check

```bash
npm run typecheck
```

Common errors and fixes:

| Error | Fix |
|---|---|
| `Panel` import not found | Adjust import path to match actual `Panel.ts` location |
| `AppContext` type mismatch | Don't add to AppContext — the store is standalone |
| `WMNewsItem` not matching `/api/news` shape | Update interface in `signalMap.ts` to match actual API response |
| Edge function import error | Move any `src/` imports out of `api/` files |

---

## STEP 9 — Run locally

```bash
npm run dev
# Opens http://localhost:5173
```

Manual test flow:

1. Open the browser → the Foresight panel should appear (empty state with "Définir un sujet")
2. Click "Définir un sujet →" → the analyzer overlay opens
3. Type a subject (e.g. "Régulation de l'IA en Europe")
4. Submit → watch the loading steps → dashboard renders
5. Check browser DevTools → Network tab:
   - Should show `POST /api/foresight-analyze` returning `{ ok: true, result: {...} }`
   - Should NOT show any direct `api.anthropic.com` calls
6. Open DevTools → Application → Local Storage → look for `wm_foresight_store_v1`
7. Reload the page → subject should persist (store loaded from localStorage)

---

## STEP 10 — Test the store events

Open DevTools Console and run:

```javascript
// Access the singleton store
import('/src/foresight/foresightStore.js').then(m => {
  const store = m.foresightStore;
  console.log('Subjects:', store.getSubjects());
  console.log('Active:', store.getActiveSubject());

  // Subscribe to updates
  store.on('variable:updated', ({ variable }) => {
    console.log('Variable updated:', variable.label, variable.currentIntensity);
  });

  // Manually trigger a score update to test the event system
  const subject = store.getActiveSubject();
  if (subject && subject.variables[0]) {
    store.updateVariableScore(subject.id, subject.variables[0].id, 85, 'Manual test');
  }
});
```

Expected: console logs the updated variable + the panel re-renders with new score.

---

## STEP 11 — Test the edge function directly

```bash
# While dev server is running:
curl -X POST http://localhost:5173/api/foresight-analyze \
  -H "Content-Type: application/json" \
  -d '{"subjectText": "Transition énergétique en Afrique du Nord", "language": "fr"}' \
  | jq '.result.variables | length'
# Expected output: 9-11 (number of variables returned)
```

If you get a 500 → check that `ANTHROPIC_API_KEY` is in `.env.local`.
If you get a CORS error → the `_cors.js` helper is rejecting your origin;
add `localhost:5173` to the allowlist if not already present.

---

## STEP 12 — Test the live sync (variableSync)

```javascript
// In DevTools Console:
import('/src/foresight/variableSync.js').then(m => {
  const sync = m.variableSync;
  const { foresightStore } = await import('/src/foresight/foresightStore.js');

  const subject = foresightStore.getActiveSubject();
  if (subject) {
    // Listen for sync events
    foresightStore.on('sync:completed', ({ subjectId, updatedCount }) => {
      console.log(`Sync done — ${updatedCount} variables updated`);
    });

    // Trigger one manual sync pass
    sync.syncOnce(subject.id).then(count => {
      console.log('Manual sync updated', count, 'variables');
    });
  }
});
```

> Note: `syncOnce` calls `/api/news` which may return empty in local dev
> (no Redis). The count will be 0 locally — this is expected.
> Deploy to Vercel to test with live WorldMonitor feeds.

---

## STEP 13 — Commit

```bash
git add src/foresight/ api/foresight-analyze.js
git commit -m "feat: add Foresight Tracker module

- STEEP/MICMAC variable tracking per user-defined subject
- Vanilla TS store with localStorage persistence + typed event emitter
- Edge function wrapping Claude API (server-side, key protected)
- ForesightPanel integrating with Panel base class
- Signal mapping to WorldMonitor feed categories
- Live sync engine via variableSync (polls /api/news)
"

git push origin feature/foresight-tracker
```

---

## STEP 14 — Deploy to Vercel (staging)

```bash
# Deploy preview (does not affect production)
vercel

# Check the preview URL → test the full flow with live WM feeds
```

Verify in Vercel dashboard → Functions → `foresight-analyze` is listed.
Check Vercel logs for any runtime errors.

---

## Troubleshooting reference

| Symptom | Cause | Fix |
|---|---|---|
| Panel doesn't appear | Wrong mount point in main.ts | Check Phase 6 — compare with another panel's mount |
| "Analysis service unavailable" (502) | Claude API key missing or invalid | Check `.env.local` / Vercel env vars |
| Store resets on reload | localStorage key mismatch | Check `STORAGE_KEY` in `foresightStore.ts` |
| TypeScript: `Panel` not a constructor | Import path wrong | Run `grep -r "export.*Panel" src/components/` |
| CORS error on `/api/foresight-analyze` | Origin not in allowlist | Edit `api/_cors.js` to include dev origin |
| Sync returns 0 updated | `/api/news` empty locally | Expected in local dev — test on Vercel preview |
| Edge function imports from `src/` | Build will fail | Move all shared code into `api/_foresight-*.js` helpers |
