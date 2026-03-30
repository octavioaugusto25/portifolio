/**
 * analysisEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure financial logic for the DeFi Risk Intelligence app.
 * No React, no UI, no side effects — only functions that take numbers, return numbers.
 *
 * Every public function documents:
 *   - what inputs are required
 *   - what it returns when inputs are missing / invalid
 *   - the formula used
 *
 * Rules enforced throughout:
 *   1. NEVER invent data. If input is invalid → return null.
 *   2. NEVER mix token-denominated and USD-denominated values.
 *   3. ALL percentages are plain numbers (e.g. 5.72 means 5.72 %, NOT 0.0572).
 *   4. ALL fractions are 0–1 (e.g. positionShare = 0.000004, NOT 0.0004%).
 */

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────

/** True when v is a finite, positive number usable as a price. */
export const isValidPrice = (v) => typeof v === "number" && isFinite(v) && v > 0;

/** True when v is a finite, non-negative number. */
export const isValidAmount = (v) => typeof v === "number" && isFinite(v) && v >= 0;

/** True when v is a finite, strictly positive number (volumes, TVL). */
export const isValidPositive = (v) => typeof v === "number" && isFinite(v) && v > 0;

// ─── ENTRY PRICE RESOLUTION ──────────────────────────────────────────────────

/**
 * Resolve the single source-of-truth entry price for a position.
 *
 * Priority order (first valid wins):
 *   1. avgCostUSD (user-entered cost per token — most intentional)
 *   2. entryPrice (legacy field / imported from tx)
 *   3. null (no entry price known)
 *
 * NEVER fall back to current market price — that would always show 0% IL.
 *
 * @param {object} pos - position object from portfolio state
 * @returns {number|null}
 */
export function resolveEntryPrice(pos) {
  if (!pos) return null;
  const avg  = Number(pos.avgCostUSD);
  const entr = Number(pos.entryPrice);
  if (isValidPrice(avg))  return avg;
  if (isValidPrice(entr)) return entr;
  return null;
}

// ─── IMPERMANENT LOSS ─────────────────────────────────────────────────────────

/**
 * Calculate Impermanent Loss percentage.
 *
 * Formula: IL = (2√r / (1+r) − 1) × 100
 * where r = currentPrice / entryPrice
 *
 * Properties:
 *   - IL is always ≤ 0 (it is a loss relative to hold)
 *   - IL = 0 when r = 1 (price unchanged)
 *   - IL approaches −100% as r → 0 or r → ∞
 *   - Practical range for r ∈ [0.5, 2]: IL ∈ [−5.72%, 0%]
 *
 * @param {number|null} currentPrice  - current market price in USD
 * @param {number|null} entryPrice    - entry price in USD (same token denomination)
 * @returns {{ ratio: number, il: number, ilAbs: number } | null}
 */
export function computeIL(currentPrice, entryPrice) {
  if (!isValidPrice(currentPrice) || !isValidPrice(entryPrice)) return null;

  const r   = currentPrice / entryPrice;
  const raw = (2 * Math.sqrt(r) / (1 + r) - 1) * 100;

  // Clamp: IL cannot exceed 100% loss mathematically,
  // and floating point can produce tiny positive values at r≈1.
  const il    = Math.max(-100, Math.min(0, raw));
  const ilAbs = Math.abs(il);

  return { ratio: r, il, ilAbs };
}

/**
 * Classify IL severity for display.
 * @param {number} ilAbs - absolute IL percentage (0–100)
 */
export function ilSeverity(ilAbs) {
  if (ilAbs < 0.5)  return { label: "Negligível", tier: "negligible", color: "#22c55e" };
  if (ilAbs < 2)    return { label: "Baixo",       tier: "low",        color: "#86efac" };
  if (ilAbs < 5)    return { label: "Moderado",    tier: "medium",     color: "#f59e0b" };
  if (ilAbs < 12)   return { label: "Alto",        tier: "high",       color: "#f97316" };
  return              { label: "Crítico",     tier: "critical",   color: "#ef4444" };
}

