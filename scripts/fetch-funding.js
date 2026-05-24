#!/usr/bin/env node
/**
 * Δ-NEUTRAL DESK — générateur de funding-data.json
 *
 * Récupère le snapshot Hyperliquid (mark, OI, volume, funding courant) + l'historique
 * de funding sur 30 jours par asset, puis calcule les moyennes annualisées
 * sur 10h / 24h / 72h / 7j / 15j / 30j. Conçu pour tourner dans un GitHub Action.
 *
 * Node 18+ (fetch global). Aucune dépendance npm.
 * Variables d'env optionnelles :
 *   MIN_OI    seuil d'OI ($) sous lequel on ne fetch pas l'historique (def. 500000)
 *   SLEEP_MS  pause entre requêtes pour éviter le rate-limit (def. 80)
 */
const fs = require('fs');

const EP = 'https://api.hyperliquid.xyz/info';
const MIN_OI = Number(process.env.MIN_OI || 500000);
const SLEEP_MS = Number(process.env.SLEEP_MS || 80);
const HISTORY_DAYS = 30;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function info(body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(EP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(600 * (i + 1));
    }
  }
}

// fundingHistory renvoie max ~500 lignes -> on pagine
async function fundingHistory(coin, startTime, endTime) {
  let out = [], cursor = startTime, guard = 0;
  while (guard++ < 20) {
    const batch = await info({ type: 'fundingHistory', coin, startTime: cursor, endTime });
    if (!Array.isArray(batch) || batch.length === 0) break;
    out = out.concat(batch);
    if (batch.length < 500) break;
    const last = batch[batch.length - 1].time;
    if (last <= cursor) break;
    cursor = last + 1;
    await sleep(SLEEP_MS);
  }
  const seen = new Set(), dedup = [];
  for (const r of out) { if (!seen.has(r.time)) { seen.add(r.time); dedup.push(r); } }
  dedup.sort((a, b) => a.time - b.time);
  return dedup;
}

const WINDOWS = [['h10', 10], ['h24', 24], ['h72', 72], ['d7', 168], ['d15', 360], ['d30', 720]];

// moyenne du funding horaire sur la fenêtre -> annualisée en %
function avgAPR(records, now, hours) {
  const cutoff = now - hours * 3600 * 1000;
  let sum = 0, n = 0;
  for (const r of records) {
    if (r.time >= cutoff) { sum += parseFloat(r.fundingRate) || 0; n++; }
  }
  if (!n) return null;
  return +((sum / n) * 24 * 365 * 100).toFixed(2);
}

async function main() {
  console.error('Fetching metaAndAssetCtxs…');
  const [meta, ctxs] = await info({ type: 'metaAndAssetCtxs' });

  // assets aussi dispo en spot sur HL (best-effort par nom de token)
  let spotSet = new Set();
  try {
    const sp = await info({ type: 'spotMetaAndAssetCtxs' });
    const tokens = (sp && sp[0] && sp[0].tokens) ? sp[0].tokens : [];
    tokens.forEach(t => t && t.name && spotSet.add(t.name.toUpperCase()));
  } catch (e) { console.error('spotMeta failed:', e.message); }

  const now = Date.now();
  const start = now - HISTORY_DAYS * 24 * 3600 * 1000;

  const base = meta.universe.map((u, i) => {
    const c = ctxs[i] || {};
    const mark = parseFloat(c.markPx) || 0;
    const fH = parseFloat(c.funding) || 0;
    return {
      name: u.name,
      delisted: !!u.isDelisted,
      lev: u.maxLeverage || 0,
      mark,
      fundingNow: +(fH * 100).toFixed(5),
      apr: +(fH * 24 * 365 * 100).toFixed(2),
      oi: (parseFloat(c.openInterest) || 0) * mark,
      vol: parseFloat(c.dayNtlVlm) || 0,
      hasSpot: spotSet.has((u.name || '').toUpperCase()),
      avg: {}, samples: 0,
    };
  }).filter(r => !r.delisted);

  const targets = base.filter(r => r.oi >= MIN_OI);
  console.error(`History pour ${targets.length}/${base.length} assets (OI >= $${MIN_OI})`);

  for (const r of targets) {
    try {
      const hist = await fundingHistory(r.name, start, now);
      for (const [key, hrs] of WINDOWS) r.avg[key] = avgAPR(hist, now, hrs);
      r.samples = hist.length;
      console.error(`  ${r.name}: ${hist.length} pts`);
    } catch (e) {
      console.error(`  ${r.name} FAILED: ${e.message}`);
    }
    await sleep(SLEEP_MS);
  }

  const out = {
    updated: new Date().toISOString(),
    source: 'api.hyperliquid.xyz',
    minOi: MIN_OI,
    windows: WINDOWS.map(w => w[0]),
    assets: base.map(r => ({
      name: r.name, mark: r.mark, lev: r.lev, oi: Math.round(r.oi), vol: Math.round(r.vol),
      hasSpot: r.hasSpot, fundingNow: r.fundingNow, apr: r.apr, avg: r.avg, samples: r.samples,
    })),
  };

  fs.writeFileSync('funding-data.json', JSON.stringify(out));
  console.error(`Écrit funding-data.json — ${out.assets.length} assets @ ${out.updated}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
