import { useCallback, useEffect, useMemo, useState } from "react";
import { AAVE_API, BALANCER_API, CERTIK_API, CHAINS_OK, COINGECKO, COMPOUND_API, CURVE_API, DEFILLAMA_YIELDS, DEFISAFETY_API, DUNE_API, PROTOCOL_COIN_MAP, UNISWAP_ALT, UNISWAP_SUBGRAPH } from "./constants";
import { buildPoolIntelligence, calcFdvRevenueRatio, calcHistoricalVolatility, calcLiquidityScore, calcScore, detectNarratives, fmt, getAuditEntry, getMarketContext, getProtocolCoinId, getVolLabel, isPairSS, isPairSV, normalizePoolModel, suggestRebuildStrategy } from "./utils";
import { Badge, CalcTab, Card, Chg, LiquidezTab, PlanTab, PoolModal, PoolRow, PortfolioTab, Spin, StatusDot, StrategiesTab, VolatilityTab, AIAdvisorTab } from "./ui";

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,          setTab]          = useState("pools");
  const [prices,       setPrices]       = useState(null);
  const [pricesLoading,setPricesLoading]= useState(true);
  const [lastUpdate,   setLastUpdate]   = useState(null);
  const [rawPools,     setRawPools]     = useState([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [uniswapMap,   setUniswapMap]   = useState({});
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
      const r=await fetch(`${COINGECKO}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd,brl&include_24hr_change=true`);
      const d=await r.json();
      setPrices({bitcoin:{usd:d.bitcoin?.usd,brl:d.bitcoin?.brl,change24h:d.bitcoin?.usd_24h_change},ethereum:{usd:d.ethereum?.usd,brl:d.ethereum?.brl,change24h:d.ethereum?.usd_24h_change},solana:{usd:d.solana?.usd,brl:d.solana?.brl,change24h:d.solana?.usd_24h_change}});
      setLastUpdate(new Date());
      setDataStatus(s=>({...s,coingecko:"ok"}));
    }catch{ setDataStatus(s=>({...s,coingecko:"error"})); }
    finally{ setPricesLoading(false); }
  },[]);

  // ── Fetch pools ──
  const fetchPools = useCallback(async()=>{
    setPoolsLoading(true);
    setDataStatus(s=>({...s,defillama:"loading"}));
    try {
      const r=await fetch(DEFILLAMA_YIELDS);
      const d=await r.json();
      const processed=d.data.filter(p=>CHAINS_OK.includes(p.chain)&&p.tvlUsd>300_000&&p.apy>1&&p.apy<300)
        .map(p=>({...p,_auditEntry:getAuditEntry(p.project),_liqScore:calcLiquidityScore(p)}))
        .map(p=>({...p,_score:calcScore(p)}))
        .sort((a,b)=>b._score-a._score);
      setRawPools(processed);
      setDataStatus(s=>({...s,defillama:"ok"}));
    }catch{ setDataStatus(s=>({...s,defillama:"error"})); }
    finally{ setPoolsLoading(false); }
  },[]);

  // ── Fetch Uniswap ──
  const fetchUniswap = useCallback(async()=>{
    setDataStatus(s=>({...s,uniswap:"loading"}));
    const query=`{ pools(first:200,orderBy:volumeUSD,orderDirection:desc){ id token0{symbol} token1{symbol} volumeUSD txCount totalValueLockedUSD } }`;
    for(const url of [UNISWAP_SUBGRAPH,UNISWAP_ALT]){
      try{
        const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query})});
        const d=await r.json();
        if(d.data?.pools?.length){
          const map={};
          d.data.pools.forEach(p=>{ map[p.id.toLowerCase()]={txCount:parseInt(p.txCount||0),volumeUSD:parseFloat(p.volumeUSD||0)}; });
          setUniswapMap(map);
          setDataStatus(s=>({...s,uniswap:"ok"}));
          return;
        }
      }catch{/* noop */}
    }
    setDataStatus(s=>({...s,uniswap:"error"}));
  },[]);

  // ── Fetch FDV ──
  const fetchFdv = useCallback(async()=>{
    setDataStatus(s=>({...s,fdv:"loading"}));
    try{
      const ids=Object.values(PROTOCOL_COIN_MAP).join(",");
      const r=await fetch(`${COINGECKO}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=50`);
      const coins=await r.json();
      const map={};
      coins.forEach(c=>{ map[c.id]={fdv:c.fully_diluted_valuation,marketCap:c.market_cap,price:c.current_price}; });
      setFdvMap(map);
      setDataStatus(s=>({...s,fdv:"ok"}));
    }catch{ setDataStatus(s=>({...s,fdv:"error"})); }
  },[]);

  // ── 7. Fetch Volatility (CoinGecko 30d price history) ──
  const fetchVolatility = useCallback(async()=>{
    setVolLoading(true);
    setDataStatus(s=>({...s,vol:"loading"}));
    // Fetch top tokens sequentially to avoid rate limiting
    const priorityCoins = ["bitcoin","ethereum","solana","arbitrum","optimism","chainlink","uniswap","aave"];
    const result = {};
    for(const coinId of priorityCoins){
      try{
        const r = await fetch(`${COINGECKO}/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`);
        if(!r.ok) continue;
        const d = await r.json();
        const pArr = (d.prices||[]).map(p=>p[1]);
        const vol  = calcHistoricalVolatility(pArr);
        if(vol) result[coinId] = vol;
        await new Promise(res=>setTimeout(res,200)); // small delay to avoid rate limit
      }catch{/* noop */}
    }
    setVolData(result);
    setVolLoading(false);
    setDataStatus(s=>({...s,vol:Object.keys(result).length>0?"ok":"error"}));
  },[]);

  const pingSource = useCallback(async (url, key) => {
    setDataStatus(s => ({ ...s, [key]: "loading" }));
    try {
      const r = await fetch(url, { method: "GET" });
      setDataStatus(s => ({ ...s, [key]: r.ok ? "ok" : "error" }));
    } catch {
      setDataStatus(s => ({ ...s, [key]: "error" }));
    }
  }, []);

  const fetchExtendedSources = useCallback(async () => {
    await Promise.all([
      pingSource(CURVE_API, "curve"),
      pingSource(BALANCER_API, "balancer"),
      pingSource(AAVE_API, "aave"),
      pingSource(COMPOUND_API, "compound"),
      pingSource(DUNE_API, "dune"),
      pingSource(CERTIK_API, "certik"),
      pingSource(DEFISAFETY_API, "defisafety"),
    ]);
  }, [pingSource]);

  useEffect(()=>{ fetchPrices(); fetchPools(); fetchUniswap(); fetchFdv(); fetchVolatility(); fetchExtendedSources(); },[]);
  useEffect(()=>{ const t=setInterval(fetchPrices,60000); return()=>clearInterval(t); },[]);

  // ── Enrich pools with Uniswap + FDV ──
  const allPools = useMemo(()=>{
    if(!rawPools.length) return [];
    return rawPools.map(p=>{
      const uid=p.pool?.toLowerCase();
      const uni=uniswapMap[uid]||null;
      const coinId=getProtocolCoinId(p.project);
      const fd=coinId?fdvMap[coinId]:null;
      const txCount=uni?.txCount||0;
      const liqScore=calcLiquidityScore({...p,_txCount:txCount});
      const enriched={...p,_txCount:txCount,_liqScore:liqScore,_fdv:fd?.fdv||null,_fdvTvlRatio:fd?.fdv&&p.tvlUsd?fd.fdv/p.tvlUsd:null};
      const withIntelligence = { ...enriched, _fdvRevenueRatio: calcFdvRevenueRatio(enriched) };
      const scored = { ...withIntelligence, _score:calcScore(withIntelligence) };
      return { ...scored, _normalized: normalizePoolModel(scored), _intelligence: buildPoolIntelligence(scored) };
    }).sort((a,b)=>b._score-a._score);
  },[rawPools,uniswapMap,fdvMap]);

  const fetchWalletActivePools = useCallback(async (walletAddress) => {
    if (!walletAddress) return [];
    setWalletLoading(true);
    const owner = walletAddress.toLowerCase();
    const query = `{
      positions(first: 30, where: { owner: "${owner}", liquidity_gt: "0" }) {
        id
        liquidity
        pool {
          id
          feeTier
          token0 { symbol }
          token1 { symbol }
          volumeUSD
          totalValueLockedUSD
        }
      }
    }`;
    for (const url of [UNISWAP_SUBGRAPH, UNISWAP_ALT]) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const d = await r.json();
        const positions = d?.data?.positions || [];
        if (positions.length) {
          const mapped = positions.map(pos => {
            const symbol = `${pos.pool?.token0?.symbol || "?"}/${pos.pool?.token1?.symbol || "?"}`;
            const localMatch = allPools.find(p => p.symbol?.toUpperCase().replace(/_/g, "/").includes(symbol.toUpperCase()));
            return {
              id: pos.id,
              symbol,
              feeTier: pos.pool?.feeTier,
              liquidity: pos.liquidity,
              tvlUsd: Number(pos.pool?.totalValueLockedUSD || 0),
              volumeUsd: Number(pos.pool?.volumeUSD || 0),
              matchedPool: localMatch || null,
            };
          });
          setWalletPools(mapped);
          setWalletLoading(false);
          return mapped;
        }
      } catch {/* noop */}
    }
    setWalletPools([]);
    setWalletLoading(false);
    return [];
  }, [allPools]);

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
    <div style={{minHeight:"100vh",background:"#060c14",color:"#e2e8f0",fontFamily:"Georgia,serif"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}.fade{animation:fadeIn 0.22s ease both}input{outline:none}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:#1a2535;border-radius:2px}`}</style>

      {/* Header */}
      <div style={{background:"linear-gradient(90deg,#08152b,#0b1e38)",borderBottom:"1px solid rgba(99,102,241,0.13)",padding:"0 22px",height:"50px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
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
          <button onClick={()=>{fetchPrices();fetchPools();fetchUniswap();fetchFdv();fetchVolatility();}} style={{padding:"4px 10px",borderRadius:"5px",fontSize:"9px",background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.18)",color:"#4f5bc4",cursor:"pointer",fontFamily:"monospace",letterSpacing:"1px"}}>↻ REFRESH</button>
        </div>
      </div>

      {/* Ticker */}
      <div style={{background:"#070e1a",borderBottom:"1px solid rgba(255,255,255,0.03)",padding:"12px 22px"}}>
        <div style={{maxWidth:"1180px",margin:"0 auto",display:"flex",gap:"10px",flexWrap:"wrap"}}>
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
      <div style={{borderBottom:"1px solid rgba(255,255,255,0.04)",padding:"0 22px",background:"#070d18",overflowX:"auto"}}>
        <div style={{maxWidth:"1180px",margin:"0 auto",display:"flex",gap:"1px",minWidth:"max-content"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 12px",border:"none",background:tab===t.id?"rgba(99,102,241,0.07)":"transparent",color:tab===t.id?"#8b97e8":"#2d3748",fontSize:"10px",cursor:"pointer",borderBottom:`2px solid ${tab===t.id?"#6366f1":"transparent"}`,transition:"all 0.2s",fontFamily:"Georgia,serif",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"4px"}}>
              {t.label}
              {t.isNew&&<span style={{padding:"1px 4px",background:"rgba(34,197,94,0.12)",borderRadius:"3px",fontSize:"7px",color:"#22c55e",fontFamily:"monospace"}}>NEW</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{maxWidth:"1180px",margin:"0 auto",padding:"18px 22px"}} className="fade" key={tab}>

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

        {tab==="portfolio"  && <PortfolioTab pools={allPools} volData={volData} walletPools={walletPools} walletLoading={walletLoading} onFetchWalletPools={fetchWalletActivePools} onSuggestRebuild={(pool)=>suggestRebuildStrategy(pool, volData)}/>}
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
        {tab==="calc"  && <CalcTab prices={prices}/>}
        {tab==="plano" && <PlanTab/>}
      </div>

      <PoolModal pool={selectedPool} onClose={()=>setSelectedPool(null)} onAdvise={p=>{setAdvisorPool(p);setTab("ai");}} volData={volData}/>
    </div>
  );
}