// ─── RANGE ANALYSIS ──────────────────────────────────────────────────────────

/**
 * Determine the effective price range to use.
 *
 * Priority:
 *   1. User-defined range (rangeMin / rangeMax) — if both are valid and min < max
 *   2. Suggested range from volatility (suggestedRange) — if available
 *   3. null (no range available)
 *
 * @param {number|null} userMin
 * @param {number|null} userMax
 * @param {{ lower: number, upper: number }|null} suggestedRange
 * @returns {{ min: number, max: number, source: 'user'|'suggested' } | null}
 */
export function resolveRange(userMin, userMax, suggestedRange) {
  const uMin = Number(userMin);
  const uMax = Number(userMax);
  if (isValidPrice(uMin) && isValidPrice(uMax) && uMin < uMax) {
    return { min: uMin, max: uMax, source: "user" };
  }
  if (suggestedRange && isValidPrice(suggestedRange.lower) && isValidPrice(suggestedRange.upper)) {
    return { min: suggestedRange.lower, max: suggestedRange.upper, source: "suggested" };
  }
  return null;
}

/**
 * Compute range status given a resolved range and current price.
 *
 * @param {number|null} currentPrice
 * @param {{ min: number, max: number, source: string }|null} range
 * @returns {{
 *   inRange: boolean,
 *   distancePct: number,     // 0 if inRange; % distance to nearest boundary otherwise
 *   nearestBoundary: 'min'|'max'|null,
 *   source: 'user'|'suggested'|null
 * } | null}
 */
export function computeRangeStatus(currentPrice, range) {
  if (!isValidPrice(currentPrice) || !range) return null;

  const { min, max, source } = range;
  const inRange = currentPrice >= min && currentPrice <= max;

  let distancePct = 0;
  let nearestBoundary = null;

  if (!inRange) {
    if (currentPrice < min) {
      distancePct = ((min - currentPrice) / currentPrice) * 100;
      nearestBoundary = "min";
    } else {
      distancePct = ((currentPrice - max) / currentPrice) * 100;
      nearestBoundary = "max";
    }
  }

  return { inRange, distancePct, nearestBoundary, source };
}

// ─── FEE ANALYSIS ────────────────────────────────────────────────────────────

/**
 * Compute fee metrics for a liquidity pool.
 *
 * Primary formula (when volume is available):
 *   dailyPoolFees = volume24h × feeTier_fraction
 *   feeAPR        = (dailyPoolFees × 365 / tvl) × 100
 *   userDailyFees = dailyPoolFees × positionShare
 *
 * Fallback formula (when volume is missing but TVL and APY are available):
 *   Estimate daily fees from reported APY:
 *   dailyPoolFees ≈ tvl × (apy / 100) / 365
 *   NOTE: this includes token rewards, so it overestimates pure fee revenue.
 *   Always label as "APY fallback" and warn user.
 *
 * @param {object} params
 * @param {number|null} params.volume24h        - real 24-h pool volume in USD
 * @param {number|null} params.tvl              - pool total value locked in USD
 * @param {number|null} params.feeTierBps       - fee tier in basis-points (e.g. 3000 = 0.3%)
 * @param {number|null} params.positionValueUSD - user position size in USD
 * @param {number|null} params.apy              - pool reported APY % (for fallback only)
 * @returns {{
 *   dailyPoolFees:   number|null,
 *   feeAPR:          number|null,
 *   userDailyFees:   number|null,
 *   userMonthlyFees: number|null,
 *   positionShare:   number|null,   // fraction 0–1
 *   volTvlRatio:     number|null,   // % (informational)
 *   dataSource:      'volume'|'apy_fallback'|'unavailable',
 *   warning:         string|null,
 * }}
 */
