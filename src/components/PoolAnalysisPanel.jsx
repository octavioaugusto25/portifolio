import { useCallback, useEffect, useRef, useState } from "react";
import { VOLATILITY_COIN_MAP } from "../constants";
import {
  extractTokens, fmt, fmtK,
  getLiqLabel, getPair, getRisk, getStrategy, getVolLabel,
  isStable, suggestLPRange,
} from "../utils";
import { Badge, Spin } from "./primitives";
import {
  runPositionAnalysis,
  ilSeverity,
  formatShare,
  resolveEntryPrice,
} from "../analysisEngine";

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────

const usd = (n, d = 2) => (n == null || !isFinite(n)) ? "—" : `$${fmt(n, d)}`;
const pct = (n, d = 1) => (n == null || !isFinite(n)) ? "—" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(d)}%`;

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

const MetricBox = ({ label, value, sub, color = "#94a3b8", unavailable = false }) => (
  <div style={{
    padding: "10px 12px",
    background: "rgba(0,0,0,0.28)",
    borderRadius: "9px",
    border: `1px solid ${unavailable ? "rgba(255,255,255,0.04)" : color + "18"}`,
    opacity: unavailable ? 0.5 : 1,
  }}>
    <div style={{ fontSize: "14px", fontWeight: 700, color: unavailable ? "#334155" : color, fontFamily: "monospace", lineHeight: 1.1 }}>
      {value}
    </div>
    <div style={{ fontSize: "8px", color: "#475569", marginTop: "3px", letterSpacing: "1px", fontFamily: "monospace" }}>
      {label}
    </div>
    {sub && (
      <div style={{ fontSize: "9px", color: unavailable ? "#1e2d3d" : "#475569", marginTop: "2px", lineHeight: 1.4 }}>{sub}</div>
    )}
  </div>
);

const NA = ({ label, reason }) => (
  <MetricBox label={label} value="—" sub={reason} unavailable />
);

const SectionHeader = ({ children, color = "#6366f1" }) => (
  <div style={{
    fontSize: "8px", fontWeight: 700, color,
    letterSpacing: "2.5px", fontFamily: "monospace", textTransform: "uppercase",
    borderLeft: `2px solid ${color}`, paddingLeft: "7px", marginBottom: "10px",
  }}>
    {children}
  </div>
);

const Divider = () => (
  <div style={{ height: "1px", background: "rgba(255,255,255,0.04)", margin: "14px 0" }} />
);

const WarningBanner = ({ text }) => (
  <div style={{
    padding: "7px 10px", marginBottom: "8px",
    background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)",
    borderRadius: "7px", fontSize: "9px", color: "#f59e0b", lineHeight: 1.5,
  }}>
    ⚠ {text}
  </div>
);

const inputStyle = {
  width: "100%", padding: "5px 7px",
  background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "6px", color: "#f1f5f9", fontFamily: "monospace", fontSize: "11px",
};

const InputLabel = ({ children }) => (
  <div style={{ fontSize: "7px", color: "#334155", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "3px" }}>
    {children}
  </div>
);

// ─── RANGE GAUGE ─────────────────────────────────────────────────────────────

const RangeGauge = ({ currentPrice, range, suggestedRange, entryPrice }) => {
  if (!range || !currentPrice) return null;
  const { min, max } = range;
  if (min >= max) return null;

  const span = max - min;
  const pos  = (v) => Math.max(0, Math.min(100, ((v - min) / span) * 100));
  const inRange = currentPrice >= min && currentPrice <= max;
  const sugLow  = suggestedRange?.lower;
  const sugHigh = suggestedRange?.upper;

  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ position: "relative", height: "24px", background: "rgba(0,0,0,0.3)", borderRadius: "12px", margin: "0 8px", overflow: "visible" }}>
        {sugLow && sugHigh && range.source === "user" && (
          <div style={{
            position: "absolute", top: "4px", bottom: "4px",
            left: `${Math.max(0, pos(sugLow))}%`,
            width: `${Math.max(0, Math.min(100, pos(sugHigh)) - Math.max(0, pos(sugLow)))}%`,
            background: "rgba(99,102,241,0.15)", borderRadius: "6px",
            border: "1px dashed rgba(99,102,241,0.3)", minWidth: "1px",
          }} title="Range sugerido pela volatilidade" />
        )}
        <div style={{
          position: "absolute", inset: 0,
          background: inRange ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.05)",
          borderRadius: "12px",
        }} />
        {entryPrice && entryPrice >= min && entryPrice <= max && (
          <div style={{
            position: "absolute", top: "-4px", bottom: "-4px", width: "2px",
            background: "#f59e0b", left: `${pos(entryPrice)}%`, borderRadius: "1px",
          }} title={`Entrada: ${usd(entryPrice)}`} />
        )}
        <div style={{
          position: "absolute", top: "-6px",
          left: `calc(${Math.max(0, Math.min(100, pos(currentPrice)))}% - 6px)`,
          width: "12px", height: "36px",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2,
        }}>
          <div style={{
            width: "12px", height: "12px", borderRadius: "50%",
            background: inRange ? "#22c55e" : "#ef4444",
            border: "2px solid rgba(0,0,0,0.6)",
            boxShadow: `0 0 8px ${inRange ? "#22c55e80" : "#ef444480"}`,
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
      {range.source === "suggested" && (
        <div style={{ textAlign: "center", fontSize: "8px", color: "#6366f1", marginTop: "4px", fontFamily: "monospace" }}>
          📐 Range automático via vol — defina manualmente acima para análise precisa
        </div>
      )}
    </div>
  );
};

// ─── IL REFERENCE TABLE ───────────────────────────────────────────────────────

const ILTable = () => (
  <div style={{ marginTop: "8px" }}>
    {[[0.5, "−50%"], [0.75, "−25%"], [1.5, "+50%"], [2, "+100%"], [3, "+200%"]].map(([r, label]) => {
      const raw = (2 * Math.sqrt(r) / (1 + r) - 1) * 100;
      const il  = Math.max(-100, Math.min(0, raw));
      const sev = ilSeverity(Math.abs(il));
      return (
        <div key={r} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: "9px" }}>
          <span style={{ color: "#334155" }}>{label}</span>
          <span style={{ color: sev.color, fontFamily: "monospace" }}>{il.toFixed(2)}% IL</span>
        </div>
      );
    })}
  </div>
);

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export function PoolAnalysisPanel({ pool, volData = {}, prices, fetchExternal, onClose }) {
  if (!pool) return null;

  // Canonical entry price: resolveEntryPrice gives avgCostUSD ?? entryPrice
  const canonicalEntry = resolveEntryPrice(pool);

  // User-editable state — initialized once from position data
  const [userEntry,  setUserEntry]  = useState(canonicalEntry != null ? String(canonicalEntry) : "");
  const [userMin,    setUserMin]    = useState(String(pool.rangeMin || ""));
  const [userMax,    setUserMax]    = useState(String(pool.rangeMax || ""));
  const [userPos,    setUserPos]    = useState(String(pool.valueUSD || ""));
  const [feeTierBps, setFeeTierBps] = useState(Number(pool.feeTier) || 3000);
  const [ilSimRatio, setIlSimRatio] = useState(2);

  // AI state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText,    setAiText]    = useState("");
  const [aiAsked,   setAiAsked]   = useState(false);
  const aiRef = useRef(null);

  // Pool source data
  const src   = pool.matchedPool || pool;
  const sym   = (pool.symbol || src.symbol || "").toUpperCase().replace(/_/g, "/");
  const proj  = src.project   || pool.protocol || "—";
  const chain = src.chain     || pool.chain    || "—";
  const apy   = Number(src.apy   || pool.apy   || 0);
  const tvl   = Number(src.tvlUsd || pool.tvlUsd || 0) || null;
  const score = Number(src._score || pool._score || 0);
  const liq   = getLiqLabel(src._liqScore || pool._liqScore || 0);
  const risk  = getRisk(score);
  const pair  = getPair(sym);
  const strat = getStrategy(src.symbol ? src : pool);

  // Current price from live prices
  const tokens    = extractTokens(sym);
  const volTokens = tokens.filter(t => !isStable(t) && VOLATILITY_COIN_MAP[t]);
  const baseToken = volTokens[0] || null;
  const priceMap  = { ETH: prices?.ethereum?.usd, BTC: prices?.bitcoin?.usd, SOL: prices?.solana?.usd };
  const currentPrice = baseToken ? (priceMap[baseToken] ?? null) : null;

  // Annual volatility
  const resolveVol = (key) => {
    const v = volData[key];
    if (!v) return null;
    return typeof v === "number" ? v : (v?.annualVol ?? null);
  };
  const annualVol = volTokens.length > 0
    ? (volTokens.map(t => {
        const id = VOLATILITY_COIN_MAP[t];
        return resolveVol(id) ?? resolveVol(t) ?? resolveVol(t.toLowerCase());
      }).filter(Boolean).reduce((s, v, _, arr) => s + v / arr.length, 0) || null)
    : null;
  const volLabel = getVolLabel(annualVol);

  // Suggested range
  const suggestedRange = (currentPrice && annualVol)
    ? suggestLPRange(currentPrice, annualVol, 30, 1.5)
    : null;

  // Parsed user inputs
  const entryForEngine = parseFloat(userEntry) || null;
  const positionForEngine = {
    ...pool,
    avgCostUSD:  entryForEngine,
    entryPrice:  entryForEngine,
    rangeMin:    parseFloat(userMin) || null,
    rangeMax:    parseFloat(userMax) || null,
    valueUSD:    parseFloat(userPos) || pool.valueUSD || 0,
    feeTier:     feeTierBps,
  };

  // Full analysis — pure function, no side effects
  const analysis = runPositionAnalysis({
    position:     positionForEngine,
    matchedPool:  pool.matchedPool || null,
    currentPrice,
    annualVol,
    suggestedRange,
  });

  const { ilResult, range, rangeStatus, feeResult, decision, staticSummary } = analysis;

  // Composite quality score
  let qualityScore = score;
  if (rangeStatus?.inRange === true)  qualityScore = Math.min(100, qualityScore + 5);
  if (rangeStatus?.inRange === false) qualityScore = Math.max(0,   qualityScore - 10);
  if ((feeResult.volTvlRatio ?? 0) > 50) qualityScore = Math.min(100, qualityScore + 5);
  if ((annualVol ?? 0) > 100)         qualityScore = Math.max(0,   qualityScore - 5);
  qualityScore = Math.round(qualityScore);

  // IL display: real if available, simulator otherwise
  const displayIL = (() => {
    if (ilResult) return { ...ilResult, simulated: false };
    const raw = (2 * Math.sqrt(ilSimRatio) / (1 + ilSimRatio) - 1) * 100;
    const il  = Math.max(-100, Math.min(0, raw));
    return { il, ilAbs: Math.abs(il), ratio: ilSimRatio, simulated: true };
  })();
  const ilSev      = ilSeverity(displayIL.ilAbs);
  const ilBreakeven = displayIL.ilAbs;
  const ilCovered  = apy >= ilBreakeven;

  // AI prompt
  const buildPrompt = useCallback(() => {
    const lines = [
      `Pool: ${sym} | ${proj} | ${chain}`,
      `Score: ${qualityScore}/100 | Risco: ${risk.label} | APY: ${apy.toFixed(1)}%`,
      `TVL: ${tvl ? fmtK(tvl) : "N/A"} | Vol 24h: ${analysis.vol24h ? fmtK(analysis.vol24h) : "N/A"}`,
      ilResult
        ? `IL real: ${ilResult.il.toFixed(2)}% (ratio ${ilResult.ratio.toFixed(3)}×) — ${ilSeverity(ilResult.ilAbs).label}`
        : "IL: preço de entrada não informado",
      rangeStatus
        ? `Range: ${rangeStatus.inRange ? "IN RANGE" : `OUT OF RANGE +${rangeStatus.distancePct.toFixed(1)}%`} (${rangeStatus.source})`
        : "Range: não definido",
      feeResult.feeAPR != null
        ? `Fee APR: ${feeResult.feeAPR.toFixed(1)}% (${feeResult.dataSource})`
        : "Fee APR: sem dados",
      feeResult.userDailyFees != null
        ? `Fees/dia: ${usd(feeResult.userDailyFees, 4)} | Share pool: ${formatShare(feeResult.positionShare)}`
        : "",
      annualVol ? `Vol histórica ${baseToken}: ${annualVol.toFixed(0)}%/aa` : "",
      `Decisão: ${decision.action} — ${decision.reason}`,
    ].filter(Boolean).join("\n");

    return `Você é um advisor DeFi especialista. Analise e responda em PT-BR (máx 200 palavras):
