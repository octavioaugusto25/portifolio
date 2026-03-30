/**
 * analysisEngine.js — DeFi Risk Intelligence
 * ─────────────────────────────────────────────────────────────────────────────
 * Senior DeFi quant-grade financial logic.
 * Pure functions: no React, no UI, no side effects.
 *
 * CONTRACTS:
 *   1. NEVER invent data. Missing input → return null, not 0 or an estimate.
 *   2. NEVER mix LP-context price with spot wallet avgCost.
 *   3. ALL percentages are plain numbers: 5.72 means 5.72%, NOT 0.0572.
 *   4. ALL fractions are 0–1: positionShare = 0.000004.
 *   5. Fee calculation ONLY uses volume × feeTier. APY fallback is LABELLED.
 *   6. IL MUST drive the decision engine — not just decorate the UI.
 *   7. Net daily result (fees minus IL drift) is the primary economic output.
 */

// ─── GUARDS ──────────────────────────────────────────────────────────────────

/** Finite number, strictly positive — safe as a price or amount. */
export const isValidPrice    = (v) => typeof v === "number" && isFinite(v) && v > 0;
/** Finite number, ≥ 0 — safe as a balance or quantity. */
export const isValidAmount   = (v) => typeof v === "number" && isFinite(v) && v >= 0;
/** Finite number, strictly positive — safe as TVL, volume, etc. */
export const isValidPositive = (v) => typeof v === "number" && isFinite(v) && v > 0;

// ─── ENTRY PRICE RESOLUTION ──────────────────────────────────────────────────

/**
 * LP context and spot context use DIFFERENT price concepts.
 *
 * LP context (PoolAnalysisPanel):
 *   → entryPrice = price of the volatile asset AT THE MOMENT OF LIQUIDITY PROVISION.
 *     Used to compute IL = how much LP diverged vs simply holding.
 *
 * Spot context (wallet spot position):
 *   → avgCostUSD = cost basis per token for P&L tracking.
 *     ONLY meaningful for single-asset hold positions, NOT for LP pairs.
 *
 * Priority for LP analysis (resolveEntryPrice):
 *   1. avgCostUSD  — user entered explicit cost (most intentional)
 *   2. entryPrice  — imported from tx / legacy field
 *   3. null        — we do NOT fall back to current price (would show 0% IL always)
 *
 * NEVER use current market price as a proxy for entry price.
 */
export function resolveEntryPrice(pos) {
  if (!pos) return null;
  // avgCostUSD wins if valid
  const avg = Number(pos.avgCostUSD);
  if (isValidPrice(avg)) return avg;
  // legacy entryPrice field
  const entr = Number(pos.entryPrice);
  if (isValidPrice(entr)) return entr;
  return null;
}

/**
 * Detect whether a position is an LP position or a spot hold.
 * LP positions have a "/" in their symbol and a feeTier.
 */
export function detectPositionType(pos) {
  const sym = (pos?.symbol || "").toUpperCase();
  const hasSlash = sym.includes("/");
  const hasFeeTier = isValidPositive(Number(pos?.feeTier));
  if (hasSlash || hasFeeTier) return "lp";
  return "spot";
}

// ─── IMPERMANENT LOSS ─────────────────────────────────────────────────────────

/**
 * Compute Impermanent Loss for a FULL-RANGE (v2-style) LP position.
 *
 * Formula: IL = (2√r / (1+r) − 1) × 100   where r = currentPrice / entryPrice
 *
 * Notes:
 *   - IL is always ≤ 0 relative to holding both assets.
 *   - At r = 1 (no price change): IL = 0.
 *   - At r = 2 (+100%): IL ≈ −5.72%.
 *   - At r = 0.5 (−50%): IL ≈ −5.72% (symmetric).
 *   - Concentrated LP (v3) has higher IL per unit of range — this formula gives
 *     a LOWER BOUND; real v3 IL can be much worse when out of range.
 *
 * @param {number|null} currentPrice  - current market price (USD)
 * @param {number|null} entryPrice    - price at LP provision (USD, same token)
 * @returns {{ ratio: number, il: number, ilAbs: number } | null}
 */