export function computeFees({ volume24h, tvl, feeTierBps, positionValueUSD, apy }) {
  const hasTvl      = isValidPositive(tvl);
  const hasVolume   = isValidPositive(volume24h);
  const hasPosition = isValidPositive(positionValueUSD);
  const feeFraction = isValidPositive(feeTierBps) ? feeTierBps / 1_000_000 : null;

  // Position share — calculated regardless of fee source
  const positionShare = (hasPosition && hasTvl) ? positionValueUSD / tvl : null;

  // Vol/TVL ratio (informational efficiency metric)
  const volTvlRatio = (hasVolume && hasTvl) ? (volume24h / tvl) * 100 : null;

  // ── Primary: volume-based ──
  if (hasVolume && hasTvl && feeFraction != null) {
    const dailyPoolFees   = volume24h * feeFraction;
    const feeAPR          = (dailyPoolFees * 365 / tvl) * 100;
    const userDailyFees   = positionShare != null ? dailyPoolFees * positionShare : null;
    const userMonthlyFees = userDailyFees != null ? userDailyFees * 30 : null;
    return {
      dailyPoolFees,
      feeAPR,
      userDailyFees,
      userMonthlyFees,
      positionShare,
      volTvlRatio,
      dataSource: "volume",
      warning: null,
    };
  }

  // ── Fallback: APY-based (TVL × APY / 365) ──
  // Only use when tvl AND apy are available and volume is truly missing
  if (hasTvl && isValidPositive(apy) && !hasVolume) {
    const dailyPoolFees   = tvl * (apy / 100) / 365;
    const feeAPR          = apy;   // by definition
    const userDailyFees   = positionShare != null ? dailyPoolFees * positionShare : null;
    const userMonthlyFees = userDailyFees != null ? userDailyFees * 30 : null;
    return {
      dailyPoolFees,
      feeAPR,
      userDailyFees,
      userMonthlyFees,
      positionShare,
      volTvlRatio: null,
      dataSource: "apy_fallback",
      warning: "Volume 24h indisponível. Fees estimados via APY reportado — inclui token rewards; pode superestimar receita de fees pura.",
    };
  }

  // ── Unavailable ──
  return {
    dailyPoolFees:   null,
    feeAPR:          null,
    userDailyFees:   null,
    userMonthlyFees: null,
    positionShare,
    volTvlRatio:     null,
    dataSource:      "unavailable",
    warning:         "Sem dados de volume ou TVL suficientes para calcular fees.",
  };
}

// ─── DECISION ENGINE ──────────────────────────────────────────────────────────

/**
 * Generate a structured decision recommendation.
 *
 * Decision hierarchy (first matching rule wins):
 *
 *   EXIT         IL crítico (>12%) AND fees não cobrem IL
 *   REBALANCE    Fora do range definido/sugerido
 *   HOLD         In range AND fees cobrem IL (ou IL negligível)
 *   MONITOR      Score baixo (<45) OR vol extrema (>150%) OR sem dados suficientes
 *   HOLD         Default (pool aceitável, dados insuficientes para outra decisão)
 *
 * @param {object} params
 * @param {object|null}  params.ilResult      - output of computeIL()
 * @param {object|null}  params.rangeStatus   - output of computeRangeStatus()
 * @param {object}       params.feeResult     - output of computeFees()
 * @param {number}       params.score         - pool risk score 0–100
 * @param {number|null}  params.annualVol     - historical annualized volatility %
 * @param {number}       params.apy           - pool APY %
 * @returns {{
 *   action:     'EXIT'|'REBALANCE'|'HOLD'|'MONITOR',
 *   urgency:    'high'|'medium'|'low',
 *   title:      string,
 *   reason:     string,
 *   nextStep:   string,
 *   color:      string,
 *   icon:       string,
 *   confidence: 'high'|'medium'|'low',  // how confident we are (depends on data completeness)
 * }}
 */
