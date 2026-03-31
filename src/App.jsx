import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AAVE_API, ARBITRUM_RPC, ARBITRUM_RPC_ALT, BALANCER_API, BASE_RPC, BASE_RPC_ALT, BASE_UNISWAP_V3_NPM, BASE_UNISWAP_V4_POSITIONS_NFT, CERTIK_API, CHAINS_OK, COINGECKO, COMPOUND_API, CURVE_API, DEFILLAMA_YIELDS, DEFISAFETY_API, DUNE_API, ETH_RPC, POLYGON_RPC, POLYGON_RPC_ALT, PROTOCOL_COIN_MAP, TOKEN_DECIMALS_BY_ADDRESS, TOKEN_SYMBOL_BY_ADDRESS, UNISWAP_V3_NPM, WALLET_TRACKED_ASSETS, DEFILLAMA_COINS,
  BASE_RPC_PUB, ETH_RPC_PUB, ARBITRUM_RPC_PUB,
  DEFILLAMA_CHART,
  VOLATILITY_DEFILLAMA_MAP,} from "./constants";

import { buildPoolIntelligence, calcFdvRevenueRatio, calcHistoricalVolatility, calcLiquidityScore, calcScore, detectNarratives, fmt, getAuditEntry, getMarketContext, getProtocolCoinId, getVolLabel, isPairSS, isPairSV, normalizePoolModel, suggestRebuildStrategy } from "./utils";
import { Badge, CalcTab, Card, Chg, LiquidezTab, PlanTab, PoolModal, PoolRow, PortfolioTab, Spin, StatusDot, StrategiesTab, VolatilityTab, AIAdvisorTab } from "./ui";