1. Estado atual (2 frases com números)
2. IL e range: bem posicionado?
3. Fees compensam o IL?
4. Decisão final justificada numericamente
5. Próximo passo específico

Dados:
${lines}`;
  }, [sym, proj, chain, qualityScore, risk, apy, tvl, analysis.vol24h, ilResult, rangeStatus, feeResult, annualVol, decision, baseToken]);

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
          model: "claude-sonnet-4-20250514", max_tokens: 600,
          system: "DeFi advisor. Direct, data-driven. Respond in Brazilian Portuguese (pt-BR). Use exact numbers from context.",
          messages: [{ role: "user", content: buildPrompt() }],
        }),
      });
      const d = await r.json();
      setAiText(d.content?.find(b => b.type === "text")?.text || "Sem resposta do modelo.");
    } catch {
      setAiText("⚠ Erro de conexão. Resumo automático disponível acima.");
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

      {/* Header */}
      <div style={{
        background: `linear-gradient(90deg, rgba(0,0,0,0.4), ${risk.color}0a)`,
        borderBottom: `1px solid ${risk.color}18`,
        padding: "14px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: "#f1f5f9" }}>{sym}</div>
            <div style={{ fontSize: "9px", color: "#475569", marginTop: "2px" }}>{proj} · {chain}</div>
          </div>
          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
            <Badge color={risk.color} sm>{risk.icon} {risk.label}</Badge>
            <Badge color={strat.color} sm>{strat.icon} {strat.type}</Badge>
            <Badge color={pair.color} sm>{pair.icon} {pair.label}</Badge>
            {annualVol && <Badge color={volLabel.color} sm>📊 {annualVol.toFixed(0)}%/aa</Badge>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "52px", height: "52px", borderRadius: "50%",
            background: `conic-gradient(${risk.color} ${qualityScore * 3.6}deg, rgba(255,255,255,0.05) 0deg)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#08111e", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: "13px", fontWeight: 800, color: risk.color, fontFamily: "monospace", lineHeight: 1 }}>{qualityScore}</div>
              <div style={{ fontSize: "6px", color: "#334155" }}>SCORE</div>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "none", color: "#64748b", width: "28px", height: "28px", borderRadius: "7px", cursor: "pointer" }}>✕</button>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* S1: Pool Metrics */}
        <div>
          <SectionHeader color="#3b82f6">📊 Dados do Pool</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
            <MetricBox label="APY" value={`${apy.toFixed(1)}%`} color={apy > 80 ? "#ef4444" : apy > 40 ? "#f59e0b" : "#22c55e"} />
            {tvl ? <MetricBox label="TVL" value={fmtK(tvl)} color="#3b82f6" /> : <NA label="TVL" reason="indisponível" />}
            {analysis.vol24h
              ? <MetricBox label="VOL 24H" value={fmtK(analysis.vol24h)} color={analysis.vol24h > 1e6 ? "#22c55e" : "#f59e0b"}
                  sub={feeResult.volTvlRatio != null ? `${feeResult.volTvlRatio.toFixed(1)}% vol/TVL` : undefined} />
              : <NA label="VOL 24H" reason="sem dados" />
            }
            <MetricBox label="LIQUIDEZ" value={liq.label} color={liq.color} />
          </div>
        </div>

        <Divider />

        {/* S2: Price & Range */}
        <div>
          <SectionHeader color="#6366f1">📐 Preço & Range</SectionHeader>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "6px", marginBottom: "10px" }}>
            <div>
              <InputLabel>PREÇO ENTRADA {baseToken ? `(${baseToken} em $)` : ""}</InputLabel>
              <input
                value={userEntry}
                onChange={e => setUserEntry(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder={currentPrice ? `atual: ${usd(currentPrice, 0)}` : "ex: 2500"}
                style={inputStyle}
              />
              {/* Warn if position had conflicting values */}
              {pool.avgCostUSD && pool.entryPrice && Math.abs(Number(pool.avgCostUSD) - Number(pool.entryPrice)) > 0.01 && (
                <div style={{ fontSize: "7px", color: "#f59e0b", marginTop: "2px" }}>
                  avgCost {usd(pool.avgCostUSD, 0)} ≠ entry {usd(pool.entryPrice, 0)} → usando avgCost
                </div>
              )}
            </div>
            <div>
              <InputLabel>RANGE MIN ($)</InputLabel>
              <input value={userMin} onChange={e => setUserMin(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="ex: 2000" style={inputStyle} />
            </div>
            <div>
              <InputLabel>RANGE MAX ($)</InputLabel>
              <input value={userMax} onChange={e => setUserMax(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="ex: 3000" style={inputStyle} />
            </div>
            <div>
              <InputLabel>POSIÇÃO ($)</InputLabel>
              <input value={userPos} onChange={e => setUserPos(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="ex: 1000" style={inputStyle} />
            </div>
            <div>
              <InputLabel>FEE TIER (bps)</InputLabel>
              <input
                value={feeTierBps}
                onChange={e => setFeeTierBps(Number(e.target.value.replace(/[^0-9]/g, "")) || 3000)}
                placeholder="3000"
                style={inputStyle}
              />
              <div style={{ fontSize: "7px", color: "#334155", marginTop: "2px" }}>{(feeTierBps / 10000).toFixed(2)}% por swap</div>
            </div>
          </div>

          <RangeGauge currentPrice={currentPrice} range={range} suggestedRange={suggestedRange} entryPrice={entryForEngine} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
            {currentPrice
              ? <MetricBox label={`PREÇO ATUAL ${baseToken || ""}`} value={usd(currentPrice)} color="#f1f5f9" />
              : <NA label="PREÇO ATUAL" reason="token não mapeado" />
            }
            {entryForEngine
              ? <MetricBox label="PREÇO ENTRADA" value={usd(entryForEngine)} color="#f59e0b"
                  sub={currentPrice ? pct(((currentPrice - entryForEngine) / entryForEngine) * 100) + " vs entrada" : undefined} />
              : <MetricBox label="PREÇO ENTRADA" value="—" sub="informe acima" unavailable />
            }
            {rangeStatus
              ? <MetricBox
                  label={rangeStatus.inRange ? "IN RANGE ✓" : "OUT OF RANGE ✗"}
                  value={rangeStatus.inRange ? "✅ Ativo" : `${rangeStatus.distancePct.toFixed(1)}% fora`}
                  color={rangeStatus.inRange ? "#22c55e" : "#ef4444"}
                  sub={rangeStatus.source === "suggested" ? "range sugerido" : "range definido"}
                />
              : <MetricBox label="STATUS RANGE" value="—" sub="sem range" unavailable />
            }
            {annualVol
              ? <MetricBox label="VOLATILIDADE" value={`${annualVol.toFixed(0)}%/aa`} color={volLabel.color} sub={volLabel.label} />
              : <NA label="VOLATILIDADE" reason="sem histórico" />
            }
          </div>

          {suggestedRange && (
            <div style={{
              marginTop: "8px", padding: "10px 12px",
              background: "rgba(99,102,241,0.05)", border: "1px dashed rgba(99,102,241,0.25)",
              borderRadius: "8px", display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap",
            }}>
              <div style={{ fontSize: "9px", color: "#6366f1", fontFamily: "monospace", fontWeight: 700 }}>RANGE SUGERIDO (1.5σ / 30d)</div>
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ color: "#ef4444", fontFamily: "monospace", fontWeight: 700 }}>↓ {usd(suggestedRange.lower)}</span>
                <span style={{ color: "#475569" }}>→</span>
                <span style={{ color: "#22c55e", fontFamily: "monospace", fontWeight: 700 }}>↑ {usd(suggestedRange.upper)}</span>
              </div>
              <span style={{ fontSize: "9px", color: "#475569" }}>±{suggestedRange.rangePct.toFixed(1)}% · {suggestedRange.confidence}% confiança</span>
            </div>
          )}
        </div>

        <Divider />

        {/* S3: IL + Fees */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>

          {/* IL */}
          <div>
            <SectionHeader color="#ef4444">📉 Impermanent Loss</SectionHeader>

            {!entryForEngine && (
              <WarningBanner text="Informe o preço de entrada para IL real. Simulador abaixo usa ratio hipotético." />
            )}

            {/* Ratio line or slider */}
            {ilResult ? (
              <div style={{ marginBottom: "8px", fontSize: "9px", color: "#64748b", fontFamily: "monospace" }}>
                RATIO {baseToken}: {usd(currentPrice, 0)} / {usd(entryForEngine, 0)} = <strong style={{ color: "#f1f5f9" }}>{ilResult.ratio.toFixed(3)}×</strong>
              </div>
            ) : (
              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "8px", color: "#334155", fontFamily: "monospace", marginBottom: "4px" }}>
                  SIMULAÇÃO — ratio: {ilSimRatio}×
                </div>
                <input type="range" min="0.1" max="5" step="0.1" value={ilSimRatio}
                  onChange={e => setIlSimRatio(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#ef4444", marginBottom: "4px" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8px", color: "#334155" }}>
                  <span>0.1×</span><span>5×</span>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
              <div style={{
                padding: "12px", textAlign: "center",
                background: `${ilSev.color}0c`, border: `1px solid ${ilSev.color}25`, borderRadius: "9px",
              }}>
                <div style={{ fontSize: "24px", fontWeight: 800, color: ilSev.color, fontFamily: "monospace" }}>
                  {displayIL.il.toFixed(2)}%
                </div>
                <div style={{ fontSize: "8px", color: ilSev.color, marginTop: "2px", letterSpacing: "1px" }}>
                  {ilSev.label.toUpperCase()}{displayIL.simulated ? " (simulado)" : ""}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <MetricBox label="BREAKEVEN APY" value={`≥${ilBreakeven.toFixed(1)}%`}
                  color={ilCovered ? "#22c55e" : "#ef4444"} sub={`APY atual: ${apy.toFixed(1)}%`} />
                <MetricBox label="IL COBERTO?" value={ilCovered ? "✅ Sim" : "❌ Não"}
                  color={ilCovered ? "#22c55e" : "#ef4444"} />
              </div>
            </div>
            <ILTable />
          </div>

          {/* Fees */}
          <div>
            <SectionHeader color="#22c55e">💰 Análise de Fees</SectionHeader>

            {feeResult.warning && <WarningBanner text={feeResult.warning} />}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
              <MetricBox label="FEE TIER" value={`${(feeTierBps / 10000).toFixed(2)}%`} color="#a5b4fc" sub="por swap" />
              {feeResult.feeAPR != null
                ? <MetricBox label="FEE APR" value={`${feeResult.feeAPR.toFixed(1)}%`}
                    color={feeResult.feeAPR > 20 ? "#22c55e" : feeResult.feeAPR > 5 ? "#f59e0b" : "#ef4444"}
                    sub={feeResult.dataSource === "apy_fallback" ? "via APY (est.)" : "vol × fee / TVL"} />
                : <NA label="FEE APR" reason="sem volume/TVL" />
              }
              {feeResult.dailyPoolFees != null
                ? <MetricBox label="FEES POOL/DIA" value={usd(feeResult.dailyPoolFees)}
                    color="#3b82f6" sub={feeResult.dataSource === "volume" ? "vol24h × feeTier" : "TVL × APY/365"} />
                : <NA label="FEES POOL/DIA" reason="sem dados" />
              }
              {feeResult.volTvlRatio != null
                ? <MetricBox label="EFICIÊNCIA vol/TVL" value={`${feeResult.volTvlRatio.toFixed(1)}%`}
                    color={feeResult.volTvlRatio > 10 ? "#22c55e" : feeResult.volTvlRatio > 1 ? "#f59e0b" : "#ef4444"} />
                : <NA label="EFICIÊNCIA vol/TVL" reason="sem volume" />
              }
            </div>

            {/* User position estimate */}
            {parseFloat(userPos) > 0 && (
              <div style={{ padding: "10px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: "8px" }}>
                <div style={{ fontSize: "9px", color: "#22c55e", fontFamily: "monospace", letterSpacing: "1px", marginBottom: "6px" }}>
                  💼 SUA POSIÇÃO ({usd(parseFloat(userPos), 0)})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                  {[
                    { label: "Fees/dia",   value: feeResult.userDailyFees   != null ? usd(feeResult.userDailyFees,   feeResult.userDailyFees < 0.001 ? 6 : 4) : "—" },
                    { label: "Fees/mês",   value: feeResult.userMonthlyFees  != null ? usd(feeResult.userMonthlyFees, 2) : "—" },
                    { label: "Share pool", value: formatShare(feeResult.positionShare) },
                  ].map(m => (
                    <div key={m.label} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: m.value !== "—" ? "#22c55e" : "#334155", fontFamily: "monospace" }}>{m.value}</div>
                      <div style={{ fontSize: "8px", color: "#334155" }}>{m.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "8px", color: "#2d3748", marginTop: "6px", lineHeight: 1.5 }}>
                  ⚠ Proporcional ao TVL — não inclui concentração de tick.
                  {feeResult.dataSource === "apy_fallback" && " Inclui token rewards."}
                </div>
              </div>
            )}
          </div>
        </div>

        <Divider />

        {/* S4: Decision Engine */}
        <div>
          <SectionHeader color={decision.color}>{decision.icon} DECISÃO — {decision.action}</SectionHeader>
          <div style={{
            padding: "14px",
            background: `${decision.color}06`, border: `1px solid ${decision.color}22`,
            borderRadius: "10px",
          }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ fontSize: "26px", flexShrink: 0 }}>{decision.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: decision.color }}>{decision.title}</div>
                  <span style={{
                    padding: "1px 6px", borderRadius: "4px", fontSize: "8px",
                    background: `${decision.color}15`, color: decision.color,
                    fontFamily: "monospace", letterSpacing: "1px",
                  }}>
                    {decision.confidence === "high" ? "ALTA" : decision.confidence === "medium" ? "MÉDIA" : "BAIXA"} CONFIANÇA
                  </span>
                </div>
                <div style={{ fontSize: "10px", color: "#64748b", lineHeight: 1.7 }}>{decision.reason}</div>
                <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "5px", lineHeight: 1.6, fontStyle: "italic" }}>
                  → {decision.nextStep}
                </div>
              </div>
            </div>
            {/* Data completeness checklist */}
            {decision.confidence !== "high" && (
              <div style={{ marginTop: "10px", padding: "8px 10px", background: "rgba(0,0,0,0.2)", borderRadius: "6px", fontSize: "9px", color: "#475569", lineHeight: 1.7 }}>
                📋 Para análise de alta confiança, informe:{" "}
                {!entryForEngine && "• Preço de entrada "}
                {!rangeStatus && "• Range (min / max) "}
                {!analysis.vol24h && "• Volume aguardado do pool "}
              </div>
            )}
          </div>
        </div>

        <Divider />

        {/* S5: AI Advisor */}
        <div ref={aiRef}>
          <SectionHeader color="#a5b4fc">🤖 AI Advisor</SectionHeader>

          {/* Static summary — always visible, no API call needed */}
          <div style={{
            padding: "12px 14px", marginBottom: "10px",
            background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: "9px",
          }}>
            <div style={{ fontSize: "8px", color: "#334155", fontFamily: "monospace", letterSpacing: "1px", marginBottom: "6px" }}>
              RESUMO AUTOMÁTICO
            </div>
            <div style={{ fontSize: "10px", color: "#94a3b8", lineHeight: 1.8 }}>
              {staticSummary}
            </div>
          </div>

          {!aiAsked ? (
            <button onClick={fetchAI} style={{
              width: "100%", padding: "11px",
              background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: "9px", color: "#a5b4fc", fontSize: "11px",
              cursor: "pointer", fontFamily: "monospace", letterSpacing: "1px",
            }}>
              🤖 Gerar análise detalhada com IA →
            </button>
          ) : (
            <div style={{
              padding: "14px", background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(99,102,241,0.2)", borderRadius: "10px", minHeight: "60px",
            }}>
              {aiLoading ? (
                <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "#475569", fontSize: "11px" }}>
                  <Spin size={14} /> Analisando dados...
                </div>
              ) : (
                <>
                  <div style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
                    {aiText.replace(/\*\*(.*?)\*\*/g, "$1")}
                  </div>
                  <button onClick={fetchAI} style={{
                    marginTop: "10px", padding: "4px 10px", borderRadius: "5px",
                    fontSize: "9px", background: "transparent", border: "1px solid rgba(99,102,241,0.2)",
                    color: "#6366f1", cursor: "pointer", fontFamily: "monospace",
                  }}>↻ atualizar</button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div style={{ fontSize: "8px", color: "#1e2d3d", lineHeight: 1.6, textAlign: "center", paddingTop: "4px" }}>
          ⚠ Análise educacional. IL = (2√r/(1+r)−1)×100 onde r = preço atual / entrada.
          Fees = vol24h × feeTier / TVL. Share = posição / TVL. Não é conselho financeiro. DYOR.
        </div>
      </div>
    </div>
  );
}