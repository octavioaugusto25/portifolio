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
  formatUSD,
  resolveEntryPrice,
  detectPositionType,
} from "../analysisEngine";

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────

const usd = (n, d = 2) => (n == null || !isFinite(n)) ? "—" : `$${fmt(n, d)}`;
const pct = (n, d = 1) => (n == null || !isFinite(n)) ? "—" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(d)}%`;
const sign = (n) => n == null ? "—" : n >= 0 ? `+${formatUSD(n)}` : `-${formatUSD(Math.abs(n))}`;

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

const MetricBox = ({ label, value, sub, color = "#94a3b8", unavailable = false }) => (
  <div style={{
    padding: "10px 12px",
    background: "rgba(0,0,0,0.28)",
    borderRadius: "9px",
    border: `1px solid ${unavailable ? "rgba(255,255,255,0.04)" : color + "18"}`,
    opacity: unavailable ? 0.45 : 1,
  }}>
    <div style={{ fontSize: "14px", fontWeight: 700, color: unavailable ? "#334155" : color, fontFamily: "monospace", lineHeight: 1.1 }}>
      {value}
    </div>
    <div style={{ fontSize: "8px", color: "#475569", marginTop: "3px", letterSpacing: "1px", fontFamily: "monospace" }}>
      {label}
    </div>
    {sub && (
      <div style={{ fontSize: "9px", color: unavailable ? "#1e2d3d" : "#64748b", marginTop: "2px", lineHeight: 1.4 }}>{sub}</div>
    )}
  </div>
);

const NA = ({ label, reason }) => (
  <MetricBox label={label} value="Indisponível" sub={reason} unavailable />
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

const WarningBanner = ({ text, level = "warn" }) => {
  const colors = {
    warn:  { bg: "rgba(245,158,11,0.06)",  border: "rgba(245,158,11,0.2)",  text: "#f59e0b" },
    error: { bg: "rgba(239,68,68,0.07)",   border: "rgba(239,68,68,0.25)",  text: "#ef4444" },
    info:  { bg: "rgba(99,102,241,0.06)",  border: "rgba(99,102,241,0.2)",  text: "#a5b4fc" },
  }[level] || {};
  return (
    <div style={{
      padding: "7px 10px", marginBottom: "8px",
      background: colors.bg, border: `1px solid ${colors.border}`,
      borderRadius: "7px", fontSize: "9px", color: colors.text, lineHeight: 1.5,
    }}>
      {level === "error" ? "🚨" : level === "info" ? "ℹ" : "⚠"} {text}
    </div>
  );
};

const inputStyle = {
  width: "100%", padding: "5px 7px",
  background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "6px", color: "#f1f5f9", fontFamily: "monospace", fontSize: "11px",
};

const InputLabel = ({ children, hint }) => (
  <div style={{ fontSize: "7px", color: "#334155", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "3px", display: "flex", justifyContent: "space-between" }}>
    <span>{children}</span>
    {hint && <span style={{ color: "#1e2d3d", fontWeight: 400 }}>{hint}</span>}
  </div>
);

// ─── NET RESULT BANNER ────────────────────────────────────────────────────────

const NetResultBanner = ({ netResult, feeResult }) => {
  if (netResult.netDailyUSD == null) return null;

  const isProfit = netResult.isProfit;
  const color    = isProfit ? "#22c55e" : "#ef4444";
  const bg       = isProfit ? "rgba(34,197,94,0.07)"  : "rgba(239,68,68,0.07)";
  const border   = isProfit ? "rgba(34,197,94,0.2)"   : "rgba(239,68,68,0.2)";

  return (
    <div style={{
      padding: "12px 16px",
      background: bg, border: `1px solid ${border}`,
      borderRadius: "10px", marginBottom: "4px",
    }}>
      <div style={{ display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "3px" }}>
            RESULTADO LÍQUIDO VS HOLD / DIA
            {!netResult.reliable && <span style={{ color: "#f59e0b", marginLeft: "6px" }}>⚠ ESTIMADO</span>}
          </div>
          <div style={{ fontSize: "22px", fontWeight: 800, color, fontFamily: "monospace" }}>
            {sign(netResult.netDailyUSD)}
          </div>
          {netResult.annualizedPct != null && (
            <div style={{ fontSize: "9px", color, fontFamily: "monospace" }}>
              {netResult.annualizedPct >= 0 ? "+" : ""}{netResult.annualizedPct.toFixed(1)}%/aa
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "14px", fontSize: "10px" }}>
          <div>
            <div style={{ color: "#334155", fontSize: "8px", fontFamily: "monospace" }}>FEES/DIA</div>
            <div style={{ color: "#22c55e", fontFamily: "monospace", fontWeight: 600 }}>
              {netResult.breakdown.feesDailyUSD != null ? formatUSD(netResult.breakdown.feesDailyUSD) : "—"}
            </div>
          </div>
          <div style={{ color: "#475569" }}>−</div>
          <div>
            <div style={{ color: "#334155", fontSize: "8px", fontFamily: "monospace" }}>IL DRIFT/DIA</div>
            <div style={{ color: "#ef4444", fontFamily: "monospace", fontWeight: 600 }}>
              {netResult.breakdown.ilDriftDailyUSD != null ? formatUSD(netResult.breakdown.ilDriftDailyUSD) : "—"}
            </div>
          </div>
        </div>
        <div style={{ fontSize: "9px", color: "#2d3748", lineHeight: 1.6, marginLeft: "auto", maxWidth: "160px" }}>
          {isProfit
            ? "LP supera hold hoje. Manter enquanto fees > IL drift."
            : "LP perde vs hold hoje. Avaliar saída ou migração."}
          {feeResult.dataSource === "apy_fallback" && (
            <div style={{ color: "#f59e0b", marginTop: "2px" }}>Via APY — inclui rewards. Pode superestimar.</div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── RANGE GAUGE ─────────────────────────────────────────────────────────────

const RangeGauge = ({ currentPrice, range, suggestedRange, entryPrice }) => {
  if (!range || !currentPrice) return null;
  const { min, max } = range;
  if (min >= max) return null;

  const span = max - min;
  const pos  = (v) => Math.max(0, Math.min(100, ((v - min) / span) * 100));
  const inRange = currentPrice >= min && currentPrice <= max;

  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ position: "relative", height: "24px", background: "rgba(0,0,0,0.3)", borderRadius: "12px", margin: "0 8px", overflow: "visible" }}>
        {/* Suggested range overlay (only when user range is set) */}
        {suggestedRange?.lower && suggestedRange?.upper && range.source === "user" && (
          <div style={{
            position: "absolute", top: "4px", bottom: "4px",
            left: `${Math.max(0, pos(suggestedRange.lower))}%`,
            width: `${Math.max(0, Math.min(100, pos(suggestedRange.upper)) - Math.max(0, pos(suggestedRange.lower)))}%`,
            background: "rgba(99,102,241,0.15)", borderRadius: "6px",
            border: "1px dashed rgba(99,102,241,0.3)", minWidth: "1px",
          }} title="Range sugerido pela volatilidade" />
        )}
        <div style={{
          position: "absolute", inset: 0,
          background: inRange ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.05)",
          borderRadius: "12px",
        }} />
        {/* Entry price marker */}
        {entryPrice && entryPrice >= min && entryPrice <= max && (
          <div style={{
            position: "absolute", top: "-4px", bottom: "-4px", width: "2px",
            background: "#f59e0b", left: `${pos(entryPrice)}%`, borderRadius: "1px",
          }} title={`Entrada LP: ${usd(entryPrice)}`} />
        )}
        {/* Current price dot */}
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
          📐 Range automático via volatilidade — defina manualmente para análise precisa
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

  const posType = detectPositionType(pool);
  const canonicalEntry = resolveEntryPrice(pool);
  const marketDataConfirmed = pool.marketDataConfirmed !== false;

  // User-editable state
  const [userEntry,  setUserEntry]  = useState(canonicalEntry != null ? String(canonicalEntry) : "");
  const [userMin,    setUserMin]    = useState(String(pool.rangeMin  || ""));
  const [userMax,    setUserMax]    = useState(String(pool.rangeMax  || ""));
  const [userPos,    setUserPos]    = useState(String(pool.valueUSD  || ""));
  const [feeTierBps, setFeeTierBps] = useState(Number(pool.feeTier)  || 3000);
  const [ilSimRatio, setIlSimRatio] = useState(2);

  // AI state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText,    setAiText]    = useState("");
  const [aiAsked,   setAiAsked]   = useState(false);
  const aiRef = useRef(null);

  // Pool source data
  const src   = marketDataConfirmed ? (pool.matchedPool || pool) : pool;
  const sym   = (pool.symbol  || src.symbol  || "").toUpperCase().replace(/_/g, "/");
  const proj  = src.project   || pool.protocol || "—";
  const chain = src.chain     || pool.chain    || "—";
  const rawApy = marketDataConfirmed ? Number(src.apy || pool.apy || 0) : 0;
  const apy   = rawApy > 0 ? rawApy : null;
  const tvl   = marketDataConfirmed ? (Number(src.tvlUsd || pool.tvlUsd || 0) || null) : null;
  const score = Number(src._score || pool._score || 0);
  const liq   = getLiqLabel(src._liqScore || pool._liqScore || 0);
  const risk  = getRisk(score);
  const pair  = getPair(sym);
  const strat = getStrategy(src.symbol ? src : pool);

  // Current price from live prices
  const tokens     = extractTokens(sym);
  const volTokens  = tokens.filter(t => !isStable(t) && VOLATILITY_COIN_MAP[t]);
  const baseToken  = volTokens[0] || null;
  const priceMap   = { ETH: prices?.ethereum?.usd, BTC: prices?.bitcoin?.usd, SOL: prices?.solana?.usd };
  const currentPrice = baseToken ? (priceMap[baseToken] ?? null) : null;

  // Resolve vol — check both sym-key and coinId-key
  const resolveVol = (key) => {
    const v = volData[key];
    if (!v) return null;
    return typeof v === "number" ? v : (v?.annualVol ?? null);
  };
  const annualVol = volTokens.length > 0
    ? (volTokens
        .map(t => {
          const id = VOLATILITY_COIN_MAP[t];
          return resolveVol(id) ?? resolveVol(t) ?? resolveVol(t.toLowerCase()) ?? null;
        })
        .filter(Boolean)
        .reduce((s, v, _, arr) => s + v / arr.length, 0) || null)
    : null;
  const volLabel = getVolLabel(annualVol);

  // Suggested range
  const suggestedRange = (currentPrice && annualVol)
    ? suggestLPRange(currentPrice, annualVol, 30, 1.5)
    : null;

  // Build position with user overrides
  const positionForEngine = {
    ...pool,
    avgCostUSD:  parseFloat(userEntry) || null,
    entryPrice:  parseFloat(userEntry) || null,
    rangeMin:    parseFloat(userMin)   || null,
    rangeMax:    parseFloat(userMax)   || null,
    valueUSD:    parseFloat(userPos)   || pool.valueUSD || 0,
    feeTier:     feeTierBps,
  };

  // Run full analysis
  const analysis = runPositionAnalysis({
    position:     positionForEngine,
    matchedPool:  marketDataConfirmed ? (pool.matchedPool || null) : null,
    currentPrice,
    annualVol,
    suggestedRange,
    marketDataConfirmed,
  });

  const {
    ilResult, range, rangeStatus, feeResult, netResult, decision, staticSummary,
    dailyILDrift,
  } = analysis;

  const entryForEngine = analysis.entryPrice;

  // Quality score (composite)
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
  const ilSev       = ilSeverity(displayIL.ilAbs);
  const ilBreakeven = displayIL.ilAbs;
  const ilCovered   = apy != null ? apy >= ilBreakeven : null;

  // AI prompt
  const buildPrompt = useCallback(() => {
    const lines = [
      `Pool: ${sym} | ${proj} | ${chain} | Tipo: ${posType === "lp" ? "LP" : "Spot"}`,
      `Score: ${qualityScore}/100 | APY: ${apy != null ? `${apy.toFixed(1)}%` : "N/A"}`,
      `TVL: ${tvl ? fmtK(tvl) : "N/A"} | Vol 24h: ${analysis.vol24h ? fmtK(analysis.vol24h) : "N/A"}`,
      posType === "lp" && ilResult
        ? `IL real: ${ilResult.il.toFixed(2)}% (ratio ${ilResult.ratio.toFixed(3)}×, ${ilSeverity(ilResult.ilAbs).label}) | Breakeven APY: ${ilResult.ilAbs.toFixed(1)}%`
        : posType === "lp" ? "IL: preço de entrada LP não informado"
        : "Posição spot — sem IL",
      rangeStatus
        ? `Range: ${rangeStatus.inRange ? "IN RANGE" : `OUT OF RANGE — ${rangeStatus.distancePct.toFixed(1)}% além do limite ${rangeStatus.nearestBoundary === "min" ? "inferior" : "superior"}`} (${rangeStatus.source})`
        : "Range: não definido",
      feeResult.feeAPR != null
        ? `Fee APR: ${feeResult.feeAPR.toFixed(1)}% (${feeResult.dataSource === "volume" ? "via volume real" : "estimado via APY — inclui rewards"})`
        : "Fee APR: sem dados confiáveis",
      feeResult.userDailyFees != null
        ? `Fees/dia usuário: ${formatUSD(feeResult.userDailyFees)} | Share pool: ${formatShare(feeResult.positionShare)}`
        : "",
      netResult.netDailyUSD != null && feeResult.dataSource === "volume"
        ? `Resultado líquido vs hold: ${netResult.netDailyUSD >= 0 ? "+" : ""}${formatUSD(netResult.netDailyUSD)}/dia (${netResult.annualizedPct?.toFixed(1) ?? "?"}%/aa)`
        : "",
      annualVol ? `Vol histórica ${baseToken}: ${annualVol.toFixed(0)}%/aa` : "",
      !marketDataConfirmed ? "Market data: posição identificada por tx/NFT, sem TVL/APY/volume confirmados para esse pool v4." : "",
      `Decisão: ${decision.action} — ${decision.reason}`,
    ].filter(Boolean).join("\n");

    return `Você é um advisor DeFi sênior, quantitativo e direto. Analise e responda em PT-BR (máx 180 palavras).