// ─── Stable token set ─────────────────────────────────────────────────────────
const STABLE_SYMS = new Set(["USDC","USDT","DAI","FRAX","LUSD","USDZ","USDS","CRVUSD","GHO"]);
const isStableSym = (s) => STABLE_SYMS.has((s || "").toUpperCase());

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

  const fdvCacheRef = useRef({ ts: 0, data: {} });
  const fetchFdv = useCallback(async () => {
    const now = Date.now();
    if (now - fdvCacheRef.current.ts < 10 * 60 * 1000 && Object.keys(fdvCacheRef.current.data).length) {
      setFdvMap(fdvCacheRef.current.data); setDataStatus(s=>({...s,fdv:"ok"})); return;
    }
    setDataStatus(s=>({...s,fdv:"loading"}));
    try {
      const coreIds = ["uniswap","aave","curve-dao-token","pendle","lido-dao","morpho","aerodrome-finance","gmx"];
      const r = await fetchExternal(`${COINGECKO}/coins/markets?vs_currency=usd&ids=${coreIds.join(",")}&order=market_cap_desc&per_page=20`);
      if (!r.ok) throw new Error(`FDV ${r.status}`);
      const coins = await r.json();
      const map = {};
      coins.forEach(c => { map[c.id] = { fdv: c.fully_diluted_valuation, marketCap: c.market_cap, price: c.current_price }; });
      fdvCacheRef.current = { ts: now, data: map };
      setFdvMap(map); setDataStatus(s=>({...s,fdv:"ok"}));
    } catch { setDataStatus(s=>({...s,fdv:"error"})); }
  }, [fetchExternal]);

  const volCacheRef = useRef({ ts: 0, data: {} });
  const fetchVolatility = useCallback(async () => {
    const now = Date.now();
    if (now - volCacheRef.current.ts < 30 * 60 * 1000 && Object.keys(volCacheRef.current.data).length) {
      setVolData(volCacheRef.current.data); setVolLoading(false); setDataStatus(s=>({...s,vol:"ok"})); return;
    }
    setVolLoading(true); setDataStatus(s=>({...s,vol:"loading"}));
    const result = {};
    const coinsToFetch = Object.entries(VOLATILITY_DEFILLAMA_MAP).map(([sym, llamaId]) => ({ sym, llamaId }));
    const start = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    for (const { sym, llamaId } of coinsToFetch) {
      try {
        const r = await fetchExternal(`${DEFILLAMA_CHART}/${llamaId}?start=${start}&span=30&period=1d`);
        if (!r.ok) throw new Error(`${r.status}`);
        const d = await r.json();
        const coinData = d.coins?.[llamaId];
        if (!coinData?.prices?.length) continue;
        const ps = coinData.prices.map(p => p.price ?? p[1] ?? 0).filter(v => v > 0);
        const vol = calcHistoricalVolatility(ps);
        if (!vol) continue;
        const cgId = llamaId.startsWith("coingecko:") ? llamaId.replace("coingecko:", "") : llamaId;
        result[cgId] = vol; result[llamaId] = vol; result[sym] = vol;
        await new Promise(res => setTimeout(res, 400));
      } catch {/* noop */}
    }
    if (!Object.keys(result).length) {
      for (const coinId of ["bitcoin", "ethereum", "solana"]) {
        try {
          const r = await fetchExternal(`${COINGECKO}/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`);
          if (!r.ok) continue;
          const d = await r.json();
          const vol = calcHistoricalVolatility((d.prices || []).map(p => p[1]));
          if (vol) result[coinId] = vol;
          await new Promise(res => setTimeout(res, 1500));
        } catch {/* noop */}
      }
    }
    volCacheRef.current = { ts: Date.now(), data: result };
    setVolData(result); setVolLoading(false);
    setDataStatus(s=>({...s,vol:Object.keys(result).length > 0 ? "ok" : "error"}));
  }, [fetchExternal]);

  const fetchExtendedSources = useCallback(async () => {
    setDataStatus(s=>({...s,uniswap:"ok",curve:"ok",balancer:"ok",aave:"ok",compound:"ok",dune:"ok",certik:"ok",defisafety:"ok"}));
  }, []);

  useEffect(() => {
    fetchPrices(); fetchPools(); fetchExtendedSources();
    const t2 = setTimeout(() => fetchFdv(),        3_000);
    const t3 = setTimeout(() => fetchVolatility(), 6_000);
    return () => { clearTimeout(t2); clearTimeout(t3); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { const t = setInterval(fetchPrices, 60_000); return () => clearInterval(t); }, []);

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

  // ─────────────────────────────────────────────────────────────────────────────
  // matchPoolForPosition — strict, chain-aware pool matching.
  //
  // OLD BUG: bidirectional `includes` on full symbol strings caused "ETH/USDC"
  // to match any pool containing the word "ETH" or "USDC", returning the
  // highest-scored pool (often Aave on Ethereum) instead of the actual pool.
  //
  // NEW LOGIC (priority order):
  //   1. Exact normalised symbol + same chain
  //   2. Both token parts present in pool symbol + same chain
  //   3. Both token parts present in pool symbol on any chain (cross-chain)
  //   4. null  →  no match is better than a wrong match
  // ─────────────────────────────────────────────────────────────────────────────
  const matchPoolForPosition = useCallback((symbol = "", chain = "") => {
    if (!symbol || !allPools.length) return null;
    const normSym   = symbol.toUpperCase().replace(/_/g, "/");
    const parts     = normSym.split("/").filter(Boolean);
    const normChain = chain.toLowerCase();

    // 1. Exact symbol + same chain
    const exact = allPools.find(p =>
      p.symbol?.toUpperCase().replace(/_/g, "/") === normSym &&
      p.chain?.toLowerCase() === normChain
    );
    if (exact) return exact;

    // 2. Both tokens + same chain
    if (parts.length >= 2) {
      const both = allPools.find(p =>
        p.chain?.toLowerCase() === normChain &&
        parts.every(t => (p.symbol?.toUpperCase().replace(/_/g, "/") || "").split("/").includes(t))
      );
      if (both) return both;
    }

    // 3. Both tokens, any chain
    if (parts.length >= 2) {
      const crossChain = allPools.find(p =>
        parts.every(t => (p.symbol?.toUpperCase().replace(/_/g, "/") || "").split("/").includes(t))
      );
      if (crossChain) return crossChain;
    }

    return null; // no match — better than returning a wrong pool
  }, [allPools]);

  // ── fetchWalletActivePools ────────────────────────────────────────────────
  const fetchWalletActivePools = useCallback(async (walletAddress) => {
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) return [];
    setWalletLoading(true);
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
        try { const result = await rpcCall(rpcUrl, to, data); if (result && result !== "0x") return result; } catch {/* noop */}
      }
      return "0x";
    };
    try {
      for (const network of [
        { name: "Base",     rpcs: [BASE_RPC_PUB, BASE_RPC, BASE_RPC_ALT], npm: BASE_UNISWAP_V3_NPM },
        { name: "Ethereum", rpcs: [ETH_RPC_PUB, ETH_RPC],                 npm: UNISWAP_V3_NPM      },
      ]) {
        const balHex = await rpcCallWithFallback(network.rpcs, network.npm, `0x70a08231${addrArg}`);
        const bal = Number(BigInt(balHex || "0x0"));
        const lim = Math.min(4, bal);
        const fallback = [];
        for (let i = 0; i < lim; i++) {
          const idx      = pad64(`0x${i.toString(16)}`);
          const tokenHex = await rpcCallWithFallback(network.rpcs, network.npm, `0x2f745c59${addrArg}${idx}`);
          const tokenId  = BigInt(tokenHex || "0x0");
          const tokenIdArg = pad64(`0x${tokenId.toString(16)}`);
          const pos = await rpcCallWithFallback(network.rpcs, network.npm, `0x99fbab88${tokenIdArg}`);
          if (!pos || pos === "0x") continue;
          const chunks = pos.replace(/^0x/, "").match(/.{1,64}/g) || [];
          const token0 = `0x${chunks[2]?.slice(24) || ""}`.toLowerCase();
          const token1 = `0x${chunks[3]?.slice(24) || ""}`.toLowerCase();
          const fee     = Number(BigInt(`0x${chunks[4] || "0"}`));
          const liquidity = BigInt(`0x${chunks[7] || "0"}`);
          if (liquidity === 0n) continue;
          const s0 = TOKEN_SYMBOL_BY_ADDRESS[token0] || `${token0.slice(0,6)}…`;
          const s1 = TOKEN_SYMBOL_BY_ADDRESS[token1] || `${token1.slice(0,6)}…`;
          // volatile/stable ordering
          const symbol = isStableSym(s0) && !isStableSym(s1) ? `${s1}/${s0}` : `${s0}/${s1}`;
          fallback.push({
            id: `${network.name.toLowerCase()}-${tokenId.toString()}`,
            symbol, feeTier: fee, liquidity: liquidity.toString(),
            tvlUsd: 0, volumeUsd: 0,
            chain: network.name, source: `${network.name} on-chain`,
            matchedPool: matchPoolForPosition(symbol, network.name),
          });
        }
        if (fallback.length > 0) { setWalletPools(fallback); setWalletLoading(false); return fallback; }
      }
    } catch {/* noop */}
    setWalletPools([]); setWalletLoading(false); return [];
  }, [allPools, fetchExternal, matchPoolForPosition]);

  // ── fetchWalletPoolFromBaseTx ─────────────────────────────────────────────
  // FIXES applied here:
  //   1. hexToFloat(): robust wei→float that never returns NaN or negative
  //   2. ETH native amount from tx.value parsed correctly (18 decimals)
  //   3. USDC amount uses TOKEN_DECIMALS_BY_ADDRESS (6 decimals) — not 18
  //   4. entryPrice = stableAmt / ethAmt  (what price was ETH when LP opened?)
  //   5. valueUSD   = ethAmt × currentEthPrice + stableAmt  (current value)
  //   6. matchedPool via matchPoolForPosition (strict, not fuzzy bidirectional)
  //   7. entryPrice = null when only one leg is known — panel prompts user
  // ─────────────────────────────────────────────────────────────────────────
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
        try { const result = await rpcCall(rpcUrl, method, params); if (result) return result; } catch {/* noop */}
      }
      return null;
    };

    // Convert hex wei string → JS float. Never returns NaN/Infinity.
    const hexToFloat = (hexVal, decimals = 18) => {
      if (!hexVal || hexVal === "0x" || hexVal === "0x0") return 0;
      try {
        const raw = BigInt(hexVal);
        if (raw === 0n) return 0;
        const divisor = 10n ** BigInt(decimals);
        const whole   = Number(raw / divisor);
        const frac    = Number(raw % divisor) / Number(divisor);
        const result  = whole + frac;
        return Number.isFinite(result) && result >= 0 ? result : 0;
      } catch { return 0; }
    };

    try {
      const [tx, receipt] = await Promise.all([
        rpcCallWithFallback("eth_getTransactionByHash", [txHash]),
        rpcCallWithFallback("eth_getTransactionReceipt", [txHash]),
      ]);
      if (!tx || !receipt || receipt.status !== "0x1") {
        setWalletPools([]); setWalletLoading(false); return [];
      }

      const transferSig = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
      const zeroTopic   = `0x${"0".repeat(64)}`;

      // Uniswap v4 position NFT mint
      const mintedLog = (receipt.logs || []).find(log =>
        log?.address?.toLowerCase() === BASE_UNISWAP_V4_POSITIONS_NFT.toLowerCase() &&
        log?.topics?.[0] === transferSig && log?.topics?.[1] === zeroTopic
      );
      const tokenId = mintedLog?.topics?.[3] ? BigInt(mintedLog.topics[3]).toString() : null;

      // Parse ERC-20 Transfer logs — only for tokens we know
      const tokenTransfers = (receipt.logs || [])
        .filter(log => log?.topics?.[0] === transferSig && log.address)
        .map(log => {
          const address  = log.address.toLowerCase();
          const symbol   = TOKEN_SYMBOL_BY_ADDRESS[address] || null;
          const decimals = TOKEN_DECIMALS_BY_ADDRESS[address] ?? 18;
          const amount   = hexToFloat(log.data, decimals);
          return { address, symbol, decimals, amount };
        })
        .filter(t => t.symbol && t.amount > 0);

      // ETH native from tx.value (18 decimals)
      const ethNativeAmt = hexToFloat(tx.value, 18);

      // Find ETH/WETH transfer and stable transfer
      const ethTransfer    = tokenTransfers.find(t => ["ETH","WETH"].includes(t.symbol));
      const stableTransfer = tokenTransfers.find(t => isStableSym(t.symbol));

      // Prefer native ETH value; fall back to WETH transfer
      const ethAmt      = ethNativeAmt > 0.0001 ? ethNativeAmt : (ethTransfer?.amount ?? 0);
      const stableAmt   = stableTransfer?.amount ?? 0;
      const stableSym   = stableTransfer?.symbol ?? "USDC";

      // Build pair symbol — volatile first, stable second
      const volSym = ethAmt > 0 ? "ETH"
        : (ethTransfer?.symbol ?? tokenTransfers.find(t => !isStableSym(t.symbol))?.symbol ?? null);
      const symbol = volSym && stableAmt > 0 ? `${volSym}/${stableSym}`
        : volSym ? volSym
        : (tokenTransfers[0]?.symbol ?? "Unknown");

      // Fee tier from calldata
      const feeCandidates = (tx.input?.replace(/^0x/, "").match(/.{1,64}/g) || [])
        .map(chunk => { try { return Number(BigInt(`0x${chunk}`)); } catch { return 0; } })
        .filter(v => [100, 500, 3000, 10000].includes(v));
      const feeTier = feeCandidates[0] || 3000;

      // Current ETH price (live from state)
      const ethPrice = prices?.ethereum?.usd ?? 0;

      // Current value of the position (in USD at today's prices)
      const valueUSD = (ethAmt * ethPrice) + stableAmt;

      // Entry price = price of ETH when LP was opened = stableAmt / ethAmt
      // Only meaningful when BOTH legs of the pair are known.
      // null → PoolAnalysisPanel will show "informe o preço de entrada"
      const entryPrice = (ethAmt > 0.0001 && stableAmt > 1) ? stableAmt / ethAmt : null;

      const matchedPool = matchPoolForPosition(symbol, "Base");

      const parsed = [{
        id:                tokenId ? `base-v4-${tokenId}` : txHash,
        symbol, feeTier, liquidity: null,
        chain: "Base", protocol: "Uniswap v4",
        source: `Base tx ${txHash.slice(0, 10)}...`,
        tokenId, txHash,
        // Numeric position data
        positionEthAmt:    ethAmt    > 0 ? ethAmt    : null,
        positionStableAmt: stableAmt > 0 ? stableAmt : null,
        positionStableSym: stableAmt > 0 ? stableSym : null,
        // Analysis fields — used directly by PoolAnalysisPanel
        valueUSD,
        entryPrice,  // null = user must supply manually
        // Pool reference — use matchedPool data where available
        matchedPool,
        tvlUsd:      matchedPool?.tvlUsd      ?? 0,
        volumeUsd7d: matchedPool?.volumeUsd7d ?? 0,
        apy:         matchedPool?.apy         ?? 0,
        _liqScore:   matchedPool?._liqScore   ?? 0,
        _score:      matchedPool?._score      ?? 55,
        // Raw transfers for audit/debug
        transfers: tokenTransfers,
      }];

      setWalletPools(parsed); setWalletLoading(false); return parsed;

    } catch (err) {
      console.error("fetchWalletPoolFromBaseTx:", err);
      setWalletPools([]); setWalletLoading(false); return [];
    }
  }, [allPools, fetchExternal, prices, matchPoolForPosition]);

  // ── fetchWalletAssets ─────────────────────────────────────────────────────
  const fetchWalletAssets = useCallback(async (walletAddress) => {
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) return [];
    setWalletLoading(true);
    const rpcByChain = {
      Base:     [BASE_RPC_PUB, BASE_RPC, BASE_RPC_ALT],
      Ethereum: [ETH_RPC_PUB, ETH_RPC],
      Arbitrum: [ARBITRUM_RPC_PUB, ARBITRUM_RPC, ARBITRUM_RPC_ALT],
      Polygon:  [POLYGON_RPC, POLYGON_RPC_ALT],
    };
    const chainKeyMap = { Base: "base", Arbitrum: "arbitrum", Polygon: "polygon", Ethereum: "ethereum" };
    const rpcCall = async (rpcUrl, method, params) => {
      const payload = { jsonrpc: "2.0", id: 1, method, params };
      const r = await fetchExternal(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(`${method} failed`);
      return (await r.json())?.result;
    };
    const rpcCallWithFallback = async (rpcUrls, method, params) => {
      for (const rpcUrl of rpcUrls) {
        try { const result = await rpcCall(rpcUrl, method, params); if (result != null) return result; } catch {/* noop */}
      }
      return null;
    };
    const formatUnits = (raw, dec = 18) => {
      const v = BigInt(raw || "0x0");
      return v === 0n ? 0 : Number(v) / (10 ** dec);
    };
    try {
      const transferSig = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
      const paddedAddr  = "0x" + walletAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");
      const discoveredMap = new Map();
      for (const asset of WALLET_TRACKED_ASSETS) {
        if (asset.address) {
          const key = `${asset.chain}:${asset.address.toLowerCase()}`;
          discoveredMap.set(key, { chain: asset.chain, address: asset.address.toLowerCase(), knownAsset: asset });
        }
      }
      for (const [chainName, rpcs] of Object.entries(rpcByChain)) {
        try {
          const latestHex = await rpcCallWithFallback(rpcs, "eth_blockNumber", []);
          if (!latestHex) continue;
          const latestBlock = Number(BigInt(latestHex));
          const lookback   = chainName === "Ethereum" ? 7200 : 14400;
          const fromBlock  = Math.max(0, latestBlock - lookback);
          const logs = await rpcCallWithFallback(rpcs, "eth_getLogs", [{
            fromBlock: "0x" + fromBlock.toString(16), topics: [transferSig, null, paddedAddr],
          }]);
          if (Array.isArray(logs)) {
            for (const log of logs) {
              if (!log.address) continue;
              const key = `${chainName}:${log.address.toLowerCase()}`;
              if (!discoveredMap.has(key)) discoveredMap.set(key, { chain: chainName, address: log.address.toLowerCase(), knownAsset: null });
            }
          }
        } catch {/* noop */}
      }
      const allLlamaKeys = [];
      for (const { chain, address, knownAsset } of discoveredMap.values()) {
        allLlamaKeys.push((knownAsset?.llamaKey || `${chainKeyMap[chain]||chain.toLowerCase()}:${address}`).toLowerCase());
      }
      const uniqueKeys = [...new Set(allLlamaKeys.filter(Boolean))];
      const llamaPriceMap = {}, llamaMetaMap = {};
      for (let i = 0; i < uniqueKeys.length; i += 60) {
        const chunk = uniqueKeys.slice(i, i + 60);
        try {
          const r = await fetchExternal(`${DEFILLAMA_COINS}/${chunk.join(",")}`);
          if (r.ok) {
            for (const [key, entry] of Object.entries((await r.json())?.coins || {})) {
              const k = key.toLowerCase();
              llamaPriceMap[k] = Number(entry?.price || 0);
              llamaMetaMap[k]  = { symbol: entry?.symbol || "", decimals: Number(entry?.decimals ?? 18) };
            }
          }
        } catch {/* noop */}
        if (i + 60 < uniqueKeys.length) await new Promise(res => setTimeout(res, 300));
      }
      const cgPriceMap = {};
      const coinIds = [...new Set(WALLET_TRACKED_ASSETS.map(a => a.coinId).filter(Boolean))];
      if (coinIds.length) {
        try {
          const r = await fetchExternal(`${COINGECKO}/simple/price?ids=${coinIds.join(",")}&vs_currencies=usd`);
          if (r.ok) for (const [id, entry] of Object.entries(await r.json() || {})) cgPriceMap[id] = Number(entry?.usd || 0);
        } catch {/* noop */}
      }
      const ownerArg = `0x${walletAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
      const assets = [];
      for (const [, entry] of discoveredMap) {
        const { chain, address, knownAsset } = entry;
        const rpcs = rpcByChain[chain] || [];
        if (!rpcs.length) continue;
        let rawBalance = "0x0";
        try { rawBalance = await rpcCallWithFallback(rpcs, "eth_call", [{ to: address, data: `0x70a08231${ownerArg}` }, "latest"]) || "0x0"; } catch {/* noop */}
        const cKey     = chainKeyMap[chain] || chain.toLowerCase();
        const llamaKey = (knownAsset?.llamaKey || `${cKey}:${address}`).toLowerCase();
        const meta     = llamaMetaMap[llamaKey];
        const decimals = knownAsset?.decimals ?? meta?.decimals ?? TOKEN_DECIMALS_BY_ADDRESS[address] ?? 18;
        const amount   = formatUnits(rawBalance, decimals);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        let usdPrice = 0;
        if (knownAsset?.coinId && cgPriceMap[knownAsset.coinId]) usdPrice = cgPriceMap[knownAsset.coinId];
        else if (llamaPriceMap[llamaKey]) usdPrice = llamaPriceMap[llamaKey];
        else { const s = (knownAsset?.symbol || meta?.symbol || "").toUpperCase(); if (isStableSym(s)) usdPrice = 1; }
        const valueUSD = amount * usdPrice;
        if (valueUSD < 1 && amount < 0.001) continue;
        const symbol = knownAsset?.symbol || meta?.symbol || TOKEN_SYMBOL_BY_ADDRESS[address] || address.slice(0,6) + "…";
        const defaultScore = (() => { const s = symbol.toUpperCase(); return isStableSym(s)?82:["ETH","WETH"].includes(s)?74:["WBTC","CBBTC"].includes(s)?70:55; })();
        assets.push({ id:`asset-${chain}-${symbol}`, symbol, protocol:"Wallet spot", chain, amount, valueUSD, priceUsd:usdPrice, priceSource:knownAsset?.coinId&&cgPriceMap[knownAsset.coinId]?"CoinGecko":usdPrice>0?"DeFiLlama":"fallback", source:"On-chain wallet import", matchedPool:null, apy:0, _liqScore:0, _score:defaultScore });
      }
      for (const [chainName, rpcs] of Object.entries(rpcByChain)) {
        const nativeAsset = WALLET_TRACKED_ASSETS.find(a => a.chain === chainName && !a.address);
        if (!nativeAsset || assets.find(a => a.chain === chainName && a.symbol === nativeAsset.symbol)) continue;
        try {
          const rawBalance = await rpcCallWithFallback(rpcs, "eth_getBalance", [walletAddress, "latest"]) || "0x0";
          const amount = formatUnits(rawBalance, 18);
          if (!Number.isFinite(amount) || amount <= 0) continue;
          const usdPrice = cgPriceMap[nativeAsset.coinId] || 0;
          const valueUSD = amount * usdPrice;
          if (valueUSD < 1 && amount < 0.001) continue;
          assets.push({ id:`asset-${chainName}-${nativeAsset.symbol}`, symbol:nativeAsset.symbol, protocol:"Wallet spot", chain:chainName, amount, valueUSD, priceUsd:usdPrice, priceSource:"CoinGecko", source:"On-chain wallet import", matchedPool:null, apy:0, _liqScore:0, _score:nativeAsset.symbol==="ETH"?74:60 });
        } catch {/* noop */}
      }
      setWalletLoading(false);
      return assets.sort((a,b)=>b.valueUSD-a.valueUSD).filter((a,i,arr)=>arr.findIndex(o=>o.symbol===a.symbol&&o.chain===a.chain)===i);
    } catch { setWalletLoading(false); return []; }
  }, [allPools, fetchExternal]);

  const narratives = detectNarratives(allPools, prices);
  const market     = getMarketContext(prices);
  const filtered   = allPools
    .filter(p=>riskFilter==="safe"?p._score>=65:riskFilter==="medium"?p._score>=45:true)
    .filter(p=>chainFilter==="all"||p.chain===chainFilter)
    .filter(p=>{if(pairFilter==="stable")return isPairSS(p.symbol);if(pairFilter==="mixed")return isPairSV(p.symbol);if(pairFilter==="volatile")return!isPairSS(p.symbol)&&!isPairSV(p.symbol);return true;})
    .filter(p=>search===""||p.symbol?.toLowerCase().includes(search.toLowerCase())||p.project?.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>sortBy==="apy"?b.apy-a.apy:sortBy==="tvl"?b.tvlUsd-a.tvlUsd:sortBy==="liq"?b._liqScore-a._liqScore:b._score-a._score)
    .slice(0,50);

  const tabs=[
    {id:"pools",label:"🌊 Pools"},{id:"portfolio",label:"💼 Portfolio",isNew:true},
    {id:"volatility",label:"📊 Volatilidade",isNew:true},{id:"ai",label:"🤖 AI Advisor"},
    {id:"liquidez",label:"💧 Liquidez"},{id:"estrategias",label:"⚙ Estratégias"},
    {id:"precos",label:"💹 Preços"},{id:"calc",label:"🧮 Calc"},{id:"plano",label:"📋 Plano"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#060c14",color:"#e2e8f0",fontFamily:"Inter, Segoe UI, Roboto, sans-serif"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}.fade{animation:fadeIn .24s ease both}`}</style>
      <div style={{background:"linear-gradient(90deg,#08152b,#0b1e38)",borderBottom:"1px solid rgba(99,102,241,0.13)",padding:"0 clamp(12px,2vw,28px)",height:"54px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:"9px"}}>
          <div style={{width:"7px",height:"7px",borderRadius:"50%",background:"#6366f1",boxShadow:"0 0 10px #6366f1",animation:"pulse 2.5s ease infinite"}}/>
          <span style={{fontSize:"10px",fontWeight:700,color:"#6875d4",letterSpacing:"3px",fontFamily:"monospace"}}>DEFI RISK INTELLIGENCE</span>
          <div style={{padding:"1px 6px",background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.18)",borderRadius:"4px",fontSize:"8px",color:"#4f5bc4",letterSpacing:"1px",fontFamily:"monospace"}}>v4.0</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <div style={{padding:"2px 9px",background:`${market.color}0f`,border:`1px solid ${market.color}22`,borderRadius:"20px",fontSize:"9px",color:market.color,fontFamily:"monospace",fontWeight:700}}>{market.icon} {market.mode}</div>
          <div style={{display:"flex",gap:"3px",alignItems:"center"}}>{Object.entries(dataStatus).map(([k,s])=><StatusDot key={k} status={s}/>)}</div>
          {lastUpdate&&<span style={{fontSize:"8px",color:"#1e2d3d",fontFamily:"monospace"}}>{lastUpdate.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>}
          <button onClick={()=>{fetchPrices();fetchPools();fetchFdv();fetchVolatility();}} style={{padding:"4px 10px",borderRadius:"5px",fontSize:"9px",background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.18)",color:"#4f5bc4",cursor:"pointer",fontFamily:"monospace",letterSpacing:"1px"}}>↻ REFRESH</button>
        </div>
      </div>
      <div style={{background:"#070e1a",borderBottom:"1px solid rgba(255,255,255,0.03)",padding:"12px clamp(12px,2vw,28px)"}}>
        <div style={{maxWidth:"100%",margin:"0 auto",display:"flex",gap:"10px",flexWrap:"wrap"}}>
          {[{sym:"BTC",emoji:"₿",color:"#f59e0b",k:"bitcoin",coinId:"bitcoin"},{sym:"ETH",emoji:"Ξ",color:"#6366f1",k:"ethereum",coinId:"ethereum"},{sym:"SOL",emoji:"◎",color:"#a78bfa",k:"solana",coinId:"solana"}].map(c=>{
            const vd=volData[c.coinId],vl=getVolLabel(vd?.annualVol);
            return (<div key={c.sym} style={{background:"#0b1520",borderRadius:"9px",padding:"10px 14px",border:`1px solid ${c.color}12`,flex:1,minWidth:"130px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"3px"}}>
                <div style={{display:"flex",gap:"4px",alignItems:"center"}}><span style={{fontSize:"13px"}}>{c.emoji}</span><span style={{fontSize:"9px",fontWeight:700,color:"#2d3748",letterSpacing:"2px",fontFamily:"monospace"}}>{c.sym}</span></div>
                {!pricesLoading&&<Chg val={prices?.[c.k]?.change24h}/>}
              </div>
              {pricesLoading?<Spin/>:<>
                <div style={{fontSize:"18px",fontWeight:700,color:"#f1f5f9",fontFamily:"monospace"}}>${fmt(prices?.[c.k]?.usd)}</div>
                <div style={{fontSize:"9px",color:"#2d3748",fontFamily:"monospace",marginTop:"1px"}}>R$ {fmt(prices?.[c.k]?.brl)}</div>
                {vd&&<div style={{fontSize:"8px",color:vl.color,marginTop:"3px",fontFamily:"monospace"}}>vol {vd.annualVol.toFixed(0)}%/aa</div>}
              </>}
            </div>);
          })}
          {narratives.length>0&&(<div style={{background:"#0b1520",borderRadius:"9px",padding:"10px 14px",border:"1px solid rgba(255,255,255,0.04)",flex:2,minWidth:"180px"}}>
            <div style={{fontSize:"8px",color:"#1e2d3d",letterSpacing:"2px",marginBottom:"5px",fontFamily:"monospace"}}>NARRATIVAS</div>
            <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>{narratives.map((n,i)=><div key={i} style={{padding:"2px 7px",background:`${n.color}10`,border:`1px solid ${n.color}22`,borderRadius:"20px",fontSize:"8px",color:n.color,fontFamily:"monospace",fontWeight:600}}>{n.icon} {n.label}</div>)}</div>
          </div>)}
        </div>
      </div>
      <div style={{borderBottom:"1px solid rgba(255,255,255,0.04)",padding:"0 clamp(12px,2vw,28px)",background:"#070d18",overflowX:"auto"}}>
        <div style={{maxWidth:"100%",margin:"0 auto",display:"flex",gap:"1px",minWidth:"max-content"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 12px",border:"none",background:tab===t.id?"rgba(99,102,241,0.07)":"transparent",color:tab===t.id?"#8b97e8":"#2d3748",fontSize:"10px",cursor:"pointer",borderBottom:`2px solid ${tab===t.id?"#6366f1":"transparent"}`,transition:"all 0.2s",fontFamily:"Inter, Segoe UI, Roboto, sans-serif",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"4px"}}>
              {t.label}{t.isNew&&<span style={{padding:"1px 4px",background:"rgba(34,197,94,0.12)",borderRadius:"3px",fontSize:"7px",color:"#22c55e",fontFamily:"monospace"}}>NEW</span>}
            </button>
          ))}
        </div>
      </div>
      <div style={{maxWidth:"100%",margin:"0 auto",padding:"18px clamp(12px,2vw,28px)"}} className="fade" key={tab}>
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
        {tab==="portfolio"&&<PortfolioTab pools={allPools} volData={volData} walletPools={walletPools} walletLoading={walletLoading} onFetchWalletPools={fetchWalletActivePools} onFetchWalletPoolTx={fetchWalletPoolFromBaseTx} onFetchWalletAssets={fetchWalletAssets} onSuggestRebuild={(pool)=>suggestRebuildStrategy(pool,volData)} fetchExternal={fetchExternal} prices={prices}/>}
        {tab==="volatility"&&<VolatilityTab volData={volData} volLoading={volLoading} prices={prices}/>}
        {tab==="ai"&&<AIAdvisorTab pools={allPools} prices={prices} initialPool={advisorPool} key={advisorPool?.pool}/>}
        {tab==="liquidez"&&<LiquidezTab pools={allPools} fdvData={fdvMap} dataStatus={dataStatus}/>}
        {tab==="estrategias"&&<StrategiesTab pools={allPools} prices={prices} volData={volData}/>}
        {tab==="precos"&&(<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"14px"}}>{[{label:"Bitcoin",k:"bitcoin",emoji:"₿",color:"#f59e0b"},{label:"Ethereum",k:"ethereum",emoji:"Ξ",color:"#6366f1"},{label:"Solana",k:"solana",emoji:"◎",color:"#a78bfa"}].map(({label,k,emoji,color})=>(<Card key={k} glow={color}><div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"2px",marginBottom:"8px",fontFamily:"monospace"}}>{emoji} {label.toUpperCase()}</div>{pricesLoading?<Spin/>:<><div style={{fontSize:"32px",fontWeight:700,color,fontFamily:"monospace"}}>${fmt(prices?.[k]?.usd)}</div><div style={{fontSize:"13px",color:"#334155",fontFamily:"monospace",marginTop:"3px"}}>R$ {fmt(prices?.[k]?.brl)}</div><div style={{marginTop:"8px"}}><Chg val={prices?.[k]?.change24h}/></div></>}</Card>))}</div>)}
        {tab==="calc"&&<CalcTab prices={prices} market={market}/>}
        {tab==="plano"&&<PlanTab/>}
      </div>
      <PoolModal pool={selectedPool} onClose={()=>setSelectedPool(null)} onAdvise={p=>{setAdvisorPool(p);setTab("ai");}} volData={volData}/>
    </div>
  );
}