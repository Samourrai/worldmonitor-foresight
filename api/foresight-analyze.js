/**
 * api/foresight-analyze.js
 * ──────────────────────────────────────────────────────────────────
 * Vercel Edge Function — proxies foresight analysis requests to
 * the Claude API server-side (keeps API key off the client).
 *
 * POST /api/foresight-analyze
 * Body: { subjectText: string, language?: "fr" | "en" | "ar" }
 *
 * Follows WorldMonitor's Edge Function conventions:
 *   - Same-directory _cors.js and _rate-limit.js helpers
 *   - No imports from ../src/
 *   - Vercel edge runtime
 * ──────────────────────────────────────────────────────────────────
 */

import { corsHeaders } from './_cors.js';
import { rateLimit } from './_rate-limit.js';

export const config = { runtime: 'edge' };

// ─── Prompt builder ───────────────────────────────────────────────

function buildPrompt(subjectText, language = 'fr') {
  const langInstruction =
    language === 'ar' ? 'Réponds en arabe (الفصحى).' :
    language === 'en' ? 'Respond in English.' :
    'Réponds en français.';

  return `Tu es un expert en prospective (école Godet/LIPSOR + Shell Scenarios).
${langInstruction}

Sujet : "${subjectText}"

Génère une analyse prospective structurée. Réponds UNIQUEMENT en JSON valide, sans backticks ni texte autour.

{
  "subject": "titre court max 60 chars",
  "horizon": "horizon temporel ex: 5-15 ans",
  "methodology": "méthode retenue ex: STEEP + MICMAC lite",
  "variables": [
    {
      "id": "v1",
      "label": "Nom court max 45 chars",
      "steep": "S ou T ou E ou En ou P",
      "micmac": "motrice ou relais ou dependante ou exclue",
      "motricite": 1 à 10,
      "dependance": 1 à 10,
      "worldmonitor_signals": ["signal-court-1", "signal-court-2"],
      "rationale": "1-2 phrases expliquant pourquoi cette variable est clé",
      "current_intensity": 10 à 95,
      "trend": "rising ou stable ou declining",
      "is_weak_signal": true ou false
    }
  ],
  "driving_questions": ["question1 ?", "question2 ?", "question3 ?"],
  "wild_cards": [
    {"label": "titre court wild card", "impact": "impact en 10-15 mots max"}
  ]
}

Règles :
- Génère 9 à 11 variables couvrant toutes les dimensions STEEP
- Les valeurs motricite/dependance doivent être cohérentes avec le type micmac
  (motrice = haute motricité ≥7, faible dépendance ≤4)
  (dependante = faible motricité ≤4, haute dépendance ≥7)
- Include 2-3 wild cards pertinentes au sujet`;
}

// ─── Handler ──────────────────────────────────────────────────────

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  // Method guard
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  // Rate limiting: 10 analysis requests per user per hour
  const limited = await rateLimit(req, {
    prefix:  'foresight-analyze',
    limit:   10,
    windowMs: 60 * 60 * 1000,
  });

  if (limited) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  // Parse body
  let subjectText, language;
  try {
    const body = await req.json();
    subjectText = body.subjectText?.trim();
    language    = body.language ?? 'fr';
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  if (!subjectText || subjectText.length < 3) {
    return new Response(JSON.stringify({ error: 'subjectText is required (min 3 chars)' }), {
      status: 400,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  if (subjectText.length > 500) {
    return new Response(JSON.stringify({ error: 'subjectText too long (max 500 chars)' }), {
      status: 400,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  // Claude API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[foresight-analyze] ANTHROPIC_API_KEY not set');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }

  // Call Claude API
  try {
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: buildPrompt(subjectText, language) }],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error('[foresight-analyze] Claude API error:', claudeResponse.status, errText);
      return new Response(JSON.stringify({ error: 'Analysis service unavailable' }), {
        status: 502,
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const claudeData = await claudeResponse.json();
    const rawText = claudeData.content?.[0]?.text ?? '';

    // Parse and validate JSON from Claude
    let analysisResult;
    try {
      analysisResult = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch (parseErr) {
      console.error('[foresight-analyze] JSON parse failed:', parseErr, '\nRaw:', rawText);
      return new Response(JSON.stringify({ error: 'Analysis parsing failed', raw: rawText }), {
        status: 422,
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    // Return validated result
    return new Response(JSON.stringify({ ok: true, result: analysisResult }), {
      status: 200,
      headers: {
        ...corsHeaders(req),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',   // analysis results are not cacheable
      },
    });

  } catch (err) {
    console.error('[foresight-analyze] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
}