export function computeIL(currentPrice, entryPrice) {
  if (!isValidPrice(currentPrice) || !isValidPrice(entryPrice)) return null;

  const r   = currentPrice / entryPrice;
  const raw = (2 * Math.sqrt(r) / (1 + r) - 1) * 100;
  // Clamp: IL is mathematically in (−100%, 0]; floating point can give tiny positives at r≈1
  const il    = Math.max(-100, Math.min(0, raw));
  const ilAbs = Math.abs(il);

  return { ratio: r, il, ilAbs };
}

/**
 * Classify IL severity.
 * These thresholds represent annual fee APY ranges typical for DeFi pools.
 */
export function ilSeverity(ilAbs) {
  if (ilAbs < 0.5)  return { label: "Negligível", tier: "negligible", color: "#22c55e" };
  if (ilAbs < 2)    return { label: "Baixo",       tier: "low",        color: "#86efac" };
  if (ilAbs < 5)    return { label: "Moderado",    tier: "medium",     color: "#f59e0b" };
  if (ilAbs < 12)   return { label: "Alto",        tier: "high",       color: "#f97316" };
  return              { label: "Crítico",     tier: "critical",   color: "#ef4444" };
}

/**
 * Estimate the DAILY IL drift in USD.
 *
 * This approximates how much value is being lost per day purely from price movement,
 * compared to what the position would be worth if simply held as 50/50.
 *
 * Approximation: dailyILDrift ≈ positionValueUSD × (annualVol² / 8) / 365
 *
 * Derivation: For small price moves, IL ≈ −(Δp/p)² / 8.
 * Daily variance ≈ (annualVol/√365)², so expected daily IL drift ≈ vol²/(8×365).
 * This is a lower bound — v3 concentrated positions lose more when out of range.
 *
 * Only valid when:
 *   - positionValueUSD > 0
 *   - annualVol is known
 *   - position is in range (out-of-range LP has 0 new IL but is fully converted to one asset)
 *
 * @param {number|null} positionValueUSD
 * @param {number|null} annualVolPct  - e.g. 60 means 60%/year
 * @param {boolean}     inRange
 * @returns {number|null} - USD per day (positive = cost)
 */
export function estimateDailyILDrift(positionValueUSD, annualVolPct, inRange) {
  if (!isValidPositive(positionValueUSD) || !isValidPositive(annualVolPct)) return null;
  if (!inRange) return null; // out-of-range: no NEW IL, but position is fully converted
  const vol   = annualVolPct / 100;
  const daily = positionValueUSD * (vol * vol) / (8 * 365);
  return daily;
}

// ─── RANGE ANALYSIS ──────────────────────────────────────────────────────────

/**
 * Resolve the effective price range to use.
 *
 * Priority:
 *   1. User-defined (rangeMin / rangeMax) — if both valid and min < max
 *   2. Suggested range from volatility analysis — if available
 *   3. null — no range data
 *
 * Source is tracked so the UI can label it clearly.
 */
export function resolveRange(userMin, userMax, suggestedRange) {
  const uMin = Number(userMin);
  const uMax = Number(userMax);
  if (isValidPrice(uMin) && isValidPrice(uMax) && uMin < uMax) {
    return { min: uMin, max: uMax, source: "user" };
  }
  if (
    suggestedRange &&
    isValidPrice(suggestedRange.lower) &&
    isValidPrice(suggestedRange.upper)
  ) {
    return { min: suggestedRange.lower, max: suggestedRange.upper, source: "suggested" };
  }
  return null;
}

/**
 * Compute range status.
 *
 * @returns {{
 *   inRange:          boolean,
 *   distancePct:      number,              // 0 if inRange; % to nearest boundary otherwise
 *   nearestBoundary:  'min'|'max'|null,
 *   source:           'user'|'suggested',
 *   centerPrice:      number,              // midpoint of range
 *   rangeWidthPct:    number,              // (max−min)/min × 100
 * } | null}
 */
export function computeRangeStatus(currentPrice, range) {
  if (!isValidPrice(currentPrice) || !range) return null;

  const { min, max, source } = range;
  const inRange         = currentPrice >= min && currentPrice <= max;
  const centerPrice     = (min + max) / 2;
  const rangeWidthPct   = ((max - min) / min) * 100;

  let distancePct      = 0;
  let nearestBoundary  = null;

  if (!inRange) {
    if (currentPrice < min) {
      distancePct     = ((min - currentPrice) / currentPrice) * 100;
      nearestBoundary = "min";
    } else {
      distancePct     = ((currentPrice - max) / currentPrice) * 100;
      nearestBoundary = "max";
    }
  }

  return { inRange, distancePct, nearestBoundary, source, centerPrice, rangeWidthPct };
}

