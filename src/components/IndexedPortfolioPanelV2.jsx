import { useMemo, useState } from "react";
import { Badge, Card, SecTitle } from "./primitives";
import { fmt } from "../utils";

const mono = { fontFamily: "monospace" };
const TRUSTED_SYMBOLS = new Set([
  "ETH", "WETH", "USDC", "USDT", "DAI", "WBTC", "CBBTC", "BTC",
  "ARB", "POL", "MATIC", "AERO", "ANZ", "SOL",
]);
const SPAM_TERMS = ["SHIT", "KILLER", "BOTCOIN", "NATO", "TOSHI", "GSD", "INU", "DOGE", "PEPE"];

function chainLabel(chainId, chain) {
  if (chain) {
    const raw = String(chain);
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return ({ 1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 137: "Polygon" })[Number(chainId)] || `Chain ${chainId}`;
}

function protocolLabel(protocol) {
  const raw = String(protocol || "Indexed position");
  if (raw.toLowerCase() === "uniswapv4") return "Uniswap v4";
  if (raw.toLowerCase() === "uniswapv3") return "Uniswap v3";
  return raw;
}

function usdText(value) {
  return Number.isFinite(Number(value)) ? `$${fmt(Number(value), 2)}` : "—";
}

function formatAmount(amount) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value === 0) return "0";
  if (Math.abs(value) >= 1_000_000) {
    return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  }
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
  }
  if (Math.abs(value) >= 1) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(value);
  }
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(value);
}

function normalizeAmount(item) {
  const direct = [item?.amount_formatted, item?.formatted_amount, item?.amount_decimal, item?.ui_amount];
  for (const candidate of direct) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const raw = Number(item?.amount);
  const decimals = Number(item?.decimals);
  if (Number.isFinite(raw) && raw > 0 && Number.isFinite(decimals) && decimals >= 0) {
    return raw / (10 ** decimals);
  }
  return Number.isFinite(raw) ? raw : 0;
}

function classifyAsset(item) {
  const symbol = String(item.symbol || "").toUpperCase();
  const valueUsd = Number(item.valueUsd || 0);
  const suspiciousName = SPAM_TERMS.some((term) => symbol.includes(term));
  const tiny = valueUsd < 1;
  const trusted = TRUSTED_SYMBOLS.has(symbol);
  return { trusted, isSpam: suspiciousName || (tiny && !trusted) };
}

function parseIndexedResponse(data) {
  const positionsRaw = Array.isArray(data?.positions)
    ? data.positions
    : Array.isArray(data?.defi_positions)
      ? data.defi_positions
      : Array.isArray(data?.items)
        ? data.items
        : [];
  const balancesRaw = Array.isArray(data?.balances)
    ? data.balances
    : Array.isArray(data?.tokens)
      ? data.tokens
      : [];

  const positions = positionsRaw.map((item, index) => {
    const token0 = item?.token0?.symbol || item?.base_token?.symbol || item?.underlying_tokens?.[0]?.symbol || "";
    const token1 = item?.token1?.symbol || item?.quote_token?.symbol || item?.underlying_tokens?.[1]?.symbol || "";
    const symbol = item?.name || [token0, token1].filter(Boolean).join("/") || item?.protocol || `Position ${index + 1}`;
    return {
      id: item?.id || item?.position_id || `${symbol}-${index}`,
      symbol,
      protocol: protocolLabel(item?.protocol || item?.dex || item?.type || "Indexed position"),
      chain: chainLabel(item?.chain_id, item?.chain),
      valueUsd: Number(item?.value_usd || item?.total_value_usd || item?.position_value_usd || 0),
      entryUsd: Number(item?.cost_basis_usd || item?.entry_value_usd || 0),
      feeUsd: Number(item?.unclaimed_fees?.value_usd || item?.fees?.value_usd || 0),
      fees0: Number(item?.unclaimed_fees?.token0_amount || item?.fees?.token0_amount || 0),
      fees1: Number(item?.unclaimed_fees?.token1_amount || item?.fees?.token1_amount || 0),
      fee0Symbol: item?.token0?.symbol || token0 || "",
      fee1Symbol: item?.token1?.symbol || token1 || "",
      rangeMin: Number(item?.price_range?.min || item?.tick_range?.min_price || item?.range?.min_price || 0),
      rangeMax: Number(item?.price_range?.max || item?.tick_range?.max_price || item?.range?.max_price || 0),
      tokenId: item?.token_id || item?.nft_id || null,
    };
  }).sort((a, b) => b.valueUsd - a.valueUsd);

  const assets = balancesRaw
    .map((item, index) => ({
      id: item?.id || `${item?.chain_id || item?.chain}-${item?.symbol || index}`,
      symbol: item?.symbol || item?.name || "Token",
      chain: chainLabel(item?.chain_id, item?.chain),
      amount: normalizeAmount(item),
      valueUsd: Number(item?.value_usd || 0),
    }))
    .filter((item) => item.amount > 0 || item.valueUsd > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd);

  return { positions, assets };
}

