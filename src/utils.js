import { AUDIT_PROXY, MEDIUM_PROTOCOLS, PROTOCOL_COIN_MAP, SAFE_PROTOCOLS, STABLES, VOLATILITY_COIN_MAP } from "./constants";

export const isStable = s => STABLES.some(x => s?.toUpperCase().includes(x));
export const isPairSS = sym => { const p = sym?.replace(/_/g, "-").split(/[-/]/) || []; return p.length >= 2 && p.every(x => isStable(x)); };
export const isPairSV = sym => { const p = sym?.replace(/_/g, "-").split(/[-/]/) || []; return p.length >= 2 && p.some(x => isStable(x)) && !isPairSS(sym); };

export function getAuditEntry(project) {
  const p = project?.toLowerCase() || "";
  for (const [k, v] of Object.entries(AUDIT_PROXY)) if (p.includes(k)) return v;
  return null;
}
export function getProtocolCoinId(project) {
  const p = project?.toLowerCase() || "";
  for (const [k, v] of Object.entries(PROTOCOL_COIN_MAP)) if (p.includes(k)) return v;
  return null;
}

export function calcHistoricalVolatility(pricesArr) {
  if (!pricesArr || pricesArr.length < 5) return null;
  const returns = pricesArr.slice(1).map((p, i) => Math.log(p / pricesArr[i]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  const annualVol = dailyVol * Math.sqrt(365) * 100;
  return { annualVol, dailyVol: dailyVol * 100, sampleSize: pricesArr.length };
}

export function suggestLPRange(currentPrice, annualVolPct, horizonDays = 30, sigma = 1.5) {
  if (!currentPrice || !annualVolPct) return null;
  const vol = annualVolPct / 100;
  const periodV = vol * Math.sqrt(horizonDays / 365);
  const lower = currentPrice * Math.exp(-sigma * periodV);
  const upper = currentPrice * Math.exp(sigma * periodV);
  const rangePct = (upper / lower - 1) * 100;
  const confidence = sigma === 1 ? 68 : sigma === 1.5 ? 86 : 95;
  return { lower, upper, rangePct, confidence, horizonDays };
}

export function getVolLabel(annualVol) {
  if (annualVol == null) return { label: "—", color: "#475569", tier: "unknown" };
  if (annualVol < 30) return { label: "BAIXA", color: "#22c55e", tier: "low" };
  if (annualVol < 70) return { label: "MÉDIA", color: "#f59e0b", tier: "medium" };
  if (annualVol < 120) return { label: "ALTA", color: "#f97316", tier: "high" };
  return { label: "EXTREMA", color: "#ef4444", tier: "extreme" };
}

export function extractTokens(sym) {
  const clean = sym?.toUpperCase().replace(/_/g, "-") || "";
  return clean.split(/[-/]/).filter(Boolean);
}

export function calcLiquidityScore(pool) {
  const vol1d = (pool.volumeUsd7d || 0) / 7;
  const tvl = pool.tvlUsd || 1;
  const ratio = vol1d / tvl;
  const txCount = pool._txCount || 0;
  let s = 0;
  if (vol1d > 50e6) s += 40; else if (vol1d > 10e6) s += 30; else if (vol1d > 1e6) s += 20; else if (vol1d > 100e3) s += 10; else if (vol1d > 5e3) s += 4;
  if (ratio > 2) s += 35; else if (ratio > 0.5) s += 25; else if (ratio > 0.1) s += 15; else if (ratio > 0.01) s += 7;
  if (txCount > 10000) s += 25; else if (txCount > 1000) s += 15; else if (txCount > 100) s += 7; else if (txCount > 0) s += 2;
  return Math.min(100, s);
}
export function getLiqLabel(score) {
  if (score >= 65) return { label: "ALTA", color: "#22c55e" };
  if (score >= 35) return { label: "MÉDIA", color: "#f59e0b" };
  if (score >= 10) return { label: "BAIXA", color: "#f97316" };
  return { label: "SEM DADOS", color: "#475569" };
}

export function calcScore(pool) {
  const sym = pool.symbol?.toUpperCase() || "";
  const proto = pool.project?.toLowerCase() || "";
  const apy = pool.apy || 0;
  const tvl = pool.tvlUsd || 0;
  const vol1d = (pool.volumeUsd7d || 0) / 7;
  const protocolScore = SAFE_PROTOCOLS.some(p => proto.includes(p)) ? 22 : MEDIUM_PROTOCOLS.some(p => proto.includes(p)) ? 12 : 2;
  let tvlScore = tvl > 100e6 ? 16 : tvl > 50e6 ? 14 : tvl > 10e6 ? 11 : tvl > 2e6 ? 7 : tvl > 500e3 ? 3 : 0;
  if (vol1d > tvl * 0.05 && tvl > 0) tvlScore = Math.min(18, tvlScore + 2);
  const pairScore = isPairSS(sym) ? 20 : isPairSV(sym) ? 12 : 4;
  const apyScore = apy > 200 ? 0 : apy > 100 ? 2 : apy > 60 ? 5 : apy > 30 ? 8 : apy >= 5 ? 13 : 9;
  const netScore = pool.chain === "Ethereum" ? 10 : ["Arbitrum", "Base", "Optimism"].includes(pool.chain) ? 8 : pool.chain === "Solana" ? 6 : 3;
  const audit = pool._auditEntry;
  const scScore = audit ? Math.max(1, Math.round(audit.score / 10) - (audit.hacks > 0 ? 3 : 0)) : SAFE_PROTOCOLS.some(p => proto.includes(p)) ? 8 : MEDIUM_PROTOCOLS.some(p => proto.includes(p)) ? 5 : 1;
  const liqBonus = (pool._liqScore || 0) > 60 ? 7 : (pool._liqScore || 0) > 30 ? 4 : (pool._liqScore || 0) > 10 ? 2 : 0;
  return calcWeightedRiskScore({
    protocolScore,
    tvlScore,
    pairScore,
    apyScore,
    netScore,
    scScore,
    liqBonus,
  });
}

export function calcWeightedRiskScore({
  protocolScore = 0,
  tvlScore = 0,
  pairScore = 0,
  apyScore = 0,
  netScore = 0,
  scScore = 0,
  liqBonus = 0,
}) {
  const normalizedProtocol = (protocolScore / 22) * 100;
  const normalizedTvl = (Math.min(18, tvlScore) / 18) * 100;
  const normalizedPair = (pairScore / 20) * 100;
  const normalizedApy = (apyScore / 13) * 100;
  const normalizedNetwork = (netScore / 10) * 100;
  const normalizedSc = (scScore / 10) * 100;
  const weighted =
    normalizedProtocol * 0.25 +
    normalizedTvl * 0.20 +
    normalizedPair * 0.20 +
    normalizedApy * 0.15 +
    normalizedNetwork * 0.10 +
    normalizedSc * 0.10;
  return Math.max(0, Math.min(100, Math.round(weighted + liqBonus * 0.35)));
}

export function getRisk(score) {
  if (score >= 75) return { label: "BAIXO RISCO", color: "#22c55e", bg: "rgba(34,197,94,0.09)", icon: "🟢" };
  if (score >= 55) return { label: "RISCO MÉDIO", color: "#f59e0b", bg: "rgba(245,158,11,0.09)", icon: "🟡" };
  if (score >= 35) return { label: "RISCO ALTO", color: "#f97316", bg: "rgba(249,115,22,0.09)", icon: "🟠" };
  return { label: "MUITO ARRISCADO", color: "#ef4444", bg: "rgba(239,68,68,0.09)", icon: "🔴" };
}
export function getPair(sym) {
  if (isPairSS(sym)) return { label: "Stable/Stable", color: "#22c55e", icon: "🔒", il: "Sem IL", ilRisk: "low" };
  if (isPairSV(sym)) return { label: "Stable/Volátil", color: "#f59e0b", icon: "⚡", il: "IL moderado", ilRisk: "medium" };
  return { label: "Volátil/Volátil", color: "#ef4444", icon: "🔥", il: "IL alto", ilRisk: "high" };
}
export function getIlRiskLevel(sym) {
  if (isPairSS(sym)) return "low";
  if (isPairSV(sym)) return "medium";
  return "high";
}
export function getStrategy(pool) {
  const sym = pool.symbol?.toUpperCase() || "", apy = pool.apy || 0;
  if (isPairSS(sym)) return { type: "Stable Yield", color: "#22c55e", icon: "🏦" };
  if (isPairSV(sym) && apy < 40) return { type: "Range Trading", color: "#3b82f6", icon: "📐" };
  if (apy >= 40) return { type: "High Yield Farming", color: "#f59e0b", icon: "🌾" };
  return { type: "Lending Loop", color: "#a78bfa", icon: "🔄" };
}
export function getMarketContext(prices) {
  if (!prices) return { mode: "UNKNOWN", color: "#64748b", icon: "❓", advice: "Aguardando dados..." };
  const avg = ((prices.bitcoin?.change24h || 0) + (prices.ethereum?.change24h || 0)) / 2;
  if (avg > 3) return { mode: "BULL 🐂", color: "#22c55e", icon: "📈", advice: "Alta — favoreça pools voláteis de protocolos top para capturar upside." };
  if (avg < -3) return { mode: "BEAR 🐻", color: "#ef4444", icon: "📉", advice: "Queda — priorize stable/stable e reduza exposição a voláteis." };
  if (avg > 1) return { mode: "BULLISH", color: "#86efac", icon: "↗", advice: "Leve alta — boa hora para pools stable/volátil auditadas." };
  if (avg < -1) return { mode: "BEARISH", color: "#fca5a5", icon: "↘", advice: "Leve baixa — monitore posições voláteis, considere hedge." };
  return { mode: "LATERAL", color: "#94a3b8", icon: "→", advice: "Lateral — ideal para stable yields e range trading." };
}
export function detectNarratives(pools, prices) {
  const narratives = [];
  const solAvg = pools.filter(p => p.chain === "Solana").reduce((a, b, _, ar) => a + b.apy / ar.length, 0);
  const baseAvg = pools.filter(p => p.chain === "Base").reduce((a, b, _, ar) => a + b.apy / ar.length, 0);
  if (solAvg > 20) narratives.push({ label: "Solana DeFi Hot", color: "#a78bfa", icon: "◎" });
  if (baseAvg > 15) narratives.push({ label: "Base Ecosystem", color: "#3b82f6", icon: "🔵" });
  if ((prices?.bitcoin?.change24h || 0) > 3) narratives.push({ label: "BTC Bull Run", color: "#f59e0b", icon: "₿" });
  if ((prices?.ethereum?.change24h || 0) > 4) narratives.push({ label: "ETH Breakout", color: "#6366f1", icon: "Ξ" });
  if (pools.filter(p => isPairSS(p.symbol)).length > 20) narratives.push({ label: "Stable Yields Rising", color: "#22c55e", icon: "🏦" });
  return narratives.slice(0, 5);
}
export function getFdvRating(ratio) {
  if (!ratio) return { label: "N/A", color: "#475569" };
  if (ratio < 1) return { label: "Subavaliado ↓", color: "#22c55e" };
  if (ratio < 5) return { label: "Justo ~", color: "#f59e0b" };
  if (ratio < 15) return { label: "Premium ↑", color: "#f97316" };
  return { label: "Especulativo 🔥", color: "#ef4444" };
}

export function calcFdvRevenueRatio(pool) {
  const fdv = pool?._fdv || 0;
  const volume24h = (pool?.volumeUsd7d || 0) / 7;
  const estimatedRevenue24h = volume24h * 0.003;
  const annualizedRevenue = estimatedRevenue24h * 365;
  if (!fdv || !annualizedRevenue) return null;
  return fdv / annualizedRevenue;
}

export function normalizePoolModel(pool) {
  const audit = pool?._auditEntry;
  const protocol = pool?.project || "";
  return {
    protocol,
    chain: pool?.chain || "",
    category: getStrategy(pool).type,
    tvl: pool?.tvlUsd || 0,
    volume_24h: (pool?.volumeUsd7d || 0) / 7,
    tx_count: pool?._txCount || 0,
    apy: pool?.apy || 0,
    fdv: pool?._fdv || 0,
    price: pool?.underlyingTokensPrice || 0,
    audit: Boolean(audit),
    audit_score: audit?.score || 0,
  };
}

export function buildPoolIntelligence(pool) {
  const ilRisk = getIlRiskLevel(pool?.symbol);
  const risk = getRisk(pool?._score || 0);
  const strategy = getStrategy(pool);
  const fdvRevenue = calcFdvRevenueRatio(pool);
  return {
    riskLabel: risk.label,
    strategy: strategy.type,
    ilRisk,
    fdvRevenueRatio: fdvRevenue,
  };
}

export function suggestRebuildStrategy(pool, volData = {}) {
  if (!pool) {
    return {
      title: "Pool não encontrada no ranking atual",
      action: "Mapeie manualmente o par/protocolo e refaça a posição com menor risco.",
      cadence: "Revisão imediata",
    };
  }
  const tokens = extractTokens(pool.symbol);
  const volTokens = tokens.filter(t => !isStable(t) && VOLATILITY_COIN_MAP[t]);
  const avgVol = volTokens.length
    ? volTokens
      .map(t => volData[VOLATILITY_COIN_MAP[t]]?.annualVol)
      .filter(Boolean)
      .reduce((a, b) => a + b, 0) / volTokens.length
    : null;
  const score = pool._score || 0;

  if (score < 55) {
    return {
      title: "Remontagem defensiva",
      action: "Reduzir exposição e migrar para pool score ≥ 65 (stable/stable ou stable/volátil).",
      cadence: "Revisão semanal",
    };
  }
  if (avgVol && avgVol > 100) {
    return {
      title: "Remontagem por alta volatilidade",
      action: "Reabrir com range mais amplo e menor capital por posição para evitar sair do range rápido.",
      cadence: "Revisão a cada 3–7 dias",
    };
  }
  if ((pool.apy || 0) < 12 && (pool._liqScore || 0) < 35) {
    return {
      title: "Remontagem por eficiência",
      action: "Pool com baixa eficiência de fees: considerar migração para pool de maior liquidez/volume.",
      cadence: "Revisão quinzenal",
    };
  }
  return {
    title: "Remontagem tática",
    action: "Manter o par e rebalancear range com aporte parcial para reduzir custo médio.",
    cadence: "Revisão a cada 2–4 semanas",
  };
}

export function calcDiversificationScore(positions) {
  const total = positions.reduce((a, b) => a + (b.valueUSD || 0), 0);
  if (!total || positions.length === 0) return 0;
  const weights = positions.map(p => (p.valueUSD || 0) / total);
  const hhi = weights.reduce((a, w) => a + w * w, 0);
  return Math.round((1 - hhi) * 100);
}
export function calcRiskConcentration(positions) {
  const total = positions.reduce((a, b) => a + (b.valueUSD || 0), 0);
  if (!total) return { low: 0, medium: 0, high: 0, extreme: 0 };
  return positions.reduce((acc, p) => {
    const score = p._score || 0;
    const pct = (p.valueUSD || 0) / total * 100;
    if (score >= 75) acc.low += pct;
    else if (score >= 55) acc.medium += pct;
    else if (score >= 35) acc.high += pct;
    else acc.extreme += pct;
    return acc;
  }, { low: 0, medium: 0, high: 0, extreme: 0 });
}
export function calcChainConcentration(positions) {
  const total = positions.reduce((a, b) => a + (b.valueUSD || 0), 0);
  if (!total) return {};
  return positions.reduce((acc, p) => {
    acc[p.chain] = (acc[p.chain] || 0) + (p.valueUSD || 0) / total * 100;
    return acc;
  }, {});
}
export function calcPortfolioScore(positions) {
  const total = positions.reduce((a, b) => a + (b.valueUSD || 0), 0);
  if (!total) return 0;
  return Math.round(positions.reduce((a, p) => a + (p._score || 0) * (p.valueUSD || 0) / total, 0));
}

export const fmt = (n, d = 2) => n == null ? "—" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtK = n => !n ? "$0" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`;
export const calcIL = r => (2 * Math.sqrt(r) / (1 + r) - 1) * 100;