// ─── FEE CALCULATION ─────────────────────────────────────────────────────────

/**
 * Compute fee metrics. STRICT rules:
 *
 * PRIMARY (volume-based, the ONLY accurate method):
 *   dailyPoolFees = volume24h × (feeTierBps / 1,000,000)
 *   feeAPR        = (dailyPoolFees × 365 / tvl) × 100
 *   userDailyFees = dailyPoolFees × (positionValueUSD / tvl)
 *
 * FALLBACK (APY-based) — ONLY when volume is missing AND explicitly flagged:
 *   ⚠ APY includes token emission rewards, not just trading fees.
 *   ⚠ This ALWAYS OVERESTIMATES pure fee income.
 *   ⚠ Never use this for HOLD/EXIT decisions.
 *   dailyPoolFees ≈ tvl × (apy / 100) / 365
 *
 * If neither volume nor APY+TVL are available → return unavailable.
 * NEVER fake data. NEVER show invented precision.
 *
 * @param {{
 *   volume24h:        number|null,
 *   tvl:              number|null,
 *   feeTierBps:       number|null,  // e.g. 500=0.05%, 3000=0.3%, 10000=1%
 *   positionValueUSD: number|null,
 *   apy:              number|null,
 * }} params
 */
export function computeFees({ volume24h, tvl, feeTierBps, positionValueUSD, apy }) {
  const hasTvl      = isValidPositive(tvl);
  const hasVolume   = isValidPositive(volume24h);
  const hasPosition = isValidPositive(positionValueUSD);

  // feeTierBps: validate it's a real fee tier (100–10000 bps = 0.01%–1%)
  const feeFraction = (isValidPositive(feeTierBps) && feeTierBps >= 100 && feeTierBps <= 10000)
    ? feeTierBps / 1_000_000
    : null;

  const positionShare = (hasPosition && hasTvl) ? positionValueUSD / tvl : null;
  const volTvlRatio   = (hasVolume && hasTvl)   ? (volume24h / tvl) * 100 : null;

  // ── PRIMARY: volume-based ──────────────────────────────────────────────────
  if (hasVolume && hasTvl && feeFraction != null) {
    const dailyPoolFees   = volume24h * feeFraction;
    const feeAPR          = (dailyPoolFees * 365 / tvl) * 100;
    const userDailyFees   = positionShare != null ? dailyPoolFees * positionShare : null;
    const userMonthlyFees = userDailyFees != null ? userDailyFees * 30 : null;
    const userAnnualFees  = userDailyFees != null ? userDailyFees * 365 : null;
    return {
      dailyPoolFees,
      feeAPR,
      userDailyFees,
      userMonthlyFees,
      userAnnualFees,
      positionShare,
      volTvlRatio,
      dataSource: "volume",
      warning:    null,
      reliable:   true,
    };
  }

  // ── FALLBACK: APY-based ───────────────────────────────────────────────────
  // Only when we truly have NO volume data at all.
  if (hasTvl && isValidPositive(apy) && !hasVolume) {
    const dailyPoolFees   = tvl * (apy / 100) / 365;
    const feeAPR          = apy; // by definition: uses reported APY directly
    const userDailyFees   = positionShare != null ? dailyPoolFees * positionShare : null;
    const userMonthlyFees = userDailyFees != null ? userDailyFees * 30 : null;
    const userAnnualFees  = userDailyFees != null ? userDailyFees * 365 : null;
    return {
      dailyPoolFees,
      feeAPR,
      userDailyFees,
      userMonthlyFees,
      userAnnualFees,
      positionShare,
      volTvlRatio:    null,
      dataSource:     "apy_fallback",
      warning:        "Volume 24h indisponível. Fee estimado via APY reportado — inclui emissões de token. Pode superestimar receita de fees pura. NÃO use para decidir EXIT.",
      reliable:       false,
    };
  }

  // ── UNAVAILABLE ───────────────────────────────────────────────────────────
  return {
    dailyPoolFees:    null,
    feeAPR:           null,
    userDailyFees:    null,
    userMonthlyFees:  null,
    userAnnualFees:   null,
    positionShare,
    volTvlRatio:      null,
    dataSource:       "unavailable",
    warning:          "Dados insuficientes para calcular fees. Forneça volume 24h ou TVL + APY.",
    reliable:         false,
  };
}

