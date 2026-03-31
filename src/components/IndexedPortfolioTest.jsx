import { useState } from "react";
import { Badge, Card, SecTitle } from "./primitives";
import { fmt } from "../utils";

const mono = { fontFamily: "monospace" };

function chainLabel(chainId, chain) {
  if (chain) return String(chain);
  return ({ 1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 137: "Polygon" })[Number(chainId)] || `Chain ${chainId}`;
}

function valueText(value) {
  return Number.isFinite(Number(value)) ? `$${fmt(Number(value), 2)}` : "—";
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
    const fees0 = Number(item?.unclaimed_fees?.token0_amount || item?.fees?.token0_amount || 0);
    const fees1 = Number(item?.unclaimed_fees?.token1_amount || item?.fees?.token1_amount || 0);
    const feeUsd = Number(item?.unclaimed_fees?.value_usd || item?.fees?.value_usd || 0);
    const rangeMin = Number(item?.price_range?.min || item?.tick_range?.min_price || item?.range?.min_price || 0);
    const rangeMax = Number(item?.price_range?.max || item?.tick_range?.max_price || item?.range?.max_price || 0);
    return {
      id: item?.id || item?.position_id || `${symbol}-${index}`,
      symbol,
      protocol: item?.protocol || item?.dex || item?.type || "Indexed position",
      chain: chainLabel(item?.chain_id, item?.chain),
      valueUsd: Number(item?.value_usd || item?.total_value_usd || item?.position_value_usd || 0),
      entryUsd: Number(item?.cost_basis_usd || item?.entry_value_usd || 0),
      pnlUsd: Number(item?.pnl_usd || item?.profit_usd || 0),
      ilUsd: Number(item?.impermanent_loss_usd || item?.il_usd || 0),
      fees0,
      fees1,
      feeUsd,
      fee0Symbol: item?.token0?.symbol || token0 || "",
      fee1Symbol: item?.token1?.symbol || token1 || "",
      rangeMin,
      rangeMax,
      tokenId: item?.token_id || item?.nft_id || null,
      raw: item,
    };
  });

  const assets = balancesRaw
    .map((item, index) => ({
      id: item?.id || `${item?.chain_id || item?.chain}-${item?.symbol || index}`,
      symbol: item?.symbol || item?.name || "Token",
      chain: chainLabel(item?.chain_id, item?.chain),
      amount: Number(item?.amount_formatted || item?.formatted_amount || item?.amount || 0),
      valueUsd: Number(item?.value_usd || 0),
      priceUsd: Number(item?.price_usd || 0),
    }))
    .filter((item) => item.amount > 0 || item.valueUsd > 0);

  return { positions, assets };
}

