import { useEffect, useState } from "react";
import { VOLATILITY_COIN_MAP, VOLATILITY_DEFILLAMA_MAP } from "../constants";
import { calcIL, fmt, getVolLabel, suggestLPRange } from "../utils";
import { Badge, Card, SecTitle, Spin } from "../components/primitives";

// CoinGecko ID → DeFiLlama coins key (for batch price fetch)
const CG_TO_LLAMA = {
  "ethereum":        "coingecko:ethereum",
  "bitcoin":         "coingecko:bitcoin",
  "solana":          "coingecko:solana",
  "binancecoin":     "coingecko:binancecoin",
  "arbitrum":        "coingecko:arbitrum",
  "optimism":        "coingecko:optimism",
  "avalanche-2":     "coingecko:avalanche-2",
  "matic-network":   "coingecko:matic-network",
  "uniswap":         "coingecko:uniswap",
  "aave":            "coingecko:aave",
  "curve-dao-token": "coingecko:curve-dao-token",
  "gmx":             "coingecko:gmx",
  "pendle":          "coingecko:pendle",
  "chainlink":       "coingecko:chainlink",
  "lido-dao":        "coingecko:lido-dao",
  "aerodrome-finance":"coingecko:aerodrome-finance",
};

// ─── VOLATILITY TAB ───────────────────────────────────────────────────────────
export function VolatilityTab({ volData, volLoading, prices, fetchExternal }) {
  const [ilRatio,      setIlRatio]      = useState(2);
  const [selectedTok,  setSelectedTok]  = useState("ETH");
  const [sigma,        setSigma]        = useState(1.5);
  const [horizonDays,  setHorizonDays]  = useState(30);
  const [customPrice,  setCustomPrice]  = useState("");

  // ── Preços auto-buscados para qualquer token do VOLATILITY_COIN_MAP ─────
  const [tokenPrices,  setTokenPrices]  = useState({});
  const [priceLoading, setPriceLoading] = useState(false);

  // Seed com os preços BTC/ETH/SOL que já temos do App
  useEffect(() => {
    setTokenPrices(prev => ({
      ...prev,
      ...(prices?.bitcoin?.usd  ? { bitcoin:   prices.bitcoin.usd  } : {}),
      ...(prices?.ethereum?.usd ? { ethereum:  prices.ethereum.usd } : {}),
      ...(prices?.solana?.usd   ? { solana:    prices.solana.usd   } : {}),
    }));
  }, [prices]);

  // Batch fetch all token prices via DeFiLlama /prices/current (no CORS, no rate-limit)
  // Runs once on mount; re-runs if fetchExternal changes.
  useEffect(() => {
    const coinIds = Object.values(VOLATILITY_COIN_MAP).filter(id => !id.startsWith("base:") && !id.startsWith("coingecko:"));
    // Build DeFiLlama keys
    const llamaKeys = coinIds.map(id => CG_TO_LLAMA[id]).filter(Boolean);
    // Also add on-chain tokens from VOLATILITY_DEFILLAMA_MAP that use chain:address
    const onChainKeys = Object.values(VOLATILITY_DEFILLAMA_MAP)
      .filter(k => !k.startsWith("coingecko:"))
      .map(k => k); // e.g. "base:0x..."

    const allKeys = [...new Set([...llamaKeys, ...onChainKeys])];
    if (!allKeys.length) return;

    const fetch_ = fetchExternal || ((url) => fetch(url));
    setPriceLoading(true);

    const url = `https://coins.llama.fi/prices/current/${allKeys.join(",")}`;
    fetch_(url)
      .then(r => r.json())
      .then(d => {
        const coins = d?.coins || {};
        const newPrices = {};
        for (const [llamaKey, data] of Object.entries(coins)) {
          const usd = data?.price;
          if (!usd) continue;
          // Map llamaKey back to coinGecko ID for lookup
          if (llamaKey.startsWith("coingecko:")) {
            const cgId = llamaKey.replace("coingecko:", "");
            newPrices[cgId] = usd;
          } else {
            // on-chain key — store as-is
            newPrices[llamaKey] = usd;
          }
        }
        setTokenPrices(prev => ({ ...prev, ...newPrices }));
      })
      .catch(() => {/* noop — individual fallback below */})
      .finally(() => setPriceLoading(false));
  }, [fetchExternal]);

  // Individual fallback: when user selects a token and price is still missing
  useEffect(() => {
    const coinId = VOLATILITY_COIN_MAP[selectedTok];
    if (!coinId) return;

    // Check if we already have the price (by coinId or llamaKey)
    const llamaKey = coinId.startsWith("base:") ? coinId : CG_TO_LLAMA[coinId];
    const alreadyHave = tokenPrices[coinId] || (llamaKey && tokenPrices[llamaKey]);
    if (alreadyHave) return;

    const fetch_ = fetchExternal || ((url) => fetch(url));
    setPriceLoading(true);

    // Try DeFiLlama single coin first (more reliable)
    const llamaId = llamaKey || `coingecko:${coinId}`;
    fetch_(`https://coins.llama.fi/prices/current/${llamaId}`)
      .then(r => r.json())
      .then(d => {
        const usd = d?.coins?.[llamaId]?.price;
        if (usd) {
          setTokenPrices(prev => ({ ...prev, [coinId]: usd }));
        } else {
          // Fallback: CoinGecko simple/price
          return fetch_(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`)
            .then(r => r.json())
            .then(d2 => {
              const usd2 = d2?.[coinId]?.usd;
              if (usd2) setTokenPrices(prev => ({ ...prev, [coinId]: usd2 }));
            });
        }
      })
      .catch(() => {/* noop */})
      .finally(() => setPriceLoading(false));
  }, [selectedTok]); // eslint-disable-line react-hooks/exhaustive-deps

  const coinId       = VOLATILITY_COIN_MAP[selectedTok];
  const autoPrice    = coinId ? (tokenPrices[coinId] || null) : null;
  const currentPrice = customPrice ? Number(customPrice) : autoPrice;
  const vd           = volData[coinId] || volData[selectedTok];
  const range        = vd?.annualVol && currentPrice
    ? suggestLPRange(currentPrice, vd.annualVol, horizonDays, sigma)
    : null;
  const ilLoss = calcIL(ilRatio);

  const tokens = Object.entries(VOLATILITY_COIN_MAP).slice(0, 12);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

      {/* Overview BTC/ETH/SOL */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px" }}>
        {[
          { sym: "ETH", k: "ethereum", emoji: "Ξ", color: "#6366f1" },
          { sym: "BTC", k: "bitcoin",  emoji: "₿", color: "#f59e0b" },
          { sym: "SOL", k: "solana",   emoji: "◎", color: "#a78bfa" },
        ].map(({ sym, k, emoji, color }) => {
          const vd2 = volData[k];
          const vl  = getVolLabel(vd2?.annualVol);
          return (
            <Card key={sym} glow={color}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                  <span style={{ fontSize: "15px" }}>{emoji}</span>
                  <span style={{ fontSize: "9px", color: "#2d3748", letterSpacing: "2px", fontFamily: "monospace" }}>{sym}</span>
                </div>
                {volLoading ? <Spin size={10} /> : <Badge color={vl.color} sm>{vl.label}</Badge>}
              </div>
              {volLoading ? (
                <div style={{ height: "40px", display: "flex", alignItems: "center" }}><Spin /></div>
              ) : vd2 ? (
                <>
                  <div style={{ fontSize: "24px", fontWeight: 700, color, fontFamily: "monospace" }}>
                    {vd2.annualVol.toFixed(1)}<span style={{ fontSize: "11px", color: "#475569" }}>%</span>
                  </div>
                  <div style={{ fontSize: "9px", color: "#475569", marginTop: "2px" }}>Volatilidade anualizada (30d)</div>
                  <div style={{ fontSize: "9px", color: "#334155", marginTop: "4px" }}>Diária: {vd2.dailyVol.toFixed(2)}%</div>
                  {tokenPrices[k] && (
                    <div style={{ fontSize: "9px", color: "#64748b", marginTop: "4px", fontFamily: "monospace" }}>
                      ${fmt(tokenPrices[k], 0)}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: "10px", color: "#2d3748" }}>Indisponível (CORS/limite API)</div>
              )}
            </Card>
          );
        })}
      </div>

      {/* All tokens vol grid */}
      <Card>
        <SecTitle icon="📊" sub="Volatilidade histórica anualizada (30 dias, retornos log-diários)">Volatilidade por Token</SecTitle>
        {volLoading ? (
          <div style={{ textAlign: "center", padding: "30px" }}>
            <Spin size={18} />
            <div style={{ marginTop: "8px", fontSize: "10px", color: "#334155" }}>Buscando histórico de preços...</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px" }}>
            {tokens.map(([sym, cId]) => {
              const vd2 = volData[cId] || volData[sym];
              const vl  = getVolLabel(vd2?.annualVol);
              const p   = tokenPrices[cId];
              return (
                <div
                  key={sym}
                  onClick={() => setSelectedTok(sym)}
                  style={{
                    padding: "10px",
                    background: selectedTok === sym ? "rgba(99,102,241,0.1)" : "rgba(0,0,0,0.2)",
                    border: `1px solid ${selectedTok === sym ? "rgba(99,102,241,0.3)" : vd2 ? `${vl.color}15` : "rgba(255,255,255,0.04)"}`,
                    borderRadius: "8px", cursor: "pointer", transition: "all 0.15s"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8" }}>{sym}</span>
                    {vd2 ? (
                      <span style={{ fontSize: "10px", fontWeight: 700, color: vl.color, fontFamily: "monospace" }}>{vd2.annualVol.toFixed(0)}%</span>
                    ) : priceLoading ? (
                      <Spin size={9}/>
                    ) : (
                      <span style={{ fontSize: "8px", color: "#334155" }}>—</span>
                    )}
                  </div>
                  {vd2 ? (
                    <>
                      <div style={{ fontSize: "8px", color: vl.color, marginBottom: "3px" }}>{vl.label}</div>
                      <div style={{ height: "2px", background: "rgba(255,255,255,0.04)", borderRadius: "1px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(100, vd2.annualVol / 2)}%`, background: vl.color }} />
                      </div>
                      {p && <div style={{ fontSize: "8px", color: "#334155", marginTop: "4px", fontFamily: "monospace" }}>${p >= 1 ? fmt(p, 2) : fmt(p, 4)}</div>}
                    </>
                  ) : (
                    <div style={{ fontSize: "8px", color: "#1e2d3d", marginTop: "4px" }}>
                      {p ? `$${p >= 1 ? fmt(p, 2) : fmt(p, 4)}` : "sem dados de vol"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* LP Range + IL Calculator row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
        <Card>
          <SecTitle icon="⚙️" sub="Configure o token e horizonte para o range">Configuração de Range</SecTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <div style={{ fontSize: "9px", color: "#334155", letterSpacing: "1px", marginBottom: "6px", fontFamily: "monospace" }}>TOKEN</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                {Object.keys(VOLATILITY_COIN_MAP).map(sym => {
                  const cId = VOLATILITY_COIN_MAP[sym];
                  const vd2 = volData[cId] || volData[sym];
                  const hasData = Boolean(vd2);
                  return (
                    <button
                      key={sym}
                      onClick={() => { setSelectedTok(sym); setCustomPrice(""); }}
                      style={{
                        padding: "3px 8px", borderRadius: "6px", fontSize: "10px", cursor: "pointer",
                        background: selectedTok === sym ? "rgba(99,102,241,0.18)" : "rgba(0,0,0,0.2)",
                        border: `1px solid ${selectedTok === sym ? "#6366f1" : hasData ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)"}`,
                        color: selectedTok === sym ? "#a5b4fc" : hasData ? "#64748b" : "#334155",
                        opacity: hasData ? 1 : 0.55
                      }}
                    >{sym}{!hasData && " ·"}</button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "9px", color: "#334155", letterSpacing: "1px", marginBottom: "4px", fontFamily: "monospace" }}>
                PREÇO DE {selectedTok}
                {autoPrice && !customPrice && <span style={{ color: "#22c55e", marginLeft: "6px" }}>● automático</span>}
                {!autoPrice && !customPrice && <span style={{ color: "#f59e0b", marginLeft: "6px" }}>● manual necessário</span>}
              </div>
              <input
                value={customPrice}
                onChange={e => setCustomPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder={autoPrice
                  ? `${fmt(autoPrice, autoPrice >= 1 ? 2 : 4)} (automático — sobrescreva se quiser)`
                  : `Cole o preço atual de ${selectedTok}…`}
                style={{
                  width: "100%", padding: "7px 10px", background: "rgba(0,0,0,0.3)",
                  border: `1px solid ${customPrice ? "rgba(99,102,241,0.4)" : autoPrice ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.3)"}`,
                  borderRadius: "7px", color: "#f1f5f9", fontFamily: "monospace", fontSize: "12px"
                }}
              />
              {/* Quick price links for tokens without auto-price */}
              {!autoPrice && !customPrice && (
                <div style={{ marginTop: "5px", fontSize: "9px", color: "#334155" }}>
                  Busque em{" "}
                  <a href={`https://www.coingecko.com/en/coins/${VOLATILITY_COIN_MAP[selectedTok]}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1" }}>CoinGecko</a>
                  {" "}ou{" "}
                  <a href={`https://defillama.com/`} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1" }}>DeFiLlama</a>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: "9px", color: "#334155", letterSpacing: "1px", marginBottom: "4px", fontFamily: "monospace" }}>HORIZONTE: {horizonDays} dias</div>
              <input type="range" min={7} max={90} step={1} value={horizonDays} onChange={e => setHorizonDays(Number(e.target.value))} style={{ width: "100%", accentColor: "#6366f1", height: "3px" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8px", color: "#2d3748" }}><span>7d</span><span>90d</span></div>
            </div>
            <div>
              <div style={{ fontSize: "9px", color: "#334155", letterSpacing: "1px", marginBottom: "4px", fontFamily: "monospace" }}>SIGMA: {sigma}σ — {sigma === 1 ? "68%" : sigma === 1.5 ? "86%" : "95%"} confiança</div>
              <div style={{ display: "flex", gap: "5px" }}>
                {[{ v: 1, l: "1σ 68%" }, { v: 1.5, l: "1.5σ 86%" }, { v: 2, l: "2σ 95%" }].map(s => (
                  <button
                    key={s.v}
                    onClick={() => setSigma(s.v)}
                    style={{
                      flex: 1, padding: "4px", borderRadius: "6px", fontSize: "9px", cursor: "pointer",
                      background: sigma === s.v ? "rgba(99,102,241,0.15)" : "rgba(0,0,0,0.2)",
                      border: `1px solid ${sigma === s.v ? "#6366f1" : "rgba(255,255,255,0.05)"}`,
                      color: sigma === s.v ? "#a5b4fc" : "#475569"
                    }}
                  >{s.l}</button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <SecTitle icon="🎯" sub="Range sugerido com base na vol histórica + sigma escolhido">Range Sugerido</SecTitle>
          {!vd ? (
            <div style={{ padding: "20px", textAlign: "center", fontSize: "10px", color: "#334155", lineHeight: 1.7 }}>
              Volatilidade de <strong style={{ color: "#94a3b8" }}>{selectedTok}</strong> não disponível.<br />
              <span style={{ fontSize: "8px", color: "#1e2d3d" }}>Aguarde o carregamento ou verifique limite da API.</span>
            </div>
          ) : !currentPrice ? (
            <div style={{ padding: "20px", textAlign: "center" }}>
              {priceLoading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <Spin size={14} />
                  <span style={{ fontSize: "10px", color: "#64748b" }}>Buscando preço de {selectedTok}…</span>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: "10px", color: "#f59e0b", marginBottom: "6px" }}>
                    Preço de <strong>{selectedTok}</strong> não disponível automaticamente.
                  </div>
                  <div style={{ fontSize: "9px", color: "#334155" }}>
                    Cole o preço manualmente no campo ao lado para calcular o range.
                  </div>
                </div>
              )}
            </div>
          ) : range ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "14px" }}>
                <div style={{ padding: "14px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: "10px" }}>
                  <div style={{ fontSize: "9px", color: "#2d3748", letterSpacing: "1px", marginBottom: "6px", fontFamily: "monospace" }}>LIMITE SUPERIOR</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>${fmt(range.upper, 2)}</div>
                  <div style={{ fontSize: "9px", color: "#475569" }}>+{((range.upper / currentPrice - 1) * 100).toFixed(1)}% do preço atual</div>
                </div>
                <div style={{ padding: "10px", background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: "8px", textAlign: "center" }}>
                  <div style={{ fontSize: "10px", color: "#6366f1", fontWeight: 700 }}>
                    {selectedTok} — PREÇO ATUAL: ${fmt(currentPrice, currentPrice >= 1 ? 2 : 4)}
                  </div>
                  <div style={{ fontSize: "8px", color: "#334155", marginTop: "2px" }}>
                    Vol: {vd.annualVol.toFixed(1)}%/aa · Sigma: {sigma}σ · {horizonDays}d
                    {!customPrice && autoPrice && <span style={{ color: "#22c55e" }}> · preço automático via DeFiLlama</span>}
                    {customPrice && <span style={{ color: "#f59e0b" }}> · preço manual</span>}
                  </div>
                </div>
                <div style={{ padding: "14px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "10px" }}>
                  <div style={{ fontSize: "9px", color: "#2d3748", letterSpacing: "1px", marginBottom: "6px", fontFamily: "monospace" }}>LIMITE INFERIOR</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: "#ef4444", fontFamily: "monospace" }}>${fmt(range.lower, 2)}</div>
                  <div style={{ fontSize: "9px", color: "#475569" }}>-{((1 - range.lower / currentPrice) * 100).toFixed(1)}% do preço atual</div>
                </div>
              </div>
              <div style={{ padding: "10px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", fontSize: "9px", color: "#64748b", lineHeight: 1.7 }}>
                Amplitude total: <strong style={{ color: "#f59e0b" }}>{range.rangePct.toFixed(1)}%</strong><br />
                Confiança histórica: <strong style={{ color: "#22c55e" }}>{range.confidence}%</strong><br />
                <span style={{ color: "#334155" }}>Se o preço sair do range, sua posição para de acumular fees e vira exposição direcional.</span>
              </div>
            </>
          ) : null}
        </Card>
      </div>

      {/* IL Calculator */}
      <Card>
        <SecTitle icon="📉" sub="Quanto você perde em relação a só segurar (HODL)">Calculadora de Impermanent Loss</SecTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div>
            <div style={{ fontSize: "10px", color: "#475569", marginBottom: "6px" }}>
              Variação de preço (multiplicador): <strong style={{ color: "#f59e0b" }}>{ilRatio}x</strong>
            </div>
            <input type="range" min="0.1" max="5" step="0.1" value={ilRatio} onChange={e => setIlRatio(Number(e.target.value))} style={{ width: "100%", accentColor: "#f59e0b", marginBottom: "6px" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#2d3748" }}>
              <span>0.1x (−90%)</span><span>5x (+400%)</span>
            </div>
            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {[[0.25, "−75%"], [0.5, "−50%"], [2, "×2 +100%"], [3, "×3 +200%"], [5, "×5 +400%"]].map(([r, l]) => (
                <div
                  key={r}
                  style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", background: "rgba(0,0,0,0.2)", borderRadius: "5px", fontSize: "9px", cursor: "pointer" }}
                  onClick={() => setIlRatio(r)}
                >
                  <span style={{ color: "#64748b" }}>{l}</span>
                  <span style={{ color: "#ef4444", fontFamily: "monospace", fontWeight: 700 }}>{calcIL(r).toFixed(2)}% IL</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ padding: "14px", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: "10px" }}>
              <div style={{ fontSize: "9px", color: "#475569", marginBottom: "3px", letterSpacing: "1px" }}>PERDA POR IMPERMANENT LOSS</div>
              <div style={{ fontSize: "30px", fontWeight: 700, color: "#ef4444", fontFamily: "monospace" }}>{ilLoss.toFixed(2)}%</div>
              <div style={{ fontSize: "9px", color: "#475569", marginTop: "3px" }}>vs manter os tokens sem LP</div>
            </div>
            <div style={{ padding: "10px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", fontSize: "10px", color: "#64748b", lineHeight: 1.7 }}>
              APY mínimo para cobrir IL:<br />
              <strong style={{ color: "#f59e0b", fontSize: "14px" }}>{Math.abs(ilLoss).toFixed(1)}%/ano</strong>
            </div>
            <div style={{ padding: "10px", background: "rgba(0,0,0,0.15)", borderRadius: "7px", fontSize: "9px", color: "#334155", lineHeight: 1.6 }}>
              <span style={{ fontFamily: "monospace", color: "#94a3b8" }}>IL = 2√r/(1+r) − 1</span>, onde r = multiplicador de preço.<br />
              IL é latente enquanto você está no pool. Stable/stable pools têm IL≈0.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}