// ─── NET ECONOMIC RESULT ──────────────────────────────────────────────────────

/**
 * The single most important metric for a DeFi LP position:
 * Are you making or losing money compared to just holding?
 *
 * netDailyUSD = userDailyFees - dailyILDrift
 *
 * Positive → LP is profitable vs hold today.
 * Negative → LP is losing money vs hold today.
 *
 * Context:
 *   - This is a FLOW metric (daily). It tells you the DIRECTION of P&L.
 *   - It does NOT account for accrued IL since entry (that's the IL% already computed).
 *   - Out-of-range positions: fees = 0, so net = −dailyILDrift.
 *
 * @param {number|null} userDailyFees    - daily fee income in USD
 * @param {number|null} dailyILDrift     - daily IL cost in USD (positive = cost)
 * @param {boolean}     feeReliable      - whether fee data is from volume (true) or estimated (false)
 * @returns {{
 *   netDailyUSD:     number | null,
 *   annualizedPct:   number | null,  // annualized as % of position value
 *   isProfit:        boolean | null,
 *   reliable:        boolean,
 *   breakdown: {
 *     feesDailyUSD:  number | null,
 *     ilDriftDailyUSD: number | null,
 *   }
 * }}
 */
export function computeNetResult({ userDailyFees, dailyILDrift, positionValueUSD, feeReliable }) {
  const hasFees    = isValidAmount(userDailyFees);
  const hasDrift   = isValidAmount(dailyILDrift);

  if (!hasFees && !hasDrift) {
    return {
      netDailyUSD:   null,
      annualizedPct: null,
      isProfit:      null,
      reliable:      false,
      breakdown: { feesDailyUSD: null, ilDriftDailyUSD: null },
    };
  }

  const fees  = hasFees  ? userDailyFees  : 0;
  const drift = hasDrift ? dailyILDrift   : 0;
  const net   = fees - drift;

  const annualizedPct = isValidPositive(positionValueUSD)
    ? (net * 365 / positionValueUSD) * 100
    : null;

  return {
    netDailyUSD:   net,
    annualizedPct,
    isProfit:      net >= 0,
    reliable:      feeReliable && hasDrift,
    breakdown: {
      feesDailyUSD:    hasFees  ? userDailyFees : null,
      ilDriftDailyUSD: hasDrift ? dailyILDrift  : null,
    },
  };
}

// ─── DECISION ENGINE ──────────────────────────────────────────────────────────

/**
 * Generate a DECISIVE, ACTIONABLE recommendation.
 *
 * This is the core of the app. It MUST be strict.
 *
 * Decision hierarchy (FIRST matching rule wins):
 *
 *  [1] EXIT_CRITICAL
 *      IL > 15% AND (no fee data OR feeAPR < IL breakeven)
 *      → "Sair imediatamente. IL crítico irrecuperável."
 *
 *  [2] EXIT_INEFFICIENT
 *      Fee data is RELIABLE (volume-based) AND netDailyUSD < 0 AND IL > 5%
 *      → "Pool economicamente ineficiente. Fees não compensam IL."
 *
 *  [3] REBALANCE
 *      Out of range (regardless of IL)
 *      Fees are ZERO when out of range — every day is pure IL drift.
 *      → "Fora do range. Sem acúmulo de fees."
 *
 *  [4] HOLD_STRONG
 *      In range AND fees reliable AND net > 0 AND IL < 5%
 *      → "Posição saudável. Mantendo bem."
 *
 *  [5] HOLD_WATCH
 *      In range AND fees cover IL (even if unreliable estimate)
 *      → "Manter, mas monitorar fees."
 *
 *  [6] MONITOR_SCORE
 *      Score < 45 — protocol/TVL risk too high
 *      → "Score insuficiente. Risco de protocolo elevado."
 *
 *  [7] MONITOR_VOL
 *      Annualized vol > 150% — range will break frequently
 *      → "Volatilidade extrema. Custo de gás pode superar fees."
 *
 *  [8] HOLD_DEFAULT
 *      Not enough data to make a stronger call
 *      → "Dados insuficientes. Forneça entrada e range para análise completa."
 *
 * @param {{
 *   ilResult:      object|null,
 *   rangeStatus:   object|null,
 *   feeResult:     object,
 *   netResult:     object,
 *   score:         number,
 *   annualVol:     number|null,
 *   apy:           number,
 *   posType:       'lp'|'spot',
 * }} params
 */