export function computeDecision({ ilResult, rangeStatus, feeResult, score, annualVol, apy }) {
  const { feeAPR, dataSource: feeSource } = feeResult;
  const hasIL    = ilResult != null;
  const hasRange = rangeStatus != null;
  const hasFees  = feeAPR != null;

  // How much data do we have? Affects confidence.
  const dataPoints = [hasIL, hasRange, hasFees].filter(Boolean).length;
  const confidence = dataPoints >= 3 ? "high" : dataPoints >= 2 ? "medium" : "low";

  // ── Rule 1: EXIT ──
  // IL is critical AND fees clearly cannot recover losses
  if (hasIL && ilResult.ilAbs > 12) {
    const ilBreakeven = ilResult.ilAbs; // APY needed to break even annually
    const feesInsufficient = !hasFees || feeAPR < ilBreakeven;
    if (feesInsufficient) {
      return {
        action:     "EXIT",
        urgency:    "high",
        title:      "Sair da posição",
        reason:     `IL crítico de ${ilResult.ilAbs.toFixed(1)}% ${hasFees ? `com fee APR de apenas ${feeAPR.toFixed(1)}% — abaixo do breakeven de ${ilBreakeven.toFixed(1)}%` : "sem dados de fee para compensar"}.`,
        nextStep:   "Remover liquidez e aguardar estabilização do preço antes de remontar.",
        color:      "#ef4444",
        icon:       "🚨",
        confidence,
      };
    }
  }

  // ── Rule 2: REBALANCE ──
  // Out of range (regardless of IL status)
  if (hasRange && !rangeStatus.inRange) {
    const distStr = rangeStatus.distancePct.toFixed(1);
    const boundary = rangeStatus.nearestBoundary === "min" ? "mínimo" : "máximo";
    return {
      action:     "REBALANCE",
      urgency:    "medium",
      title:      "Remontar range",
      reason:     `Preço ${distStr}% além do limite ${boundary} do range${rangeStatus.source === "suggested" ? " sugerido" : " definido"}. Posição não acumula fees fora do range.`,
      nextStep:   `Retirar liquidez e reabrir com novo range centrado no preço atual${annualVol ? ` (vol ${annualVol.toFixed(0)}%/aa)` : ""}.`,
      color:      "#f59e0b",
      icon:       "🔄",
      confidence,
    };
  }

  // ── Rule 3: HOLD ──
  // In range AND either (fees cover IL) or (IL is negligible)
  if (hasRange && rangeStatus.inRange) {
    const ilNegligible = !hasIL || ilResult.ilAbs < 2;
    const feesOk       = hasFees && feeAPR >= (ilResult?.ilAbs ?? 0);
    if (ilNegligible || feesOk) {
      const feeLabel = hasFees ? `Fee APR ${feeAPR.toFixed(1)}%` : "fees não calculados";
      return {
        action:     "HOLD",
        urgency:    "low",
        title:      "Manter posição",
        reason:     `In range${hasIL ? ` — IL ${ilResult.ilAbs.toFixed(2)}%` : ""}. ${feeLabel}${feesOk ? " cobre IL." : "."}${feeSource === "apy_fallback" ? " (fee estimado via APY)" : ""}`,
        nextStep:   "Monitorar semanalmente. Revisar range se preço se aproximar dos limites.",
        color:      "#22c55e",
        icon:       "✅",
        confidence,
      };
    }
    // In range but fees don't cover IL
    if (hasIL && hasFees && feeAPR < ilResult.ilAbs) {
      return {
        action:     "MONITOR",
        urgency:    "medium",
        title:      "Monitorar — fees abaixo do breakeven",
        reason:     `In range, mas fee APR ${feeAPR.toFixed(1)}% não cobre IL breakeven de ${ilResult.ilAbs.toFixed(1)}%. Posição perde valor líquido.`,
        nextStep:   `Avaliar migração para pool com fee APR ≥ ${ilResult.ilAbs.toFixed(0)}% para o mesmo par.`,
        color:      "#f59e0b",
        icon:       "👁",
        confidence,
      };
    }
  }

  // ── Rule 4: MONITOR (score baixo ou vol extrema) ──
  if (score < 45) {
    return {
      action:     "MONITOR",
      urgency:    "medium",
      title:      "Monitorar — score baixo",
      reason:     `Score ${score}/100 abaixo do nível seguro (45). Protocolo ou TVL insuficiente para confiança alta.`,
      nextStep:   "Considerar migração para pool score ≥ 65 com mesmo par.",
      color:      "#f97316",
      icon:       "⚠",
      confidence,
    };
  }
  if (annualVol != null && annualVol > 150) {
    return {
      action:     "MONITOR",
      urgency:    "medium",
      title:      "Monitorar — volatilidade extrema",
      reason:     `Vol histórica de ${annualVol.toFixed(0)}%/aa. Range estreito sai rapidamente; custo de gás para remontar pode superar fees.`,
      nextStep:   "Usar range mais amplo (2σ) ou migrar para pool stable/stable.",
      color:      "#f97316",
      icon:       "📡",
      confidence,
    };
  }

  // ── Rule 5: HOLD (default — dados insuficientes para outra decisão) ──
  const dataNote = confidence === "low"
    ? " Dados insuficientes para análise completa — informe preço de entrada e range."
    : "";
  return {
    action:     "HOLD",
    urgency:    "low",
    title:      "Manter posição",
    reason:     `Pool dentro dos parâmetros aceitáveis (score ${score}/100).${dataNote}`,
    nextStep:   "Monitorar semanalmente. Adicionar preço de entrada e range para análise completa.",
    color:      "#22c55e",
    icon:       confidence === "low" ? "📊" : "✅",
    confidence,
  };
}