function MetricBox({ label, value, color = "#e2e8f0", sub = "" }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: "12px", background: "rgba(2, 6, 14, 0.52)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
      <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", ...mono }}>{label}</div>
      <div style={{ color, fontWeight: 700, fontSize: "17px", marginTop: "4px", ...mono }}>{value}</div>
      {sub ? <div style={{ marginTop: "4px", color: "#64748b", fontSize: "9px" }}>{sub}</div> : null}
    </div>
  );
}

function insightText(position) {
  if (position.rangeMin > 0 && position.rangeMax > position.rangeMin) return "range identificado";
  if (position.feeUsd > 0) return "fees reconhecidas";
  return "aguardando mais contexto";
}

export function IndexedPortfolioPanelV2({ onFetchIndexedPortfolio, onUseIndexedPositions, onUseIndexedAssets, defaultWallet = "0x7828319afdffb75f26a54e941c787b5f11a9ee34" }) {
  const [wallet, setWallet] = useState(defaultWallet);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [showSpam, setShowSpam] = useState(false);

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await onFetchIndexedPortfolio?.(wallet);
      setResult(data || null);
      if (!data) setError("Sem resposta do indexador.");
    } catch (err) {
      setError(err?.message || "Falha ao consultar indexador.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const parsed = useMemo(() => parseIndexedResponse(result || {}), [result]);
  const filteredAssets = useMemo(() => {
    const relevant = [];
    const spam = [];
    for (const asset of parsed.assets) {
      const flags = classifyAsset(asset);
      (flags.isSpam ? spam : relevant).push(asset);
    }
    return { relevant, spam };
  }, [parsed.assets]);

  const totalLp = parsed.positions.reduce((sum, item) => sum + Number(item.valueUsd || 0), 0);
  const totalSpot = filteredAssets.relevant.reduce((sum, item) => sum + Number(item.valueUsd || 0), 0);
  const totalFees = parsed.positions.reduce((sum, item) => sum + Number(item.feeUsd || 0), 0);
  const topPosition = parsed.positions[0] || null;
  const chainMix = parsed.positions.reduce((acc, item) => {
    acc[item.chain] = (acc[item.chain] || 0) + item.valueUsd;
    return acc;
  }, {});
  const chainFocus = Object.entries(chainMix).sort((a, b) => b[1] - a[1])[0];

  return (
    <Card glow="#0ea5e9">
      <SecTitle icon="🧪" sub="Fonte indexada para ficar mais perto de um dashboard tipo Krystal">Portfolio Indexado</SecTitle>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: "8px", marginBottom: "12px" }}>
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value.trim())}
          placeholder="0x... carteira"
          style={{ width: "100%", padding: "10px 12px", background: "rgba(3, 8, 18, 0.82)", border: "1px solid rgba(14, 165, 233, 0.14)", borderRadius: "12px", color: "#e2e8f0", fontSize: "11px", ...mono }}
        />
        <button
          onClick={run}
          disabled={loading}
          style={{ padding: "10px 12px", borderRadius: "12px", border: "1px solid rgba(14,165,233,0.22)", background: "linear-gradient(135deg, rgba(14,165,233,0.16), rgba(34,197,94,0.12))", color: "#bae6fd", fontSize: "10px", cursor: "pointer", ...mono }}
        >
          {loading ? "Consultando..." : "Sincronizar"}
        </button>
      </div>

      {error ? (
        <div style={{ marginBottom: "12px", padding: "10px 12px", borderRadius: "12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.16)", color: "#fca5a5", fontSize: "10px", lineHeight: 1.5 }}>
          {error}
        </div>
      ) : null}

      {!result ? (
        <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.6 }}>
          Use este bloco para puxar um portfolio indexado por carteira, com pools LP e ativos spot em varias redes, sem depender so de RPC bruto.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px" }}>
            <MetricBox label="POSICOES LP" value={parsed.positions.length} />
            <MetricBox label="ATIVOS RELEVANTES" value={filteredAssets.relevant.length} />
            <MetricBox label="VALOR LP" value={usdText(totalLp)} color="#3b82f6" />
            <MetricBox label="VALOR SPOT" value={usdText(totalSpot)} color="#22c55e" />
            <MetricBox label="FEES MAPEADAS" value={usdText(totalFees)} color="#f59e0b" />
          </div>

          {(topPosition || chainFocus) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {topPosition ? <MetricBox label="POOL PRINCIPAL" value={topPosition.symbol} sub={`${topPosition.protocol} · ${topPosition.chain} · ${usdText(topPosition.valueUsd)}`} color="#e2e8f0" /> : null}
              {chainFocus ? <MetricBox label="REDE DOMINANTE" value={chainFocus[0]} sub={`${usdText(chainFocus[1])} em LP indexado`} color="#a5b4fc" /> : null}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button
              onClick={() => onUseIndexedPositions?.(parsed.positions, wallet)}
              disabled={!parsed.positions.length}
              style={{ padding: "8px 12px", borderRadius: "10px", border: "1px solid rgba(59,130,246,0.20)", background: "rgba(59,130,246,0.12)", color: "#93c5fd", fontSize: "10px", cursor: parsed.positions.length ? "pointer" : "default", ...mono }}
            >
              Usar pools no portfolio
            </button>
            <button
              onClick={() => onUseIndexedAssets?.(filteredAssets.relevant, wallet)}
              disabled={!filteredAssets.relevant.length}
              style={{ padding: "8px 12px", borderRadius: "10px", border: "1px solid rgba(34,197,94,0.20)", background: "rgba(34,197,94,0.12)", color: "#86efac", fontSize: "10px", cursor: filteredAssets.relevant.length ? "pointer" : "default", ...mono }}
            >
              Usar ativos limpos
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "9px", color: "#64748b", letterSpacing: "1px", ...mono }}>POOLS INDEXADAS</div>
              {parsed.positions.length ? parsed.positions.map((item) => (
                <div key={item.id} style={{ padding: "14px", borderRadius: "14px", background: "linear-gradient(180deg, rgba(7, 12, 22, 0.9), rgba(3, 8, 18, 0.88))", border: "1px solid rgba(59,130,246,0.12)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start", marginBottom: "10px" }}>
                    <div>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: "#e2e8f0" }}>{item.symbol}</div>
                      <div style={{ fontSize: "10px", color: "#64748b" }}>{item.protocol} · {item.chain}</div>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {item.tokenId ? <Badge color="#7dd3fc" sm>NFT #{item.tokenId}</Badge> : null}
                      {item.rangeMin > 0 && item.rangeMax > item.rangeMin ? <Badge color="#a5b4fc" sm>${fmt(item.rangeMin, 0)} - ${fmt(item.rangeMax, 0)}</Badge> : <Badge color="#64748b" sm>range indisponivel</Badge>}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                    <MetricBox label="VALOR" value={usdText(item.valueUsd)} color="#3b82f6" />
                    <MetricBox label="ENTRADA" value={item.entryUsd > 0 ? usdText(item.entryUsd) : "—"} color="#f59e0b" />
                    <MetricBox label="FEES TOKEN" value={item.fees0 || item.fees1 ? `${formatAmount(item.fees0)} ${item.fee0Symbol} / ${formatAmount(item.fees1)} ${item.fee1Symbol}` : "—"} color="#22c55e" />
                    <MetricBox label="FEES USD" value={item.feeUsd > 0 ? usdText(item.feeUsd) : "$0,00"} sub={insightText(item)} />
                  </div>
                </div>
              )) : <div style={{ fontSize: "11px", color: "#64748b" }}>Nenhuma pool retornada pelo indexador.</div>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "9px", color: "#64748b", letterSpacing: "1px", ...mono }}>ATIVOS FILTRADOS</div>
                {filteredAssets.spam.length ? (
                  <button
                    onClick={() => setShowSpam((v) => !v)}
                    style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "10px", cursor: "pointer", ...mono }}
                  >
                    {showSpam ? "Ocultar spam" : `Mostrar spam (${filteredAssets.spam.length})`}
                  </button>
                ) : null}
              </div>
              {filteredAssets.relevant.length ? filteredAssets.relevant.slice(0, 12).map((item) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 100px", gap: "8px", padding: "12px 14px", borderRadius: "12px", background: "rgba(2, 6, 14, 0.48)", border: "1px solid rgba(34,197,94,0.08)" }}>
                  <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{item.symbol} <span style={{ color: "#64748b", fontWeight: 400, fontSize: "10px" }}>· {item.chain}</span></div>
                  <div style={{ color: "#cbd5e1", ...mono }}>{formatAmount(item.amount)}</div>
                  <div style={{ color: "#22c55e", ...mono }}>{usdText(item.valueUsd)}</div>
                </div>
              )) : <div style={{ fontSize: "11px", color: "#64748b" }}>Nenhum ativo relevante encontrado.</div>}

              {showSpam && filteredAssets.spam.length ? (
                <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {filteredAssets.spam.slice(0, 10).map((item) => (
                    <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 100px", gap: "8px", padding: "10px 12px", borderRadius: "10px", background: "rgba(15, 23, 42, 0.65)", border: "1px solid rgba(148, 163, 184, 0.08)", opacity: 0.72 }}>
                      <div style={{ color: "#94a3b8", fontWeight: 700 }}>{item.symbol} <span style={{ color: "#64748b", fontWeight: 400, fontSize: "10px" }}>· {item.chain}</span></div>
                      <div style={{ color: "#94a3b8", ...mono }}>{formatAmount(item.amount)}</div>
                      <div style={{ color: "#94a3b8", ...mono }}>{usdText(item.valueUsd)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