export function computeDecision({
  ilResult,
  rangeStatus,
  feeResult,
  netResult,
  score,
  annualVol,
  apy,
  posType,
}) {
  const { feeAPR, dataSource: feeSource, reliable: feeReliable } = feeResult;
  const hasIL      = ilResult != null;
  const hasRange   = rangeStatus != null;
  const hasFeeAPR  = feeAPR != null;
  const hasNet     = netResult.netDailyUSD != null;

  // Confidence = how many data signals we have
  const signals    = [hasIL, hasRange, hasFeeAPR].filter(Boolean).length;
  const confidence = signals >= 3 ? "high" : signals >= 2 ? "medium" : "low";

  // Spot positions: no IL, no range logic applies
  if (posType === "spot") {
    return {
      action:     "HOLD",
      urgency:    "low",
      title:      "Posição spot — sem IL",
      reason:     `Ativo spot (sem LP). Score ${score}/100. Acompanhe P&L pelo custo médio.`,
      nextStep:   "Compare com custo médio. Defina alvo de saída antes de aportar mais.",
      color:      "#22c55e",
      icon:       "💼",
      confidence: "high",
    };
  }

  // ── RULE 1: EXIT_CRITICAL ─────────────────────────────────────────────────
  if (hasIL && ilResult.ilAbs > 15) {
    const feesInsufficient = !hasFeeAPR || (feeReliable && feeAPR < ilResult.ilAbs);
    const unreliableAndLow = !feeReliable && (!hasFeeAPR || feeAPR < ilResult.ilAbs * 1.5);
    if (feesInsufficient || unreliableAndLow) {
      return {
        action:     "EXIT",
        urgency:    "critical",
        title:      "Sair da posição — IL crítico",
        reason:     `IL de ${ilResult.ilAbs.toFixed(1)}% exige fee APR ≥ ${ilResult.ilAbs.toFixed(0)}% para breakeven. ${hasFeeAPR ? `Fee APR ${feeReliable ? "real" : "estimado"}: ${feeAPR.toFixed(1)}% — insuficiente.` : "Sem dados de fee para compensar."}`,
        nextStep:   "Remover liquidez agora. Aguardar consolidação do preço antes de reentrar.",
        color:      "#ef4444",
        icon:       "🚨",
        confidence,
      };
    }
  }

  // ── RULE 2: EXIT_INEFFICIENT ──────────────────────────────────────────────
  if (hasIL && ilResult.ilAbs > 5 && feeReliable && hasNet && !netResult.isProfit) {
    const netStr = netResult.netDailyUSD != null
      ? `Você perde $${Math.abs(netResult.netDailyUSD).toFixed(4)}/dia vs hold.`
      : "";
    return {
      action:     "EXIT",
      urgency:    "high",
      title:      "Pool economicamente ineficiente",
      reason:     `Fees reais (${feeAPR.toFixed(1)}%/aa) não compensam IL de ${ilResult.ilAbs.toFixed(1)}%. ${netStr}`,
      nextStep:   "Migrar para pool com fee APR > IL ou para stable/stable sem IL.",
      color:      "#ef4444",
      icon:       "⛔",
      confidence,
    };
  }

  // ── RULE 3: REBALANCE ─────────────────────────────────────────────────────
  if (hasRange && !rangeStatus.inRange) {
    const bdLabel = rangeStatus.nearestBoundary === "min" ? "inferior" : "superior";
    return {
      action:     "REBALANCE",
      urgency:    "high",
      title:      "Fora do range — fees zerados",
      reason:     `Preço ${rangeStatus.distancePct.toFixed(1)}% além do limite ${bdLabel}${rangeStatus.source === "suggested" ? " (range sugerido)" : ""}. Posição não acumula fees. Apenas IL drift.`,
      nextStep:   `Retirar e reabrir range centrado no preço atual${annualVol ? ` (vol ${annualVol.toFixed(0)}%/aa — use sigma 1.5–2)` : ""}.`,
      color:      "#f59e0b",
      icon:       "🔄",
      confidence,
    };
  }

  // ── RULE 4: HOLD_STRONG ───────────────────────────────────────────────────
  if (hasRange && rangeStatus.inRange && feeReliable && hasNet && netResult.isProfit && hasIL && ilResult.ilAbs < 5) {
    const netPct = netResult.annualizedPct != null ? ` (net ${netResult.annualizedPct.toFixed(1)}%/aa)` : "";
    return {
      action:     "HOLD",
      urgency:    "low",
      title:      "Manter — posição saudável",
      reason:     `In range. Fees (${feeAPR.toFixed(1)}%/aa) superam IL (${ilResult.ilAbs.toFixed(2)}%). Net positivo${netPct}. $${netResult.netDailyUSD.toFixed(4)}/dia vs hold.`,
      nextStep:   "Monitorar semanalmente. Revisar range se preço se aproximar dos limites.",
      color:      "#22c55e",
      icon:       "✅",
      confidence,
    };
  }

  // ── RULE 5: HOLD_WATCH ────────────────────────────────────────────────────
  if (hasRange && rangeStatus.inRange && hasFeeAPR) {
    const ilBreakeven = hasIL ? ilResult.ilAbs : 0;
    const feeCoversIL = feeAPR >= ilBreakeven;
    if (feeCoversIL) {
      const label = feeReliable ? `Fee real ${feeAPR.toFixed(1)}%` : `Fee estimado ${feeAPR.toFixed(1)}% (via APY — inclui rewards)`;
      return {
        action:     "HOLD",
        urgency:    "low",
        title:      "Manter — fees cobrem IL",
        reason:     `In range. ${label}${hasIL ? ` ≥ IL breakeven ${ilBreakeven.toFixed(1)}%` : ""}. ${feeReliable ? "" : "⚠ Confirme com volume real."}`,
        nextStep:   "Acompanhar volume do pool. Revisar se fees reais baixarem de " + (ilBreakeven > 0 ? `${ilBreakeven.toFixed(0)}%` : "10%") + ".",
        color:      "#f59e0b",
        icon:       "👁",
        confidence: feeReliable ? confidence : "low",
      };
    }
    // In range but fees don't cover IL
    if (hasIL && feeAPR < ilBreakeven) {
      return {
        action:     "MONITOR",
        urgency:    "medium",
        title:      "Monitorar — fee APR abaixo do breakeven",
        reason:     `In range, mas ${feeReliable ? "fee real" : "fee estimado"} ${feeAPR.toFixed(1)}% < IL breakeven ${ilBreakeven.toFixed(1)}%. Posição perde valor diariamente vs hold.`,
        nextStep:   `Buscar pool com fee APR ≥ ${Math.ceil(ilBreakeven)}% no mesmo par. Ou remontar em stable/stable.`,
        color:      "#f97316",
        icon:       "⚠",
        confidence,
      };
    }
  }

  // ── RULE 6: MONITOR_SCORE ─────────────────────────────────────────────────
  if (score < 45) {
    return {
      action:     "MONITOR",
      urgency:    "medium",
      title:      "Monitorar — score baixo",
      reason:     `Score ${score}/100 indica protocolo ou TVL insuficiente para confiança alta. Risco de smart contract elevado.`,
      nextStep:   "Migrar para pool score ≥ 65 no mesmo par.",
      color:      "#f97316",
      icon:       "⚠",
      confidence,
    };
  }

  // ── RULE 7: MONITOR_VOL ───────────────────────────────────────────────────
  if (annualVol != null && annualVol > 150) {
    return {
      action:     "MONITOR",
      urgency:    "medium",
      title:      "Monitorar — volatilidade extrema",
      reason:     `Vol histórica ${annualVol.toFixed(0)}%/aa. Range sai em dias. Custo de gás para remontar pode superar fees acumulados.`,
      nextStep:   "Usar range 2σ ou mais. Ou migrar para stable/stable.",
      color:      "#f97316",
      icon:       "📡",
      confidence,
    };
  }

  // ── RULE 8: HOLD_DEFAULT ─────────────────────────────────────────────────
  const missing = [];
  if (!hasIL) missing.push("preço de entrada (LP)");
  if (!hasRange) missing.push("range min/max");
  if (!hasFeeAPR) missing.push("volume 24h");
  return {
    action:     "HOLD",
    urgency:    "low",
    title:      "Manter — dados insuficientes para análise completa",
    reason:     `Score ${score}/100 aceitável. Não é possível avaliar IL vs fees sem: ${missing.join(", ")}.`,
    nextStep:   `Informe ${missing.join(" e ")} para obter recomendação confiável.`,
    color:      "#94a3b8",
    icon:       "📊",
    confidence: "low",
  };
}

