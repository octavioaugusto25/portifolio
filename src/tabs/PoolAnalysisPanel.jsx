import { useCallback, useEffect, useRef, useState } from "react";
import { VOLATILITY_COIN_MAP, VOLATILITY_DEFILLAMA_MAP } from "../constants";
import {
  calcIL, extractTokens, fmt, fmtK,
  getLiqLabel, getPair, getRisk, getStrategy, getVolLabel,
  isStable, suggestLPRange,
} from "../utils";
import { Badge, Card, SecTitle, Spin } from "./primitives";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const pct = (n, d = 1) => n == null ? "—" : `${Number(n) >= 0 ? "+" : ""}${Number(n).toFixed(d)}%`;
const usd = (n, d = 2) => n == null ? "—" : `$${fmt(n, d)}`;
const clr = (v, goodHigh = true) => {
  if (v == null) return "#64748b";
  return goodHigh ? (v >= 0 ? "#22c55e" : "#ef4444") : (v <= 0 ? "#22c55e" : "#ef4444");
};
const IL_SEVERITY = (il) => {
  const abs = Math.abs(il);
  if (abs < 0.5) return { label: "Negligível", color: "#22c55e" };
  if (abs < 2)   return { label: "Baixo",       color: "#86efac" };
  if (abs < 5)   return { label: "Moderado",    color: "#f59e0b" };
  if (abs < 12)  return { label: "Alto",        color: "#f97316" };
  return             { label: "Crítico",     color: "#ef4444" };
};

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
const MetricBox = ({ label, value, sub, color = "#94a3b8", icon, large }) => (
  <div style={{
    padding: "10px 12px", background: "rgba(0,0,0,0.28)",
    borderRadius: "9px", border: `1px solid ${color}18`,
  }}>
    {icon && <div style={{ fontSize: "14px", marginBottom: "4px" }}>{icon}</div>}
    <div style={{ fontSize: large ? "20px" : "15px", fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1.1 }}>
      {value}
    </div>
    <div style={{ fontSize: "8px", color: "#475569", marginTop: "3px", letterSpacing: "1px", fontFamily: "monospace" }}>
      {label}
    </div>
    {sub && <div style={{ fontSize: "9px", color: "#334155", marginTop: "2px" }}>{sub}</div>}
  </div>
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

// ─── RANGE GAUGE ─────────────────────────────────────────────────────────────
const RangeGauge = ({ current, min, max, suggested, entry }) => {
  if (!current || !min || !max) return null;
  const inRange = current >= min && current <= max;
  const span = max - min;
  if (span <= 0) return null;
  const toPos = (v) => Math.max(0, Math.min(100, ((v - min) / span) * 100));
  const curPos = toPos(current);
  const entPos = entry ? toPos(entry) : null;
  const sugLow = suggested?.lower ? toPos(suggested.lower) : null;
  const sugHigh = suggested?.upper ? toPos(suggested.upper) : null;

  return (
    <div style={{ marginBottom: "10px" }}>
      {/* Track */}
      <div style={{ position: "relative", height: "24px", background: "rgba(0,0,0,0.3)", borderRadius: "12px", overflow: "visible", margin: "0 8px" }}>
        {/* Suggested range band */}
        {sugLow != null && sugHigh != null && (
          <div style={{
            position: "absolute", top: "4px", bottom: "4px",
            left: `${Math.max(0, sugLow)}%`, width: `${Math.min(100, sugHigh) - Math.max(0, sugLow)}%`,
            background: "rgba(99,102,241,0.15)", borderRadius: "8px",
            border: "1px dashed rgba(99,102,241,0.3)",
          }} title="Range sugerido pela volatilidade" />
        )}
        {/* User range fill */}
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: "0%", width: "100%",
          background: inRange ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.06)",
          borderRadius: "12px",
        }} />
        {/* Entry price marker */}
        {entPos != null && (
          <div style={{
            position: "absolute", top: "-4px", bottom: "-4px", width: "2px",
            background: "#f59e0b", left: `${entPos}%`,
            borderRadius: "2px",
          }} title={`Entrada: $${fmt(entry, 2)}`} />
        )}
        {/* Current price cursor */}
        <div style={{
          position: "absolute", top: "-6px", width: "12px", height: "36px",
          left: `calc(${curPos}% - 6px)`,
          display: "flex", flexDirection: "column", alignItems: "center",
          zIndex: 2,
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
      {/* Labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "8px", color: "#475569", fontFamily: "monospace", padding: "0 8px" }}>
        <span>${fmt(min, 0)} <span style={{ color: "#334155" }}>min</span></span>
        <span style={{ color: inRange ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
          {inRange ? "✓ IN RANGE" : "✗ OUT OF RANGE"}
        </span>
        <span><span style={{ color: "#334155" }}>max</span> ${fmt(max, 0)}</span>
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export function PoolAnalysisPanel({ pool, volData = {}, prices, fetchExternal, onClose }) {
  if (!pool) return null;

  const [entryPrice, setEntryPrice]   = useState(String(pool.entryPrice || pool._entryPrice || ""));
  const [userMin,    setUserMin]      = useState(String(pool.rangeMin || ""));
  const [userMax,    setUserMax]      = useState(String(pool.rangeMax || ""));
  const [position,   setPosition]     = useState(String(pool.valueUSD || ""));
  const [feeTier,    setFeeTier]      = useState(pool.feeTier || 3000);
  const [ilRatio,    setIlRatio]      = useState(2);
  const [aiLoading,  setAiLoading]    = useState(false);
  const [aiText,     setAiText]       = useState("");
  const [aiAsked,    setAiAsked]      = useState(false);
  const aiRef = useRef(null);

  // ── Resolve underlying pool data ──
  const src   = pool.matchedPool || pool;
  const sym   = (pool.symbol || src.symbol || "").toUpperCase().replace(/_/g, "/");
  const proj  = src.project  || pool.protocol || "—";
  const chain = src.chain    || pool.chain     || "—";
  const apy   = src.apy      || pool.apy       || 0;
  const tvl   = src.tvlUsd   || pool.tvlUsd    || 0;
  const vol1d = (src.volumeUsd7d || 0) / 7;
  const score = src._score   || pool._score    || 0;
  const liq   = getLiqLabel(src._liqScore || pool._liqScore || 0);
  const risk  = getRisk(score);
  const pair  = getPair(sym);
  const strat = getStrategy(src.symbol ? src : pool);

  // ── Resolve current price ──
  const tokens    = extractTokens(sym);
  const volTokens = tokens.filter(t => !isStable(t) && VOLATILITY_COIN_MAP[t]);
  const poolVol   = volTokens.length > 0
    ? volTokens.map(t => {
        const id = VOLATILITY_COIN_MAP[t];
        return volData[id]?.annualVol || volData[t]?.annualVol;
      }).filter(Boolean).reduce((a, b, _, arr) => a + b / arr.length, 0)
    : null;
  const volLabel  = getVolLabel(poolVol);

  // Current price: try to match token to prices prop
  const priceMap = { ETH: prices?.ethereum?.usd, BTC: prices?.bitcoin?.usd, SOL: prices?.solana?.usd };
  const volTok    = volTokens[0];
  const currentPrice = priceMap[volTok] || null;

  // ── Computed values ──
  const entry  = parseFloat(entryPrice) || null;
  const minR   = parseFloat(userMin)    || null;
  const maxR   = parseFloat(userMax)    || null;
  const posVal = parseFloat(position)   || 0;

  // Suggested range from vol
  const suggested = (currentPrice && poolVol)
    ? suggestLPRange(currentPrice, poolVol, 30, 1.5)
    : null;

  // In range?
  const inRange  = (currentPrice && minR && maxR) ? (currentPrice >= minR && currentPrice <= maxR) : null;
  const distFromRange = (currentPrice && minR && maxR && !inRange)
    ? (currentPrice < minR ? ((minR - currentPrice) / currentPrice) * 100 : ((currentPrice - maxR) / currentPrice) * 100)
    : null;

  // IL
  const ilPriceRatio = entry && currentPrice ? currentPrice / entry : ilRatio;
  const il = calcIL(ilPriceRatio) * 100; // already returns fraction, multiply
  // Wait — calcIL returns the decimal already multiplied, let me re-check
  // calcIL = (2 * sqrt(r) / (1 + r) - 1) * 100  — yes, it's already * 100 in utils
  // So il is already a percentage
  const ilSeverity = IL_SEVERITY(il);

  // IL breakeven: APY needed to cover IL in 12 months
  const ilBreakeven = Math.abs(il);

  // Fee analysis
  const feePct       = feeTier / 1_000_000;       // e.g. 3000 → 0.003 = 0.3%
  const feeEfficiency = tvl > 0 ? (vol1d / tvl) * 100 : 0; // volume/TVL %
  const dailyFeePoolTotal = vol1d * feePct;        // total fees generated by pool per day
  const feeAPR       = tvl > 0 ? (dailyFeePoolTotal * 365 / tvl) * 100 : 0;
  // User share estimate: if user has posVal, their share of pool
  const userShare    = (posVal > 0 && tvl > 0) ? posVal / tvl : null;
  const userDailyFee = userShare != null ? dailyFeePoolTotal * userShare : null;
  const userMonthlyFee = userDailyFee != null ? userDailyFee * 30 : null;

  // ── Rebuild strategy ──
  const shouldRebuild = score < 55 || (inRange === false) || (poolVol && poolVol > 120) || feeEfficiency < 1;
  let rebuildReason = "";
  let rebuildAction = "";
  let rebuildRange  = null;
  if (inRange === false) {
    rebuildReason = `Preço atual ${currentPrice ? `$${fmt(currentPrice, 0)}` : "desconhecido"} está fora do range definido (${distFromRange?.toFixed(1)}% de distância).`;
    rebuildAction = suggested
      ? `Remontar no range $${fmt(suggested.lower, 0)}–$${fmt(suggested.upper, 0)} (${suggested.confidence}% confiança histórica, ${suggested.horizonDays}d).`
      : "Ampliar o range baseado na volatilidade histórica do ativo.";
    rebuildRange  = suggested;
  } else if (score < 55) {
    rebuildReason = `Score ${score}/100 abaixo do mínimo recomendado. Protocolo ou TVL fraco.`;
    rebuildAction = "Considerar migrar para pool score ≥ 65 no mesmo par.";
  } else if (poolVol && poolVol > 120) {
    rebuildReason = `Volatilidade extrema (${poolVol.toFixed(0)}%/aa). Range estreito sai rapidamente.`;
    rebuildAction = suggested
      ? `Usar range amplo: $${fmt(suggested.lower, 0)}–$${fmt(suggested.upper, 0)}.`
      : "Ampliar range ou migrar para stable/stable.";
    rebuildRange = suggested;
  } else if (feeEfficiency < 1) {
    rebuildReason = `Eficiência de fees baixa (volume/TVL = ${feeEfficiency.toFixed(2)}%). Pool pouco utilizada.`;
    rebuildAction = "Buscar pool do mesmo par com maior volume relativo ao TVL.";
  } else {
    rebuildReason = "Pool dentro dos parâmetros aceitáveis.";
    rebuildAction = "Monitorar semanalmente. Revisar range se vol aumentar.";
  }

  // ── Pool Quality Score (composite) ──
  let qualityScore = score;
  if (inRange === true)  qualityScore = Math.min(100, qualityScore + 5);
  if (inRange === false) qualityScore = Math.max(0, qualityScore - 10);
  if (feeEfficiency > 50) qualityScore = Math.min(100, qualityScore + 5);
  if (poolVol && poolVol > 100) qualityScore = Math.max(0, qualityScore - 5);
  qualityScore = Math.round(qualityScore);

  // ── AI Advisor ──
  const buildPrompt = useCallback(() => {
    const parts = [
      `Análise detalhada do pool ${sym} (${proj}, ${chain}):`,
      `Score: ${qualityScore}/100 | Risco: ${risk.label}`,
      `APY: ${apy.toFixed(1)}% | TVL: ${fmtK(tvl)} | Vol 24h: ${fmtK(vol1d)}`,
      `Liquidez: ${liq.label} | Fee efficiency: ${feeEfficiency.toFixed(1)}%`,
      currentPrice ? `Preço atual ${volTok}: $${fmt(currentPrice, 0)}` : "",
      entry         ? `Preço de entrada: $${fmt(entry, 2)}` : "",
      (minR && maxR) ? `Range do usuário: $${fmt(minR, 2)}–$${fmt(maxR, 2)} (${inRange ? "IN RANGE ✓" : "OUT OF RANGE ✗"})` : "",
      suggested     ? `Range sugerido (vol ${poolVol?.toFixed(0)}%/aa): $${fmt(suggested.lower, 2)}–$${fmt(suggested.upper, 2)}` : "",
      `IL estimado: ${il.toFixed(2)}% (${ilSeverity.label})`,
      posVal > 0    ? `Posição: $${fmt(posVal, 0)} | Fees/dia estimado: ${userDailyFee != null ? `$${fmt(userDailyFee, 2)}` : "—"}` : "",
      `Fee APR: ${feeAPR.toFixed(1)}%`,
      `Decisão: ${shouldRebuild ? "REMONTAR — " + rebuildReason : "MANTER — " + rebuildReason}`,
      suggested && shouldRebuild ? `Ação: ${rebuildAction}` : "",
      `Volatilidade histórica (${volTok}): ${poolVol ? poolVol.toFixed(0) + "%/aa" : "não disponível"}`,
    ].filter(Boolean).join("\n");

    return `Você é um advisor DeFi especialista. Analise este pool e forneça:
1. Resumo do estado atual (2 frases)
2. Análise do range: está bem posicionado? Risco de sair?
3. IL: o quanto preocupa dado o APY?
4. Decisão: manter, remontar ou sair? Justifique com números.
5. Próxima ação específica e mensurável.

Dados:
${parts}

Responda em PT-BR, direto, usando números. Máximo 200 palavras.`;
  }, [sym, proj, chain, qualityScore, risk, apy, tvl, vol1d, liq, feeEfficiency, currentPrice, entry, minR, maxR, inRange, suggested, poolVol, il, ilSeverity, posVal, userDailyFee, feeAPR, shouldRebuild, rebuildReason, rebuildAction, volTok]);

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
          system: "You are an expert DeFi advisor. Be direct, data-driven, actionable. Always respond in Brazilian Portuguese (pt-BR). Use specific numbers from the context.",
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
      {/* ── Header strip ── */}
      <div style={{
        background: `linear-gradient(90deg, rgba(0,0,0,0.4) 0%, ${risk.color}0a 100%)`,
        borderBottom: `1px solid ${risk.color}18`,
        padding: "14px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.5px" }}>{sym}</div>
            <div style={{ fontSize: "9px", color: "#475569", marginTop: "2px" }}>
              {proj} · {chain}
            </div>
          </div>
          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
            <Badge color={risk.color} sm>{risk.icon} {risk.label}</Badge>
            <Badge color={strat.color} sm>{strat.icon} {strat.type}</Badge>
            <Badge color={pair.color} sm>{pair.icon} {pair.label}</Badge>
            {poolVol && <Badge color={volLabel.color} sm>📊 {poolVol.toFixed(0)}%/aa</Badge>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Quality score ring */}
          <div style={{
            width: "52px", height: "52px", borderRadius: "50%",
            background: `conic-gradient(${risk.color} ${qualityScore * 3.6}deg, rgba(255,255,255,0.05) 0deg)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative",
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

        {/* ── SECTION 1: CORE METRICS ── */}
        <div>
          <SectionHeader color="#3b82f6">📊 Dados do Pool</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
            <MetricBox label="APY" value={`${apy.toFixed(1)}%`} color={apy > 80 ? "#ef4444" : apy > 40 ? "#f59e0b" : "#22c55e"} />
            <MetricBox label="TVL" value={fmtK(tvl)} color="#3b82f6" />
            <MetricBox label="VOL 24H" value={vol1d > 0 ? fmtK(vol1d) : "—"} color={vol1d > 1e6 ? "#22c55e" : "#64748b"} />
            <MetricBox label="LIQUIDEZ" value={liq.label} color={liq.color} />
          </div>
        </div>

        <Divider />

        {/* ── SECTION 2: PRICE & RANGE ── */}
        <div>
          <SectionHeader color="#6366f1">📐 Preço & Range</SectionHeader>

          {/* Inputs row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "6px", marginBottom: "12px" }}>
            {[
              { label: "PREÇO ENTRADA ($)", val: entryPrice, set: setEntryPrice, ph: "ex: 2500" },
              { label: "RANGE MIN ($)",      val: userMin,    set: setUserMin,    ph: "ex: 2000" },
              { label: "RANGE MAX ($)",      val: userMax,    set: setUserMax,    ph: "ex: 3000" },
              { label: "POSIÇÃO ($)",        val: position,   set: setPosition,   ph: "ex: 1000" },
              { label: "FEE TIER (bps)",     val: String(feeTier), set: v => setFeeTier(Number(v)), ph: "3000" },
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
              </div>
            ))}
          </div>

          {/* Range gauge */}
          {(minR && maxR) && (
            <RangeGauge
              current={currentPrice} min={minR} max={maxR}
              suggested={suggested} entry={entry}
            />
          )}

          {/* Price metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
            <MetricBox
              label="PREÇO ATUAL"
              value={currentPrice ? usd(currentPrice) : "—"}
              color={currentPrice ? "#f1f5f9" : "#475569"}
              sub={volTok || ""}
            />
            <MetricBox
              label="PREÇO ENTRADA"
              value={entry ? usd(entry) : "—"}
              color="#f59e0b"
              sub={entry && currentPrice ? `${pct(((currentPrice - entry) / entry) * 100, 1)} vs entrada` : "informe abaixo"}
            />
            <MetricBox
              label={inRange === null ? "STATUS RANGE" : inRange ? "IN RANGE ✓" : "OUT OF RANGE ✗"}
              value={inRange === null ? "—" : inRange ? "✅ Ativo" : `${distFromRange?.toFixed(1)}% fora`}
              color={inRange === null ? "#475569" : inRange ? "#22c55e" : "#ef4444"}
            />
            <MetricBox
              label="VOLATILIDADE"
              value={poolVol ? `${poolVol.toFixed(0)}%/aa` : "—"}
              color={volLabel.color}
              sub={volLabel.label}
            />
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
                <div style={{ fontSize: "12px", color: "#ef4444", fontFamily: "monospace", fontWeight: 700 }}>
                  ↓ ${fmt(suggested.lower, 2)}
                </div>
                <div style={{ fontSize: "10px", color: "#475569" }}>→</div>
                <div style={{ fontSize: "12px", color: "#22c55e", fontFamily: "monospace", fontWeight: 700 }}>
                  ↑ ${fmt(suggested.upper, 2)}
                </div>
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

          {/* IL */}
          <div>
            <SectionHeader color="#ef4444">📉 Impermanent Loss</SectionHeader>
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "8px", color: "#334155", marginBottom: "3px", fontFamily: "monospace" }}>
                {entry && currentPrice ? `RATIO: preço atual / entrada = ${(currentPrice / entry).toFixed(3)}x` : `SIMULAR: multiplicador de preço (${ilRatio}x)`}
              </div>
              {(!entry || !currentPrice) && (
                <input
                  type="range" min="0.1" max="5" step="0.1"
                  value={ilRatio} onChange={e => setIlRatio(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#ef4444", marginBottom: "6px" }}
                />
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
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
                <MetricBox label="APY P/ COBRIR IL" value={`≥${ilBreakeven.toFixed(1)}%`} color={apy >= ilBreakeven ? "#22c55e" : "#ef4444"} />
                <MetricBox label="IL COBERTO?" value={apy >= ilBreakeven ? "✅ Sim" : "❌ Não"} color={apy >= ilBreakeven ? "#22c55e" : "#ef4444"} />
              </div>
            </div>
            {/* Quick IL table */}
            <div style={{ marginTop: "8px", fontSize: "9px", color: "#475569" }}>
              {[[0.5, "−50%"], [0.75, "−25%"], [1.5, "+50%"], [2, "+100%"], [3, "+200%"]].map(([r, l]) => {
                const il2 = Math.abs(calcIL(r));
                return (
                  <div key={r} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <span style={{ color: "#334155" }}>{l}</span>
                    <span style={{ color: IL_SEVERITY(il2).color, fontFamily: "monospace" }}>{il2.toFixed(2)}% IL</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fees */}
          <div>
            <SectionHeader color="#22c55e">💰 Análise de Fees</SectionHeader>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
              <MetricBox label="FEE TIER" value={`${(feeTier / 10000).toFixed(2)}%`} color="#a5b4fc" />
              <MetricBox label="FEE APR" value={`${feeAPR.toFixed(1)}%`} color={feeAPR > 20 ? "#22c55e" : feeAPR > 5 ? "#f59e0b" : "#ef4444"} sub="estimado via vol" />
              <MetricBox label="FEES POOL/DIA" value={vol1d > 0 ? usd(dailyFeePoolTotal) : "—"} color="#3b82f6" />
              <MetricBox label="EFICIÊNCIA" value={`${feeEfficiency.toFixed(1)}%`} color={feeEfficiency > 10 ? "#22c55e" : feeEfficiency > 1 ? "#f59e0b" : "#ef4444"} sub="vol/TVL" />
            </div>
            {posVal > 0 && userDailyFee != null && (
              <div style={{ padding: "10px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: "8px" }}>
                <div style={{ fontSize: "9px", color: "#22c55e", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "6px" }}>
                  💼 SUA POSIÇÃO (${fmt(posVal, 0)})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                  {[
                    { label: "Fees/dia", value: usd(userDailyFee, 3) },
                    { label: "Fees/mês", value: usd(userMonthlyFee, 2) },
                    { label: "Share pool", value: userShare ? `${(userShare * 100).toFixed(4)}%` : "—" },
                  ].map(m => (
                    <div key={m.label} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>{m.value}</div>
                      <div style={{ fontSize: "8px", color: "#334155" }}>{m.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "8px", color: "#2d3748", marginTop: "6px", lineHeight: 1.5 }}>
                  ⚠ Estimativa baseada em proporção do TVL. Não inclui concentração de range nem tick proximity.
                </div>
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
                <span style={{ color: "#ef4444", fontFamily: "monospace", fontWeight: 700 }}>
                  ${fmt(rebuildRange.lower, 2)}
                </span>
                <span style={{ color: "#334155" }}>→</span>
                <span style={{ color: "#22c55e", fontFamily: "monospace", fontWeight: 700 }}>
                  ${fmt(rebuildRange.upper, 2)}
                </span>
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
                transition: "all 0.2s",
              }}
            >
              🤖 Gerar análise completa com IA →
            </button>
          ) : (
            <div style={{
              padding: "14px", background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(99,102,241,0.2)", borderRadius: "10px",
              minHeight: "80px",
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
          ⚠ Análise educacional. Fee estimates baseadas em vol/TVL proporcional. Não inclui concentração de tick. DYOR antes de qualquer aporte.
        </div>
      </div>
    </div>
  );
}