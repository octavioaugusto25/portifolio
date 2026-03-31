import { useEffect, useMemo, useState } from "react";
import { fmt } from "../utils";
import { Badge, Card, SecTitle } from "../components/primitives";
import { IndexedPortfolioProbe } from "../components/IndexedPortfolioProbe";
import { readPersisted, writePersisted } from "../persist";

const STORAGE_KEY = "portfolio-positions-clean-v1";
const DRAFT_KEY = "portfolio-inputs-clean-v1";
const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  background: "rgba(3, 8, 18, 0.75)",
  border: "1px solid rgba(148, 163, 184, 0.12)",
  borderRadius: "10px",
  color: "#e2e8f0",
  fontFamily: "monospace",
  fontSize: "11px",
};

function Metric({ label, value, sub, color = "#94a3b8" }) {
  return (
    <div style={{ padding: "10px 12px", background: "rgba(2, 6, 14, 0.55)", border: "1px solid rgba(148, 163, 184, 0.08)", borderRadius: "10px" }}>
      <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "3px" }}>{label}</div>
      <div style={{ fontSize: "15px", fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
      {sub ? <div style={{ fontSize: "9px", color: "#64748b", marginTop: "3px", lineHeight: 1.5 }}>{sub}</div> : null}
    </div>
  );
}