// ─── STATIC SUMMARY ───────────────────────────────────────────────────────────

/**
 * Rule-based text summary. No API call needed.
 * Shows the most important facts in 4–6 sentences.
 */
export function generateStaticSummary({
  sym, decision, ilResult, rangeStatus,
  feeResult, netResult, apy, score, annualVol,
  posType, currentPrice, entryPrice,
}) {
  const parts = [];

  // 1. Identity + score
  const riskLabel = score >= 75 ? "baixo risco" : score >= 55 ? "risco médio" : score >= 35 ? "risco alto" : "risco muito alto";
  parts.push(`${sym}: score ${score}/100 (${riskLabel}).`);

  // 2. Price context (only for LP)
  if (posType === "lp") {
    if (currentPrice && entryPrice) {
      const changePct = ((currentPrice - entryPrice) / entryPrice) * 100;
      parts.push(`Preço atual $${currentPrice.toLocaleString("pt-BR", {maximumFractionDigits:2})} vs entrada $${entryPrice.toLocaleString("pt-BR", {maximumFractionDigits:2})} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%).`);
    } else if (!entryPrice) {
      parts.push("Preço de entrada LP não informado — IL não calculado.");
    }
  }

  // 3. IL
  if (ilResult && posType === "lp") {
    const sev = ilSeverity(ilResult.ilAbs);
    parts.push(`IL atual: ${ilResult.il.toFixed(2)}% (${sev.label}, ratio ${ilResult.ratio.toFixed(3)}×). Breakeven mínimo: fee APR ≥ ${ilResult.ilAbs.toFixed(1)}%/aa.`);
  }

  // 4. Range
  if (rangeStatus) {
    if (rangeStatus.inRange) {
      parts.push(`✅ In range (${rangeStatus.source === "suggested" ? "range sugerido" : "range definido"}).`);
    } else {
      parts.push(`🚨 OUT OF RANGE: ${rangeStatus.distancePct.toFixed(1)}% além do limite ${rangeStatus.nearestBoundary === "min" ? "inferior" : "superior"}. Fees zerados.`);
    }
  }

  // 5. Fees + net
  if (feeResult.feeAPR != null) {
    const src = feeResult.dataSource === "volume"
      ? "via volume real"
      : "estimado via APY (inclui rewards)";
    parts.push(`Fee APR: ${feeResult.feeAPR.toFixed(1)}% (${src}).`);
  }
  if (netResult.netDailyUSD != null && feeResult.dataSource === "volume") {
    const sign = netResult.isProfit ? "+" : "-";
    parts.push(`Resultado líquido vs hold: ${sign}$${Math.abs(netResult.netDailyUSD).toFixed(netResult.netDailyUSD < 0.01 ? 6 : 4)}/dia${netResult.annualizedPct != null ? ` (${sign}${Math.abs(netResult.annualizedPct).toFixed(1)}%/aa)` : ""}.`);
  }

  // 6. Volatility
  if (annualVol != null) {
    const vLabel = annualVol < 30 ? "baixa" : annualVol < 70 ? "média" : annualVol < 120 ? "alta" : "extrema";
    parts.push(`Volatilidade histórica: ${annualVol.toFixed(0)}%/aa (${vLabel}).`);
  }

  // 7. Decision
  parts.push(`${decision.icon} ${decision.title}: ${decision.nextStep}`);

  return parts.join(" ");
}

