# WorldMonitor — Foresight Tracker
## GitHub Upload Guide

This package adds a **STEEP/MICMAC foresight variable tracker** to WorldMonitor,
powered by Claude AI and connected to WorldMonitor's live signal feeds.

---

## What's in this zip

```
.github/workflows/
  seed-redis.yml        GitHub Actions cron — seeds Redis every 30 min (replaces Railway)

src/foresight/
  types.ts              TypeScript interfaces
  signalMap.ts          Variable → WorldMonitor signal mapping
  foresightStore.ts     Vanilla TS store + event emitter (+ Zustand adapter)
  ForesightPanel.ts     WorldMonitor Panel class

api/
  foresight-analyze.js  Vercel Edge Function — wraps Claude API server-side

docs/
  deployment-guide.html Interactive step-by-step checklist (open in browser)
  FORESIGHT_INTEGRATION.md  Code integration reference
```

---

## Step 1 — Upload files to GitHub

Go to your fork: github.com/YOUR_USERNAME/worldmonitor

### Upload src/foresight/ files

1. Click **src/** folder
2. Click **Add file** → **Create new file**
3. In the filename box type: `foresight/types.ts`
4. Paste the content of `src/foresight/types.ts`
5. Click **Commit changes**
6. Repeat for: `foresight/signalMap.ts`, `foresight/foresightStore.ts`, `foresight/ForesightPanel.ts`

OR use the **Upload files** button and drag all 4 files at once
after navigating into the `src/foresight/` folder (create it first
by committing one file with the path `foresight/types.ts`).

### Upload api/foresight-analyze.js

1. Click **api/** folder
2. Click **Add file** → **Upload files**
3. Drag `api/foresight-analyze.js`
4. Click **Commit changes**

### Upload GitHub Actions workflow

1. Navigate to **.github/workflows/** (create path if needed)
2. Click **Add file** → **Upload files**
3. Drag `.github/workflows/seed-redis.yml`
4. Click **Commit changes**

---

## Step 2 — Two manual code edits

These two files already exist in WorldMonitor — edit them in the GitHub web editor
(click the file → pencil icon ✏️ → edit → commit).

### Edit 1: src/foresight/ForesightPanel.ts

Find this block near the top and **delete** it:
```
interface PanelBase { ... }
declare const Panel: { ... }
```

Replace with:
```typescript
import { Panel } from '../components/Panel';

export class ForesightPanel extends Panel {
  constructor() {
    super('foresight', 'Foresight', { resizable: true });
    this.bindStoreEvents();
    this.render();
  }
  // Replace every this.container → this.content in the rest of the file
}
```

To find the correct Panel import path, open `src/components/` and
look for `Panel.ts`. Also check an existing panel (e.g. NewsPanel.ts)
to match the constructor pattern exactly.

### Edit 2: src/main.ts

Search for `SignalModal` — this is Phase 6 of App.init().
Add these two lines in that block:

```typescript
import { ForesightPanel } from './foresight/ForesightPanel';
// same location as other panel instantiations:
new ForesightPanel(/* container element */);
```

---

## Step 3 — Add GitHub Secrets

Settings → Secrets and variables → Actions → New repository secret

**Required (Foresight won't work without these):**
```
UPSTASH_REDIS_REST_URL      from upstash.com → your database → REST API tab
UPSTASH_REDIS_REST_TOKEN    from upstash.com → your database → REST API tab
ANTHROPIC_API_KEY           from console.anthropic.com → API Keys
```

**Also add to Vercel** (for the edge function):
Vercel dashboard → your project → Settings → Environment Variables

Add the same three keys there.

**Optional data feed secrets (add as you get them):**
```
GROQ_API_KEY          console.groq.com (free — AI summaries)
FINNHUB_API_KEY       finnhub.io (free — stock markets)
FRED_API_KEY          fred.stlouisfed.org (free — economics)
EIA_API_KEY           eia.gov/opendata (free — energy)
NASA_FIRMS_API_KEY    firms.modaps.eosdis.nasa.gov (free — fires)
ACLED_ACCESS_TOKEN    acleddata.com (free for research — conflicts)
AVIATIONSTACK_API     aviationstack.com (free tier — flights)
AISSTREAM_API_KEY     aisstream.io (free — ships)
```

---

## Step 4 — Vercel deployment

Open `docs/deployment-guide.html` in your browser.
Follow phases 1–9 (interactive checklist with copy buttons).

Short version:
```
npm install
vercel link
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
vercel env add ANTHROPIC_API_KEY
vercel --prod
```

---

## Step 5 — Verify

The GitHub Actions workflow runs automatically every 30 minutes.
To trigger it immediately: Actions tab → "Seed Redis" → Run workflow.

Test the Foresight endpoint:
```
POST https://YOUR_APP.vercel.app/api/foresight-analyze
{"subjectText": "Régulation IA en Europe", "language": "fr"}
```

Expected: {"ok":true, "result": {"variables": [...10 items...]}}

---

## Architecture summary

```
GitHub Actions (cron every 30 min)
  → runs seed-*.mjs scripts
  → writes to Upstash Redis

Browser request
  → Foresight panel → POST /api/foresight-analyze
  → Vercel Edge Function → Claude API (server-side)
  → returns STEEP/MICMAC variables
  → stored in foresightStore (localStorage)
  → synced to WorldMonitor feeds via variableSync
```

No Railway needed — GitHub Actions handles the cron seeding for free.