REGRAS:
- Seja decisivo. Não diga "considere" ou "pode ser".
- Use os números exatos fornecidos.
- Se fees não cobrem IL: diga explicitamente.
- Termine com UMA ação clara: MANTER / SAIR / REBALANCEAR + justificativa em 1 frase.

Estrutura (4 parágrafos curtos):
1. Estado atual (2 frases, números)
2. IL vs Fees: compensando?
3. Range: posição eficiente?
4. Decisão final + próximo passo específico

Dados:
${lines}`;
  }, [sym, proj, chain, posType, qualityScore, apy, tvl, analysis.vol24h, ilResult, rangeStatus, feeResult, netResult, annualVol, decision, baseToken, marketDataConfirmed]);

  const fetchAI = useCallback(async () => {
    if (!fetchExternal || aiLoading) return;
    setAiLoading(true);
    setAiAsked(true);
    setAiText("");
    try {
      const r = await fetchExternal("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          max_tokens: 600,
          temperature: 0.3,
          messages: [{ role: "system", content: "DeFi quantitative advisor. Be direct and decisive. Use exact numbers. Never say 'consider' and give clear actions. Respond in Brazilian Portuguese (pt-BR)." }, { role: "user", content: buildPrompt() }],
        }),
      });
      const d = await r.json();
      setAiText(d.choices?.[0]?.message?.content || (d.error?.message ? `⚠ ${d.error.message}` : "Sem resposta do modelo."));
    } catch {
      setAiText("⚠ Erro de conexão. O resumo automático acima contém a análise completa.");
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
            <div style={{ fontSize: "9px", color: "#475569", marginTop: "2px" }}>
              {proj} · {chain}
              <span style={{ marginLeft: "8px", padding: "1px 5px", background: posType === "lp" ? "rgba(99,102,241,0.15)" : "rgba(14,165,233,0.15)", borderRadius: "4px", color: posType === "lp" ? "#a5b4fc" : "#7dd3fc", fontFamily: "monospace" }}>
                {posType === "lp" ? "💧 LP" : "💼 SPOT"}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
            <Badge color={risk.color} sm>{risk.icon} {risk.label}</Badge>
            <Badge color={strat.color} sm>{strat.icon} {strat.type}</Badge>
            <Badge color={pair.color} sm>{pair.icon} {pair.label}</Badge>
            {annualVol && <Badge color={volLabel.color} sm>📊 {annualVol.toFixed(0)}%/aa</Badge>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Score ring */}
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

        {/* NET RESULT — most important metric, shown first */}
        {posType === "lp" && <NetResultBanner netResult={netResult} feeResult={feeResult} />}
        {!marketDataConfirmed && (
          <WarningBanner
            text="Posição identificada pela tx/NFT. Entrada, par, fee tier e aporte estão corretos, mas TVL, volume e APY desse pool v4 ainda não foram confirmados. O painel abaixo usa só dados confiáveis."
            level="info"
          />
        )}

        {/* S1: Pool Metrics */}
        <div>
          <SectionHeader color="#3b82f6">📊 Dados do Pool</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
            {apy != null
              ? <MetricBox label="APY" value={`${apy.toFixed(1)}%`}
                  color={apy > 80 ? "#ef4444" : apy > 40 ? "#f59e0b" : "#22c55e"}
                  sub={feeResult.dataSource === "apy_fallback" ? "inclui rewards" : undefined} />
              : <NA label="APY" reason={marketDataConfirmed ? "indisponível" : "não confirmado para esta v4"} />
            }
            {tvl ? <MetricBox label="TVL" value={fmtK(tvl)} color="#3b82f6" /> : <NA label="TVL" reason="indisponível" />}
            {analysis.vol24h
              ? <MetricBox label="VOL 24H" value={fmtK(analysis.vol24h)} color={analysis.vol24h > 1e6 ? "#22c55e" : "#f59e0b"}
                  sub={feeResult.volTvlRatio != null ? `${feeResult.volTvlRatio.toFixed(1)}% vol/TVL` : undefined} />
              : <NA label="VOL 24H" reason={marketDataConfirmed ? "sem dados" : "não confirmado para esta v4"} />
            }
            <MetricBox label="LIQUIDEZ" value={liq.label} color={liq.color} />
          </div>
        </div>

        <Divider />

        {/* S2: Price & Range (LP only) */}
        {posType === "lp" && (
          <div>
            <SectionHeader color="#6366f1">📐 Preço LP & Range</SectionHeader>

            {/* Input grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "6px", marginBottom: "10px" }}>
              <div>
                {/* IMPORTANT: This is LP entry price, NOT wallet avg cost */}
                <InputLabel hint={posType === "lp" ? "preço na abertura do LP" : undefined}>
                  ENTRADA LP {baseToken ? `(${baseToken})` : ""}
                </InputLabel>
                <input
                  value={userEntry}
                  onChange={e => setUserEntry(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder={currentPrice ? `atual: ${usd(currentPrice, 0)}` : "ex: 2500"}
                  style={inputStyle}
                />
                {pool.avgCostUSD && pool.entryPrice &&
                  Math.abs(Number(pool.avgCostUSD) - Number(pool.entryPrice)) > 0.01 && (
                  <div style={{ fontSize: "7px", color: "#f59e0b", marginTop: "2px" }}>
                    avgCost ({usd(pool.avgCostUSD, 0)}) ≠ entry ({usd(pool.entryPrice, 0)}) → usando avgCost
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
                <InputLabel hint="100–10000 bps">FEE TIER (bps)</InputLabel>
                <input
                  value={feeTierBps}
                  onChange={e => setFeeTierBps(Number(e.target.value.replace(/[^0-9]/g, "")) || 3000)}
                  placeholder="3000"
                  style={inputStyle}
                />
                <div style={{ fontSize: "7px", color: "#334155", marginTop: "2px" }}>
                  {(feeTierBps / 10000).toFixed(2)}% por swap
                </div>
              </div>
            </div>

            <RangeGauge currentPrice={currentPrice} range={range} suggestedRange={suggestedRange} entryPrice={entryForEngine} />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
              {currentPrice
                ? <MetricBox label={`PREÇO ATUAL ${baseToken || ""}`} value={usd(currentPrice)} color="#f1f5f9" />
                : <NA label="PREÇO ATUAL" reason="token não mapeado" />
              }
              {entryForEngine
                ? <MetricBox label="ENTRADA LP" value={usd(entryForEngine)}
                    color="#f59e0b"
                    sub={currentPrice ? pct(((currentPrice - entryForEngine) / entryForEngine) * 100) + " vs entrada" : undefined} />
                : <MetricBox label="ENTRADA LP" value="—" sub="informe o preço de abertura do LP" unavailable />
              }
              {rangeStatus
                ? <MetricBox
                    label={rangeStatus.inRange ? "IN RANGE ✓" : "OUT OF RANGE ✗"}
                    value={rangeStatus.inRange ? "✅ Ativo" : `${rangeStatus.distancePct.toFixed(1)}% fora`}
                    color={rangeStatus.inRange ? "#22c55e" : "#ef4444"}
                    sub={rangeStatus.source === "suggested" ? "range sugerido por vol" : `range definido · ${rangeStatus.rangeWidthPct?.toFixed(0)}% largura`}
                  />
                : <MetricBox label="STATUS RANGE" value="—" sub="sem range definido" unavailable />
              }
              {annualVol
                ? <MetricBox label="VOL HISTÓRICA" value={`${annualVol.toFixed(0)}%/aa`} color={volLabel.color} sub={volLabel.label} />
                : <NA label="VOL HISTÓRICA" reason="sem histórico" />
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
                <span style={{ fontSize: "9px", color: "#475569" }}>±{suggestedRange.rangePct.toFixed(1)}% · {suggestedRange.confidence}% confiança histórica</span>
              </div>
            )}
          </div>
        )}

        {/* Spot context — simpler */}
        {posType === "spot" && (
          <div>
            <SectionHeader color="#7dd3fc">💼 Contexto Spot</SectionHeader>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
              {currentPrice
                ? <MetricBox label={`PREÇO ATUAL ${baseToken || ""}`} value={usd(currentPrice)} color="#f1f5f9" />
                : <NA label="PREÇO ATUAL" reason="token não mapeado" />
              }
              {canonicalEntry
                ? <MetricBox label="CUSTO MÉDIO" value={usd(canonicalEntry)} color="#f59e0b"
                    sub={currentPrice ? pct(((currentPrice - canonicalEntry) / canonicalEntry) * 100) + " vs custo" : undefined} />
                : <MetricBox label="CUSTO MÉDIO" value="—" sub="informe via + POSIÇÃO" unavailable />
              }
              <MetricBox label="POSIÇÃO" value={usd(parseFloat(userPos) || pool.valueUSD || 0, 0)} color="#3b82f6" />
            </div>
          </div>
        )}

        <Divider />

        {/* S3: IL + Fees (LP only) */}
        {posType === "lp" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>

            {/* IL */}
            <div>
              <SectionHeader color="#ef4444">📉 Impermanent Loss</SectionHeader>

              {!entryForEngine && (
                <WarningBanner
                  text="Informe o PREÇO DE ENTRADA LP (preço do ativo volátil quando você abriu o LP) para calcular IL real. O simulador abaixo usa ratio hipotético."
                  level="warn"
                />
              )}

              {ilResult ? (
                <div style={{ marginBottom: "8px", fontSize: "9px", color: "#64748b", fontFamily: "monospace" }}>
                  RATIO {baseToken}: {usd(currentPrice, 0)} / {usd(entryForEngine, 0)} = <strong style={{ color: "#f1f5f9" }}>{ilResult.ratio.toFixed(3)}×</strong>
                </div>
              ) : (
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ fontSize: "8px", color: "#334155", fontFamily: "monospace", marginBottom: "4px" }}>
                    SIMULAÇÃO — ratio hipotético: {ilSimRatio}×
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
                    {ilSev.label.toUpperCase()}{displayIL.simulated ? " (simulado)" : " (real)"}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <MetricBox
                    label="BREAKEVEN APY MÍNIMO"
                    value={`≥ ${ilBreakeven.toFixed(1)}%`}
                    color={ilCovered == null ? "#94a3b8" : ilCovered ? "#22c55e" : "#ef4444"}
                    sub={apy != null ? `APY pool atual: ${apy.toFixed(1)}%` : "sem APY confiável"}
                  />
                  <MetricBox
                    label="IL COBERTO PELO APY?"
                    value={ilCovered == null ? "—" : ilCovered ? "✅ Sim" : "❌ Não"}
                    color={ilCovered == null ? "#94a3b8" : ilCovered ? "#22c55e" : "#ef4444"}
                    sub={apy != null ? "APY inclui rewards" : "aguardando market data real"}
                  />
                </div>
              </div>

              {/* Daily IL drift */}
              {dailyILDrift != null && (
                <div style={{ padding: "8px 10px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "7px", marginBottom: "8px" }}>
                  <div style={{ fontSize: "8px", color: "#334155", fontFamily: "monospace", marginBottom: "3px" }}>IL DRIFT ESPERADO / DIA (em range)</div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#ef4444", fontFamily: "monospace" }}>
                    −{formatUSD(dailyILDrift)}
                  </div>
                  <div style={{ fontSize: "8px", color: "#475569", marginTop: "2px", lineHeight: 1.4 }}>
                    Custo implícito de fornecer liquidez hoje (baseado em vol {annualVol?.toFixed(0)}%/aa)
                  </div>
                </div>
              )}

              <ILTable />
            </div>

            {/* Fees */}
            <div>
              <SectionHeader color="#22c55e">💰 Análise de Fees</SectionHeader>

              {/* Data source warning */}
              {feeResult.dataSource === "unavailable" && (
                <WarningBanner text={feeResult.warning} level="error" />
              )}
              {feeResult.dataSource === "apy_fallback" && (
                <WarningBanner text={feeResult.warning} level="warn" />
              )}
              {feeResult.dataSource === "volume" && (
                <div style={{ padding: "4px 8px", marginBottom: "8px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: "5px", fontSize: "8px", color: "#22c55e", fontFamily: "monospace" }}>
                  ✓ Volume real disponível — cálculo preciso
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                <MetricBox label="FEE TIER" value={`${(feeTierBps / 10000).toFixed(2)}%`} color="#a5b4fc" sub="por swap" />
                {feeResult.feeAPR != null
                  ? <MetricBox
                      label={feeResult.dataSource === "volume" ? "FEE APR (REAL)" : "FEE APR (ESTIMADO)"}
                      value={`${feeResult.feeAPR.toFixed(1)}%`}
                      color={feeResult.feeAPR > 20 ? "#22c55e" : feeResult.feeAPR > 5 ? "#f59e0b" : "#ef4444"}
                      sub={feeResult.dataSource === "volume" ? "vol24h × feeTier / TVL" : "⚠ via APY — inclui rewards"}
                    />
                  : <NA label="FEE APR" reason="sem volume ou TVL" />
                }
                {feeResult.dailyPoolFees != null
                  ? <MetricBox
                      label={feeResult.dataSource === "volume" ? "FEES POOL/DIA (REAL)" : "FEES POOL/DIA (ESTIMADO)"}
                      value={formatUSD(feeResult.dailyPoolFees)}
                      color="#3b82f6"
                      sub={feeResult.dataSource === "volume" ? "vol24h × feeTier" : "⚠ TVL × APY/365"}
                    />
                  : <NA label="FEES POOL/DIA" reason="sem dados" />
                }
                {feeResult.volTvlRatio != null
                  ? <MetricBox
                      label="EFICIÊNCIA VOL/TVL"
                      value={`${feeResult.volTvlRatio.toFixed(1)}%`}
                      color={feeResult.volTvlRatio > 10 ? "#22c55e" : feeResult.volTvlRatio > 1 ? "#f59e0b" : "#ef4444"}
                      sub="volume diário / TVL"
                    />
                  : <NA label="EFICIÊNCIA VOL/TVL" reason="sem volume real" />
                }
              </div>

              {/* User position fees */}
              {parseFloat(userPos) > 0 && (
                <div style={{ padding: "10px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "9px", color: "#22c55e", fontFamily: "monospace", letterSpacing: "1px", marginBottom: "6px" }}>
                    💼 SUA POSIÇÃO ({usd(parseFloat(userPos), 0)})
                    {!feeResult.reliable && <span style={{ color: "#f59e0b", marginLeft: "6px" }}>⚠ ESTIMADO</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                    {[
                      { label: "Fees/dia",   value: feeResult.userDailyFees   != null ? formatUSD(feeResult.userDailyFees) : "—" },
                      { label: "Fees/mês",   value: feeResult.userMonthlyFees  != null ? formatUSD(feeResult.userMonthlyFees) : "—" },
                      { label: "Share pool", value: formatShare(feeResult.positionShare) },
                    ].map(m => (
                      <div key={m.label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: m.value !== "—" ? "#22c55e" : "#334155", fontFamily: "monospace" }}>{m.value}</div>
                        <div style={{ fontSize: "8px", color: "#334155" }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: "8px", color: "#2d3748", marginTop: "6px", lineHeight: 1.5 }}>
                    ⚠ Proporcional ao TVL total. Não inclui concentração de tick (v3 pode ser mais eficiente).
                    {feeResult.dataSource === "apy_fallback" && " Inclui rewards de token."}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <Divider />

        {/* S4: Decision Engine */}
        <div>
          <SectionHeader color={decision.color}>{decision.icon} DECISÃO — {decision.action}</SectionHeader>
          <div style={{
            padding: "14px",
            background: `${decision.color}06`, border: `1px solid ${decision.color}22`,
            borderRadius: "10px",
          }}>
            {decision.urgency === "critical" && (
              <WarningBanner text="URGENTE: Esta posição requer ação imediata." level="error" />
            )}
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
                    CONFIANÇA {decision.confidence === "high" ? "ALTA" : decision.confidence === "medium" ? "MÉDIA" : "BAIXA"}
                  </span>
                </div>
                <div style={{ fontSize: "10px", color: "#94a3b8", lineHeight: 1.7 }}>{decision.reason}</div>
                <div style={{ fontSize: "10px", color: "#64748b", marginTop: "5px", lineHeight: 1.6, fontStyle: "italic" }}>
                  → {decision.nextStep}
                </div>
              </div>
            </div>

            {/* What's missing for high confidence */}
            {decision.confidence !== "high" && (
              <div style={{ marginTop: "10px", padding: "8px 10px", background: "rgba(0,0,0,0.2)", borderRadius: "6px", fontSize: "9px", color: "#475569", lineHeight: 1.7 }}>
                📋 Para análise de alta confiança, adicione:{" "}
                {!entryForEngine && posType === "lp" && "• Preço de entrada LP "}
                {!rangeStatus && posType === "lp" && "• Range min/max "}
                {!marketDataConfirmed && "• TVL/APY/volume reais do pool v4 "}
                {marketDataConfirmed && !analysis.vol24h && "• Volume 24h (via DeFiLlama — pode demorar) "}
              </div>
            )}
          </div>
        </div>

        <Divider />

        {/* S5: AI Advisor */}
        <div ref={aiRef}>
          <SectionHeader color="#a5b4fc">🤖 AI Advisor</SectionHeader>

          {/* Static summary — always shown, no API call */}
          <div style={{
            padding: "12px 14px", marginBottom: "10px",
            background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: "9px",
          }}>
            <div style={{ fontSize: "8px", color: "#334155", fontFamily: "monospace", letterSpacing: "1px", marginBottom: "6px" }}>
              RESUMO AUTOMÁTICO (sem IA)
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
                  }}>↻ atualizar análise</button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div style={{ fontSize: "8px", color: "#1e2d3d", lineHeight: 1.6, textAlign: "center", paddingTop: "4px" }}>
          ⚠ Análise educacional. IL = (2√r/(1+r)−1)×100 onde r = preço atual / entrada LP.
          Fees volume = vol24h × feeTier. Fees APY = TVL × APY/365 (inclui rewards).
          IL drift diário ≈ posição × vol²/(8×365). Share = posição / TVL. Não é conselho financeiro. DYOR.
        </div>
      </div>
    </div>
  );
}