function ActionNote({ children, color = "#a5b4fc" }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: "10px", background: `${color}12`, border: `1px solid ${color}22`, color, fontSize: "10px", lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

function derivePoolSnapshot(pool, prices) {
  const transfers = pool?.transfers || [];
  const stableSymbols = ["USDC", "USDT", "DAI", "USDBC"];
  const normalize = (token) => token === "WETH" ? "ETH" : token;
  if (pool?.kind === "spot") {
    const baseToken = normalize(pool?.symbol || "");
    const priceMap = {
      ETH: prices?.ethereum?.usd || 0,
      BTC: prices?.bitcoin?.usd || 0,
      SOL: prices?.solana?.usd || 0,
      USDC: 1,
      USDT: 1,
      DAI: 1,
    };
    const currentPrice = priceMap[baseToken] || Number(pool?.entryPrice || 0) || 0;
    const amount = Number(pool?.amount || 0);
    const currentValueUSD = amount > 0 && currentPrice > 0
      ? amount * currentPrice
      : Number(pool?.valueUSD || 0);
    return {
      baseToken,
      quoteToken: "",
      baseAmount: amount,
      quoteAmount: 0,
      currentPrice,
      entryPrice: Number(pool?.entryPrice || 0),
      entryValueUSD: Number(pool?.entryValueUSD || pool?.valueUSD || 0),
      currentValueUSD,
      il: null,
    };
  }
  const baseTransfer = transfers.find((item) => !stableSymbols.includes(normalize(item.symbol))) || null;
  const quoteTransfer = transfers.find((item) => stableSymbols.includes(normalize(item.symbol))) || null;
  const baseToken = normalize(baseTransfer?.symbol || pool?.baseToken || pool?.symbol?.split("/")?.[0] || "");
  const quoteToken = normalize(quoteTransfer?.symbol || pool?.quoteToken || pool?.symbol?.split("/")?.[1] || "");
  const baseAmount = baseTransfer ? parseFloat(baseTransfer.formattedAmount || "0") : parseFloat(pool?.baseAmount || pool?.positionValueEth || "0") || 0;
  const quoteAmount = quoteTransfer ? parseFloat(quoteTransfer.formattedAmount || "0") : parseFloat(pool?.quoteAmount || "0") || 0;
  const priceMap = { ETH: prices?.ethereum?.usd || 0, BTC: prices?.bitcoin?.usd || 0, SOL: prices?.solana?.usd || 0 };
  const currentPrice = priceMap[baseToken] || 0;
  const entryPrice = Number(pool?.entryPrice || pool?.lpEntryPrice || 0) || (baseAmount > 0 && quoteAmount > 0 ? quoteAmount / baseAmount : 0);
  const entryValueUSD = Number(pool?.entryValueUSD || 0) || (entryPrice > 0 ? baseAmount * entryPrice + quoteAmount : 0);
  let currentValueUSD = Number(pool?.valueUSD || 0) || (baseAmount > 0 ? baseAmount * currentPrice + quoteAmount : 0);
  const rangeMin = Number(pool?.rangeMin || 0);
  const rangeMax = Number(pool?.rangeMax || 0);
  const feesToken0 = Number(pool?.feesToken0 || 0);
  const feesToken1 = Number(pool?.feesToken1 || 0);
  const feeToken0Symbol = pool?.feeToken0Symbol || baseToken;
  const feeToken1Symbol = pool?.feeToken1Symbol || quoteToken;
  const stableUsd = { USDC: 1, USDT: 1, DAI: 1, USDZ: 1, USDBC: 1 };
  const tokenUsd = (sym) => priceMap[sym] || stableUsd[sym] || 0;
  const feesUsd = (feesToken0 * tokenUsd(feeToken0Symbol)) + (feesToken1 * tokenUsd(feeToken1Symbol));
  let il = entryPrice > 0 && currentPrice > 0 ? ((2 * Math.sqrt(currentPrice / entryPrice)) / (1 + currentPrice / entryPrice) - 1) * 100 : null;
  if (rangeMin > 0 && rangeMax > rangeMin && entryPrice > 0 && currentPrice > 0 && baseAmount > 0) {
    const sqrt = Math.sqrt;
    const pa = sqrt(rangeMin);
    const pb = sqrt(rangeMax);
    const p0 = sqrt(entryPrice);
    const p1 = sqrt(currentPrice);
    const holdValue = quoteAmount + (baseAmount * currentPrice);
    if (pb > pa && p0 > pa && p0 < pb && holdValue > 0) {
      const lFromQuote = quoteAmount > 0 ? (quoteAmount * p0 * pb) / (pb - p0) : null;
      const lFromBase = baseAmount > 0 ? baseAmount / (p0 - pa) : null;
      const liquidity = [lFromQuote, lFromBase].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)[0] || null;
      if (liquidity) {
        let currentQuote = 0;
        let currentBase = 0;
        if (currentPrice <= rangeMin) {
          currentQuote = liquidity * (pb - pa) / (pa * pb);
        } else if (currentPrice >= rangeMax) {
          currentBase = liquidity * (pb - pa);
        } else {
          currentQuote = liquidity * (pb - p1) / (p1 * pb);
          currentBase = liquidity * (p1 - pa);
        }
        const lpValue = currentQuote + (currentBase * currentPrice);
        currentValueUSD = lpValue;
        il = ((lpValue / holdValue) - 1) * 100;
      }
    }
  }
  return {
    baseToken,
    quoteToken,
    baseAmount,
    quoteAmount,
    currentPrice,
    entryPrice,
    entryValueUSD,
    currentValueUSD,
    il,
    rangeMin,
    rangeMax,
    feesToken0,
    feesToken1,
    feeToken0Symbol,
    feeToken1Symbol,
    feesUsd,
    entryPriceSource: pool?.entryPriceSource || "unknown",
  };
}

function buildTrackedPosition(pool, prices, walletAddress = "") {
  const snap = derivePoolSnapshot(pool, prices);
  return {
    id: `tracked-${pool.id}`,
    kind: "lp",
    symbol: pool.symbol,
    protocol: pool.protocol || "Uniswap v4",
    chain: pool.chain || "Base",
    txHash: pool.txHash || "",
    tokenId: pool.tokenId || "",
    feeTier: pool.feeTier || 3000,
    nftContract: pool.nftContract || "",
    baseToken: snap.baseToken,
    quoteToken: snap.quoteToken,
    baseAmount: snap.baseAmount,
    quoteAmount: snap.quoteAmount,
    entryPrice: snap.entryPrice,
    entryPriceSource: snap.entryPriceSource,
    entryValueUSD: snap.entryValueUSD,
    valueUSD: snap.currentValueUSD,
    rangeMin: pool.rangeMin || "",
    rangeMax: pool.rangeMax || "",
    feesToken0: Number(pool.feesToken0 || 0),
    feesToken1: Number(pool.feesToken1 || 0),
    feeToken0Symbol: pool.feeToken0Symbol || snap.baseToken,
    feeToken1Symbol: pool.feeToken1Symbol || snap.quoteToken,
    walletAddress: walletAddress || pool.walletAddress || "",
    notes: "",
    source: pool.source || "Base tx",
  };
}

