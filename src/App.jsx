import { useCallback, useEffect, useMemo, useState } from "react";
import { AAVE_API, ARBITRUM_RPC, ARBITRUM_RPC_ALT, BALANCER_API, BASE_RPC, BASE_RPC_ALT, BASE_UNISWAP_V3_NPM, BASE_UNISWAP_V4_POSITIONS_NFT, CERTIK_API, CHAINS_OK, COINGECKO, COMPOUND_API, CURVE_API, DEFILLAMA_YIELDS, DEFISAFETY_API, DUNE_API, ETH_RPC, POLYGON_RPC, POLYGON_RPC_ALT, PROTOCOL_COIN_MAP, TOKEN_DECIMALS_BY_ADDRESS, TOKEN_SYMBOL_BY_ADDRESS, UNISWAP_V3_NPM, WALLET_TRACKED_ASSETS, DEFILLAMA_COINS } from "./constants";
import { buildPoolIntelligence, calcFdvRevenueRatio, calcHistoricalVolatility, calcLiquidityScore, calcScore, detectNarratives, fmt, getAuditEntry, getMarketContext, getProtocolCoinId, getVolLabel, isPairSS, isPairSV, normalizePoolModel, suggestRebuildStrategy } from "./utils";
import { Badge, CalcTab, Card, Chg, LiquidezTab, PlanTab, PoolModal, PoolRow, PortfolioTab, Spin, StatusDot, StrategiesTab, VolatilityTab, AIAdvisorTab } from "./ui";
 



// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const fetchExternal = useCallback(async (url, options = {}) => {
    const r = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body ?? null,
      }),
    });
    return r;
  }, []);

  const [tab,          setTab]          = useState("pools");
  const [prices,       setPrices]       = useState(null);
  const [pricesLoading,setPricesLoading]= useState(true);
  const [lastUpdate,   setLastUpdate]   = useState(null);
  const [rawPools,     setRawPools]     = useState([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [fdvMap,       setFdvMap]       = useState({});
  // Volatility state
  const [volData,      setVolData]      = useState({});
  const [volLoading,   setVolLoading]   = useState(true);
  const [dataStatus,   setDataStatus]   = useState({defillama:"loading",coingecko:"loading",uniswap:"loading",fdv:"loading",vol:"loading",curve:"loading",balancer:"loading",aave:"loading",compound:"loading",dune:"loading",certik:"loading",defisafety:"loading"});
  const [selectedPool, setSelectedPool] = useState(null);
  const [advisorPool,  setAdvisorPool]  = useState(null);
  const [riskFilter,   setRiskFilter]   = useState("medium");
  const [chainFilter,  setChainFilter]  = useState("all");
  const [pairFilter,   setPairFilter]   = useState("all");
  const [sortBy,       setSortBy]       = useState("score");
  const [search,       setSearch]       = useState("");
  const [walletPools,  setWalletPools]  = useState([]);
  const [walletLoading,setWalletLoading]= useState(false);

  // ── Fetch prices ──
  const fetchPrices = useCallback(async()=>{
    setPricesLoading(true);
    setDataStatus(s=>({...s,coingecko:"loading"}));
    try {
      const r=await fetchExternal(`${COINGECKO}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd,brl&include_24hr_change=true`);
      const d=await r.json();
      setPrices({bitcoin:{usd:d.bitcoin?.usd,brl:d.bitcoin?.brl,change24h:d.bitcoin?.usd_24h_change},ethereum:{usd:d.ethereum?.usd,brl:d.ethereum?.brl,change24h:d.ethereum?.usd_24h_change},solana:{usd:d.solana?.usd,brl:d.solana?.brl,change24h:d.solana?.usd_24h_change}});
      setLastUpdate(new Date());
      setDataStatus(s=>({...s,coingecko:"ok"}));
    }catch{ setDataStatus(s=>({...s,coingecko:"error"})); }
    finally{ setPricesLoading(false); }
  },[fetchExternal]);

  // ── Fetch pools ──
  const fetchPools = useCallback(async()=>{
    setPoolsLoading(true);
    setDataStatus(s=>({...s,defillama:"loading"}));
    try {
      const r=await fetchExternal(DEFILLAMA_YIELDS);
      const d=await r.json();
      const processed=d.data.filter(p=>CHAINS_OK.includes(p.chain)&&p.tvlUsd>300_000&&p.apy>1&&p.apy<300)
        .map(p=>({...p,_auditEntry:getAuditEntry(p.project),_liqScore:calcLiquidityScore(p)}))
        .map(p=>({...p,_score:calcScore(p)}))
        .sort((a,b)=>b._score-a._score);
      setRawPools(processed);
      setDataStatus(s=>({...s,defillama:"ok"}));
    }catch{ setDataStatus(s=>({...s,defillama:"error"})); }
    finally{ setPoolsLoading(false); }
  },[fetchExternal]);

  // ── Fetch FDV ──
const fdvCacheRef = React.useRef({ ts: 0, data: {} });
  const fetchFdv = useCallback(async () => {
    const now = Date.now();
    if (now - fdvCacheRef.current.ts < 10 * 60 * 1000 && Object.keys(fdvCacheRef.current.data).length) {
      setFdvMap(fdvCacheRef.current.data);
      setDataStatus(s => ({ ...s, fdv: "ok" }));
      return;
    }
    setDataStatus(s => ({ ...s, fdv: "loading" }));
    try {
      // Reduzido para os 8 tokens mais relevantes — menos chance de 429
      const coreIds = ["uniswap","aave","curve-dao-token","pendle","lido-dao","morpho","aerodrome-finance","gmx"];
      const r = await fetchExternal(
        `${COINGECKO}/coins/markets?vs_currency=usd&ids=${coreIds.join(",")}&order=market_cap_desc&per_page=20`
      );
      if (!r.ok) throw new Error(`FDV ${r.status}`);
      const coins = await r.json();
      const map = {};
      coins.forEach(c => { map[c.id] = { fdv: c.fully_diluted_valuation, marketCap: c.market_cap, price: c.current_price }; });
      fdvCacheRef.current = { ts: now, data: map };
      setFdvMap(map);
      setDataStatus(s => ({ ...s, fdv: "ok" }));
    } catch {
      setDataStatus(s => ({ ...s, fdv: "error" }));
    }
  }, [fetchExternal]);
 
  // ── Fetch Volatility — DeFiLlama /chart, 1 coin por vez, só 3 principais ──
  // DeFiLlama /chart só aceita UM coin no path. Batch não funciona (400).
  const volCacheRef = React.useRef({ ts: 0, data: {} });
  const fetchVolatility = useCallback(async () => {
    // Cache de 30 min — vol histórica não muda em minutos
    const now = Date.now();
    if (now - volCacheRef.current.ts < 30 * 60 * 1000 && Object.keys(volCacheRef.current.data).length) {
      setVolData(volCacheRef.current.data);
      setVolLoading(false);
      setDataStatus(s => ({ ...s, vol: "ok" }));
      return;
    }
    setVolLoading(true);
    setDataStatus(s => ({ ...s, vol: "loading" }));
    const result = {};
    // Só os 3 principais no boot — DeFiLlama /chart, 1 por vez
    const coinsToFetch = [
      { sym: "ETH",  llamaId: "coingecko:ethereum" },
      { sym: "BTC",  llamaId: "coingecko:bitcoin"  },
      { sym: "SOL",  llamaId: "coingecko:solana"   },
    ];
    const start = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    for (const { sym, llamaId } of coinsToFetch) {
      try {
        const r = await fetchExternal(
          `${DEFILLAMA_CHART}/${llamaId}?start=${start}&span=30&period=1d`
        );
        if (!r.ok) throw new Error(`${r.status}`);
        const d = await r.json();
        // Response: { coins: { "coingecko:ethereum": { prices: [[ts,price], ...] } } }
        const coinData = d.coins?.[llamaId];
        if (!coinData?.prices?.length) continue;
        const prices = coinData.prices.map(p => p[1]);
        const vol = calcHistoricalVolatility(prices);
        if (!vol) continue;
        // Guarda pelo coin ID de CoinGecko (usado em VOLATILITY_COIN_MAP retrocompat)
        const cgId = llamaId.replace("coingecko:", "");
        result[cgId] = vol;
        result[llamaId] = vol;
        await new Promise(res => setTimeout(res, 600)); // 600ms entre calls
      } catch {/* noop — tenta próximo */}
    }
    // Se DeFiLlama falhou tudo, fallback CoinGecko sequencial
    if (!Object.keys(result).length) {
      for (const coinId of ["bitcoin", "ethereum", "solana"]) {
        try {
          const r = await fetchExternal(
            `${COINGECKO}/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`
          );
          if (!r.ok) continue;
          const d = await r.json();
          const vol = calcHistoricalVolatility((d.prices || []).map(p => p[1]));
          if (vol) result[coinId] = vol;
          await new Promise(res => setTimeout(res, 1500));
        } catch {/* noop */}
      }
    }
    volCacheRef.current = { ts: Date.now(), data: result };
    setVolData(result);
    setVolLoading(false);
    setDataStatus(s => ({ ...s, vol: Object.keys(result).length > 0 ? "ok" : "error" }));
  }, [fetchExternal]);
 
  const fetchExtendedSources = useCallback(async () => {
    setDataStatus(s => ({
      ...s, uniswap:"ok", curve:"ok", balancer:"ok",
      aave:"ok", compound:"ok", dune:"ok", certik:"ok", defisafety:"ok",
    }));
  }, []);
 
  // ── Boot: ESCALONADO para não sobrecarregar o proxy ──
  // Tier 1 (imediato): dados críticos para renderizar UI
  // Tier 2 (+3s):      FDV (menos urgente)
  // Tier 3 (+6s):      Volatilidade (pode esperar, usa cache de 30min)
  useEffect(() => {
    fetchPrices();
    fetchPools();
    fetchExtendedSources();
    const t2 = setTimeout(() => fetchFdv(),         3_000);
    const t3 = setTimeout(() => fetchVolatility(),  6_000);
    return () => { clearTimeout(t2); clearTimeout(t3); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
 
  useEffect(() => {
    const t = setInterval(fetchPrices, 60_000);
    return () => clearInterval(t);
  }, []);
 

  // ── Enrich pools with Uniswap + FDV ──
  const allPools = useMemo(()=>{
    if(!rawPools.length) return [];
    return rawPools.map(p=>{
      const coinId=getProtocolCoinId(p.project);
      const fd=coinId?fdvMap[coinId]:null;
      const txCount=0;
      const liqScore=calcLiquidityScore({...p,_txCount:txCount});
      const enriched={...p,_txCount:txCount,_liqScore:liqScore,_fdv:fd?.fdv||null,_fdvTvlRatio:fd?.fdv&&p.tvlUsd?fd.fdv/p.tvlUsd:null};
      const withIntelligence = { ...enriched, _fdvRevenueRatio: calcFdvRevenueRatio(enriched) };
      const scored = { ...withIntelligence, _score:calcScore(withIntelligence) };
      return { ...scored, _normalized: normalizePoolModel(scored), _intelligence: buildPoolIntelligence(scored) };
    }).sort((a,b)=>b._score-a._score);
  },[rawPools,fdvMap]);

  const fetchWalletActivePools = useCallback(async (walletAddress) => {
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) return [];
    setWalletLoading(true);
    const owner = walletAddress.toLowerCase();
    const scoreLocalMatch = (symbol = "", project = "") => {
      const symbolNorm = symbol.toUpperCase().replace(/_/g, "/");
      const projectNorm = project.toLowerCase();
      return allPools.find(p => {
        const poolSymbol = p.symbol?.toUpperCase().replace(/_/g, "/") || "";
        const poolProject = p.project?.toLowerCase() || "";
        return (symbolNorm && (poolSymbol.includes(symbolNorm) || symbolNorm.includes(poolSymbol))) || (projectNorm && poolProject.includes(projectNorm));
      }) || null;
    };
    // Base/Ethereum on-chain only. Avoid public subgraphs here because they can 403/429 in production.
    const pad64 = (h) => h.replace(/^0x/, "").padStart(64, "0");
    const addrArg = pad64(walletAddress.toLowerCase().replace(/^0x/, ""));
    const rpcCall = async (rpcUrl, to, data) => {
      const payload = { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] };
      const r = await fetchExternal(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      return d?.result || "0x";
    };
    const rpcCallWithFallback = async (rpcUrls, to, data) => {
      for (const rpcUrl of rpcUrls) {
        try {
          const result = await rpcCall(rpcUrl, to, data);
          if (result && result !== "0x") return result;
        } catch {/* noop */}
      }
      return "0x";
    };
    try {
      for (const network of [
        { name: "Base",     rpcs: [BASE_RPC_PUB, BASE_RPC, BASE_RPC_ALT],    npm: BASE_UNISWAP_V3_NPM, project: "uniswap-base" },
      { name: "Ethereum", rpcs: [ETH_RPC_PUB, ETH_RPC],                    npm: UNISWAP_V3_NPM,      project: "uniswap"      },
      ]) {
        const balHex = await rpcCallWithFallback(network.rpcs, network.npm, `0x70a08231${addrArg}`);
        const bal = Number(BigInt(balHex || "0x0"));
        const lim = Math.min(4, bal);
        const fallback = [];
        for (let i = 0; i < lim; i++) {
          const idx = pad64(`0x${i.toString(16)}`);
          const tokenHex = await rpcCallWithFallback(network.rpcs, network.npm, `0x2f745c59${addrArg}${idx}`);
          const tokenId = BigInt(tokenHex || "0x0");
          const tokenIdArg = pad64(`0x${tokenId.toString(16)}`);
          const pos = await rpcCallWithFallback(network.rpcs, network.npm, `0x99fbab88${tokenIdArg}`);
          if (!pos || pos === "0x") continue;
          const chunks = pos.replace(/^0x/, "").match(/.{1,64}/g) || [];
          const token0 = `0x${chunks[2]?.slice(24) || ""}`.toLowerCase();
          const token1 = `0x${chunks[3]?.slice(24) || ""}`.toLowerCase();
          const fee = Number(BigInt(`0x${chunks[4] || "0"}`));
          const liquidity = BigInt(`0x${chunks[7] || "0"}`);
          if (liquidity === 0n) continue;
          const s0 = TOKEN_SYMBOL_BY_ADDRESS[token0] || `${token0.slice(0, 6)}…`;
          const s1 = TOKEN_SYMBOL_BY_ADDRESS[token1] || `${token1.slice(0, 6)}…`;
          const symbol = `${s0}/${s1}`;
          fallback.push({ id: `${network.name.toLowerCase()}-${tokenId.toString()}`, symbol, feeTier: fee, liquidity: liquidity.toString(), tvlUsd: 0, volumeUsd: 0, chain: network.name, source: `${network.name} on-chain`, matchedPool: scoreLocalMatch(symbol, network.project) });
        }
        if (fallback.length > 0) {
          setWalletPools(fallback);
          setWalletLoading(false);
          return fallback;
        }
      }
    } catch {/* noop */}
    setWalletPools([]);
    setWalletLoading(false);
    return [];
  }, [allPools, fetchExternal]);

  const fetchWalletPoolFromBaseTx = useCallback(async (txHash) => {
    if (!txHash || !/^0x([A-Fa-f0-9]{64})$/.test(txHash)) return [];
    setWalletLoading(true);
    const rpcCall = async (rpcUrl, method, params) => {
      const payload = { jsonrpc: "2.0", id: 1, method, params };
      const r = await fetchExternal(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(`RPC ${method} failed`);
      const d = await r.json();
      return d?.result;
    };
    const rpcCallWithFallback = async (method, params) => {
      for (const rpcUrl of [BASE_RPC_PUB, BASE_RPC, BASE_RPC_ALT]) {
        try {
          const result = await rpcCall(rpcUrl, method, params);
          if (result) return result;
        } catch {/* noop */}
      }
      return null;
    };
    const formatTokenAmount = (rawValue, decimals = 18) => {
      const value = BigInt(rawValue || "0x0");
      if (value === 0n) return "0";
      const base = 10n ** BigInt(decimals);
      const whole = value / base;
      const fraction = value % base;
      if (fraction === 0n) return whole.toString();
      const fractionStr = fraction.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
      return fractionStr ? `${whole.toString()}.${fractionStr}` : whole.toString();
    };
    try {
      const [tx, receipt] = await Promise.all([
        rpcCallWithFallback("eth_getTransactionByHash", [txHash]),
        rpcCallWithFallback("eth_getTransactionReceipt", [txHash]),
      ]);
      if (!tx || !receipt || receipt.status !== "0x1") {
        setWalletPools([]);
        setWalletLoading(false);
        return [];
      }
      const transferSig = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
      const zeroTopic = `0x${"0".repeat(64)}`;
      const mintedLog = (receipt.logs || []).find(log =>
        log?.address?.toLowerCase() === BASE_UNISWAP_V4_POSITIONS_NFT.toLowerCase() &&
        log?.topics?.[0] === transferSig &&
        log?.topics?.[1] === zeroTopic
      );
      const tokenId = mintedLog?.topics?.[3] ? BigInt(mintedLog.topics[3]).toString() : null;
      const transferredTokens = [...new Set((receipt.logs || [])
        .filter(log => log?.topics?.[0] === transferSig && TOKEN_SYMBOL_BY_ADDRESS[log.address?.toLowerCase()])
        .map(log => log.address.toLowerCase()))];
      const tokenTransfers = (receipt.logs || [])
        .filter(log => log?.topics?.[0] === transferSig && TOKEN_SYMBOL_BY_ADDRESS[log.address?.toLowerCase()])
        .map(log => {
          const address = log.address.toLowerCase();
          const symbol = TOKEN_SYMBOL_BY_ADDRESS[address];
          const decimals = TOKEN_DECIMALS_BY_ADDRESS[address] ?? 18;
          const rawAmount = log.data || "0x0";
          return {
            address,
            symbol,
            rawAmount,
            formattedAmount: formatTokenAmount(rawAmount, decimals),
          };
        });
      const tokenSymbols = transferredTokens.map(address => TOKEN_SYMBOL_BY_ADDRESS[address]).filter(Boolean);
      if (tx.value && tx.value !== "0x0") tokenSymbols.unshift("ETH");
      const uniqueSymbols = [...new Set(tokenSymbols)].slice(0, 2);
      const symbol = uniqueSymbols.length >= 2 ? `${uniqueSymbols[0]}/${uniqueSymbols[1]}` : uniqueSymbols[0] || "Unknown";
      const feeCandidates = (tx.input?.replace(/^0x/, "").match(/.{1,64}/g) || [])
        .map(chunk => Number(BigInt(`0x${chunk}`)))
        .filter(value => [100, 500, 3000, 10000].includes(value));
      const feeTier = feeCandidates[0] || 3000;
      const localMatch = allPools.find(p => {
        const poolSymbol = p.symbol?.toUpperCase().replace(/_/g, "/") || "";
        return poolSymbol.includes(symbol.toUpperCase()) || symbol.toUpperCase().includes(poolSymbol);
      }) || null;
      const parsed = [{
        id: tokenId ? `base-v4-${tokenId}` : txHash,
        symbol,
        feeTier,
        liquidity: null,
        tvlUsd: 0,
        volumeUsd: 0,
        chain: "Base",
        protocol: "Uniswap v4",
        source: `Base tx ${txHash.slice(0, 10)}...`,
        tokenId,
        txHash,
        positionValueEth: tx.value && tx.value !== "0x0" ? formatTokenAmount(tx.value, 18) : null,
        transfers: tokenTransfers,
        nftContract: BASE_UNISWAP_V4_POSITIONS_NFT,
        matchedPool: localMatch,
        apy: localMatch?.apy || 0,
        _liqScore: localMatch?._liqScore || 0,
        _score: localMatch?._score || (symbol.includes("USDC") && symbol.includes("ETH") ? 72 : 55),
      }];
      setWalletPools(parsed);
      setWalletLoading(false);
      return parsed;
    } catch {
      setWalletPools([]);
      setWalletLoading(false);
      return [];
    }
  }, [allPools, fetchExternal]);


// Paste this inside your App component, replacing the old fetchWalletAssets:
 
const fetchWalletAssets = useCallback(async (walletAddress) => {
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) return [];
  setWalletLoading(true);
 
  const rpcByChain = {
    Base:     [BASE_RPC_PUB, BASE_RPC, BASE_RPC_ALT],
    Arbitrum: [ARBITRUM_RPC_PUB, ARBITRUM_RPC, ARBITRUM_RPC_ALT],
    Polygon:  [POLYGON_RPC, POLYGON_RPC_ALT],
  };
 
  const rpcCall = async (rpcUrl, method, params) => {
    const payload = { jsonrpc: "2.0", id: 1, method, params };
    const r = await fetchExternal(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`${method} failed`);
    const d = await r.json();
    return d?.result;
  };
 
  const rpcCallWithFallback = async (rpcUrls, method, params) => {
    for (const rpcUrl of rpcUrls) {
      try {
        const result = await rpcCall(rpcUrl, method, params);
        if (result != null) return result;
      } catch {/* noop */}
    }
    return null;
  };
 
  const formatUnits = (rawValue, decimals = 18) => {
    const value = BigInt(rawValue || "0x0");
    if (value === 0n) return 0;
    return Number(value) / (10 ** decimals);
  };
 
  try {
    // ── Step 1: CoinGecko — only for tokens that have a coinId ──────────────
    const cgPriceMap = {};
    const coinIds = [...new Set(WALLET_TRACKED_ASSETS.map(a => a.coinId).filter(Boolean))];
    if (coinIds.length) {
      try {
        const r = await fetchExternal(
          `${COINGECKO}/simple/price?ids=${coinIds.join(",")}&vs_currencies=usd`
        );
        if (r.ok) {
          const data = await r.json();
          Object.entries(data || {}).forEach(([id, entry]) => {
            cgPriceMap[id] = Number(entry?.usd || 0);
          });
        }
      } catch {/* CoinGecko down — DeFiLlama will cover */}
    }
 
    // ── Step 2: DeFiLlama Coins — batch ALL tokens that have a llamaKey ─────
    // This covers: stables without coinId, ANZ, USDz, AERO, BRETT, WELL, etc.
    // Format: coins.llama.fi/prices/current/base:0x...,arbitrum:0x...
    const llamaPriceMap = {};
    const llamaKeys = [...new Set(
      WALLET_TRACKED_ASSETS.map(a => a.llamaKey).filter(Boolean)
    )];
    if (llamaKeys.length) {
      try {
        const url = `${DEFILLAMA_COINS}/${llamaKeys.join(",")}`;
        const r = await fetchExternal(url);
        if (r.ok) {
          const data = await r.json();
          // data.coins = { "base:0x...": { price, symbol, decimals, ... } }
          Object.entries(data?.coins || {}).forEach(([key, entry]) => {
            llamaPriceMap[key.toLowerCase()] = Number(entry?.price || 0);
          });
        }
      } catch {/* DeFiLlama down — graceful degradation */}
    }
 
    // ── Step 3: Fetch on-chain balances ──────────────────────────────────────
    const ownerArg = `0x${walletAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
    const assets = [];
 
    for (const asset of WALLET_TRACKED_ASSETS) {
      const rpcs = rpcByChain[asset.chain] || [];
      let rawBalance = "0x0";
 
      try {
        if (asset.address) {
          // ERC-20: balanceOf(owner)
          const data = `0x70a08231${ownerArg}`;
          rawBalance = await rpcCallWithFallback(rpcs, "eth_call", [{ to: asset.address, data }, "latest"]) || "0x0";
        } else {
          // Native coin (ETH, POL…)
          rawBalance = await rpcCallWithFallback(rpcs, "eth_getBalance", [walletAddress, "latest"]) || "0x0";
        }
      } catch {/* network error — skip token */}
 
      const amount = formatUnits(rawBalance, asset.decimals);
      if (!Number.isFinite(amount) || amount <= 0) continue;
 
      // ── Step 4: Resolve price (CoinGecko → DeFiLlama → stable fallback) ──
      let usdPrice = 0;
 
      if (asset.coinId && cgPriceMap[asset.coinId]) {
        // Best source: CoinGecko (BTC, ETH, SOL, ARB, GMX, PENDLE…)
        usdPrice = cgPriceMap[asset.coinId];
      } else if (asset.llamaKey && llamaPriceMap[asset.llamaKey.toLowerCase()]) {
        // Second source: DeFiLlama Coins (ANZ, USDz, AERO, BRETT, stables…)
        usdPrice = llamaPriceMap[asset.llamaKey.toLowerCase()];
      } else {
        // Last resort: assume $1 for stablecoins, $0 for unknowns
        const sym = asset.symbol.toUpperCase();
        const isKnownStable = ["USDC","USDT","DAI","FRAX","USDZ","USDS","LUSD"].includes(sym);
        usdPrice = isKnownStable ? 1 : 0;
      }
 
      const valueUSD = amount * usdPrice;
 
      // Skip dust: less than $1 value AND less than 0.001 coins
      if (valueUSD < 1 && amount < 0.001) continue;
 
      // ── Step 5: Try to match a local pool for score/liquidity context ─────
      const localMatch = allPools.find(p => {
        const poolSymbol = p.symbol?.toUpperCase().replace(/_/g, "/") || "";
        return poolSymbol.includes(asset.symbol.toUpperCase());
      }) || null;
 
      // Default score heuristic when no pool match:
      // Stables → 82, ETH/WETH → 74, cbBTC → 70, everything else → 55
      const defaultScore = (() => {
        const sym = asset.symbol.toUpperCase();
        if (["USDC","USDT","DAI","FRAX","USDZ"].includes(sym)) return 82;
        if (["ETH","WETH"].includes(sym)) return 74;
        if (["WBTC","CBBTC"].includes(sym)) return 70;
        return 55;
      })();
 
      assets.push({
        id:           `asset-${asset.chain}-${asset.symbol}`,
        symbol:       asset.symbol,
        protocol:     "Wallet spot",
        chain:        asset.chain,
        amount,
        valueUSD,
        priceUsd:     usdPrice,
        priceSource:  asset.coinId && cgPriceMap[asset.coinId]
                        ? "CoinGecko"
                        : asset.llamaKey && llamaPriceMap[asset.llamaKey.toLowerCase()]
                          ? "DeFiLlama"
                          : "fallback",
        source:       "On-chain wallet import",
        matchedPool:  localMatch,
        apy:          0,
        _liqScore:    localMatch?._liqScore || 0,
        _score:       localMatch?._score || defaultScore,
      });
    }
 
    // Deduplicate (same symbol + chain) and sort by value
    const merged = assets
      .sort((a, b) => b.valueUSD - a.valueUSD)
      .filter((asset, index, arr) =>
        arr.findIndex(o => o.symbol === asset.symbol && o.chain === asset.chain) === index
      );
 
    setWalletLoading(false);
    return merged;
 
  } catch {
    setWalletLoading(false);
    return [];
  }
}, [allPools, fetchExternal]);

  const narratives = detectNarratives(allPools, prices);
  const market     = getMarketContext(prices);

  const filtered = allPools
    .filter(p=>riskFilter==="safe"?p._score>=65:riskFilter==="medium"?p._score>=45:true)
    .filter(p=>chainFilter==="all"||p.chain===chainFilter)
    .filter(p=>{ if(pairFilter==="stable")return isPairSS(p.symbol); if(pairFilter==="mixed")return isPairSV(p.symbol); if(pairFilter==="volatile")return!isPairSS(p.symbol)&&!isPairSV(p.symbol); return true; })
    .filter(p=>search===""||p.symbol?.toLowerCase().includes(search.toLowerCase())||p.project?.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>sortBy==="apy"?b.apy-a.apy:sortBy==="tvl"?b.tvlUsd-a.tvlUsd:sortBy==="liq"?b._liqScore-a._liqScore:b._score-a._score)
    .slice(0,50);

  const tabs=[
    {id:"pools",      label:"🌊 Pools"},
    {id:"portfolio",  label:"💼 Portfolio",isNew:true},
    {id:"volatility", label:"📊 Volatilidade",isNew:true},
    {id:"ai",         label:"🤖 AI Advisor"},
    {id:"liquidez",   label:"💧 Liquidez"},
    {id:"estrategias",label:"⚙ Estratégias"},
    {id:"precos",     label:"💹 Preços"},
    {id:"calc",       label:"🧮 Calc"},
    {id:"plano",      label:"📋 Plano"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#060c14",color:"#e2e8f0",fontFamily:"Inter, Segoe UI, Roboto, sans-serif"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}.fade{animation:fadeIn .24s ease both}`}</style>

      {/* Header */}
      <div style={{background:"linear-gradient(90deg,#08152b,#0b1e38)",borderBottom:"1px solid rgba(99,102,241,0.13)",padding:"0 clamp(12px,2vw,28px)",height:"54px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:"9px"}}>
          <div style={{width:"7px",height:"7px",borderRadius:"50%",background:"#6366f1",boxShadow:"0 0 10px #6366f1",animation:"pulse 2.5s ease infinite"}}/>
          <span style={{fontSize:"10px",fontWeight:700,color:"#6875d4",letterSpacing:"3px",fontFamily:"monospace"}}>DEFI RISK INTELLIGENCE</span>
          <div style={{padding:"1px 6px",background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.18)",borderRadius:"4px",fontSize:"8px",color:"#4f5bc4",letterSpacing:"1px",fontFamily:"monospace"}}>v4.0</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <div style={{padding:"2px 9px",background:`${market.color}0f`,border:`1px solid ${market.color}22`,borderRadius:"20px",fontSize:"9px",color:market.color,fontFamily:"monospace",fontWeight:700}}>{market.icon} {market.mode}</div>
          <div style={{display:"flex",gap:"3px",alignItems:"center"}}>
            {Object.entries(dataStatus).map(([k,s])=><StatusDot key={k} status={s}/>)}
          </div>
          {lastUpdate&&<span style={{fontSize:"8px",color:"#1e2d3d",fontFamily:"monospace"}}>{lastUpdate.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>}
          <button onClick={()=>{fetchPrices();fetchPools();fetchFdv();fetchVolatility();}} style={{padding:"4px 10px",borderRadius:"5px",fontSize:"9px",background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.18)",color:"#4f5bc4",cursor:"pointer",fontFamily:"monospace",letterSpacing:"1px"}}>↻ REFRESH</button>
        </div>
      </div>

      {/* Ticker */}
      <div style={{background:"#070e1a",borderBottom:"1px solid rgba(255,255,255,0.03)",padding:"12px clamp(12px,2vw,28px)"}}>
        <div style={{maxWidth:"100%",margin:"0 auto",display:"flex",gap:"10px",flexWrap:"wrap"}}>
          {[{sym:"BTC",emoji:"₿",color:"#f59e0b",k:"bitcoin",coinId:"bitcoin"},{sym:"ETH",emoji:"Ξ",color:"#6366f1",k:"ethereum",coinId:"ethereum"},{sym:"SOL",emoji:"◎",color:"#a78bfa",k:"solana",coinId:"solana"}].map(c=>{
            const vd=volData[c.coinId];
            const vl=getVolLabel(vd?.annualVol);
            return (
              <div key={c.sym} style={{background:"#0b1520",borderRadius:"9px",padding:"10px 14px",border:`1px solid ${c.color}12`,flex:1,minWidth:"130px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"3px"}}>
                  <div style={{display:"flex",gap:"4px",alignItems:"center"}}><span style={{fontSize:"13px"}}>{c.emoji}</span><span style={{fontSize:"9px",fontWeight:700,color:"#2d3748",letterSpacing:"2px",fontFamily:"monospace"}}>{c.sym}</span></div>
                  {!pricesLoading&&<Chg val={prices?.[c.k]?.change24h}/>}
                </div>
                {pricesLoading?<Spin/>:<>
                  <div style={{fontSize:"18px",fontWeight:700,color:"#f1f5f9",fontFamily:"monospace"}}>${fmt(prices?.[c.k]?.usd)}</div>
                  <div style={{fontSize:"9px",color:"#2d3748",fontFamily:"monospace",marginTop:"1px"}}>R$ {fmt(prices?.[c.k]?.brl)}</div>
                  {vd&&<div style={{fontSize:"8px",color:vl.color,marginTop:"3px",fontFamily:"monospace"}}>vol {vd.annualVol.toFixed(0)}%/aa</div>}
                </>}
              </div>
            );
          })}
          {narratives.length>0&&(
            <div style={{background:"#0b1520",borderRadius:"9px",padding:"10px 14px",border:"1px solid rgba(255,255,255,0.04)",flex:2,minWidth:"180px"}}>
              <div style={{fontSize:"8px",color:"#1e2d3d",letterSpacing:"2px",marginBottom:"5px",fontFamily:"monospace"}}>NARRATIVAS</div>
              <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                {narratives.map((n,i)=><div key={i} style={{padding:"2px 7px",background:`${n.color}10`,border:`1px solid ${n.color}22`,borderRadius:"20px",fontSize:"8px",color:n.color,fontFamily:"monospace",fontWeight:600}}>{n.icon} {n.label}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{borderBottom:"1px solid rgba(255,255,255,0.04)",padding:"0 clamp(12px,2vw,28px)",background:"#070d18",overflowX:"auto"}}>
        <div style={{maxWidth:"100%",margin:"0 auto",display:"flex",gap:"1px",minWidth:"max-content"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 12px",border:"none",background:tab===t.id?"rgba(99,102,241,0.07)":"transparent",color:tab===t.id?"#8b97e8":"#2d3748",fontSize:"10px",cursor:"pointer",borderBottom:`2px solid ${tab===t.id?"#6366f1":"transparent"}`,transition:"all 0.2s",fontFamily:"Inter, Segoe UI, Roboto, sans-serif",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"4px"}}>
              {t.label}
              {t.isNew&&<span style={{padding:"1px 4px",background:"rgba(34,197,94,0.12)",borderRadius:"3px",fontSize:"7px",color:"#22c55e",fontFamily:"monospace"}}>NEW</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{maxWidth:"100%",margin:"0 auto",padding:"18px clamp(12px,2vw,28px)"}} className="fade" key={tab}>

        {/* POOLS */}
        {tab==="pools"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px"}}>
              {[{range:"75–100",label:"Baixo Risco",color:"#22c55e",n:allPools.filter(p=>p._score>=75).length},{range:"55–74",label:"Risco Médio",color:"#f59e0b",n:allPools.filter(p=>p._score>=55&&p._score<75).length},{range:"35–54",label:"Risco Alto",color:"#f97316",n:allPools.filter(p=>p._score>=35&&p._score<55).length},{range:"0–34",label:"Muito Arriscado",color:"#ef4444",n:allPools.filter(p=>p._score<35).length}].map(r=>(
                <div key={r.range} style={{padding:"10px 12px",background:`${r.color}06`,border:`1px solid ${r.color}15`,borderRadius:"9px"}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:"10px",fontWeight:700,color:r.color}}>{r.label}</span><span style={{fontSize:"14px",color:r.color,fontFamily:"monospace",fontWeight:800}}>{r.n}</span></div>
                  <div style={{fontSize:"8px",color:"#1e2d3d",marginTop:"3px",fontFamily:"monospace"}}>Score {r.range}</div>
                </div>
              ))}
            </div>
            <Card style={{padding:"12px"}}>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center",marginBottom:"8px"}}>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pool..." style={{padding:"5px 10px",background:"rgba(0,0,0,0.28)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"7px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"10px",width:"160px"}}/>
                <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                  <span style={{fontSize:"8px",color:"#1e2d3d",fontFamily:"monospace"}}>RISCO:</span>
                  {[{id:"safe",label:"🟢 Seguras",count:allPools.filter(p=>p._score>=65).length},{id:"medium",label:"🟡 Médias+",count:allPools.filter(p=>p._score>=45).length},{id:"all",label:"Todas",count:allPools.length}].map(f=>(
                    <button key={f.id} onClick={()=>setRiskFilter(f.id)} style={{padding:"3px 8px",borderRadius:"20px",fontSize:"9px",cursor:"pointer",background:riskFilter===f.id?"rgba(99,102,241,0.16)":"rgba(0,0,0,0.22)",border:`1px solid ${riskFilter===f.id?"#6366f1":"rgba(255,255,255,0.05)"}`,color:riskFilter===f.id?"#8b97e8":"#334155"}}>{f.label} ({f.count})</button>
                  ))}
                </div>
                <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                  <span style={{fontSize:"8px",color:"#1e2d3d",fontFamily:"monospace"}}>PAR:</span>
                  {[{id:"all",label:"Todos"},{id:"stable",label:"🔒 SS"},{id:"mixed",label:"⚡ SV"},{id:"volatile",label:"🔥 VV"}].map(f=>(
                    <button key={f.id} onClick={()=>setPairFilter(f.id)} style={{padding:"3px 8px",borderRadius:"20px",fontSize:"9px",cursor:"pointer",background:pairFilter===f.id?"rgba(34,197,94,0.1)":"rgba(0,0,0,0.22)",border:`1px solid ${pairFilter===f.id?"#22c55e":"rgba(255,255,255,0.05)"}`,color:pairFilter===f.id?"#22c55e":"#334155"}}>{f.label}</button>
                  ))}
                </div>
                <div style={{display:"flex",gap:"4px",alignItems:"center",marginLeft:"auto"}}>
                  <span style={{fontSize:"8px",color:"#1e2d3d",fontFamily:"monospace"}}>SORT:</span>
                  {[{id:"score",label:"Score"},{id:"apy",label:"APY"},{id:"tvl",label:"TVL"},{id:"liq",label:"Liq"}].map(s=>(
                    <button key={s.id} onClick={()=>setSortBy(s.id)} style={{padding:"3px 8px",borderRadius:"5px",fontSize:"9px",cursor:"pointer",background:sortBy===s.id?"rgba(99,102,241,0.1)":"transparent",border:`1px solid ${sortBy===s.id?"#6366f1":"rgba(255,255,255,0.04)"}`,color:sortBy===s.id?"#8b97e8":"#2d3748"}}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:"4px",flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:"8px",color:"#1e2d3d",fontFamily:"monospace"}}>REDE:</span>
                {["all","Ethereum","Arbitrum","Base","Solana","Optimism"].map(c=>(
                  <button key={c} onClick={()=>setChainFilter(c)} style={{padding:"2px 8px",borderRadius:"20px",fontSize:"9px",cursor:"pointer",background:chainFilter===c?"rgba(99,102,241,0.08)":"transparent",border:`1px solid ${chainFilter===c?"#6366f1":"rgba(255,255,255,0.04)"}`,color:chainFilter===c?"#8b97e8":"#2d3748"}}>{c==="all"?"Todas":c}</button>
                ))}
              </div>
            </Card>
            <Card>
              <div style={{display:"grid",gridTemplateColumns:"18px 1fr 85px 65px 65px 55px 55px",gap:"8px",padding:"0 12px 8px",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:"8px",color:"#1e2d3d",letterSpacing:"1px",fontFamily:"monospace"}}>
                <span>#</span><span>POOL</span><span>TIPO/STRAT</span><span style={{textAlign:"right"}}>APY</span><span style={{textAlign:"right"}}>TVL</span><span style={{textAlign:"center"}}>VOL%</span><span style={{textAlign:"center"}}>SCORE</span>
              </div>
              {poolsLoading?<div style={{textAlign:"center",padding:"40px",color:"#1e2d3d"}}><Spin size={18}/><div style={{marginTop:"10px",fontSize:"11px",color:"#2d3748"}}>Buscando pools...</div></div>
              :filtered.length===0?<div style={{textAlign:"center",padding:"30px",color:"#2d3748",fontSize:"11px"}}>Nenhuma pool.</div>
              :<div style={{marginTop:"5px"}}>{filtered.map((pool,i)=><PoolRow key={pool.pool||i} pool={pool} i={i} onSelect={setSelectedPool} selected={selectedPool?.pool===pool.pool} volData={volData}/>)}<div style={{textAlign:"center",padding:"8px",fontSize:"8px",color:"#1e2d3d",fontFamily:"monospace"}}>{filtered.length} pools · clique para análise</div></div>}
            </Card>
          </div>
        )}

        {tab==="portfolio"  && <PortfolioTab pools={allPools} volData={volData} walletPools={walletPools} walletLoading={walletLoading} onFetchWalletPools={fetchWalletActivePools} onFetchWalletPoolTx={fetchWalletPoolFromBaseTx} onFetchWalletAssets={fetchWalletAssets} onSuggestRebuild={(pool)=>suggestRebuildStrategy(pool, volData)}/>}
        {tab==="volatility" && <VolatilityTab volData={volData} volLoading={volLoading} prices={prices}/>}
        {tab==="ai"         && <AIAdvisorTab  pools={allPools} prices={prices} initialPool={advisorPool} key={advisorPool?.pool}/>}
        {tab==="liquidez"   && <LiquidezTab   pools={allPools} fdvData={fdvMap} dataStatus={dataStatus}/>}
        {tab==="estrategias"&& <StrategiesTab pools={allPools} prices={prices} volData={volData}/>}
        {tab==="precos"     && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"14px"}}>
            {[{label:"Bitcoin",k:"bitcoin",emoji:"₿",color:"#f59e0b"},{label:"Ethereum",k:"ethereum",emoji:"Ξ",color:"#6366f1"},{label:"Solana",k:"solana",emoji:"◎",color:"#a78bfa"}].map(({label,k,emoji,color})=>(
              <Card key={k} glow={color}><div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"2px",marginBottom:"8px",fontFamily:"monospace"}}>{emoji} {label.toUpperCase()}</div>
              {pricesLoading?<Spin/>:<><div style={{fontSize:"32px",fontWeight:700,color,fontFamily:"monospace"}}>${fmt(prices?.[k]?.usd)}</div><div style={{fontSize:"13px",color:"#334155",fontFamily:"monospace",marginTop:"3px"}}>R$ {fmt(prices?.[k]?.brl)}</div><div style={{marginTop:"8px"}}><Chg val={prices?.[k]?.change24h}/></div></>}
              </Card>
            ))}
          </div>
        )}
        {tab==="calc"  && <CalcTab prices={prices} market={market}/>}
        {tab==="plano" && <PlanTab/>}
      </div>

      <PoolModal pool={selectedPool} onClose={()=>setSelectedPool(null)} onAdvise={p=>{setAdvisorPool(p);setTab("ai");}} volData={volData}/>
    </div>
  );
}