// ─── STATIC AI SUMMARY (no API call required) ─────────────────────────────────

/**
 * Generate a rule-based text summary that works even without an AI API call.
 * This is the fallback shown immediately — before the user clicks "Gerar análise com IA".
 *
 * @param {object} params
 * @param {string}       params.sym
 * @param {object}       params.decision     - output of computeDecision()
 * @param {object|null}  params.ilResult     - output of computeIL()
 * @param {object|null}  params.rangeStatus  - output of computeRangeStatus()
 * @param {object}       params.feeResult    - output of computeFees()
 * @param {number}       params.apy
 * @param {number}       params.score
 * @param {number|null}  params.annualVol
 * @returns {string}
 */
export function generateStaticSummary({ sym, decision, ilResult, rangeStatus, feeResult, apy, score, annualVol }) {
  const parts = [];

  // 1. Pool identity + score
  parts.push(`${sym}: score ${score}/100 (${score >= 75 ? "baixo risco" : score >= 55 ? "risco médio" : score >= 35 ? "risco alto" : "muito arriscado"}).`);

  // 2. IL status
  if (ilResult) {
    const sev = ilSeverity(ilResult.ilAbs);
    parts.push(`IL atual ${ilResult.il.toFixed(2)}% (${sev.label}) com ratio de preço ${ilResult.ratio.toFixed(2)}×.`);
  } else {
    parts.push("IL não calculado — informe o preço de entrada para análise completa.");
  }

  // 3. Range status
  if (rangeStatus) {
    if (rangeStatus.inRange) {
      parts.push(`Posição in range (${rangeStatus.source === "suggested" ? "range sugerido" : "range definido"}).`);
    } else {
      parts.push(`Posição OUT OF RANGE — ${rangeStatus.distancePct.toFixed(1)}% além do limite ${rangeStatus.nearestBoundary === "min" ? "inferior" : "superior"}. Fees zerados.`);
    }
  } else {
    parts.push("Range não definido — configure ou aceite o range sugerido.");
  }

  // 4. Fees
  if (feeResult.feeAPR != null) {
    const src = feeResult.dataSource === "apy_fallback" ? " (estimativa via APY)" : "";
    parts.push(`Fee APR estimado: ${feeResult.feeAPR.toFixed(1)}%${src}.`);
  } else {
    parts.push("Dados de volume insuficientes. Evite decisões de aporte até confirmação do volume real.");
  }

  // 5. Volatility context
  if (annualVol != null) {
    const vLabel = annualVol < 30 ? "baixa" : annualVol < 70 ? "média" : annualVol < 120 ? "alta" : "extrema";
    parts.push(`Volatilidade histórica ${annualVol.toFixed(0)}%/aa (${vLabel}).`);
  }

  // 6. Decision
  parts.push(`Decisão: ${decision.icon} ${decision.title}. ${decision.nextStep}`);

  return parts.join(" ");
}

// ─── POSITION SHARE FORMATTING ───────────────────────────────────────────────