function buildSpotPosition(asset) {
  return {
    id: `spot-${asset.chain}-${asset.symbol}`,
    kind: "spot",
    symbol: asset.symbol,
    protocol: asset.protocol || "Wallet spot",
    chain: asset.chain,
    amount: Number(asset.amount || 0),
    valueUSD: Number(asset.valueUSD || 0),
    entryValueUSD: Number(asset.valueUSD || 0),
    entryPrice: Number(asset.priceUsd || 0),
    notes: asset.source || "",
  };
}

function computeRangeStatus(position, currentPrice) {
  const min = Number(position.rangeMin || 0);
  const max = Number(position.rangeMax || 0);
  if (!(min > 0 && max > min && currentPrice > 0)) return null;
  if (currentPrice < min) return { label: "Fora do range", color: "#f59e0b", detail: `${(((min - currentPrice) / currentPrice) * 100).toFixed(1)}% abaixo do minimo` };
  if (currentPrice > max) return { label: "Fora do range", color: "#f59e0b", detail: `${(((currentPrice - max) / currentPrice) * 100).toFixed(1)}% acima do maximo` };
  return { label: "Dentro do range", color: "#22c55e", detail: "posicao ainda ativa na faixa" };
}

function inferAction(position, snapshot) {
  const range = computeRangeStatus(position, snapshot.currentPrice);
  if (position.kind === "spot") {
    return { title: "Acompanhar", text: "Ativo spot importado da carteira. Esta area agora esta focada em pools LP; use como referencia de exposicao." };
  }
  if (!position.rangeMin || !position.rangeMax) {
    return { title: "Definir range", text: "Informe range minimo e maximo para transformar esta posicao em um gerenciador de remontagem util." };
  }
  if (range && range.label === "Fora do range") {
    return { title: "Remontar", text: "A posicao ja saiu da faixa definida. O proximo passo e abrir um novo range ao redor do preco atual." };
  }
  return { title: "Manter", text: "A posicao ainda esta no range informado. Monitore a proximidade das bordas antes de remontar." };
}

function getEntryPriceCaption(snapshot) {
  if (snapshot?.entryPriceSource === "historical_market") return "preco historico do ativo na data da tx";
  if (snapshot?.entryPriceSource === "tx_ratio") return "razao dos tokens detectados na tx";
  return "entrada nao confirmada";
}

