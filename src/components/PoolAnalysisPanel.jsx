import { useCallback, useEffect, useRef, useState } from "react";
import { VOLATILITY_COIN_MAP } from "../constants";
import {
  calcIL, extractTokens, fmt, fmtK,
  getLiqLabel, getPair, getRisk, getStrategy, getVolLabel,
  isStable, suggestLPRange,
} from "../utils";
import { Badge, Card, SecTitle, Spin } from "./primitives";

// ─── MATH UTILITIES ───────────────────────────────────────────────────────────

/**
 * calcIL in utils.js already returns a percentage: (2√r/(1+r) - 1) * 100
 * So calcIL(2) = -5.72 (%), calcIL(0.5) = -5.72 (%).
 * IL is always ≤ 0 and ≥ -100.
 * DO NOT multiply by 100 again.
 */
const safeIL = (r) => {
  if (!r || r <= 0 || !isFinite(r)) return null;
  const raw = calcIL(r);                         // already %, e.g. -11.35
  return Math.max(-100, Math.min(0, raw));        // clamp [-100, 0]
};

/**
 * Format a position share percentage with appropriate precision.
 * positionShare is a fraction (0–1), not already multiplied by 100.
 * Shows scientific notation below 0.0001%.
 */
const fmtShare = (share) => {
  if (share == null || !isFinite(share)) return "—";
  const pct = share * 100;
  if (pct === 0) return "0%";
  if (pct >= 0.01)  return `${pct.toFixed(4)}%`;
  if (pct >= 1e-6)  return `${pct.toExponential(2)}%`;
  return `< 0.000001%`;
};