// ─── FORMATTING HELPERS ───────────────────────────────────────────────────────

/**
 * Format a position share fraction (0–1) as a human-readable percentage.
 * Uses enough decimal places to show 3 significant figures.
 * NEVER uses scientific notation.
 */
export function formatShare(share) {
  if (share == null || !isFinite(share)) return "—";
  const pct = share * 100;
  if (pct === 0) return "0%";
  if (pct >= 1)      return `${pct.toFixed(4)}%`;
  if (pct >= 0.01)   return `${pct.toFixed(6)}%`;
  const decimals = Math.max(0, -Math.floor(Math.log10(pct))) + 3;
  return `${pct.toFixed(Math.min(decimals, 12))}%`;
}

/**
 * Format a USD value with appropriate precision.
 * For very small values (fees < $0.01), show enough decimals.
 */
export function formatUSD(n) {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000)  return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)      return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  if (abs >= 1)          return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.001)      return `${sign}$${abs.toFixed(4)}`;
  if (abs >= 0.000001)   return `${sign}$${abs.toFixed(6)}`;
  // Never show scientific notation
  return `${sign}$${abs.toFixed(8)}`;
}

// ─── MAIN PIPELINE ────────────────────────────────────────────────────────────

/**
 * Run the full analysis pipeline for one position.
 * This is the single entry point consumed by PoolAnalysisPanel.
 *
 * @param {{
 *   position:       object,      // portfolio position record
 *   matchedPool:    object|null, // matched DeFiLlama pool (has tvlUsd, apy, volumeUsd7d)
 *   currentPrice:   number|null, // live price from CoinGecko
 *   annualVol:      number|null, // historical annualized vol %
 *   suggestedRange: object|null, // from suggestLPRange()
 * }} params
 */