export function PortfolioTab({ walletPools = [], walletLoading = false, walletDebug = "", onFetchWalletPools, onFetchWalletPoolTx, onFetchWalletAssets, onFetchIndexedPortfolio, prices }) {
  const [walletAddress, setWalletAddress] = useState("");
  const [txHash, setTxHash] = useState("0x4353b87721b13688efde117ccbdbe5b2dbcf42bcd369af4bff1a511b35275711");
  const [positions, setPositions] = useState([]);
  const [selectedPool, setSelectedPool] = useState(null);
  const [selectedPositionId, setSelectedPositionId] = useState(null);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const raw = await readPersisted(STORAGE_KEY);
        if (raw) setPositions(JSON.parse(raw));
      } catch {}
      try {
        const rawDraft = await readPersisted(DRAFT_KEY);
        if (rawDraft) {
          const draft = JSON.parse(rawDraft);
          if (draft.walletAddress) setWalletAddress(draft.walletAddress);
          if (draft.txHash) setTxHash(draft.txHash);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    writePersisted(DRAFT_KEY, JSON.stringify({ walletAddress, txHash }));
  }, [walletAddress, txHash]);

  const savePositions = async (next) => {
    setPositions(next);
    await writePersisted(STORAGE_KEY, JSON.stringify(next));
  };

  const addDetectedPool = async (pool, walletForLink = "") => {
    const existing = positions.find((item) => item.id === `tracked-${pool.id}`);
    const tracked = {
      ...buildTrackedPosition(pool, prices, walletForLink),
      notes: existing?.notes || "",
      rangeMin: pool.rangeMin || existing?.rangeMin || "",
      rangeMax: pool.rangeMax || existing?.rangeMax || "",
      feesToken0: Number(pool.feesToken0 ?? existing?.feesToken0 ?? 0),
      feesToken1: Number(pool.feesToken1 ?? existing?.feesToken1 ?? 0),
      walletAddress: walletForLink || existing?.walletAddress || pool.walletAddress || "",
    };
    const next = [...positions.filter((item) => item.id !== `tracked-${pool.id}`), tracked];
    await savePositions(next);
    setSelectedPositionId(`tracked-${pool.id}`);
    setFeedback(`Posicao ${pool.symbol} salva no portfolio.`);
  };

  const handleFetchTx = async () => {
    const pools = await onFetchWalletPoolTx?.(txHash);
    if (pools?.length) {
      setSelectedPool(pools[0]);
      await addDetectedPool(pools[0], walletAddress);
      setFeedback(`Posicao encontrada pela tx e salva no portfolio.`);
      return;
    }
    setFeedback("Nao consegui montar a posicao por essa tx.");
  };

  const handleFetchWalletPools = async () => {
    const pools = await onFetchWalletPools?.(walletAddress);
    if (pools?.length) {
      setSelectedPool(pools[0]);
      await addDetectedPool(pools[0], walletAddress);
      setFeedback(`${pools.length} pool(s) encontrada(s) pela carteira.`);
      return;
    }
    const persistedMatch = positions
      .filter((item) => item.kind === "lp" && item.walletAddress && item.walletAddress.toLowerCase() === walletAddress.toLowerCase())
      .sort((a, b) => String(b.txHash || "").localeCompare(String(a.txHash || "")));
    if (persistedMatch.length) {
      setSelectedPositionId(persistedMatch[0].id);
      setFeedback(`Nao achei pool nova on-chain, mas reabri ${persistedMatch.length} posicao(oes) ja vinculada(s) a essa carteira.`);
      return;
    }
    if (txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      setFeedback("Nao achei pool direta pela carteira. Tentei a tx informada automaticamente.");
      await handleFetchTx();
      return;
    }
    setFeedback("Nenhuma pool encontrada por carteira.");
  };

  const importWalletAssets = async () => {
    const assets = await onFetchWalletAssets?.(walletAddress);
    if (!assets?.length) {
      setFeedback("Nenhum ativo encontrado nessa carteira com a lista curada atual.");
      return;
    }
    const next = [...positions.filter((item) => !String(item.id).startsWith("spot-")), ...assets.map(buildSpotPosition)];
    await savePositions(next);
    setFeedback(`${assets.length} ativo(s) importado(s) para o portfolio.`);
  };

  const updatePosition = async (id, patch) => {
    const next = positions.map((item) => (item.id === id ? { ...item, ...patch } : item));
    await savePositions(next);
  };

  const removePosition = async (id) => {
    const next = positions.filter((item) => item.id !== id);
    await savePositions(next);
    if (selectedPositionId === id) setSelectedPositionId(null);
  };

  const enrichedPositions = useMemo(() => (
    positions.map((item) => {
      const snapshot = derivePoolSnapshot(item, prices);
      return {
        ...item,
        liveValueUSD: snapshot.currentValueUSD,
        snapshot,
      };
    })
  ), [positions, prices]);
  const totalValueLive = useMemo(
    () => enrichedPositions.reduce((sum, item) => sum + Number(item.liveValueUSD || 0), 0),
    [enrichedPositions]
  );
  const totalCost = useMemo(
    () => enrichedPositions.reduce((sum, item) => sum + Number(item.entryValueUSD || item.valueUSD || 0), 0),
    [enrichedPositions]
  );
  const pnl = totalValueLive - totalCost;

  const selectedPosition = enrichedPositions.find((item) => item.id === selectedPositionId) || null;
  const selectedSnapshot = selectedPosition?.snapshot || null;
  const selectedAction = selectedPosition && selectedSnapshot ? inferAction(selectedPosition, selectedSnapshot) : null;
  const selectedRange = selectedPosition && selectedSnapshot ? computeRangeStatus(selectedPosition, selectedSnapshot.currentPrice) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <Card>
        <SecTitle icon="🧷" sub="Importe por carteira ou cole a tx da Base da posicao que voce quer gerenciar">Portfolio</SecTitle>
        {feedback ? (
          <div style={{ marginBottom: "10px", padding: "9px 11px", borderRadius: "10px", background: "rgba(14,165,233,0.10)", border: "1px solid rgba(14,165,233,0.18)", color: "#7dd3fc", fontSize: "10px", lineHeight: 1.5 }}>
            {feedback}
          </div>
        ) : null}
        {walletDebug ? (
          <div style={{ marginBottom: "10px", padding: "9px 11px", borderRadius: "10px", background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.14)", color: "#94a3b8", fontSize: "10px", lineHeight: 1.5 }}>
            {walletDebug}
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "10px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <input value={walletAddress} onChange={(e) => setWalletAddress(e.target.value.trim())} placeholder="0x... carteira" style={inputStyle} />
            <div style={{ display: "flex", gap: "8px" }}>
              <button disabled={walletLoading} onClick={handleFetchWalletPools} style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid rgba(99,102,241,0.25)", background: "rgba(99,102,241,0.12)", color: "#a5b4fc", fontFamily: "monospace", fontSize: "10px", cursor: "pointer" }}>Buscar pools</button>
              <button disabled={walletLoading} onClick={importWalletAssets} style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid rgba(14,165,233,0.25)", background: "rgba(14,165,233,0.12)", color: "#7dd3fc", fontFamily: "monospace", fontSize: "10px", cursor: "pointer" }}>Importar ativos</button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <input value={txHash} onChange={(e) => setTxHash(e.target.value.trim())} placeholder="0x... tx da Base" style={inputStyle} />
            <button disabled={walletLoading} onClick={handleFetchTx} style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid rgba(34,197,94,0.25)", background: "rgba(34,197,94,0.12)", color: "#86efac", fontFamily: "monospace", fontSize: "10px", cursor: "pointer" }}>Buscar pela tx</button>
          </div>
        </div>
      </Card>

      <IndexedPortfolioProbe onFetchIndexedPortfolio={onFetchIndexedPortfolio} />

      {walletPools.length > 0 && (
        <Card>
          <div style={{ fontSize: "9px", color: "#64748b", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "10px" }}>POSICAO ENCONTRADA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {walletPools.map((pool) => {
              const snap = derivePoolSnapshot(pool, prices);
              return (
                <div key={pool.id} style={{ padding: "12px", borderRadius: "12px", background: "rgba(2, 6, 14, 0.5)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", marginBottom: "8px" }}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#e2e8f0" }}>{pool.symbol}</div>
                      <div style={{ fontSize: "10px", color: "#64748b" }}>{pool.protocol || "Posicao LP"} · {pool.chain || "Base"} · {pool.source}</div>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      {pool.feeTier ? <Badge color="#6366f1" sm>{pool.feeTier / 10000}% fee</Badge> : null}
                      {pool.tokenId ? <Badge color="#7dd3fc" sm>NFT #{pool.tokenId}</Badge> : null}
                      <button onClick={() => setSelectedPool(pool)} style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid rgba(148, 163, 184, 0.12)", background: "rgba(15,23,42,0.8)", color: "#cbd5e1", fontFamily: "monospace", fontSize: "10px", cursor: "pointer" }}>Gerenciar</button>
                      <button onClick={() => addDetectedPool(pool)} style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid rgba(34,197,94,0.25)", background: "rgba(34,197,94,0.12)", color: "#86efac", fontFamily: "monospace", fontSize: "10px", cursor: "pointer" }}>Salvar</button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                    <Metric label="APORTE BASE" value={snap.baseAmount > 0 ? `${snap.baseAmount}` : "—"} sub={snap.baseToken || "token base"} color="#f59e0b" />
                    <Metric label="APORTE QUOTE" value={snap.quoteAmount > 0 ? `${snap.quoteAmount}` : "—"} sub={snap.quoteToken || "token quote"} color="#22c55e" />
                    <Metric label="ENTRADA LP" value={snap.entryPrice > 0 ? `$${fmt(snap.entryPrice, 2)}` : "—"} sub={getEntryPriceCaption(snap)} color="#f59e0b" />
                    <Metric label="VALOR ATUAL" value={`$${fmt(snap.currentValueUSD, 2)}`} sub="posicao estimada hoje" color="#3b82f6" />
                  </div>
                  {(snap.rangeMin > 0 && snap.rangeMax > snap.rangeMin) ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
                      <Metric label="RANGE MIN" value={`$${fmt(snap.rangeMin, 2)}`} sub="automatico pela tx" color="#a5b4fc" />
                      <Metric label="RANGE MAX" value={`$${fmt(snap.rangeMax, 2)}`} sub="automatico pela tx" color="#a5b4fc" />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {selectedPool && (
        <Card>
          {(() => {
            const snap = derivePoolSnapshot(selectedPool, prices);
            const ilText = snap.il != null ? `${snap.il.toFixed(2)}%` : "—";
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: "#e2e8f0" }}>{selectedPool.symbol}</div>
                    <div style={{ fontSize: "10px", color: "#64748b" }}>{selectedPool.protocol || "Uniswap v4"} · {selectedPool.chain || "Base"}</div>
                  </div>
                  <button onClick={() => setSelectedPool(null)} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer" }}>✕</button>
                </div>
                <ActionNote>
                  Esta visao usa so o que foi confirmado pela sua tx. Nao vou te mostrar APY, TVL ou fee diaria enquanto esses dados nao forem reais.
                </ActionNote>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                  <Metric label="NFT / TOKEN ID" value={selectedPool.tokenId ? `#${selectedPool.tokenId}` : "—"} color="#7dd3fc" />
                  <Metric label="PRECO ATUAL" value={snap.currentPrice > 0 ? `$${fmt(snap.currentPrice, 2)}` : "—"} sub={snap.baseToken || "ativo base"} color="#e2e8f0" />
                  <Metric label="ENTRADA LP" value={snap.entryPrice > 0 ? `$${fmt(snap.entryPrice, 2)}` : "—"} sub={getEntryPriceCaption(snap)} color="#f59e0b" />
                  <Metric label="IL VS HOLD" value={ilText} sub="estimativa full-range" color={snap.il != null && snap.il < -5 ? "#f97316" : "#94a3b8"} />
                </div>
                {(snap.rangeMin > 0 && snap.rangeMax > snap.rangeMin) ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <Metric label="RANGE MIN" value={`$${fmt(snap.rangeMin, 2)}`} sub="extraido automaticamente" color="#a5b4fc" />
                    <Metric label="RANGE MAX" value={`$${fmt(snap.rangeMax, 2)}`} sub="extraido automaticamente" color="#a5b4fc" />
                  </div>
                ) : null}
              </div>
            );
          })()}
        </Card>
      )}

      <Card>
        <SecTitle icon="📋" sub="So o necessario para acompanhar e remontar suas posicoes">Minhas Posicoes</SecTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 140px 150px 90px", gap: "8px", marginBottom: "10px", fontSize: "8px", color: "#475569", letterSpacing: "1px", fontFamily: "monospace" }}>
          <div>POSICAO</div>
          <div>VALOR ATUAL</div>
          <div>ENTRADA</div>
          <div>STATUS</div>
          <div>ACOES</div>
        </div>
        {positions.length === 0 ? (
          <div style={{ padding: "20px 0", fontSize: "11px", color: "#64748b" }}>Nenhuma posicao salva ainda.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {enrichedPositions.map((position) => {
              const snapshot = position.snapshot;
              const range = computeRangeStatus(position, snapshot.currentPrice);
              const action = inferAction(position, snapshot);
              const pnlPct = position.entryValueUSD > 0 ? (((Number(position.liveValueUSD || 0) - Number(position.entryValueUSD || 0)) / Number(position.entryValueUSD || 0)) * 100) : null;
              return (
                <div key={position.id} style={{ padding: "12px", borderRadius: "12px", background: "rgba(2, 6, 14, 0.5)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 140px 150px 90px", gap: "8px", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0" }}>{position.symbol}</div>
                      <div style={{ fontSize: "10px", color: "#64748b" }}>{position.protocol} · {position.chain}</div>
                    </div>
                    <div style={{ fontSize: "12px", color: "#3b82f6", fontFamily: "monospace" }}>${fmt(position.liveValueUSD, 2)}</div>
                    <div style={{ fontSize: "12px", color: "#f59e0b", fontFamily: "monospace" }}>{position.entryPrice > 0 ? `$${fmt(position.entryPrice, 2)}` : "—"}</div>
                    <div style={{ fontSize: "10px", color: range ? range.color : "#94a3b8" }}>{range ? range.label : action.title}</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => setSelectedPositionId(position.id === selectedPositionId ? null : position.id)} style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(148, 163, 184, 0.12)", background: "rgba(15,23,42,0.8)", color: "#cbd5e1", fontSize: "10px", cursor: "pointer" }}>Abrir</button>
                      <button onClick={() => removePosition(position.id)} style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.18)", background: "rgba(239,68,68,0.08)", color: "#fca5a5", fontSize: "10px", cursor: "pointer" }}>Remover</button>
                    </div>
                  </div>
                  {pnlPct != null ? <div style={{ marginTop: "8px", fontSize: "10px", color: pnlPct >= 0 ? "#22c55e" : "#ef4444" }}>{pnlPct >= 0 ? "+" : ""}{fmt(pnlPct, 2)}% vs entrada</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {selectedPosition && selectedSnapshot && selectedAction && (
        <Card>
          <SecTitle icon="🎯" sub="Defina sua faixa e deixe a pagina te dizer quando manter ou remontar">Gerenciador</SecTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#e2e8f0" }}>{selectedPosition.symbol}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                <Metric label="PRECO ATUAL" value={selectedSnapshot.currentPrice > 0 ? `$${fmt(selectedSnapshot.currentPrice, 2)}` : "—"} color="#e2e8f0" />
                <Metric label="ENTRADA LP" value={selectedSnapshot.entryPrice > 0 ? `$${fmt(selectedSnapshot.entryPrice, 2)}` : "—"} sub={getEntryPriceCaption(selectedSnapshot)} color="#f59e0b" />
                <Metric label="IL ESTIMADA" value={selectedSnapshot.il != null ? `${selectedSnapshot.il.toFixed(2)}%` : "—"} color={selectedSnapshot.il != null && selectedSnapshot.il < -5 ? "#f97316" : "#94a3b8"} />
                <Metric label="VALOR ATUAL" value={`$${fmt(selectedPosition.liveValueUSD, 2)}`} color="#3b82f6" />
              </div>
              {selectedPosition.kind === "lp" ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "4px" }}>RANGE MIN</div>
                      <input value={selectedPosition.rangeMin || ""} onChange={(e) => updatePosition(selectedPosition.id, { rangeMin: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="ex: 1800" style={inputStyle} />
                    </div>
                    <div>
                      <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "4px" }}>RANGE MAX</div>
                      <input value={selectedPosition.rangeMax || ""} onChange={(e) => updatePosition(selectedPosition.id, { rangeMax: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="ex: 2600" style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "8px", color: "#475569", letterSpacing: "1px", fontFamily: "monospace", marginBottom: "4px" }}>NOTAS</div>
                    <input value={selectedPosition.notes || ""} onChange={(e) => updatePosition(selectedPosition.id, { notes: e.target.value })} placeholder="sua observacao dessa posicao" style={inputStyle} />
                  </div>
                </>
              ) : (
                <ActionNote color="#7dd3fc">Ativo spot importado da carteira. Esta aba foi simplificada para priorizar o gerenciamento das pools LP.</ActionNote>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <ActionNote color={selectedRange ? selectedRange.color : "#a5b4fc"}>
                <strong style={{ display: "block", marginBottom: "4px" }}>{selectedAction.title}</strong>
                {selectedAction.text}
              </ActionNote>
              {selectedPosition.kind === "lp" ? (
                <>
                  {selectedRange ? <Metric label="STATUS DO RANGE" value={selectedRange.label} sub={selectedRange.detail} color={selectedRange.color} /> : <Metric label="STATUS DO RANGE" value="Sem faixa" sub="preencha range min e max" color="#94a3b8" />}
                  <Metric label="FEES TOKEN 0" value={selectedSnapshot.feesToken0 > 0 ? `${fmt(selectedSnapshot.feesToken0, 6)} ${selectedSnapshot.feeToken0Symbol}` : `0 ${selectedSnapshot.feeToken0Symbol || ""}`.trim()} sub="unclaimed/collected ainda nao lidos da v4" color="#94a3b8" />
                  <Metric label="FEES TOKEN 1" value={selectedSnapshot.feesToken1 > 0 ? `${fmt(selectedSnapshot.feesToken1, 6)} ${selectedSnapshot.feeToken1Symbol}` : `0 ${selectedSnapshot.feeToken1Symbol || ""}`.trim()} sub="unclaimed/collected ainda nao lidos da v4" color="#94a3b8" />
                  <Metric label="FEES USD" value={selectedSnapshot.feesUsd > 0 ? `$${fmt(selectedSnapshot.feesUsd, 2)}` : "$0,00"} sub="sera atualizado quando a leitura on-chain vier" color="#94a3b8" />
                  <Metric label="APORTE BASE" value={selectedPosition.baseAmount > 0 ? `${selectedPosition.baseAmount}` : "—"} sub={selectedPosition.baseToken || "token base"} color="#f59e0b" />
                  <Metric label="APORTE QUOTE" value={selectedPosition.quoteAmount > 0 ? `${selectedPosition.quoteAmount}` : "—"} sub={selectedPosition.quoteToken || "token quote"} color="#22c55e" />
                  {selectedPosition.txHash ? <Metric label="TX BASE" value={`${selectedPosition.txHash.slice(0, 10)}...`} sub="posicao rastreada por tx" color="#7dd3fc" /> : null}
                </>
              ) : (
                <Metric label="REFERENCIA" value={selectedPosition.entryPrice > 0 ? `$${fmt(selectedPosition.entryPrice, 2)}` : "—"} sub="preco spot na importacao" color="#7dd3fc" />
              )}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
          <Metric label="PORTFOLIO TOTAL" value={`$${fmt(totalValueLive, 2)}`} color="#3b82f6" />
          <Metric label="CUSTO TOTAL" value={`$${fmt(totalCost, 2)}`} color="#f59e0b" />
          <Metric label="P&L ESTIMADO" value={`${pnl >= 0 ? "+" : "-"}$${fmt(Math.abs(pnl), 2)}`} color={pnl >= 0 ? "#22c55e" : "#ef4444"} />
        </div>
      </Card>
    </div>
  );
}