export function IndexedPortfolioTest({ onFetchIndexedPortfolio }) {
  const [wallet, setWallet] = useState("0x7828319afdffb75f26a54e941c787b5f11a9ee34");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

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

  const parsed = parseIndexedResponse(result || {});

  return (
    <Card>
      <SecTitle icon="🧪" sub="Fluxo separado de teste, mais proximo de um dashboard tipo Krystal">Portfolio Indexado</SecTitle>
      <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value.trim())}
          placeholder="0x... carteira"
          style={{ width: "100%", padding: "9px 11px", background: "rgba(3, 8, 18, 0.75)", border: "1px solid rgba(148, 163, 184, 0.12)", borderRadius: "10px", color: "#e2e8f0", fontSize: "11px", ...mono }}
        />
        <button onClick={run} disabled={loading} style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid rgba(34,197,94,0.25)", background: "rgba(34,197,94,0.12)", color: "#86efac", fontSize: "10px", cursor: "pointer", ...mono }}>
          {loading ? "Consultando..." : "Testar indexador"}
        </button>
      </div>
      {error ? (
        <div style={{ marginBottom: "10px", padding: "10px 12px", borderRadius: "10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.16)", color: "#fca5a5", fontSize: "10px", lineHeight: 1.5 }}>
          {error}
        </div>
      ) : null}
      {result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
            <div style={{ padding: "10px 12px", borderRadius: "10px", background: "rgba(2, 6, 14, 0.55)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
              <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", ...mono }}>POSICOES</div>
              <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "16px", ...mono }}>{parsed.positions.length}</div>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: "10px", background: "rgba(2, 6, 14, 0.55)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
              <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", ...mono }}>ATIVOS</div>
              <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "16px", ...mono }}>{parsed.assets.length}</div>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: "10px", background: "rgba(2, 6, 14, 0.55)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
              <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", ...mono }}>VALOR LP</div>
              <div style={{ color: "#3b82f6", fontWeight: 700, fontSize: "16px", ...mono }}>
                {valueText(parsed.positions.reduce((sum, item) => sum + Number(item.valueUsd || 0), 0))}
              </div>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: "10px", background: "rgba(2, 6, 14, 0.55)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
              <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", ...mono }}>VALOR SPOT</div>
              <div style={{ color: "#22c55e", fontWeight: 700, fontSize: "16px", ...mono }}>
                {valueText(parsed.assets.reduce((sum, item) => sum + Number(item.valueUsd || 0), 0))}
              </div>
            </div>
          </div>

          <div>
            <div style={{ marginBottom: "8px", fontSize: "9px", color: "#64748b", letterSpacing: "1px", ...mono }}>POSICOES INDEXADAS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {parsed.positions.length ? parsed.positions.map((item) => (
                <div key={item.id} style={{ padding: "12px", borderRadius: "12px", background: "rgba(2, 6, 14, 0.5)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", marginBottom: "8px" }}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#e2e8f0" }}>{item.symbol}</div>
                      <div style={{ fontSize: "10px", color: "#64748b" }}>{item.protocol} · {item.chain}</div>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      {item.tokenId ? <Badge color="#7dd3fc" sm>NFT #{item.tokenId}</Badge> : null}
                      {item.rangeMin > 0 && item.rangeMax > item.rangeMin ? <Badge color="#a5b4fc" sm>${fmt(item.rangeMin, 0)} - ${fmt(item.rangeMax, 0)}</Badge> : null}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                    <div style={{ color: "#3b82f6", ...mono }}>{valueText(item.valueUsd)}<div style={{ fontSize: "9px", color: "#64748b" }}>valor atual</div></div>
                    <div style={{ color: "#f59e0b", ...mono }}>{valueText(item.entryUsd)}<div style={{ fontSize: "9px", color: "#64748b" }}>entrada</div></div>
                    <div style={{ color: "#22c55e", ...mono }}>
                      {item.fees0 || item.fees1 ? `${fmt(item.fees0, 6)} ${item.fee0Symbol} / ${fmt(item.fees1, 6)} ${item.fee1Symbol}` : "—"}
                      <div style={{ fontSize: "9px", color: "#64748b" }}>fees token</div>
                    </div>
                    <div style={{ color: "#e2e8f0", ...mono }}>{valueText(item.feeUsd)}<div style={{ fontSize: "9px", color: "#64748b" }}>fees usd</div></div>
                  </div>
                </div>
              )) : <div style={{ fontSize: "11px", color: "#64748b" }}>Nenhuma posicao retornada pelo indexador.</div>}
            </div>
          </div>

          <div>
            <div style={{ marginBottom: "8px", fontSize: "9px", color: "#64748b", letterSpacing: "1px", ...mono }}>ATIVOS INDEXADOS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {parsed.assets.length ? parsed.assets.slice(0, 12).map((item) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px", gap: "8px", padding: "10px 12px", borderRadius: "10px", background: "rgba(2, 6, 14, 0.45)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
                  <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{item.symbol} <span style={{ color: "#64748b", fontWeight: 400, fontSize: "10px" }}>· {item.chain}</span></div>
                  <div style={{ color: "#cbd5e1", ...mono }}>{fmt(item.amount, 6)}</div>
                  <div style={{ color: "#22c55e", ...mono }}>{valueText(item.valueUsd)}</div>
                </div>
              )) : <div style={{ fontSize: "11px", color: "#64748b" }}>Nenhum ativo retornado pelo indexador.</div>}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: "11px", color: "#64748b" }}>Esse painel depende de `SIM_API_KEY` configurada no backend para testar uma abordagem indexada parecida com dashboards tipo Krystal.</div>
      )}
    </Card>
  );
}