/** Percentage formatter — always shows sign */
const pct = (n, d = 1) => {
  if (n == null || !isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${Number(n).toFixed(d)}%`;
};

const usd = (n, d = 2) => (n == null || !isFinite(n)) ? "—" : `$${fmt(n, d)}`;

const clr = (v, goodHigh = true) => {
  if (v == null) return "#64748b";
  return goodHigh ? (v >= 0 ? "#22c55e" : "#ef4444") : (v <= 0 ? "#22c55e" : "#ef4444");
};

const IL_SEVERITY = (il) => {
  // il is negative (loss). abs for labelling.
  const abs = Math.abs(il ?? 0);
  if (abs < 0.5)  return { label: "Negligível", color: "#22c55e" };
  if (abs < 2)    return { label: "Baixo",       color: "#86efac" };
  if (abs < 5)    return { label: "Moderado",    color: "#f59e0b" };
  if (abs < 12)   return { label: "Alto",        color: "#f97316" };
  return              { label: "Crítico",     color: "#ef4444" };
};

// ─── DATA VALIDATION ──────────────────────────────────────────────────────────

/**
 * Validates that a number is a usable financial value:
 * not null, not NaN, not ±Infinity, positive.
 */
const isValidPrice  = (v) => v != null && isFinite(v) && v > 0;
const isValidAmount = (v) => v != null && isFinite(v) && v >= 0;
const isValidVolume = (v) => isValidAmount(v) && v > 0;

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
const MetricBox = ({ label, value, sub, color = "#94a3b8", icon, unavailable }) => (
  <div style={{
    padding: "10px 12px", background: "rgba(0,0,0,0.28)",
    borderRadius: "9px", border: `1px solid ${unavailable ? "rgba(255,255,255,0.04)" : color + "18"}`,
    opacity: unavailable ? 0.5 : 1,
  }}>
    {icon && <div style={{ fontSize: "14px", marginBottom: "4px" }}>{icon}</div>}
    <div style={{ fontSize: "15px", fontWeight: 700, color: unavailable ? "#334155" : color, fontFamily: "monospace", lineHeight: 1.1 }}>
      {value}
    </div>
    <div style={{ fontSize: "8px", color: "#475569", marginTop: "3px", letterSpacing: "1px", fontFamily: "monospace" }}>
      {label}
    </div>
    {sub && <div style={{ fontSize: "9px", color: unavailable ? "#1e2d3d" : "#334155", marginTop: "2px" }}>{sub}</div>}
  </div>
);

const UnavailableBox = ({ label, reason }) => (
  <MetricBox label={label} value="—" sub={reason} unavailable />
);

const SectionHeader = ({ children, color = "#6366f1" }) => (
  <div style={{
    fontSize: "8px", fontWeight: 700, color, letterSpacing: "2.5px",
    fontFamily: "monospace", textTransform: "uppercase",
    borderLeft: `2px solid ${color}`, paddingLeft: "7px", marginBottom: "10px",
  }}>
    {children}
  </div>
);

const Divider = () => (
  <div style={{ height: "1px", background: "rgba(255,255,255,0.04)", margin: "14px 0" }} />
);

const DataWarning = ({ text }) => (
  <div style={{ padding: "7px 10px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: "7px", fontSize: "9px", color: "#f59e0b", lineHeight: 1.5, marginBottom: "8px" }}>
    ⚠ {text}
  </div>
);

// ─── RANGE GAUGE ─────────────────────────────────────────────────────────────
const RangeGauge = ({ current, min, max, suggested, entry }) => {
  if (!isValidPrice(current) || !isValidPrice(min) || !isValidPrice(max)) return null;
  if (min >= max) return null;

  const span = max - min;
  const toPos = (v) => Math.max(0, Math.min(100, ((v - min) / span) * 100));
  const curPos = toPos(current);
  const entPos = isValidPrice(entry) ? toPos(entry) : null;
  const sugLow  = isValidPrice(suggested?.lower) ? toPos(suggested.lower) : null;
  const sugHigh = isValidPrice(suggested?.upper) ? toPos(suggested.upper) : null;
  const inRange = current >= min && current <= max;

  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ position: "relative", height: "24px", background: "rgba(0,0,0,0.3)", borderRadius: "12px", overflow: "visible", margin: "0 8px" }}>
        {/* Suggested range band */}
        {sugLow != null && sugHigh != null && (
          <div style={{
            position: "absolute", top: "4px", bottom: "4px",
            left: `${Math.max(0, sugLow)}%`, width: `${Math.max(0, Math.min(100, sugHigh) - Math.max(0, sugLow))}%`,
            background: "rgba(99,102,241,0.15)", borderRadius: "8px",
            border: "1px dashed rgba(99,102,241,0.3)", minWidth: "2px",
          }} title="Range sugerido pela volatilidade" />
        )}
        {/* Range fill */}
        <div style={{
          position: "absolute", top: 0, bottom: 0, left: 0, width: "100%",
          background: inRange ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.06)",
          borderRadius: "12px",
        }} />
        {/* Entry price marker */}
        {entPos != null && (
          <div style={{
            position: "absolute", top: "-4px", bottom: "-4px", width: "2px",
            background: "#f59e0b", left: `${entPos}%`, borderRadius: "2px",
          }} title={`Entrada: ${usd(entry)}`} />
        )}
        {/* Current price cursor */}
        <div style={{
          position: "absolute", top: "-6px", width: "12px", height: "36px",
          left: `calc(${Math.max(0, Math.min(100, curPos))}% - 6px)`,
          display: "flex", flexDirection: "column", alignItems: "center", zIndex: 2,
        }}>
          <div style={{
            width: "12px", height: "12px", borderRadius: "50%",
            background: inRange ? "#22c55e" : "#ef4444",
            border: "2px solid rgba(0,0,0,0.6)",
            boxShadow: `0 0 8px ${inRange ? "#22c55e" : "#ef4444"}60`,
            marginTop: "6px",
          }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "8px", color: "#475569", fontFamily: "monospace", padding: "0 8px" }}>
        <span>{usd(min, 0)} <span style={{ color: "#334155" }}>min</span></span>
        <span style={{ color: inRange ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
          {inRange ? "✓ IN RANGE" : "✗ OUT OF RANGE"}
        </span>
        <span><span style={{ color: "#334155" }}>max</span> {usd(max, 0)}</span>
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export function PoolAnalysisPanel({ pool, volData = {}, prices, fetchExternal, onClose }) {
  if (!pool) return null;

  const [entryPrice, setEntryPrice] = useState(String(pool.entryPrice || pool._entryPrice || ""));
  const [userMin,    setUserMin]    = useState(String(pool.rangeMin || ""));
  const [userMax,    setUserMax]    = useState(String(pool.rangeMax || ""));
  const [position,   setPosition]   = useState(String(pool.valueUSD || ""));
  const [feeTier,    setFeeTier]    = useState(pool.feeTier || 3000);
  const [ilSimRatio, setIlSimRatio] = useState(2);   // only used when entry price unknown
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiText,     setAiText]     = useState("");
  const [aiAsked,    setAiAsked]    = useState(false);
  const aiRef = useRef(null);

  // ── Resolve source pool data ──────────────────────────────────────────────
  const src   = pool.matchedPool || pool;
  const sym   = (pool.symbol || src.symbol || "").toUpperCase().replace(/_/g, "/");
  const proj  = src.project  || pool.protocol || "—";
  const chain = src.chain    || pool.chain     || "—";
  const apy   = Number(src.apy   || pool.apy   || 0);
  const tvl   = Number(src.tvlUsd || pool.tvlUsd || 0);
  // volume: prefer 7d/7 over direct field; both must be positive numbers
  const rawVol7d  = Number(src.volumeUsd7d  || pool.volumeUsd7d  || 0);
  const vol1d     = rawVol7d > 0 ? rawVol7d / 7 : 0;
  const hasVolume = isValidVolume(vol1d);

  const score  = Number(src._score || pool._score || 0);
  const liq    = getLiqLabel(src._liqScore || pool._liqScore || 0);
  const risk   = getRisk(score);
  const pair   = getPair(sym);
  const strat  = getStrategy(src.symbol ? src : pool);

  // ── Resolve current token price ───────────────────────────────────────────
  const tokens    = extractTokens(sym);
  const volTokens = tokens.filter(t => !isStable(t) && VOLATILITY_COIN_MAP[t]);

  const resolveVol = (key) => {
    const v = volData[key];
    if (!v) return null;
    return typeof v === "number" ? v : (v?.annualVol ?? null);
  };

  const poolAnnualVol = volTokens.length > 0
    ? (volTokens
        .map(t => {
          const id = VOLATILITY_COIN_MAP[t];
          return resolveVol(id) ?? resolveVol(t) ?? resolveVol(t.toLowerCase());
        })
        .filter(Boolean)
        .reduce((sum, v, _, arr) => sum + v / arr.length, 0) || null)
    : null;

  const volLabel = getVolLabel(poolAnnualVol);

  // Current price: only from live prices prop (never derived from pool state)
  const priceMap = {
    ETH: prices?.ethereum?.usd,
    BTC: prices?.bitcoin?.usd,
    SOL: prices?.solana?.usd,
  };
  const baseToken    = volTokens[0] || null;
  const currentPrice = baseToken ? (priceMap[baseToken] ?? null) : null;
  const hasPrice     = isValidPrice(currentPrice);

  // ── Parsed user inputs ────────────────────────────────────────────────────
  const entry  = parseFloat(entryPrice) || null;
  const minR   = parseFloat(userMin)    || null;
  const maxR   = parseFloat(userMax)    || null;
  const posVal = parseFloat(position)   || 0;

  // Validate: entry price must match current price denomination (baseToken USD)
  const hasEntry      = isValidPrice(entry);
  const hasRange      = isValidPrice(minR) && isValidPrice(maxR) && minR < maxR;
  const hasTvl        = isValidAmount(tvl) && tvl > 0;
  const hasPosition   = posVal > 0;

  // ── Suggested range ───────────────────────────────────────────────────────
  const suggested = (hasPrice && poolAnnualVol)
    ? suggestLPRange(currentPrice, poolAnnualVol, 30, 1.5)
    : null;

  // ── Range status ──────────────────────────────────────────────────────────
  const inRange = (hasPrice && hasRange)
    ? (currentPrice >= minR && currentPrice <= maxR)
    : null;

  const distFromRange = (inRange === false && hasPrice && hasRange)
    ? (currentPrice < minR
        ? ((minR - currentPrice) / currentPrice) * 100
        : ((currentPrice - maxR) / currentPrice) * 100)
    : null;

  // ── Price change from entry ───────────────────────────────────────────────
  const priceChangePct = (hasPrice && hasEntry)
    ? ((currentPrice - entry) / entry) * 100
    : null;

  // ── Impermanent Loss ─────────────────────────────────────────────────────
  // IL uses real ratio when we have both prices; falls back to slider simulation.
  // calcIL already returns a percentage value (e.g. -11.35 for ratio 2.72×).
  // DO NOT multiply by 100 again.
  const ilRatio      = (hasPrice && hasEntry) ? currentPrice / entry : ilSimRatio;
  const il           = safeIL(ilRatio);           // null if inputs invalid; value in [-100, 0]
  const ilSeverity   = il != null ? IL_SEVERITY(il) : { label: "—", color: "#64748b" };
  const ilBreakeven  = il != null ? Math.abs(il) : null;    // APY% needed to offset IL
  const ilCovered    = (ilBreakeven != null && apy > 0) ? apy >= ilBreakeven : null;

  // ── Fee Analysis ─────────────────────────────────────────────────────────
  // Fees = vol24h × feeTier (in fraction) — NO volatility used here.
  const feeFraction       = feeTier / 1_000_000;           // e.g. 3000 → 0.003
  const dailyPoolFeeUSD   = hasVolume ? vol1d * feeFraction : null;
  const feeAPR            = (hasVolume && hasTvl) ? (vol1d * feeFraction * 365 / tvl) * 100 : null;
  const volTvlRatio       = (hasVolume && hasTvl) ? (vol1d / tvl) * 100 : null;   // % (informational)

  // ── Position Share ───────────────────────────────────────────────────────
  // positionShare = posVal / tvl (fraction, not %)
  // Must use TVL from the matched pool (real on-chain TVL), not 0.
  const positionShare     = (hasPosition && hasTvl) ? posVal / tvl : null;
  const userDailyFeeUSD   = (positionShare != null && dailyPoolFeeUSD != null)
    ? dailyPoolFeeUSD * positionShare
    : null;
  const userMonthlyFeeUSD = userDailyFeeUSD != null ? userDailyFeeUSD * 30 : null;

  // ── Composite Quality Score ───────────────────────────────────────────────
  let qualityScore = score;
  if (inRange === true)               qualityScore = Math.min(100, qualityScore + 5);
  if (inRange === false)              qualityScore = Math.max(0,   qualityScore - 10);
  if (volTvlRatio != null && volTvlRatio > 50) qualityScore = Math.min(100, qualityScore + 5);
  if (poolAnnualVol && poolAnnualVol > 100)     qualityScore = Math.max(0,   qualityScore - 5);
  qualityScore = Math.round(qualityScore);

  // ── Rebuild Strategy ─────────────────────────────────────────────────────
  const shouldRebuild =
    score < 55 ||
    inRange === false ||
    (poolAnnualVol && poolAnnualVol > 120) ||
    (volTvlRatio != null && volTvlRatio < 1);

  let rebuildReason = "";
  let rebuildAction = "";
  let rebuildRange  = null;

  if (inRange === false) {
    const distStr = distFromRange != null ? `${distFromRange.toFixed(1)}%` : "desconhecida";
    rebuildReason = `Preço atual ${hasPrice ? usd(currentPrice) : "?"} está fora do range (distância: ${distStr}).`;
    rebuildAction = suggested
      ? `Remontar no range ${usd(suggested.lower, 0)}–${usd(suggested.upper, 0)} (${suggested.confidence}% confiança, ${suggested.horizonDays}d).`
      : "Ampliar o range com base na volatilidade histórica.";
    rebuildRange = suggested;
  } else if (score < 55) {
    rebuildReason = `Score ${score}/100 abaixo do mínimo recomendado (55). Protocolo ou TVL fraco.`;
    rebuildAction = "Considerar migrar para pool score ≥ 65 no mesmo par.";
  } else if (poolAnnualVol && poolAnnualVol > 120) {
    rebuildReason = `Volatilidade extrema (${poolAnnualVol.toFixed(0)}%/aa). Range estreito sai rapidamente.`;
    rebuildAction = suggested
      ? `Usar range amplo: ${usd(suggested.lower, 0)}–${usd(suggested.upper, 0)}.`
      : "Ampliar range ou migrar para stable/stable.";
    rebuildRange = suggested;
  } else if (volTvlRatio != null && volTvlRatio < 1) {
    rebuildReason = `Eficiência de fees baixa (vol/TVL = ${volTvlRatio.toFixed(2)}%). Pool pouco utilizada.`;
    rebuildAction = "Buscar pool do mesmo par com maior volume relativo ao TVL.";
  } else {
    rebuildReason = "Pool dentro dos parâmetros aceitáveis.";
    rebuildAction = "Monitorar semanalmente. Revisar range se vol aumentar.";
  }

  // ── AI Prompt Builder ─────────────────────────────────────────────────────
  const buildPrompt = useCallback(() => {
    const lines = [
      `Pool: ${sym} | ${proj} | ${chain}`,
      `Score: ${qualityScore}/100 | Risco: ${risk.label}`,
      `APY: ${apy.toFixed(1)}% | TVL: ${fmtK(tvl)}`,
      hasVolume ? `Vol 24h: ${fmtK(vol1d)} | Eficiência vol/TVL: ${volTvlRatio?.toFixed(1)}%` : "Vol 24h: sem dados",
      `Liquidez: ${liq.label}`,
      feeAPR != null ? `Fee APR estimado: ${feeAPR.toFixed(1)}%` : "Fee APR: sem dados de volume",
      hasPrice ? `Preço atual ${baseToken}: ${usd(currentPrice)}` : `Preço de ${baseToken}: desconhecido`,
      hasEntry ? `Preço de entrada: ${usd(entry)}` : "Preço de entrada: não informado",
      priceChangePct != null ? `Variação desde entrada: ${pct(priceChangePct)}` : "",
      hasRange ? `Range do usuário: ${usd(minR, 0)}–${usd(maxR, 0)} → ${inRange ? "IN RANGE ✓" : "OUT OF RANGE ✗"}` : "Range: não definido",
      suggested ? `Range sugerido (1.5σ/30d): ${usd(suggested.lower, 0)}–${usd(suggested.upper, 0)}` : "",
      il != null ? `IL estimado: ${il.toFixed(2)}% (${ilSeverity.label}) | Ratio: ${ilRatio.toFixed(3)}×` : "IL: não calculável (falta preço de entrada ou atual)",
      ilCovered != null ? `IL coberto pelo APY? ${ilCovered ? "Sim ✓" : "Não ✗"} (APY ${apy.toFixed(1)}% vs IL breakeven ${ilBreakeven?.toFixed(1)}%)` : "",
      hasPosition && positionShare != null ? `Posição: ${usd(posVal, 0)} | Share do pool: ${fmtShare(positionShare)}` : "",
      userDailyFeeUSD != null ? `Fees estimados: ${usd(userDailyFeeUSD, 4)}/dia | ${usd(userMonthlyFeeUSD, 2)}/mês` : "",
      `Decisão: ${shouldRebuild ? "REMONTAR — " + rebuildReason : "MANTER — " + rebuildReason}`,
      rebuildRange ? `Ação: ${rebuildAction}` : "",
      poolAnnualVol ? `Vol histórica ${baseToken}: ${poolAnnualVol.toFixed(0)}%/aa` : "",
    ].filter(Boolean).join("\n");

    return `Você é um advisor DeFi especialista. Analise este pool e forneça:
1. Resumo do estado atual (2 frases)
2. Análise do range: está bem posicionado? Risco de sair?
3. IL: o quanto preocupa dado o APY?
4. Decisão: manter, remontar ou sair? Justifique com números.
5. Próxima ação específica e mensurável.

Dados:
${lines}

Responda em PT-BR, direto, usando os números fornecidos. Máximo 200 palavras.`;
  }, [sym, proj, chain, qualityScore, risk, apy, tvl, hasVolume, vol1d, volTvlRatio, liq, feeAPR, hasPrice, baseToken, currentPrice, hasEntry, entry, priceChangePct, hasRange, minR, maxR, inRange, suggested, il, ilSeverity, ilRatio, ilCovered, ilBreakeven, hasPosition, positionShare, posVal, userDailyFeeUSD, userMonthlyFeeUSD, shouldRebuild, rebuildReason, rebuildRange, rebuildAction, poolAnnualVol]);

  const fetchAI = useCallback(async () => {
    if (!fetchExternal || aiLoading) return;
    setAiLoading(true);
    setAiAsked(true);
    setAiText("");
    try {
      const r = await fetchExternal("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          system: "You are an expert DeFi advisor. Be direct, data-driven, actionable. Always respond in Brazilian Portuguese (pt-BR). Use specific numbers from the context provided.",
          messages: [{ role: "user", content: buildPrompt() }],
        }),
      });
      const d = await r.json();
      setAiText(d.content?.find(b => b.type === "text")?.text || "Não foi possível obter análise.");
    } catch {
      setAiText("⚠ Erro ao conectar com o AI Advisor.");
    } finally {
      setAiLoading(false);
    }
  }, [fetchExternal, buildPrompt, aiLoading]);

  useEffect(() => {
    if (aiText) aiRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiText]);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: "#08111e",
      border: `1px solid ${risk.color}20`,
      borderRadius: "16px",
      overflow: "hidden",
      boxShadow: `0 0 60px ${risk.color}08, 0 4px 24px rgba(0,0,0,0.4)`,
    }}>

      {/* ── Header ── */}
      <div style={{
        background: `linear-gradient(90deg, rgba(0,0,0,0.4) 0%, ${risk.color}0a 100%)`,
        borderBottom: `1px solid ${risk.color}18`,
        padding: "14px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.5px" }}>{sym}</div>
            <div style={{ fontSize: "9px", color: "#475569", marginTop: "2px" }}>{proj} · {chain}</div>
          </div>
          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
            <Badge color={risk.color} sm>{risk.icon} {risk.label}</Badge>
            <Badge color={strat.color} sm>{strat.icon} {strat.type}</Badge>
            <Badge color={pair.color} sm>{pair.icon} {pair.label}</Badge>
            {poolAnnualVol && <Badge color={volLabel.color} sm>📊 {poolAnnualVol.toFixed(0)}%/aa</Badge>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Score ring */}
          <div style={{
            width: "52px", height: "52px", borderRadius: "50%",
            background: `conic-gradient(${risk.color} ${qualityScore * 3.6}deg, rgba(255,255,255,0.05) 0deg)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: "40px", height: "40px", borderRadius: "50%",
              background: "#08111e",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ fontSize: "13px", fontWeight: 800, color: risk.color, fontFamily: "monospace", lineHeight: 1 }}>{qualityScore}</div>
              <div style={{ fontSize: "6px", color: "#334155", letterSpacing: "0.5px" }}>SCORE</div>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "none", color: "#64748b", width: "28px", height: "28px", borderRadius: "7px", cursor: "pointer", fontSize: "13px" }}>✕</button>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* ── SECTION 1: POOL METRICS ── */}
        <div>
          <SectionHeader color="#3b82f6">📊 Dados do Pool</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
            <MetricBox label="APY" value={`${apy.toFixed(1)}%`} color={apy > 80 ? "#ef4444" : apy > 40 ? "#f59e0b" : "#22c55e"} />
            <MetricBox label="TVL" value={hasTvl ? fmtK(tvl) : "—"} color="#3b82f6" unavailable={!hasTvl} />
            {hasVolume
              ? <MetricBox label="VOL 24H" value={fmtK(vol1d)} color={vol1d > 1e6 ? "#22c55e" : "#f59e0b"} sub={`${volTvlRatio?.toFixed(1)}% vol/TVL`} />
              : <UnavailableBox label="VOL 24H" reason="sem dados" />
            }
            <MetricBox label="LIQUIDEZ" value={liq.label} color={liq.color} />
          </div>
        </div>

        <Divider />

        {/* ── SECTION 2: PRICE & RANGE ── */}
        <div>
          <SectionHeader color="#6366f1">📐 Preço & Range</SectionHeader>

          {/* Input row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "6px", marginBottom: "12px" }}>
            {[
              { label: "PREÇO ENTRADA ($)", val: entryPrice, set: setEntryPrice, ph: "ex: 2500", hint: baseToken ? `Preço ${baseToken} na entrada` : "" },
              { label: "RANGE MIN ($)",      val: userMin,    set: setUserMin,    ph: "ex: 2000" },
              { label: "RANGE MAX ($)",      val: userMax,    set: setUserMax,    ph: "ex: 3000" },
              { label: "POSIÇÃO ($)",        val: position,   set: setPosition,   ph: "ex: 1000" },
              { label: "FEE TIER (bps)",     val: String(feeTier), set: v => setFeeTier(Number(v) || 3000), ph: "3000", hint: `${(feeTier / 10000).toFixed(2)}% por swap` },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: "7px", color: "#334155", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "3px" }}>{f.label}</div>
                <input
                  value={f.val}
                  onChange={e => f.set(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder={f.ph}
                  style={{
                    width: "100%", padding: "5px 7px",
                    background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: "6px", color: "#f1f5f9", fontFamily: "monospace", fontSize: "11px",
                  }}
                />
                {f.hint && <div style={{ fontSize: "7px", color: "#334155", marginTop: "2px" }}>{f.hint}</div>}
              </div>
            ))}
          </div>

          {/* Range gauge — only shown when all three prices are available */}
          {hasRange && (
            <RangeGauge current={currentPrice} min={minR} max={maxR} suggested={suggested} entry={entry} />
          )}

          {/* Price metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
            {hasPrice
              ? <MetricBox label={`PREÇO ATUAL (${baseToken || "token"})`} value={usd(currentPrice)} color="#f1f5f9" />
              : <UnavailableBox label="PREÇO ATUAL" reason="token não mapeado" />
            }
            {hasEntry
              ? <MetricBox label="PREÇO ENTRADA" value={usd(entry)} color="#f59e0b" sub={priceChangePct != null ? `${pct(priceChangePct)} vs entrada` : ""} />
              : <MetricBox label="PREÇO ENTRADA" value="—" color="#475569" sub="informe acima" unavailable />
            }
            {inRange !== null
              ? <MetricBox
                  label={inRange ? "IN RANGE ✓" : "OUT OF RANGE ✗"}
                  value={inRange ? "✅ Ativo" : `${distFromRange?.toFixed(1)}% fora`}
                  color={inRange ? "#22c55e" : "#ef4444"}
                />
              : <MetricBox label="STATUS RANGE" value="—" sub="defina range acima" unavailable />
            }
            {poolAnnualVol
              ? <MetricBox label="VOLATILIDADE" value={`${poolAnnualVol.toFixed(0)}%/aa`} color={volLabel.color} sub={volLabel.label} />
              : <UnavailableBox label="VOLATILIDADE" reason="sem histórico" />
            }
          </div>

          {/* Suggested range */}
          {suggested && (
            <div style={{
              marginTop: "8px", padding: "10px 12px",
              background: "rgba(99,102,241,0.05)", border: "1px dashed rgba(99,102,241,0.25)",
              borderRadius: "8px", display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap",
            }}>
              <div style={{ fontSize: "9px", color: "#6366f1", letterSpacing: "1px", fontFamily: "monospace", fontWeight: 700 }}>
                RANGE SUGERIDO (vol × 1.5σ / 30d)
              </div>
              <div style={{ display: "flex", gap: "16px" }}>
                <div style={{ fontSize: "12px", color: "#ef4444", fontFamily: "monospace", fontWeight: 700 }}>↓ {usd(suggested.lower)}</div>
                <div style={{ fontSize: "10px", color: "#475569" }}>→</div>
                <div style={{ fontSize: "12px", color: "#22c55e", fontFamily: "monospace", fontWeight: 700 }}>↑ {usd(suggested.upper)}</div>
              </div>
              <div style={{ fontSize: "9px", color: "#475569" }}>
                Amplitude: {suggested.rangePct.toFixed(1)}% · Confiança: {suggested.confidence}%
              </div>
            </div>
          )}
        </div>

        <Divider />

        {/* ── SECTION 3: IL & FEES ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>

          {/* ── IL PANEL ── */}
          <div>
            <SectionHeader color="#ef4444">📉 Impermanent Loss</SectionHeader>

            {(!hasPrice || !hasEntry) && (
              <DataWarning text={
                !hasPrice && !hasEntry ? "Informe o preço de entrada para calcular o IL real. Simulador de ratio disponível abaixo."
                : !hasPrice ? "Preço atual não disponível para este token."
                : "Informe o preço de entrada acima para calcular o IL real."
              } />
            )}

            {/* Ratio display or slider */}
            <div style={{ marginBottom: "8px" }}>
              {(hasPrice && hasEntry) ? (
                <div style={{ fontSize: "9px", color: "#64748b", marginBottom: "4px", fontFamily: "monospace" }}>
                  RATIO: {baseToken} agora / entrada = <strong style={{ color: "#f1f5f9" }}>{ilRatio.toFixed(3)}×</strong>
                  {" "}({priceChangePct != null ? pct(priceChangePct) : "—"})
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: "8px", color: "#334155", marginBottom: "3px", fontFamily: "monospace" }}>
                    SIMULAÇÃO — multiplicador de preço: {ilSimRatio}×
                  </div>
                  <input
                    type="range" min="0.1" max="5" step="0.1"
                    value={ilSimRatio} onChange={e => setIlSimRatio(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#ef4444", marginBottom: "6px" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8px", color: "#334155" }}>
                    <span>0.1× (−90%)</span><span>5× (+400%)</span>
                  </div>
                </div>
              )}
            </div>

            {/* IL result */}
            {il != null ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                  <div style={{
                    padding: "12px", background: `${ilSeverity.color}0c`,
                    border: `1px solid ${ilSeverity.color}25`, borderRadius: "9px", textAlign: "center",
                  }}>
                    <div style={{ fontSize: "22px", fontWeight: 800, color: ilSeverity.color, fontFamily: "monospace" }}>
                      {il.toFixed(2)}%
                    </div>
                    <div style={{ fontSize: "8px", color: ilSeverity.color, marginTop: "2px", letterSpacing: "1px" }}>
                      {ilSeverity.label.toUpperCase()}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <MetricBox
                      label="APY P/ COBRIR IL"
                      value={`≥${ilBreakeven?.toFixed(1)}%`}
                      color={apy >= (ilBreakeven ?? Infinity) ? "#22c55e" : "#ef4444"}
                    />
                    <MetricBox
                      label="IL COBERTO?"
                      value={ilCovered ? "✅ Sim" : "❌ Não"}
                      color={ilCovered ? "#22c55e" : "#ef4444"}
                    />
                  </div>
                </div>
                {/* IL table for reference ratios */}
                <div style={{ fontSize: "9px", color: "#475569" }}>
                  {[[0.5, "−50%"], [0.75, "−25%"], [1.5, "+50%"], [2, "+100%"], [3, "+200%"]].map(([r, l]) => {
                    const il2 = safeIL(r);
                    return (
                      <div key={r} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <span style={{ color: "#334155" }}>{l}</span>
                        <span style={{ color: il2 != null ? IL_SEVERITY(il2).color : "#475569", fontFamily: "monospace" }}>
                          {il2 != null ? `${il2.toFixed(2)}% IL` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div style={{ padding: "16px", textAlign: "center", fontSize: "10px", color: "#334155", background: "rgba(0,0,0,0.2)", borderRadius: "8px" }}>
                IL não calculável — informe preço de entrada acima.
              </div>
            )}
          </div>

          {/* ── FEE PANEL ── */}
          <div>
            <SectionHeader color="#22c55e">💰 Análise de Fees</SectionHeader>

            {!hasVolume && (
              <DataWarning text="Volume 24h não disponível. Fee estimates desabilitadas — não serão mostrados valores estimados sem dados reais." />
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
              <MetricBox label="FEE TIER" value={`${(feeTier / 10000).toFixed(2)}%`} color="#a5b4fc" sub="por swap" />
              {feeAPR != null
                ? <MetricBox label="FEE APR" value={`${feeAPR.toFixed(1)}%`} color={feeAPR > 20 ? "#22c55e" : feeAPR > 5 ? "#f59e0b" : "#ef4444"} sub="vol × fee / TVL × 365" />
                : <UnavailableBox label="FEE APR" reason="sem volume" />
              }
              {dailyPoolFeeUSD != null
                ? <MetricBox label="FEES POOL/DIA" value={usd(dailyPoolFeeUSD)} color="#3b82f6" sub="vol24h × feeTier" />
                : <UnavailableBox label="FEES POOL/DIA" reason="sem volume" />
              }
              {volTvlRatio != null
                ? <MetricBox label="EFICIÊNCIA vol/TVL" value={`${volTvlRatio.toFixed(1)}%`} color={volTvlRatio > 10 ? "#22c55e" : volTvlRatio > 1 ? "#f59e0b" : "#ef4444"} />
                : <UnavailableBox label="EFICIÊNCIA vol/TVL" reason="sem dados" />
              }
            </div>

            {/* User position estimate */}
            {hasPosition && (
              <div style={{ padding: "10px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: "8px" }}>
                <div style={{ fontSize: "9px", color: "#22c55e", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "6px" }}>
                  💼 SUA POSIÇÃO ({usd(posVal, 0)})
                </div>
                {positionShare != null && hasTvl ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "6px" }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: userDailyFeeUSD != null ? "#22c55e" : "#334155", fontFamily: "monospace" }}>
                          {userDailyFeeUSD != null ? usd(userDailyFeeUSD, userDailyFeeUSD < 0.01 ? 6 : 4) : "—"}
                        </div>
                        <div style={{ fontSize: "8px", color: "#334155" }}>Fees/dia</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: userMonthlyFeeUSD != null ? "#22c55e" : "#334155", fontFamily: "monospace" }}>
                          {userMonthlyFeeUSD != null ? usd(userMonthlyFeeUSD, 2) : "—"}
                        </div>
                        <div style={{ fontSize: "8px", color: "#334155" }}>Fees/mês</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", fontFamily: "monospace" }}>
                          {fmtShare(positionShare)}
                        </div>
                        <div style={{ fontSize: "8px", color: "#334155" }}>Share pool</div>
                      </div>
                    </div>
                    {!hasVolume && (
                      <div style={{ fontSize: "8px", color: "#f59e0b", lineHeight: 1.5 }}>
                        ⚠ Fees/dia e Fees/mês requerem volume real. Valor "—" é correto — não será estimado sem dados.
                      </div>
                    )}
                    {hasVolume && (
                      <div style={{ fontSize: "8px", color: "#2d3748", lineHeight: 1.5 }}>
                        ⚠ Estimativa proporcional ao TVL (posição distribuída uniformemente). Não considera concentração de range nem tick proximity.
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: "9px", color: "#334155" }}>
                    TVL não disponível — share do pool não calculável.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <Divider />

        {/* ── SECTION 4: REBUILD STRATEGY ── */}
        <div>
          <SectionHeader color={shouldRebuild ? "#f59e0b" : "#22c55e"}>
            {shouldRebuild ? "⚠ ESTRATÉGIA DE REMONTAGEM" : "✅ ESTRATÉGIA ATUAL"}
          </SectionHeader>
          <div style={{
            padding: "12px 14px",
            background: shouldRebuild ? "rgba(245,158,11,0.06)" : "rgba(34,197,94,0.05)",
            border: `1px solid ${shouldRebuild ? "rgba(245,158,11,0.2)" : "rgba(34,197,94,0.15)"}`,
            borderRadius: "10px",
          }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", marginBottom: "8px" }}>
              <div style={{ fontSize: "22px" }}>{shouldRebuild ? "🔄" : "✅"}</div>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: shouldRebuild ? "#f59e0b" : "#22c55e", marginBottom: "3px" }}>
                  {shouldRebuild ? "REMONTAR RECOMENDADO" : "MANTER POSIÇÃO"}
                </div>
                <div style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.7 }}>{rebuildReason}</div>
                <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "5px", lineHeight: 1.6, fontStyle: "italic" }}>
                  → {rebuildAction}
                </div>
              </div>
            </div>
            {rebuildRange && (
              <div style={{ display: "flex", gap: "16px", padding: "8px 10px", background: "rgba(0,0,0,0.2)", borderRadius: "7px", fontSize: "10px" }}>
                <span style={{ color: "#475569" }}>Range sugerido:</span>
                <span style={{ color: "#ef4444", fontFamily: "monospace", fontWeight: 700 }}>{usd(rebuildRange.lower)}</span>
                <span style={{ color: "#334155" }}>→</span>
                <span style={{ color: "#22c55e", fontFamily: "monospace", fontWeight: 700 }}>{usd(rebuildRange.upper)}</span>
                <span style={{ color: "#334155", marginLeft: "auto" }}>
                  {rebuildRange.confidence}% confiança · {rebuildRange.horizonDays}d
                </span>
              </div>
            )}
          </div>
        </div>

        <Divider />

        {/* ── SECTION 5: AI ADVISOR ── */}
        <div ref={aiRef}>
          <SectionHeader color="#a5b4fc">🤖 AI Advisor — Análise Completa</SectionHeader>
          {!aiAsked ? (
            <button
              onClick={fetchAI}
              style={{
                width: "100%", padding: "12px",
                background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: "9px", color: "#a5b4fc", fontSize: "11px",
                cursor: "pointer", fontFamily: "monospace", letterSpacing: "1px",
              }}
            >
              🤖 Gerar análise completa com IA →
            </button>
          ) : (
            <div style={{
              padding: "14px", background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(99,102,241,0.2)", borderRadius: "10px", minHeight: "80px",
            }}>
              {aiLoading ? (
                <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "#475569", fontSize: "11px" }}>
                  <Spin size={14} /> Analisando dados e gerando recomendações...
                </div>
              ) : (
                <>
                  <div style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
                    {aiText.replace(/\*\*(.*?)\*\*/g, "$1")}
                  </div>
                  <button
                    onClick={fetchAI}
                    style={{ marginTop: "10px", padding: "4px 10px", borderRadius: "5px", fontSize: "9px", background: "transparent", border: "1px solid rgba(99,102,241,0.2)", color: "#6366f1", cursor: "pointer", fontFamily: "monospace" }}
                  >
                    ↻ atualizar
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div style={{ fontSize: "8px", color: "#1e2d3d", lineHeight: 1.6, textAlign: "center", paddingTop: "4px" }}>
          ⚠ Análise educacional. Fees estimados via vol × feeTier / TVL — sem concentração de tick.
          IL calculado por (2√r/(1+r)−1), onde r = preço atual / preço entrada.
          Não é conselho financeiro. DYOR.
        </div>
      </div>
    </div>
  );
}