export function runPositionAnalysis({
  position,
  matchedPool,
  currentPrice,
  annualVol,
  suggestedRange,
}) {
  const src = matchedPool || position;

  // ── Detect position type ──────────────────────────────────────────────────
  const posType = detectPositionType(position);

  // ── Resolve canonical entry price ────────────────────────────────────────
  const entryPrice = resolveEntryPrice(position);

  // ── Pool data (prefer matchedPool for real on-chain data) ─────────────────
  const tvl         = Number(src?.tvlUsd      || position?.tvlUsd      || 0) || null;
  const rawVol7d    = Number(src?.volumeUsd7d  || position?.volumeUsd7d || 0);
  // Only use volume data if it actually exists
  const vol24h      = rawVol7d > 0 ? rawVol7d / 7 : null;
  const apy         = Number(src?.apy || position?.apy || 0);
  const score       = Number(src?._score || position?._score || 0);
  const feeTierBps  = Number(position?.feeTier || src?.feeTier || 3000);
  const posValueUSD = Number(position?.valueUSD || 0) || null;

  // ── IL (LP only) ──────────────────────────────────────────────────────────
  const ilResult = (posType === "lp")
    ? computeIL(currentPrice, entryPrice)
    : null;

  // ── Range ─────────────────────────────────────────────────────────────────
  const userMin  = Number(position?.rangeMin)  || null;
  const userMax  = Number(position?.rangeMax)  || null;
  const range    = (posType === "lp")
    ? resolveRange(userMin, userMax, suggestedRange)
    : null;
  const rangeStatus = computeRangeStatus(currentPrice, range);

  // ── Fees ──────────────────────────────────────────────────────────────────
  const feeResult = computeFees({
    volume24h:        isValidPositive(vol24h)      ? vol24h      : null,
    tvl:              isValidPositive(tvl)          ? tvl         : null,
    feeTierBps,
    positionValueUSD: isValidPositive(posValueUSD) ? posValueUSD  : null,
    apy,
  });

  // ── Daily IL drift (LP in range only) ────────────────────────────────────
  const inRange        = rangeStatus?.inRange ?? false;
  const dailyILDrift   = (posType === "lp")
    ? estimateDailyILDrift(posValueUSD, annualVol, inRange)
    : null;

  // ── Net result ────────────────────────────────────────────────────────────
  const netResult = computeNetResult({
    userDailyFees:   feeResult.userDailyFees,
    dailyILDrift,
    positionValueUSD: posValueUSD,
    feeReliable:     feeResult.reliable,
  });

  // ── Decision ──────────────────────────────────────────────────────────────
  const decision = computeDecision({
    ilResult,
    rangeStatus,
    feeResult,
    netResult,
    score,
    annualVol,
    apy,
    posType,
  });

  // ── Static summary ────────────────────────────────────────────────────────
  const staticSummary = generateStaticSummary({
    sym:          (position?.symbol || "").toUpperCase().replace(/_/g, "/"),
    decision,
    ilResult,
    rangeStatus,
    feeResult,
    netResult,
    apy,
    score,
    annualVol,
    posType,
    currentPrice,
    entryPrice,
  });

  return {
    // Resolved inputs
    entryPrice,
    currentPrice,
    tvl,
    vol24h,
    apy,
    score,
    feeTierBps,
    posValueUSD,
    posType,

    // Analysis outputs
    ilResult,
    dailyILDrift,
    range,
    rangeStatus,
    feeResult,
    netResult,
    decision,
    staticSummary,
    suggestedRange,
    annualVol,
  };
}