/**
 * Format a position share fraction (0–1) as a human-readable percentage.
 *
 * Examples:
 *   0.5       → "50.0000%"
 *   0.0001    → "0.0100%"
 *   0.0000001 → "0.0000001%"   (never scientific notation)
 *   0         → "0%"
 *   null      → "—"
 *
 * @param {number|null} share - fraction 0–1
 * @param {number} [minDecimals=4] - minimum decimal places shown
 * @returns {string}
 */
export function formatShare(share) {
  if (share == null || !isFinite(share)) return "—";
  const pct = share * 100;
  if (pct === 0) return "0%";

  // Determine how many decimal places we need to show at least 3 sig figs
  if (pct >= 1)      return `${pct.toFixed(4)}%`;
  if (pct >= 0.01)   return `${pct.toFixed(6)}%`;

  // For very small shares, use enough decimal places to show non-zero digits
  // e.g. 4.12e-8 → 0.0000000412%
  const decimals = Math.max(0, -Math.floor(Math.log10(pct))) + 3;
  return `${pct.toFixed(Math.min(decimals, 12))}%`;
}

// ─── FULL POSITION ANALYSIS ───────────────────────────────────────────────────

/**
 * Run the complete analysis pipeline for a single position.
 * This is the main entry point consumed by PoolAnalysisPanel.
 *
 * @param {object} params
 * @param {object}       params.position      - portfolio position
 * @param {object|null}  params.matchedPool   - pool from DeFiLlama
 * @param {number|null}  params.currentPrice  - live price from CoinGecko/prices prop
 * @param {number|null}  params.annualVol     - historical annualized vol %
 * @param {object|null}  params.suggestedRange - from suggestLPRange()
 * @returns {object} - full analysis result used directly by PoolAnalysisPanel
 */
export function runPositionAnalysis({ position, matchedPool, currentPrice, annualVol, suggestedRange }) {
  const src = matchedPool || position;

  // ── Resolve canonical entry price ──
  const entryPrice = resolveEntryPrice(position);

  // ── Pool data ──
  const tvl      = Number(src?.tvlUsd     || position?.tvlUsd     || 0) || null;
  const vol24h   = Number(src?.volumeUsd7d || position?.volumeUsd7d || 0)
    ? Number(src.volumeUsd7d) / 7
    : null;
  const apy      = Number(src?.apy || position?.apy || 0);
  const score    = Number(src?._score || position?._score || 0);
  const feeTierBps = Number(position?.feeTier || src?.feeTier || 3000);
  const posValueUSD = Number(position?.valueUSD || 0) || null;

  // ── IL ──
  const ilResult = computeIL(currentPrice, entryPrice);

  // ── Range ──
  const userMin  = Number(position?.rangeMin)  || null;
  const userMax  = Number(position?.rangeMax)  || null;
  const range    = resolveRange(userMin, userMax, suggestedRange);
  const rangeStatus = computeRangeStatus(currentPrice, range);

  // ── Fees ──
  const feeResult = computeFees({
    volume24h:        isValidPositive(vol24h) ? vol24h : null,
    tvl:              isValidPositive(tvl)    ? tvl    : null,
    feeTierBps,
    positionValueUSD: isValidPositive(posValueUSD) ? posValueUSD : null,
    apy,
  });

  // ── Decision ──
  const decision = computeDecision({ ilResult, rangeStatus, feeResult, score, annualVol, apy });

  // ── Static summary ──
  const staticSummary = generateStaticSummary({
    sym: (position?.symbol || "").toUpperCase().replace(/_/g, "/"),
    decision,
    ilResult,
    rangeStatus,
    feeResult,
    apy,
    score,
    annualVol,
  });

  return {
    // Inputs (resolved)
    entryPrice,
    currentPrice,
    tvl,
    vol24h,
    apy,
    score,
    feeTierBps,
    posValueUSD,

    // Analysis outputs
    ilResult,
    range,
    rangeStatus,
    feeResult,
    decision,
    staticSummary,
    suggestedRange,
    annualVol,
  };
}