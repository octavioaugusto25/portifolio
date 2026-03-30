import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ─── APIS ─────────────────────────────────────────────────────────────────────
const COINGECKO        = "https://api.coingecko.com/api/v3";
const DEFILLAMA_YIELDS = "https://yields.llama.fi/pools";
const UNISWAP_SUBGRAPH = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";
const UNISWAP_ALT      = "https://api.thegraph.com/subgraphs/name/messari/uniswap-v3-ethereum";

// ─── PROTOCOL LISTS ───────────────────────────────────────────────────────────
const SAFE_PROTOCOLS = [
  "uniswap-v3","uniswap-v2","curve","aave-v3","aave-v2","compound",
  "balancer","gmx","trader-joe","velodrome","aerodrome","camelot",
  "orca","raydium","jupiter","pancakeswap","sushiswap","convex-finance",
  "lido","rocket-pool","pendle","kamino","meteora","drift"
];
const MEDIUM_PROTOCOLS = [
  "stargate","gains-network","exactly","morpho","euler","spark",
  "frax","synthetix","lyra","polynomial","kwenta","vertex",
  "hyperliquid","marinade","jito","save","mango"
];
const CHAINS_OK = ["Ethereum","Arbitrum","Base","Solana","Optimism"];
const STABLES   = ["USDC","USDT","DAI","FRAX","LUSD","crvUSD","GHO","PYUSD","USDS","FDUSD"];

// ─── AUDIT PROXY ──────────────────────────────────────────────────────────────
const AUDIT_PROXY = {
  "uniswap":        {score:95,auditors:["Trail of Bits","ABDK"],hacks:0,bounty:true},
  "curve":          {score:88,auditors:["Trail of Bits","Chainsecurity"],hacks:1,bounty:true},
  "aave":           {score:93,auditors:["OpenZeppelin","Sigma Prime","Peckshield"],hacks:0,bounty:true},
  "compound":       {score:88,auditors:["OpenZeppelin","Trail of Bits"],hacks:0,bounty:true},
  "balancer":       {score:84,auditors:["Trail of Bits","Certik"],hacks:1,bounty:true},
  "gmx":            {score:78,auditors:["ABDK","Quantstamp"],hacks:0,bounty:true},
  "lido":           {score:91,auditors:["Sigma Prime","Quantstamp","Chainsecurity"],hacks:0,bounty:true},
  "rocket-pool":    {score:88,auditors:["Sigma Prime","Trail of Bits"],hacks:0,bounty:true},
  "pendle":         {score:76,auditors:["Ackee Blockchain","Certik"],hacks:0,bounty:false},
  "convex-finance": {score:80,auditors:["Mixbytes","Certik"],hacks:0,bounty:false},
  "sushiswap":      {score:68,auditors:["Quantstamp"],hacks:1,bounty:true},
  "pancakeswap":    {score:70,auditors:["Certik","Peckshield"],hacks:0,bounty:false},
  "velodrome":      {score:73,auditors:["Spearbit"],hacks:0,bounty:false},
  "aerodrome":      {score:71,auditors:["Spearbit"],hacks:0,bounty:false},
  "morpho":         {score:83,auditors:["Trail of Bits","Chainsecurity"],hacks:0,bounty:true},
  "trader-joe":     {score:65,auditors:["Certik"],hacks:0,bounty:false},
  "orca":           {score:70,auditors:["Kudelski Security"],hacks:0,bounty:false},
  "raydium":        {score:63,auditors:["Kudelski Security"],hacks:1,bounty:false},
  "kamino":         {score:68,auditors:["Sec3"],hacks:0,bounty:false},
  "meteora":        {score:62,auditors:["Sec3"],hacks:0,bounty:false},
  "spark":          {score:78,auditors:["Chainsecurity"],hacks:0,bounty:false},
  "euler":          {score:48,auditors:["Halborn","Sherlock"],hacks:1,bounty:false},
  "synthetix":      {score:75,auditors:["Iosiro","Trail of Bits"],hacks:0,bounty:true},
  "frax":           {score:67,auditors:["Trail of Bits"],hacks:0,bounty:false},
  "stargate":       {score:65,auditors:["Quantstamp"],hacks:0,bounty:false},
  "camelot":        {score:66,auditors:["Paladin","Solidity Finance"],hacks:0,bounty:false},
  "drift":          {score:67,auditors:["Ottersec"],hacks:0,bounty:false},
  "marinade":       {score:72,auditors:["Neodyme"],hacks:0,bounty:false},
  "jito":           {score:70,auditors:["Neodyme","Ottersec"],hacks:0,bounty:false},
};

// ─── COINGECKO ID MAP ─────────────────────────────────────────────────────────
const PROTOCOL_COIN_MAP = {
  "uniswap":"uniswap","curve":"curve-dao-token","aave":"aave",
  "compound":"compound-governance-token","balancer":"balancer","gmx":"gmx",
  "pendle":"pendle","lido":"lido-dao","synthetix":"havven","frax":"frax-share",
  "sushiswap":"sushi","pancakeswap":"pancakeswap-token","rocket-pool":"rocket-pool",
  "convex-finance":"convex-finance","morpho":"morpho","velodrome":"velodrome-finance",
  "aerodrome":"aerodrome-finance",
};

// ─── VOLATILITY COIN MAP (CoinGecko IDs for price history) ───────────────────
const VOLATILITY_COIN_MAP = {
  "ETH":"ethereum","BTC":"bitcoin","SOL":"solana","BNB":"binancecoin",
  "ARB":"arbitrum","OP":"optimism","AVAX":"avalanche-2","MATIC":"matic-network",
  "UNI":"uniswap","AAVE":"aave","CRV":"curve-dao-token","GMX":"gmx",
  "PENDLE":"pendle","LINK":"chainlink","LDO":"lido-dao",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const isStable = s  => STABLES.some(x => s?.toUpperCase().includes(x));
const isPairSS = sym => { const p=sym?.replace(/_/g,"-").split(/[-/]/)||[]; return p.length>=2&&p.every(x=>isStable(x)); };
const isPairSV = sym => { const p=sym?.replace(/_/g,"-").split(/[-/]/)||[]; return p.length>=2&&p.some(x=>isStable(x))&&!isPairSS(sym); };

function getAuditEntry(project) {
  const p = project?.toLowerCase()||"";
  for(const [k,v] of Object.entries(AUDIT_PROXY)) if(p.includes(k)) return v;
  return null;
}
function getProtocolCoinId(project) {
  const p = project?.toLowerCase()||"";
  for(const [k,v] of Object.entries(PROTOCOL_COIN_MAP)) if(p.includes(k)) return v;
  return null;
}

// ─── 7. VOLATILITY ENGINE ─────────────────────────────────────────────────────
// Calculates annualized volatility from 30-day price history (log returns)
// Suggests LP range using ±1.5σ over chosen horizon
function calcHistoricalVolatility(pricesArr) {
  if (!pricesArr || pricesArr.length < 5) return null;
  const returns = pricesArr.slice(1).map((p,i) => Math.log(p / pricesArr[i]));
  const mean    = returns.reduce((a,b)=>a+b,0) / returns.length;
  const variance= returns.reduce((a,b)=>a+Math.pow(b-mean,2),0) / returns.length;
  const dailyVol  = Math.sqrt(variance);
  const annualVol = dailyVol * Math.sqrt(365) * 100;
  return { annualVol, dailyVol: dailyVol * 100, sampleSize: pricesArr.length };
}

function suggestLPRange(currentPrice, annualVolPct, horizonDays = 30, sigma = 1.5) {
  if (!currentPrice || !annualVolPct) return null;
  const vol     = annualVolPct / 100;
  const periodV = vol * Math.sqrt(horizonDays / 365);
  const lower   = currentPrice * Math.exp(-sigma * periodV);
  const upper   = currentPrice * Math.exp( sigma * periodV);
  const rangePct= (upper / lower - 1) * 100;
  const confidence = sigma === 1 ? 68 : sigma === 1.5 ? 86 : 95;
  return { lower, upper, rangePct, confidence, horizonDays };
}

function getVolLabel(annualVol) {
  if (annualVol == null) return { label:"—",       color:"#475569", tier:"unknown" };
  if (annualVol  < 30)  return { label:"BAIXA",    color:"#22c55e", tier:"low"     };
  if (annualVol  < 70)  return { label:"MÉDIA",    color:"#f59e0b", tier:"medium"  };
  if (annualVol  < 120) return { label:"ALTA",     color:"#f97316", tier:"high"    };
  return                       { label:"EXTREMA",  color:"#ef4444", tier:"extreme" };
}

// Extract token symbols from pool symbol for volatility lookup
function extractTokens(sym) {
  const clean = sym?.toUpperCase().replace(/_/g,"-") || "";
  const parts = clean.split(/[-/]/).filter(Boolean);
  return parts;
}

// ─── 4. LIQUIDITY ENGINE ──────────────────────────────────────────────────────
function calcLiquidityScore(pool) {
  const vol1d  = (pool.volumeUsd7d||0)/7;
  const tvl    = pool.tvlUsd||1;
  const ratio  = vol1d/tvl;
  const txCount= pool._txCount||0;
  let s = 0;
  if(vol1d>50e6) s+=40; else if(vol1d>10e6) s+=30; else if(vol1d>1e6) s+=20; else if(vol1d>100e3) s+=10; else if(vol1d>5e3) s+=4;
  if(ratio>2) s+=35; else if(ratio>0.5) s+=25; else if(ratio>0.1) s+=15; else if(ratio>0.01) s+=7;
  if(txCount>10000) s+=25; else if(txCount>1000) s+=15; else if(txCount>100) s+=7; else if(txCount>0) s+=2;
  return Math.min(100, s);
}
function getLiqLabel(score) {
  if(score>=65) return {label:"ALTA",     color:"#22c55e"};
  if(score>=35) return {label:"MÉDIA",    color:"#f59e0b"};
  if(score>=10) return {label:"BAIXA",    color:"#f97316"};
  return              {label:"SEM DADOS", color:"#475569"};
}

// ─── 3. RISK ENGINE ───────────────────────────────────────────────────────────
function calcScore(pool) {
  const sym   = pool.symbol?.toUpperCase()||"";
  const proto = pool.project?.toLowerCase()||"";
  const apy   = pool.apy||0;
  const tvl   = pool.tvlUsd||0;
  const vol1d = (pool.volumeUsd7d||0)/7;
  const protocolScore = SAFE_PROTOCOLS.some(p=>proto.includes(p))?22:MEDIUM_PROTOCOLS.some(p=>proto.includes(p))?12:2;
  let tvlScore = tvl>100e6?16:tvl>50e6?14:tvl>10e6?11:tvl>2e6?7:tvl>500e3?3:0;
  if(vol1d>tvl*0.05&&tvl>0) tvlScore=Math.min(18,tvlScore+2);
  const pairScore = isPairSS(sym)?20:isPairSV(sym)?12:4;
  const apyScore  = apy>200?0:apy>100?2:apy>60?5:apy>30?8:apy>=5?13:9;
  const netScore  = pool.chain==="Ethereum"?10:["Arbitrum","Base","Optimism"].includes(pool.chain)?8:pool.chain==="Solana"?6:3;
  const audit     = pool._auditEntry;
  let scScore     = audit?Math.max(1,Math.round(audit.score/10)-(audit.hacks>0?3:0)):SAFE_PROTOCOLS.some(p=>proto.includes(p))?8:MEDIUM_PROTOCOLS.some(p=>proto.includes(p))?5:1;
  const liqBonus  = (pool._liqScore||0)>60?7:(pool._liqScore||0)>30?4:(pool._liqScore||0)>10?2:0;
  return Math.max(0,Math.min(100,protocolScore+tvlScore+pairScore+apyScore+netScore+scScore+liqBonus));
}

// ─── SUPPLEMENTARY ENGINES ────────────────────────────────────────────────────
function getRisk(score) {
  if(score>=75) return {label:"BAIXO RISCO",   color:"#22c55e",bg:"rgba(34,197,94,0.09)",  icon:"🟢"};
  if(score>=55) return {label:"RISCO MÉDIO",   color:"#f59e0b",bg:"rgba(245,158,11,0.09)", icon:"🟡"};
  if(score>=35) return {label:"RISCO ALTO",    color:"#f97316",bg:"rgba(249,115,22,0.09)", icon:"🟠"};
  return              {label:"MUITO ARRISCADO",color:"#ef4444",bg:"rgba(239,68,68,0.09)",  icon:"🔴"};
}
function getPair(sym) {
  if(isPairSS(sym)) return {label:"Stable/Stable", color:"#22c55e",icon:"🔒",il:"Sem IL",     ilRisk:"low"};
  if(isPairSV(sym)) return {label:"Stable/Volátil",color:"#f59e0b",icon:"⚡",il:"IL moderado",ilRisk:"medium"};
  return                  {label:"Volátil/Volátil",color:"#ef4444",icon:"🔥",il:"IL alto",    ilRisk:"high"};
}
function getStrategy(pool) {
  const sym=pool.symbol?.toUpperCase()||"", apy=pool.apy||0;
  if(isPairSS(sym))             return {type:"Stable Yield",      color:"#22c55e",icon:"🏦"};
  if(isPairSV(sym)&&apy<40)    return {type:"Range Trading",     color:"#3b82f6",icon:"📐"};
  if(apy>=40)                   return {type:"High Yield Farming",color:"#f59e0b",icon:"🌾"};
  return                              {type:"Lending Loop",       color:"#a78bfa",icon:"🔄"};
}
function getMarketContext(prices) {
  if(!prices) return {mode:"UNKNOWN",color:"#64748b",icon:"❓",advice:"Aguardando dados..."};
  const avg=((prices.bitcoin?.change24h||0)+(prices.ethereum?.change24h||0))/2;
  if(avg>3)  return {mode:"BULL 🐂",color:"#22c55e",icon:"📈",advice:"Alta — favoreça pools voláteis de protocolos top para capturar upside."};
  if(avg<-3) return {mode:"BEAR 🐻",color:"#ef4444",icon:"📉",advice:"Queda — priorize stable/stable e reduza exposição a voláteis."};
  if(avg>1)  return {mode:"BULLISH",color:"#86efac",icon:"↗",  advice:"Leve alta — boa hora para pools stable/volátil auditadas."};
  if(avg<-1) return {mode:"BEARISH",color:"#fca5a5",icon:"↘",  advice:"Leve baixa — monitore posições voláteis, considere hedge."};
  return           {mode:"LATERAL",color:"#94a3b8",icon:"→",  advice:"Lateral — ideal para stable yields e range trading."};
}
function detectNarratives(pools, prices) {
  const narratives=[];
  const solAvg=pools.filter(p=>p.chain==="Solana").reduce((a,b,_,ar)=>a+b.apy/ar.length,0);
  const baseAvg=pools.filter(p=>p.chain==="Base").reduce((a,b,_,ar)=>a+b.apy/ar.length,0);
  if(solAvg>20) narratives.push({label:"Solana DeFi Hot",color:"#a78bfa",icon:"◎"});
  if(baseAvg>15) narratives.push({label:"Base Ecosystem",color:"#3b82f6",icon:"🔵"});
  if((prices?.bitcoin?.change24h||0)>3) narratives.push({label:"BTC Bull Run",color:"#f59e0b",icon:"₿"});
  if((prices?.ethereum?.change24h||0)>4) narratives.push({label:"ETH Breakout",color:"#6366f1",icon:"Ξ"});
  if(pools.filter(p=>isPairSS(p.symbol)).length>20) narratives.push({label:"Stable Yields Rising",color:"#22c55e",icon:"🏦"});
  return narratives.slice(0,5);
}
function getFdvRating(ratio) {
  if(!ratio) return {label:"N/A",color:"#475569"};
  if(ratio<1)  return {label:"Subavaliado ↓",color:"#22c55e"};
  if(ratio<5)  return {label:"Justo ~",       color:"#f59e0b"};
  if(ratio<15) return {label:"Premium ↑",     color:"#f97316"};
  return             {label:"Especulativo 🔥",color:"#ef4444"};
}

// ─── 11. PORTFOLIO RISK LAYER ─────────────────────────────────────────────────
// Herfindahl-Hirschman Index → diversification (0=concentrated, 100=diversified)
function calcDiversificationScore(positions) {
  const total = positions.reduce((a,b)=>a+(b.valueUSD||0),0);
  if(!total||positions.length===0) return 0;
  const weights = positions.map(p=>(p.valueUSD||0)/total);
  const hhi     = weights.reduce((a,w)=>a+w*w,0);
  return Math.round((1-hhi)*100);
}

// Risk concentration: what % of capital is in high-risk pools
function calcRiskConcentration(positions) {
  const total = positions.reduce((a,b)=>a+(b.valueUSD||0),0);
  if(!total) return {low:0,medium:0,high:0,extreme:0};
  const byRisk = positions.reduce((acc,p)=>{
    const score = p._score||0;
    const pct   = (p.valueUSD||0)/total*100;
    if(score>=75)      acc.low     +=pct;
    else if(score>=55) acc.medium  +=pct;
    else if(score>=35) acc.high    +=pct;
    else               acc.extreme +=pct;
    return acc;
  },{low:0,medium:0,high:0,extreme:0});
  return byRisk;
}

// Chain concentration
function calcChainConcentration(positions) {
  const total = positions.reduce((a,b)=>a+(b.valueUSD||0),0);
  if(!total) return {};
  return positions.reduce((acc,p)=>{
    acc[p.chain] = (acc[p.chain]||0)+(p.valueUSD||0)/total*100;
    return acc;
  },{});
}

// Portfolio-level weighted avg score
function calcPortfolioScore(positions) {
  const total = positions.reduce((a,b)=>a+(b.valueUSD||0),0);
  if(!total) return 0;
  const weighted = positions.reduce((a,p)=>a+(p._score||0)*(p.valueUSD||0)/total,0);
  return Math.round(weighted);
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
const fmt  = (n,d=2) => n==null?"—":Number(n).toLocaleString("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtK = n => !n?"$0":n>=1e9?`$${(n/1e9).toFixed(1)}B`:n>=1e6?`$${(n/1e6).toFixed(1)}M`:`$${(n/1e3).toFixed(0)}K`;
const calcIL = r => (2*Math.sqrt(r)/(1+r)-1)*100;

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────
const Card     = ({children,style={},glow,onClick})=>(
  <div onClick={onClick} style={{background:"#0b1520",border:`1px solid ${glow?`${glow}25`:"rgba(255,255,255,0.06)"}`,borderRadius:"14px",padding:"18px",boxShadow:glow?`0 0 30px ${glow}06`:"none",cursor:onClick?"pointer":undefined,...style}}>{children}</div>
);
const Spin     = ({size=14})=>(
  <div style={{width:`${size}px`,height:`${size}px`,border:"2px solid rgba(255,255,255,0.07)",borderTop:"2px solid #6366f1",borderRadius:"50%",animation:"spin 0.8s linear infinite",display:"inline-block"}}/>
);
const Chg      = ({val})=>!val?null:(
  <span style={{fontSize:"11px",color:val>=0?"#22c55e":"#ef4444",fontFamily:"monospace"}}>{val>=0?"▲":"▼"} {Math.abs(val).toFixed(2)}%</span>
);
const Badge    = ({children,color="#3b82f6",sm})=>(
  <span style={{padding:sm?"1px 6px":"3px 9px",borderRadius:"20px",fontSize:sm?"9px":"10px",fontWeight:700,background:`${color}15`,color,border:`1px solid ${color}28`,whiteSpace:"nowrap"}}>{children}</span>
);
const SecTitle = ({icon,children,right,sub})=>(
  <div style={{marginBottom:"14px"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
        <span>{icon}</span>
        <span style={{fontSize:"9px",fontWeight:700,color:"#3d4f63",letterSpacing:"2.5px",textTransform:"uppercase",fontFamily:"monospace"}}>{children}</span>
      </div>
      {right}
    </div>
    {sub&&<div style={{fontSize:"10px",color:"#2d3748",marginTop:"2px",paddingLeft:"22px"}}>{sub}</div>}
  </div>
);
const StatusDot= ({status})=>{
  const c=status==="ok"?"#22c55e":status==="loading"?"#f59e0b":status==="error"?"#ef4444":"#475569";
  return <div style={{width:"7px",height:"7px",borderRadius:"50%",background:c,flexShrink:0,animation:status==="loading"?"pulse 1.2s ease infinite":"none"}}/>;
};

// ─── POOL MODAL (with Volatility) ─────────────────────────────────────────────
const PoolModal = ({pool,onClose,onAdvise,volData})=>{
  if(!pool) return null;
  const risk  = getRisk(pool._score);
  const pair  = getPair(pool.symbol);
  const strat = getStrategy(pool);
  const audit = pool._auditEntry;
  const liq   = getLiqLabel(pool._liqScore||0);
  const vol1d = (pool.volumeUsd7d||0)/7;
  const fdvRat= getFdvRating(pool._fdvTvlRatio);

  // Volatility for this pool's tokens
  const tokens    = extractTokens(pool.symbol);
  const volTokens = tokens.filter(t=>!isStable(t) && VOLATILITY_COIN_MAP[t]);
  const poolVol   = volTokens.length>0 ? (volTokens.map(t=>volData[VOLATILITY_COIN_MAP[t]]?.annualVol).filter(Boolean).reduce((a,b)=>a+b,0)/volTokens.length) : null;
  const volLabel  = getVolLabel(poolVol);
  const prices_approx = volTokens.map(t=>({t,price:null})); // price comes from CoinGecko
  const lpRange   = null; // Full price integration in VolatilityTab; modal shows vol % only

  const breakdown=[
    {label:"Protocol",  pts:SAFE_PROTOCOLS.some(p=>pool.project?.toLowerCase().includes(p))?22:MEDIUM_PROTOCOLS.some(p=>pool.project?.toLowerCase().includes(p))?12:2, max:22},
    {label:"TVL",       pts:pool.tvlUsd>100e6?16:pool.tvlUsd>50e6?14:pool.tvlUsd>10e6?11:pool.tvlUsd>2e6?7:pool.tvlUsd>500e3?3:0, max:18},
    {label:"Pair / IL", pts:isPairSS(pool.symbol)?20:isPairSV(pool.symbol)?12:4, max:20},
    {label:"APY Sanity",pts:pool.apy>200?0:pool.apy>100?2:pool.apy>60?5:pool.apy>30?8:pool.apy>=5?13:9, max:13},
    {label:"Network",   pts:pool.chain==="Ethereum"?10:["Arbitrum","Base","Optimism"].includes(pool.chain)?8:pool.chain==="Solana"?6:3, max:10},
    {label:"SC/Audit",  pts:audit?Math.max(1,Math.round(audit.score/10)-(audit.hacks>0?3:0)):SAFE_PROTOCOLS.some(p=>pool.project?.toLowerCase().includes(p))?8:5, max:10},
    {label:"Liquidity", pts:(pool._liqScore||0)>60?7:(pool._liqScore||0)>30?4:(pool._liqScore||0)>10?2:0, max:7},
  ];

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:"16px",backdropFilter:"blur(6px)"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#060d17",border:`1px solid ${risk.color}22`,borderRadius:"18px",padding:"26px",maxWidth:"560px",width:"100%",boxShadow:`0 0 80px ${risk.color}0c`,maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"18px"}}>
          <div>
            <div style={{fontSize:"21px",fontWeight:700,color:"#f1f5f9",marginBottom:"5px"}}>{pool.symbol?.replace(/_/g,"/")}</div>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
              <Badge color="#6366f1" sm>{pool.chain}</Badge>
              <Badge color={strat.color} sm>{strat.icon} {strat.type}</Badge>
              {audit&&<Badge color={audit.hacks>0?"#ef4444":"#22c55e"} sm>{audit.hacks>0?"⚠ Hack histórico":"✓ Auditado"}</Badge>}
              {poolVol&&<Badge color={volLabel.color} sm>📊 Vol {poolVol.toFixed(0)}% aa</Badge>}
            </div>
          </div>
          <div style={{display:"flex",gap:"8px"}}>
            <button onClick={()=>{onAdvise(pool);onClose();}} style={{padding:"6px 12px",borderRadius:"8px",fontSize:"10px",background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.3)",color:"#a5b4fc",cursor:"pointer",fontFamily:"monospace"}}>🤖 AI</button>
            <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:"none",color:"#64748b",width:"30px",height:"30px",borderRadius:"8px",cursor:"pointer"}}>✕</button>
          </div>
        </div>

        {/* Score hero */}
        <div style={{background:risk.bg,border:`1px solid ${risk.color}18`,borderRadius:"12px",padding:"14px 16px",marginBottom:"16px",display:"flex",alignItems:"center",gap:"16px"}}>
          <div style={{textAlign:"center",minWidth:"56px"}}>
            <div style={{fontSize:"40px",fontWeight:800,color:risk.color,fontFamily:"monospace",lineHeight:1}}>{pool._score}</div>
            <div style={{fontSize:"8px",color:risk.color,letterSpacing:"2px"}}>/100</div>
          </div>
          <div>
            <div style={{fontSize:"13px",fontWeight:700,color:risk.color,marginBottom:"3px"}}>{risk.icon} {risk.label}</div>
            <div style={{fontSize:"10px",color:"#475569",lineHeight:1.6}}>{pool._score>=75?"Capital maior bem-posicionado.":pool._score>=55?"Aceitável com monitoramento.":pool._score>=35?"Capital que pode perder.":"Evite ou use valor mínimo."}</div>
          </div>
        </div>

        {/* Breakdown */}
        <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"2px",marginBottom:"8px",fontFamily:"monospace"}}>BREAKDOWN — RISK ENGINE</div>
        <div style={{display:"flex",flexDirection:"column",gap:"5px",marginBottom:"16px"}}>
          {breakdown.map(b=>(
            <div key={b.label}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"2px",fontSize:"10px"}}>
                <span style={{color:"#64748b"}}>{b.label}</span>
                <span style={{color:b.pts===b.max?"#22c55e":b.pts>b.max*0.5?"#f59e0b":"#ef4444",fontFamily:"monospace",fontWeight:700}}>{b.pts}/{b.max}</span>
              </div>
              <div style={{height:"2px",background:"rgba(255,255,255,0.04)",borderRadius:"1px",overflow:"hidden"}}>
                <div style={{height:"100%",width:`${(b.pts/b.max)*100}%`,background:b.pts===b.max?"#22c55e":b.pts>b.max*0.5?"#f59e0b":"#ef4444",borderRadius:"1px"}}/>
              </div>
            </div>
          ))}
        </div>

        {/* Metrics */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"6px",marginBottom:"16px"}}>
          {[
            {label:"APY",     value:`${fmt(pool.apy)}%`,                 color:pool.apy>80?"#ef4444":pool.apy>40?"#f59e0b":"#22c55e"},
            {label:"TVL",     value:fmtK(pool.tvlUsd),                   color:"#3b82f6"},
            {label:"Vol 24h", value:vol1d>0?fmtK(vol1d):"—",             color:vol1d>1e6?"#22c55e":"#64748b"},
            {label:"Liquidez",value:liq.label,                           color:liq.color},
            {label:"IL",      value:pair.il,                             color:pair.color},
            {label:"Volatil.", value:poolVol?`${poolVol.toFixed(0)}%`:"—",color:volLabel.color},
            {label:"FDV/TVL", value:pool._fdvTvlRatio?`${pool._fdvTvlRatio.toFixed(1)}x`:"—",color:fdvRat.color},
            {label:"Audit",   value:audit?`${audit.score}/100`:"—",      color:audit?.score>=80?"#22c55e":audit?.score>=60?"#f59e0b":"#ef4444"},
          ].map(m=>(
            <div key={m.label} style={{background:"rgba(0,0,0,0.35)",borderRadius:"8px",padding:"8px",textAlign:"center"}}>
              <div style={{fontSize:"12px",fontWeight:700,color:m.color,marginBottom:"2px"}}>{m.value}</div>
              <div style={{fontSize:"8px",color:"#2d3748",letterSpacing:"1px",fontFamily:"monospace"}}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Volatility context if available */}
        {poolVol && (
          <div style={{padding:"10px 12px",background:`${volLabel.color}08`,border:`1px solid ${volLabel.color}18`,borderRadius:"8px",marginBottom:"12px"}}>
            <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"5px"}}>VOLATILIDADE HISTÓRICA (30 dias)</div>
            <div style={{display:"flex",gap:"16px",alignItems:"center"}}>
              <div><div style={{fontSize:"18px",fontWeight:700,color:volLabel.color,fontFamily:"monospace"}}>{poolVol.toFixed(1)}%<span style={{fontSize:"9px",color:"#475569"}}>/aa</span></div>
                <div style={{fontSize:"9px",color:"#475569"}}>{volLabel.label}</div></div>
              <div style={{fontSize:"10px",color:"#64748b",lineHeight:1.7}}>
                {volLabel.tier==="low"  && "Volatilidade baixa — range LP amplo funciona bem."}
                {volLabel.tier==="medium"&&"Volatilidade média — ajuste range a cada 2–4 semanas."}
                {volLabel.tier==="high"  &&"Volatilidade alta — range estreito sai do range rápido."}
                {volLabel.tier==="extreme"&&"Volatilidade extrema — prefira stable pools ou DCA."}
              </div>
            </div>
          </div>
        )}

        {audit&&(
          <div style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",borderRadius:"8px",marginBottom:"12px"}}>
            <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"5px"}}>AUDIT PROXY</div>
            <div style={{fontSize:"11px",color:"#64748b",lineHeight:1.6}}>Auditores: <span style={{color:"#94a3b8"}}>{audit.auditors.join(", ")}</span><br/>Hacks: <span style={{color:audit.hacks>0?"#ef4444":"#22c55e"}}>{audit.hacks===0?"Nenhum":`${audit.hacks} ocorrência(s)`}</span>{" · "}Bug Bounty: <span style={{color:audit.bounty?"#22c55e":"#475569"}}>{audit.bounty?"Ativo":"Não"}</span></div>
          </div>
        )}
        <div style={{padding:"8px",background:"rgba(0,0,0,0.15)",borderRadius:"6px",fontSize:"9px",color:"#2d3748",lineHeight:1.6}}>⚠ Score educacional. Volatilidade calculada via CoinGecko 30d. Não é conselho financeiro.</div>
      </div>
    </div>
  );
};

// ─── POOL ROW ─────────────────────────────────────────────────────────────────
const PoolRow = ({pool,i,onSelect,selected,volData})=>{
  const risk  = getRisk(pool._score);
  const pair  = getPair(pool.symbol);
  const strat = getStrategy(pool);
  const liq   = getLiqLabel(pool._liqScore||0);
  const vol1d = (pool.volumeUsd7d||0)/7;
  const tokens    = extractTokens(pool.symbol);
  const volTokens = tokens.filter(t=>!isStable(t)&&VOLATILITY_COIN_MAP[t]);
  const poolVol   = volTokens.length>0?(volTokens.map(t=>volData[VOLATILITY_COIN_MAP[t]]?.annualVol).filter(Boolean).reduce((a,b)=>a+b,0)/volTokens.length):null;
  const volLbl    = getVolLabel(poolVol);
  return (
    <div onClick={()=>onSelect(pool)} style={{display:"grid",gridTemplateColumns:"18px 1fr 85px 65px 65px 55px 55px",alignItems:"center",gap:"8px",padding:"8px 12px",borderRadius:"7px",cursor:"pointer",background:selected?"rgba(99,102,241,0.06)":i%2===0?"rgba(0,0,0,0.1)":"transparent",border:`1px solid ${selected?"rgba(99,102,241,0.22)":"transparent"}`,transition:"all 0.15s",fontSize:"12px"}}>
      <span style={{color:"#2d3748",fontFamily:"monospace",fontSize:"9px"}}>{i+1}</span>
      <div style={{minWidth:0}}>
        <div style={{color:"#cbd5e1",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:"1px"}}>{pool.symbol?.replace(/_/g,"/")}</div>
        <div style={{fontSize:"9px",color:"#2d3748"}}>{pool.project} · {pool.chain}</div>
      </div>
      <div>
        <div style={{fontSize:"9px",color:pair.color,marginBottom:"1px"}}>{pair.icon} {pair.label}</div>
        <div style={{fontSize:"9px",color:strat.color}}>{strat.icon} {strat.type.split(" ")[0]}</div>
      </div>
      <div style={{textAlign:"right"}}>
        <div style={{color:pool.apy>80?"#ef4444":pool.apy>40?"#f59e0b":"#22c55e",fontWeight:700,fontFamily:"monospace"}}>{fmt(pool.apy)}%</div>
        <div style={{fontSize:"9px",color:"#2d3748"}}>APY</div>
      </div>
      <div style={{textAlign:"right"}}>
        <div style={{color:"#475569",fontFamily:"monospace",fontSize:"11px"}}>{fmtK(pool.tvlUsd)}</div>
        <div style={{fontSize:"9px",color:"#2d3748"}}>TVL</div>
      </div>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:"9px",fontWeight:600,color:volLbl.color}}>{poolVol?`${poolVol.toFixed(0)}%`:"—"}</div>
        <div style={{fontSize:"8px",color:"#2d3748"}}>Vol</div>
      </div>
      <div style={{textAlign:"center"}}>
        <div style={{display:"inline-block",padding:"2px 7px",borderRadius:"20px",background:risk.bg,color:risk.color,fontSize:"11px",fontWeight:800,border:`1px solid ${risk.color}22`,fontFamily:"monospace"}}>{pool._score}</div>
      </div>
    </div>
  );
};

// ─── 7. VOLATILITY TAB ────────────────────────────────────────────────────────
function VolatilityTab({volData, volLoading, prices}) {
  const [ilRatio,     setIlRatio]     = useState(2);
  const [selectedTok, setSelectedTok] = useState("ETH");
  const [sigma,       setSigma]       = useState(1.5);
  const [horizonDays, setHorizonDays] = useState(30);
  const [customPrice, setCustomPrice] = useState("");

  const tokPrice = prices?.ethereum?.usd || prices?.bitcoin?.usd || 2000;
  const priceMap = { ETH:prices?.ethereum?.usd, BTC:prices?.bitcoin?.usd, SOL:prices?.solana?.usd };
  const currentPrice = customPrice ? Number(customPrice) : (priceMap[selectedTok] || null);
  const vd = volData[VOLATILITY_COIN_MAP[selectedTok]];
  const range = vd?.annualVol && currentPrice ? suggestLPRange(currentPrice, vd.annualVol, horizonDays, sigma) : null;
  const ilLoss = calcIL(ilRatio);

  const tokens = Object.entries(VOLATILITY_COIN_MAP).slice(0,12);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>

      {/* Overview grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"10px"}}>
        {[
          {sym:"ETH",k:"ethereum",emoji:"Ξ",color:"#6366f1"},
          {sym:"BTC",k:"bitcoin", emoji:"₿",color:"#f59e0b"},
          {sym:"SOL",k:"solana",  emoji:"◎",color:"#a78bfa"},
        ].map(({sym,k,emoji,color})=>{
          const vd2=volData[k];
          const vl=getVolLabel(vd2?.annualVol);
          return (
            <Card key={sym} glow={color}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                <div style={{display:"flex",gap:"5px",alignItems:"center"}}><span style={{fontSize:"15px"}}>{emoji}</span><span style={{fontSize:"9px",color:"#2d3748",letterSpacing:"2px",fontFamily:"monospace"}}>{sym}</span></div>
                {volLoading?<Spin size={10}/>:<Badge color={vl.color} sm>{vl.label}</Badge>}
              </div>
              {volLoading?<div style={{height:"40px",display:"flex",alignItems:"center"}}><Spin/></div>:vd2?(
                <>
                  <div style={{fontSize:"24px",fontWeight:700,color,fontFamily:"monospace"}}>{vd2.annualVol.toFixed(1)}<span style={{fontSize:"11px",color:"#475569"}}>%</span></div>
                  <div style={{fontSize:"9px",color:"#475569",marginTop:"2px"}}>Volatilidade anualizada (30d)</div>
                  <div style={{fontSize:"9px",color:"#334155",marginTop:"4px"}}>Diária: {vd2.dailyVol.toFixed(2)}%</div>
                </>
              ):<div style={{fontSize:"10px",color:"#2d3748"}}>Indisponível (CORS/limite API)</div>}
            </Card>
          );
        })}
      </div>

      {/* All tokens vol */}
      <Card>
        <SecTitle icon="📊" sub="Volatilidade histórica anualizada (30 dias, retornos log-diários)">Volatilidade por Token</SecTitle>
        {volLoading?(
          <div style={{textAlign:"center",padding:"30px"}}><Spin size={18}/><div style={{marginTop:"8px",fontSize:"10px",color:"#334155"}}>Buscando histórico de preços...</div></div>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px"}}>
            {tokens.map(([sym,coinId])=>{
              const vd2=volData[coinId];
              const vl=getVolLabel(vd2?.annualVol);
              return (
                <div key={sym} onClick={()=>setSelectedTok(sym)} style={{padding:"10px",background:selectedTok===sym?"rgba(99,102,241,0.1)":"rgba(0,0,0,0.2)",border:`1px solid ${selectedTok===sym?"rgba(99,102,241,0.3)":vd2?`${vl.color}15`:"rgba(255,255,255,0.04)"}`,borderRadius:"8px",cursor:"pointer",transition:"all 0.15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}>
                    <span style={{fontSize:"11px",fontWeight:700,color:"#94a3b8"}}>{sym}</span>
                    {vd2&&<span style={{fontSize:"10px",fontWeight:700,color:vl.color,fontFamily:"monospace"}}>{vd2.annualVol.toFixed(0)}%</span>}
                  </div>
                  {vd2?(
                    <>
                      <div style={{height:"3px",background:"rgba(255,255,255,0.04)",borderRadius:"2px",overflow:"hidden",marginBottom:"4px"}}>
                        <div style={{height:"100%",width:`${Math.min(100,vd2.annualVol/2)}%`,background:vl.color,borderRadius:"2px"}}/>
                      </div>
                      <div style={{fontSize:"8px",color:vl.color}}>{vl.label}</div>
                    </>
                  ):<div style={{fontSize:"8px",color:"#2d3748"}}>—</div>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* LP Range Calculator */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
        <Card>
          <SecTitle icon="📐" sub="Sugestão de range baseada em volatilidade histórica">LP Range Suggester</SecTitle>
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <div>
              <div style={{fontSize:"9px",color:"#334155",letterSpacing:"1px",marginBottom:"4px",fontFamily:"monospace"}}>TOKEN</div>
              <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                {["ETH","BTC","SOL","ARB","OP","LINK"].map(t=>(
                  <button key={t} onClick={()=>setSelectedTok(t)} style={{padding:"3px 9px",borderRadius:"20px",fontSize:"10px",cursor:"pointer",background:selectedTok===t?"rgba(99,102,241,0.18)":"rgba(0,0,0,0.22)",border:`1px solid ${selectedTok===t?"#6366f1":"rgba(255,255,255,0.05)"}`,color:selectedTok===t?"#a5b4fc":"#475569"}}>{t}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontSize:"9px",color:"#334155",letterSpacing:"1px",marginBottom:"4px",fontFamily:"monospace"}}>PREÇO ATUAL ($) <span style={{color:"#1e2d3d"}}>{currentPrice?`— usando $${fmt(currentPrice,0)}`:""}</span></div>
              <input value={customPrice} onChange={e=>setCustomPrice(e.target.value.replace(/[^0-9.]/g,""))} placeholder={currentPrice?`$${fmt(currentPrice,0)} (automático)`:""} style={{width:"100%",padding:"7px 10px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"7px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"12px"}}/>
            </div>
            <div>
              <div style={{fontSize:"9px",color:"#334155",letterSpacing:"1px",marginBottom:"4px",fontFamily:"monospace"}}>HORIZONTE: {horizonDays} dias</div>
              <input type="range" min={7} max={90} step={1} value={horizonDays} onChange={e=>setHorizonDays(Number(e.target.value))} style={{width:"100%",accentColor:"#6366f1",height:"3px"}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:"8px",color:"#2d3748"}}><span>7d</span><span>90d</span></div>
            </div>
            <div>
              <div style={{fontSize:"9px",color:"#334155",letterSpacing:"1px",marginBottom:"4px",fontFamily:"monospace"}}>SIGMA: {sigma}σ — {sigma===1?"68%":sigma===1.5?"86%":"95%"} confiança</div>
              <div style={{display:"flex",gap:"5px"}}>
                {[{v:1,l:"1σ 68%"},{v:1.5,l:"1.5σ 86%"},{v:2,l:"2σ 95%"}].map(s=>(
                  <button key={s.v} onClick={()=>setSigma(s.v)} style={{flex:1,padding:"4px",borderRadius:"6px",fontSize:"9px",cursor:"pointer",background:sigma===s.v?"rgba(99,102,241,0.15)":"rgba(0,0,0,0.2)",border:`1px solid ${sigma===s.v?"#6366f1":"rgba(255,255,255,0.05)"}`,color:sigma===s.v?"#a5b4fc":"#475569"}}>{s.l}</button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <SecTitle icon="🎯" sub="Range sugerido com base na vol histórica + sigma escolhido">Range Sugerido</SecTitle>
          {!vd?(
            <div style={{padding:"20px",textAlign:"center",fontSize:"10px",color:"#334155",lineHeight:1.7}}>
              Volatilidade de {selectedTok} não disponível.<br/>
              Verifique o limite da API CoinGecko.<br/>
              <span style={{fontSize:"8px",color:"#1e2d3d"}}>Em produção (Vercel) funciona normalmente.</span>
            </div>
          ):!currentPrice?(
            <div style={{padding:"20px",textAlign:"center",fontSize:"10px",color:"#334155"}}>Digite o preço atual do token.</div>
          ):range?(
            <>
              <div style={{display:"flex",flexDirection:"column",gap:"10px",marginBottom:"14px"}}>
                <div style={{padding:"14px",background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:"10px"}}>
                  <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"1px",marginBottom:"6px",fontFamily:"monospace"}}>LIMITE SUPERIOR</div>
                  <div style={{fontSize:"22px",fontWeight:700,color:"#22c55e",fontFamily:"monospace"}}>${fmt(range.upper,2)}</div>
                  <div style={{fontSize:"9px",color:"#475569"}}>+{((range.upper/currentPrice-1)*100).toFixed(1)}% do preço atual</div>
                </div>
                <div style={{padding:"10px",background:"rgba(99,102,241,0.06)",border:"1px solid rgba(99,102,241,0.15)",borderRadius:"8px",textAlign:"center"}}>
                  <div style={{fontSize:"10px",color:"#6366f1",fontWeight:700}}>PREÇO ATUAL: ${fmt(currentPrice,2)}</div>
                  <div style={{fontSize:"8px",color:"#334155",marginTop:"2px"}}>Vol: {vd.annualVol.toFixed(1)}%/aa · Sigma: {sigma}σ · {horizonDays}d</div>
                </div>
                <div style={{padding:"14px",background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.15)",borderRadius:"10px"}}>
                  <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"1px",marginBottom:"6px",fontFamily:"monospace"}}>LIMITE INFERIOR</div>
                  <div style={{fontSize:"22px",fontWeight:700,color:"#ef4444",fontFamily:"monospace"}}>${fmt(range.lower,2)}</div>
                  <div style={{fontSize:"9px",color:"#475569"}}>-{((1-range.lower/currentPrice)*100).toFixed(1)}% do preço atual</div>
                </div>
              </div>
              <div style={{padding:"10px",background:"rgba(0,0,0,0.2)",borderRadius:"8px",fontSize:"9px",color:"#64748b",lineHeight:1.7}}>
                Amplitude total: <strong style={{color:"#f59e0b"}}>{range.rangePct.toFixed(1)}%</strong><br/>
                Confiança histórica: <strong style={{color:"#22c55e"}}>{range.confidence}%</strong><br/>
                <span style={{color:"#334155"}}>Se o preço sair do range, sua posição para de acumular fees e vira exposição direcional.</span>
              </div>
            </>
          ):null}
        </Card>
      </div>

      {/* IL Calculator */}
      <Card>
        <SecTitle icon="📉" sub="Quanto você perde em relação a só segurar (HODL)">Calculadora de Impermanent Loss</SecTitle>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"20px"}}>
          <div>
            <div style={{fontSize:"10px",color:"#475569",marginBottom:"6px"}}>Variação de preço (multiplicador): <strong style={{color:"#f59e0b"}}>{ilRatio}x</strong></div>
            <input type="range" min="0.1" max="5" step="0.1" value={ilRatio} onChange={e=>setIlRatio(Number(e.target.value))} style={{width:"100%",accentColor:"#f59e0b",marginBottom:"6px"}}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:"9px",color:"#2d3748"}}><span>0.1x (−90%)</span><span>5x (+400%)</span></div>
            <div style={{marginTop:"14px",display:"flex",flexDirection:"column",gap:"6px"}}>
              {[[0.25,"−75%",],[0.5,"−50%"],[2,"×2 +100%"],[3,"×3 +200%"],[5,"×5 +400%"]].map(([r,l])=>(
                <div key={r} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",background:"rgba(0,0,0,0.2)",borderRadius:"5px",fontSize:"9px",cursor:"pointer"}} onClick={()=>setIlRatio(r)}>
                  <span style={{color:"#64748b"}}>{l}</span>
                  <span style={{color:"#ef4444",fontFamily:"monospace",fontWeight:700}}>{calcIL(r).toFixed(2)}% IL</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            <div style={{padding:"14px",background:"rgba(239,68,68,0.07)",border:"1px solid rgba(239,68,68,0.18)",borderRadius:"10px"}}>
              <div style={{fontSize:"9px",color:"#475569",marginBottom:"3px",letterSpacing:"1px"}}>PERDA POR IMPERMANENT LOSS</div>
              <div style={{fontSize:"30px",fontWeight:700,color:"#ef4444",fontFamily:"monospace"}}>{ilLoss.toFixed(2)}%</div>
              <div style={{fontSize:"9px",color:"#475569",marginTop:"3px"}}>vs manter os tokens sem LP</div>
            </div>
            <div style={{padding:"10px",background:"rgba(0,0,0,0.2)",borderRadius:"8px",fontSize:"10px",color:"#64748b",lineHeight:1.7}}>
              APY mínimo para cobrir IL:<br/>
              <strong style={{color:"#f59e0b",fontSize:"14px"}}>{Math.abs(ilLoss).toFixed(1)}%/ano</strong>
            </div>
            <div style={{padding:"10px",background:"rgba(0,0,0,0.15)",borderRadius:"7px",fontSize:"9px",color:"#334155",lineHeight:1.6}}>
              IL permanece latente enquanto você está no pool. Só se materializa ao retirar. Stable/stable pools têm IL≈0.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── 11. PORTFOLIO TAB ────────────────────────────────────────────────────────
function PortfolioTab({pools, prices, volData}) {
  const STORAGE_KEY = "portfolio-positions-v2";
  const [positions, setPositions] = useState([]);
  const [showAdd,   setShowAdd]   = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [newPos,    setNewPos]    = useState({symbol:"",protocol:"",chain:"Ethereum",valueUSD:"",entryPrice:"",entryDate:new Date().toISOString().slice(0,10)});
  const [poolSearch,setPoolSearch]= useState("");

  useEffect(()=>{
    (async()=>{ try{ const r=await window.storage?.get(STORAGE_KEY); if(r){setPositions(JSON.parse(r.value)||[]);} }catch{} })();
  },[]);

  const save = async(pos) => {
    try{ await window.storage?.set(STORAGE_KEY, JSON.stringify(pos)); setSaved(true); setTimeout(()=>setSaved(false),2000); }catch{}
  };

  const addPosition = () => {
    if(!newPos.symbol||!newPos.valueUSD) return;
    // try to find matching pool for score
    const matchPool = pools.find(p=>p.symbol?.toLowerCase().replace(/_/g,"/").includes(newPos.symbol.toLowerCase())||newPos.symbol.toLowerCase().includes(p.project?.toLowerCase()));
    const enriched = {
      id: Date.now(), ...newPos,
      valueUSD: Number(newPos.valueUSD),
      entryPrice: Number(newPos.entryPrice)||0,
      _score: matchPool?._score||50,
      _liqScore: matchPool?._liqScore||0,
      apy: matchPool?.apy||0,
    };
    const updated = [...positions, enriched];
    setPositions(updated);
    save(updated);
    setNewPos({symbol:"",protocol:"",chain:"Ethereum",valueUSD:"",entryPrice:"",entryDate:new Date().toISOString().slice(0,10)});
    setShowAdd(false);
  };

  const removePosition = (id) => {
    const updated = positions.filter(p=>p.id!==id);
    setPositions(updated);
    save(updated);
  };

  // ── Analytics ──
  const totalValue    = positions.reduce((a,b)=>a+(b.valueUSD||0),0);
  const divScore      = calcDiversificationScore(positions);
  const riskConc      = calcRiskConcentration(positions);
  const chainConc     = calcChainConcentration(positions);
  const portScore     = calcPortfolioScore(positions);
  const portRisk      = getRisk(portScore);
  const weightedAPY   = positions.length>0&&totalValue>0 ? positions.reduce((a,p)=>a+(p.apy||0)*(p.valueUSD||0)/totalValue,0) : 0;

  const filteredPools = pools.filter(p=>poolSearch?p.symbol?.toLowerCase().includes(poolSearch.toLowerCase())||p.project?.toLowerCase().includes(poolSearch.toLowerCase()):true).slice(0,6);

  const divColor = divScore>=70?"#22c55e":divScore>=40?"#f59e0b":"#ef4444";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>

      {/* Summary cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px"}}>
        {[
          {label:"Capital Total",     value:totalValue>0?`$${fmt(totalValue,0)}`:"$0",      color:"#3b82f6",    icon:"💰"},
          {label:"Score Médio",       value:`${portScore}/100`,                              color:portRisk.color,icon:"🧠"},
          {label:"Diversificação",    value:`${divScore}/100`,                               color:divColor,      icon:"🌐"},
          {label:"APY Médio Pond.",   value:totalValue>0?`${fmt(weightedAPY,1)}%`:"—",      color:"#22c55e",    icon:"📈"},
        ].map(m=>(
          <Card key={m.label} glow={m.color} style={{padding:"14px"}}>
            <div style={{fontSize:"14px",marginBottom:"4px"}}>{m.icon}</div>
            <div style={{fontSize:"22px",fontWeight:800,color:m.color,fontFamily:"monospace"}}>{m.value}</div>
            <div style={{fontSize:"9px",color:"#2d3748",marginTop:"4px",letterSpacing:"1px"}}>{m.label}</div>
          </Card>
        ))}
      </div>

      {positions.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>

          {/* Risk Concentration */}
          <Card>
            <SecTitle icon="🎯" sub="Distribuição do capital por nível de risco">Risk Concentration</SecTitle>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {[
                {label:"🟢 Baixo Risco (≥75)",   pct:riskConc.low,    color:"#22c55e"},
                {label:"🟡 Risco Médio (55–74)", pct:riskConc.medium, color:"#f59e0b"},
                {label:"🟠 Risco Alto (35–54)",  pct:riskConc.high,   color:"#f97316"},
                {label:"🔴 Muito Arriscado (<35)",pct:riskConc.extreme,color:"#ef4444"},
              ].map(r=>(
                <div key={r.label}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px",fontSize:"10px"}}>
                    <span style={{color:"#64748b"}}>{r.label}</span>
                    <span style={{color:r.color,fontFamily:"monospace",fontWeight:700}}>{r.pct.toFixed(1)}%</span>
                  </div>
                  <div style={{height:"5px",background:"rgba(255,255,255,0.04)",borderRadius:"3px",overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${r.pct}%`,background:r.color,borderRadius:"3px",transition:"width 0.6s ease"}}/>
                  </div>
                </div>
              ))}
            </div>
            {riskConc.extreme>30&&(
              <div style={{marginTop:"10px",padding:"8px",background:"rgba(239,68,68,0.07)",border:"1px solid rgba(239,68,68,0.18)",borderRadius:"6px",fontSize:"9px",color:"#ef4444"}}>
                ⚠ {riskConc.extreme.toFixed(0)}% do capital em pools de alto risco. Considere rebalancear.
              </div>
            )}
          </Card>

          {/* Chain & Diversification */}
          <Card>
            <SecTitle icon="🌐" sub="Concentração por rede">Chain Distribution</SecTitle>
            <div style={{display:"flex",flexDirection:"column",gap:"6px",marginBottom:"14px"}}>
              {Object.entries(chainConc).sort((a,b)=>b[1]-a[1]).map(([chain,pct])=>{
                const chainColor = chain==="Ethereum"?"#627eea":chain==="Arbitrum"?"#2d9cdb":chain==="Base"?"#3b82f6":chain==="Solana"?"#9945ff":"#64748b";
                return (
                  <div key={chain}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:"2px",fontSize:"10px"}}>
                      <span style={{color:"#64748b"}}>{chain}</span>
                      <span style={{color:chainColor,fontFamily:"monospace",fontWeight:700}}>{pct.toFixed(1)}%</span>
                    </div>
                    <div style={{height:"4px",background:"rgba(255,255,255,0.04)",borderRadius:"2px",overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${pct}%`,background:chainColor,borderRadius:"2px"}}/>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:"10px",background:divScore>=70?"rgba(34,197,94,0.06)":divScore>=40?"rgba(245,158,11,0.06)":"rgba(239,68,68,0.06)",border:`1px solid ${divColor}18`,borderRadius:"8px"}}>
              <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"1px",marginBottom:"4px",fontFamily:"monospace"}}>DIVERSIFICATION SCORE</div>
              <div style={{fontSize:"24px",fontWeight:800,color:divColor,fontFamily:"monospace"}}>{divScore}<span style={{fontSize:"12px",color:"#475569"}}>/100</span></div>
              <div style={{fontSize:"9px",color:"#475569",marginTop:"3px"}}>{divScore>=70?"Bem diversificado. Continue balanceando.":divScore>=40?"Diversificação moderada. Adicione outras redes/pares.":"Muito concentrado. Distribua o capital entre mais pools/redes."}</div>
            </div>
          </Card>
        </div>
      )}

      {/* Positions list */}
      <Card>
        <SecTitle icon="💼" right={
          <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
            {saved&&<span style={{fontSize:"9px",color:"#22c55e",fontFamily:"monospace"}}>✓ SALVO</span>}
            <button onClick={()=>setShowAdd(!showAdd)} style={{padding:"4px 12px",borderRadius:"6px",fontSize:"9px",background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.28)",color:"#a5b4fc",cursor:"pointer",fontFamily:"monospace"}}>+ POSIÇÃO</button>
          </div>
        }>Minhas Posições</SecTitle>

        {/* Add form */}
        {showAdd&&(
          <div style={{padding:"14px",background:"rgba(99,102,241,0.06)",border:"1px solid rgba(99,102,241,0.18)",borderRadius:"10px",marginBottom:"14px"}}>
            <div style={{fontSize:"9px",color:"#3d4f63",letterSpacing:"2px",fontFamily:"monospace",marginBottom:"10px"}}>NOVA POSIÇÃO</div>

            {/* Pool search */}
            <div style={{marginBottom:"8px"}}>
              <div style={{fontSize:"9px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>BUSCAR POOL (opcional)</div>
              <input value={poolSearch} onChange={e=>setPoolSearch(e.target.value)} placeholder="Ex: USDC/ETH, uniswap..." style={{width:"100%",padding:"6px 10px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"6px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"11px",marginBottom:"6px"}}/>
              {poolSearch&&(
                <div style={{display:"flex",flexDirection:"column",gap:"3px",maxHeight:"120px",overflowY:"auto"}}>
                  {filteredPools.map(p=>(
                    <div key={p.pool} onClick={()=>{setNewPos(n=>({...n,symbol:p.symbol?.replace(/_/g,"/"),protocol:p.project,chain:p.chain}));setPoolSearch("");}} style={{padding:"5px 8px",background:"rgba(0,0,0,0.3)",borderRadius:"5px",cursor:"pointer",fontSize:"10px",display:"flex",justifyContent:"space-between"}}>
                      <span style={{color:"#94a3b8",fontWeight:600}}>{p.symbol?.replace(/_/g,"/")} — {p.project}</span>
                      <span style={{color:getRisk(p._score).color,fontFamily:"monospace",fontSize:"9px"}}>Score {p._score}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"8px"}}>
              {[
                {label:"PAR / SÍMBOLO",key:"symbol",   placeholder:"USDC/ETH"},
                {label:"PROTOCOLO",    key:"protocol",  placeholder:"uniswap-v3"},
                {label:"REDE",         key:"chain",     placeholder:"Ethereum"},
              ].map(f=>(
                <div key={f.key}>
                  <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>{f.label}</div>
                  <input value={newPos[f.key]} onChange={e=>setNewPos(n=>({...n,[f.key]:e.target.value}))} placeholder={f.placeholder} style={{width:"100%",padding:"6px 8px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"6px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"11px"}}/>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"10px"}}>
              {[
                {label:"VALOR (USD)",key:"valueUSD",   placeholder:"1000"},
                {label:"PREÇO ENTRADA",key:"entryPrice",placeholder:"2000"},
                {label:"DATA ENTRADA",key:"entryDate",  placeholder:"2025-01-01"},
              ].map(f=>(
                <div key={f.key}>
                  <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>{f.label}</div>
                  <input value={newPos[f.key]} onChange={e=>setNewPos(n=>({...n,[f.key]:e.target.value}))} placeholder={f.placeholder} style={{width:"100%",padding:"6px 8px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"6px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"11px"}}/>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={addPosition} style={{padding:"6px 16px",borderRadius:"6px",background:"rgba(34,197,94,0.15)",border:"1px solid rgba(34,197,94,0.3)",color:"#22c55e",fontSize:"10px",cursor:"pointer",fontFamily:"monospace"}}>✓ ADICIONAR</button>
              <button onClick={()=>setShowAdd(false)} style={{padding:"6px 16px",borderRadius:"6px",background:"rgba(0,0,0,0.2)",border:"1px solid rgba(255,255,255,0.07)",color:"#475569",fontSize:"10px",cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        )}

        {positions.length===0?(
          <div style={{textAlign:"center",padding:"40px",color:"#2d3748",fontSize:"11px",lineHeight:1.8}}>
            Nenhuma posição registrada.<br/>
            <span style={{fontSize:"9px",color:"#1e2d3d"}}>Clique em "+ POSIÇÃO" para começar a rastrear seu portfólio.</span>
          </div>
        ):(
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 80px 70px 70px 60px 60px 28px",gap:"8px",padding:"0 8px 8px",borderBottom:"1px solid rgba(255,255,255,0.04)",fontSize:"8px",color:"#1e2d3d",letterSpacing:"1px",fontFamily:"monospace"}}>
              <span>POSIÇÃO</span><span style={{textAlign:"right"}}>VALOR</span><span style={{textAlign:"right"}}>APY</span><span style={{textAlign:"right"}}>ENTRADA</span><span style={{textAlign:"center"}}>SCORE</span><span style={{textAlign:"center"}}>RISCO</span><span></span>
            </div>
            {positions.map(pos=>{
              const risk2=getRisk(pos._score);
              const tokens2=extractTokens(pos.symbol);
              const volToks=tokens2.filter(t=>!isStable(t)&&VOLATILITY_COIN_MAP[t]);
              const posVol=volToks.length>0?(volToks.map(t=>volData[VOLATILITY_COIN_MAP[t]]?.annualVol).filter(Boolean).reduce((a,b)=>a+b,0)/volToks.length):null;
              const vl=getVolLabel(posVol);
              return (
                <div key={pos.id} style={{display:"grid",gridTemplateColumns:"1fr 80px 70px 70px 60px 60px 28px",gap:"8px",padding:"8px",borderRadius:"7px",marginBottom:"4px",background:"rgba(0,0,0,0.15)",alignItems:"center",fontSize:"11px"}}>
                  <div>
                    <div style={{fontWeight:600,color:"#94a3b8",marginBottom:"1px"}}>{pos.symbol}</div>
                    <div style={{fontSize:"9px",color:"#2d3748"}}>{pos.protocol} · {pos.chain} {posVol?<span style={{color:vl.color}}>· vol {posVol.toFixed(0)}%</span>:""}</div>
                  </div>
                  <div style={{textAlign:"right",fontFamily:"monospace",color:"#3b82f6",fontWeight:700}}>${fmt(pos.valueUSD,0)}</div>
                  <div style={{textAlign:"right",fontFamily:"monospace",color:"#22c55e"}}>{pos.apy>0?`${fmt(pos.apy,1)}%`:"—"}</div>
                  <div style={{textAlign:"right",fontSize:"9px",color:"#334155",fontFamily:"monospace"}}>{pos.entryPrice>0?`$${fmt(pos.entryPrice,0)}`:"—"}</div>
                  <div style={{textAlign:"center"}}>
                    <div style={{display:"inline-block",padding:"1px 6px",borderRadius:"20px",background:risk2.bg,color:risk2.color,fontSize:"10px",fontWeight:800,fontFamily:"monospace"}}>{pos._score}</div>
                  </div>
                  <div style={{textAlign:"center",fontSize:"9px",color:risk2.color,fontWeight:600}}>{risk2.icon}</div>
                  <button onClick={()=>removePosition(pos.id)} style={{background:"none",border:"none",color:"#1e2d3d",cursor:"pointer",fontSize:"12px",padding:"2px"}}>✕</button>
                </div>
              );
            })}

            {/* Portfolio weight visual */}
            <div style={{marginTop:"12px",padding:"10px",background:"rgba(0,0,0,0.15)",borderRadius:"8px"}}>
              <div style={{fontSize:"8px",color:"#1e2d3d",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"6px"}}>PESO DO PORTFÓLIO</div>
              <div style={{display:"flex",height:"12px",borderRadius:"6px",overflow:"hidden",gap:"2px"}}>
                {positions.map((pos,i)=>{
                  const colors=["#6366f1","#22c55e","#f59e0b","#3b82f6","#ef4444","#a78bfa","#f97316"];
                  return (
                    <div key={pos.id} title={`${pos.symbol}: ${((pos.valueUSD/totalValue)*100).toFixed(1)}%`}
                      style={{height:"100%",width:`${(pos.valueUSD/totalValue)*100}%`,background:colors[i%colors.length],minWidth:"2px",transition:"width 0.4s"}}/>
                  );
                })}
              </div>
              <div style={{display:"flex",gap:"8px",marginTop:"6px",flexWrap:"wrap"}}>
                {positions.map((pos,i)=>{
                  const colors=["#6366f1","#22c55e","#f59e0b","#3b82f6","#ef4444","#a78bfa","#f97316"];
                  return <div key={pos.id} style={{display:"flex",alignItems:"center",gap:"4px",fontSize:"8px",color:"#475569"}}>
                    <div style={{width:"8px",height:"8px",borderRadius:"2px",background:colors[i%colors.length]}}/>
                    {pos.symbol} ({((pos.valueUSD/totalValue)*100).toFixed(0)}%)
                  </div>;
                })}
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ─── AI ADVISOR ───────────────────────────────────────────────────────────────
function AIAdvisorTab({pools, prices, initialPool}) {
  const [messages,   setMessages]   = useState([]);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [ctxPool,    setCtxPool]    = useState(initialPool||null);
  const [poolSearch, setPoolSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const endRef = useRef(null);

  useEffect(()=>{
    if(!messages.length) setMessages([{role:"assistant",content:initialPool
      ?`Analisei o pool **${initialPool.symbol?.replace(/_/g,"/")}** (${initialPool.project} · ${initialPool.chain}) — Score ${initialPool._score}/100, APY ${initialPool.apy?.toFixed(1)}%. O que quer saber?`
      :"Olá! Sou seu advisor DeFi. Posso analisar pools, explicar riscos, sugerir estratégias e LP ranges. Selecione um pool ou faça uma pergunta!"
    }]);
  },[]);

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[messages]);

  const buildSystem = () => {
    const mkt = getMarketContext(prices);
    const top = pools.slice(0,12).map(p=>`${p.symbol?.replace(/_/g,"/")} | ${p.project} | ${p.chain} | APY:${p.apy?.toFixed(1)}% | TVL:${fmtK(p.tvlUsd)} | Score:${p._score} | Liq:${getLiqLabel(p._liqScore||0).label}`).join("\n");
    const pCtx = ctxPool?`\nPOOL EM ANÁLISE:\n- ${ctxPool.symbol?.replace(/_/g,"/")} (${ctxPool.project}, ${ctxPool.chain})\n- APY: ${ctxPool.apy?.toFixed(2)}% | TVL: ${fmtK(ctxPool.tvlUsd)} | Score: ${ctxPool._score}/100\n- ${ctxPool._auditEntry?`Auditado: ${ctxPool._auditEntry.auditors.join(", ")} | Hacks: ${ctxPool._auditEntry.hacks}`:"Audit: desconhecido"}`:""
    return `You are an expert DeFi advisor with deep knowledge of liquidity pools, yield farming, impermanent loss, smart contract risk, tokenomics, and LP range management.\n\nMARKET: ${mkt.mode} | BTC $${prices?.bitcoin?.usd?.toLocaleString()||"?"} (${prices?.bitcoin?.change24h?.toFixed(1)||0}%) | ETH $${prices?.ethereum?.usd?.toLocaleString()||"?"} | SOL $${prices?.solana?.usd?.toLocaleString()||"?"}\n\nTOP POOLS:\n${top}${pCtx}\n\nRules:\n- Respond in Brazilian Portuguese (pt-BR)\n- Be direct, practical, data-driven\n- Reference specific numbers from context\n- Mention IL and volatility when relevant\n- Always note DYOR\n- Concise (3-6 sentences) unless asked for detail`;
  };

  const send = async() => {
    const text=input.trim(); if(!text||loading) return;
    setInput("");
    const newMsgs=[...messages,{role:"user",content:text}];
    setMessages(newMsgs); setLoading(true);
    try {
      const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:buildSystem(),messages:newMsgs.map(m=>({role:m.role,content:m.content}))})});
      const d=await r.json();
      setMessages(p=>[...p,{role:"assistant",content:d.content?.find(b=>b.type==="text")?.text||"Erro."}]);
    }catch{ setMessages(p=>[...p,{role:"assistant",content:"⚠ Erro de conexão."}]); }
    finally{ setLoading(false); }
  };

  const quickPrompts=ctxPool?[
    `Análise completa do ${ctxPool.symbol?.replace(/_/g,"/")}`,
    `Score ${ctxPool._score} justifica aportar?`,
    `Qual o risco de IL nesse pool?`,
    `APY ${ctxPool.apy?.toFixed(1)}% é sustentável?`,
    `Compare com alternativas mais seguras`,
  ]:[
    "Quais os pools mais seguros agora?",
    "Como interpretar o Volatility Score?",
    "O que é LP Range e como escolher?",
    "Diferença entre Stable Yield e High Yield Farming",
    "Como diversificar um portfólio DeFi?",
  ];

  const filtered = pools.filter(p=>p.symbol?.toLowerCase().includes(poolSearch.toLowerCase())||p.project?.toLowerCase().includes(poolSearch.toLowerCase())).slice(0,8);

  return (
    <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:"14px",height:"600px"}}>
      <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
        <Card style={{padding:"14px"}}>
          <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"2px",fontFamily:"monospace",marginBottom:"8px"}}>CONTEXTO</div>
          {ctxPool?(
            <div style={{background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.18)",borderRadius:"8px",padding:"9px"}}>
              <div style={{fontSize:"12px",fontWeight:700,color:"#a5b4fc",marginBottom:"2px"}}>{ctxPool.symbol?.replace(/_/g,"/")}</div>
              <div style={{fontSize:"9px",color:"#334155"}}>{ctxPool.project} · {ctxPool.chain}</div>
              <div style={{display:"flex",gap:"4px",marginTop:"5px",flexWrap:"wrap"}}>
                <Badge color={getRisk(ctxPool._score).color} sm>Score {ctxPool._score}</Badge>
                <Badge color="#22c55e" sm>{fmt(ctxPool.apy)}%</Badge>
              </div>
              <button onClick={()=>setCtxPool(null)} style={{marginTop:"6px",fontSize:"9px",color:"#334155",background:"none",border:"none",cursor:"pointer",padding:0}}>✕ remover</button>
            </div>
          ):<div style={{fontSize:"10px",color:"#334155",lineHeight:1.6}}>Análise geral.<br/>Selecione um pool para contexto.</div>}
          <button onClick={()=>setShowSearch(!showSearch)} style={{marginTop:"8px",width:"100%",padding:"5px",borderRadius:"6px",fontSize:"10px",background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.18)",color:"#7c85d4",cursor:"pointer"}}>🔍 Selecionar pool</button>
          {showSearch&&(
            <div style={{marginTop:"6px"}}>
              <input value={poolSearch} onChange={e=>setPoolSearch(e.target.value)} placeholder="Buscar..." style={{width:"100%",padding:"5px 8px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"5px",color:"#f1f5f9",fontSize:"10px",fontFamily:"monospace",marginBottom:"4px"}}/>
              <div style={{maxHeight:"140px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"2px"}}>
                {filtered.map(p=>(
                  <div key={p.pool} onClick={()=>{setCtxPool(p);setShowSearch(false);setPoolSearch("");}} style={{padding:"5px 7px",borderRadius:"5px",cursor:"pointer",fontSize:"10px",background:"rgba(0,0,0,0.2)"}}>
                    <div style={{fontWeight:600,color:"#94a3b8"}}>{p.symbol?.replace(/_/g,"/")}</div>
                    <div style={{fontSize:"8px",color:"#334155"}}>{p.project} · Score {p._score}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card style={{padding:"14px",flex:1}}>
          <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"2px",fontFamily:"monospace",marginBottom:"8px"}}>PERGUNTAS RÁPIDAS</div>
          <div style={{display:"flex",flexDirection:"column",gap:"5px"}}>
            {quickPrompts.map((q,i)=>(
              <button key={i} onClick={()=>setInput(q)} style={{padding:"7px 9px",borderRadius:"7px",fontSize:"10px",textAlign:"left",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.04)",color:"#475569",cursor:"pointer",lineHeight:1.4}}>{q}</button>
            ))}
          </div>
        </Card>
      </div>
      <Card style={{display:"flex",flexDirection:"column",padding:"0",overflow:"hidden"}}>
        <div style={{flex:1,overflowY:"auto",padding:"18px",display:"flex",flexDirection:"column",gap:"10px"}}>
          {messages.map((m,i)=>(
            <div key={i} style={{display:"flex",gap:"8px",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
              {m.role==="assistant"&&<div style={{width:"26px",height:"26px",borderRadius:"50%",background:"linear-gradient(135deg,#4f46e5,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",flexShrink:0,marginTop:"2px"}}>🤖</div>}
              <div style={{maxWidth:"78%",padding:"10px 13px",borderRadius:m.role==="user"?"13px 13px 3px 13px":"13px 13px 13px 3px",background:m.role==="user"?"rgba(99,102,241,0.18)":"rgba(0,0,0,0.28)",border:`1px solid ${m.role==="user"?"rgba(99,102,241,0.28)":"rgba(255,255,255,0.05)"}`,fontSize:"12px",color:"#cbd5e1",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{m.content.replace(/\*\*(.*?)\*\*/g,"$1")}</div>
            </div>
          ))}
          {loading&&<div style={{display:"flex",gap:"8px"}}><div style={{width:"26px",height:"26px",borderRadius:"50%",background:"linear-gradient(135deg,#4f46e5,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px"}}>🤖</div><div style={{padding:"10px 14px",borderRadius:"13px 13px 13px 3px",background:"rgba(0,0,0,0.28)",border:"1px solid rgba(255,255,255,0.05)",display:"flex",gap:"8px",alignItems:"center"}}><Spin/><span style={{fontSize:"11px",color:"#334155"}}>Analisando...</span></div></div>}
          <div ref={endRef}/>
        </div>
        <div style={{padding:"14px",borderTop:"1px solid rgba(255,255,255,0.04)",display:"flex",gap:"8px"}}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} placeholder="Pergunte sobre pools, ranges, IL, estratégias..." style={{flex:1,padding:"9px 13px",background:"rgba(0,0,0,0.28)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"9px",color:"#f1f5f9",fontSize:"13px",fontFamily:"Georgia,serif"}}/>
          <button onClick={send} disabled={loading||!input.trim()} style={{padding:"9px 16px",borderRadius:"9px",fontSize:"10px",background:loading||!input.trim()?"rgba(99,102,241,0.06)":"rgba(99,102,241,0.2)",border:`1px solid ${loading||!input.trim()?"rgba(99,102,241,0.08)":"rgba(99,102,241,0.35)"}`,color:loading||!input.trim()?"#2d3748":"#a5b4fc",cursor:loading||!input.trim()?"not-allowed":"pointer",fontFamily:"monospace",letterSpacing:"1px"}}>SEND →</button>
        </div>
      </Card>
    </div>
  );
}

// ─── LIQUIDITY TAB ────────────────────────────────────────────────────────────
function LiquidezTab({pools, fdvData, dataStatus}) {
  const topByVol  = [...pools].sort((a,b)=>((b.volumeUsd7d||0)/7)-((a.volumeUsd7d||0)/7)).slice(0,15);
  const valuation = Object.entries(PROTOCOL_COIN_MAP).map(([proto,coinId])=>{
    const fd=fdvData[coinId]; if(!fd?.fdv) return null;
    const relPools=pools.filter(p=>p.project?.toLowerCase().includes(proto));
    const totalTvl=relPools.reduce((a,b)=>a+b.tvlUsd,0);
    return {proto,coinId,fdv:fd.fdv,marketCap:fd.marketCap,tvl:totalTvl,ratio:totalTvl>0?fd.fdv/totalTvl:null};
  }).filter(Boolean).sort((a,b)=>(a.ratio||999)-(b.ratio||999)).slice(0,12);
  const auditList = Object.entries(AUDIT_PROXY).sort((a,b)=>b[1].score-a[1].score).slice(0,16);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
      <Card>
        <SecTitle icon="📡">Data Sources</SecTitle>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px"}}>
          {[{label:"DeFiLlama",key:"defillama",note:"TVL, APY, Vol 7d"},{label:"CoinGecko Prices",key:"coingecko",note:"BTC, ETH, SOL"},{label:"CoinGecko FDV",key:"fdv",note:"FDV e Market Cap"},{label:"Uniswap Subgraph",key:"uniswap",note:"TxCount, Volume"}].map(s=>(
            <div key={s.key} style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",borderRadius:"8px",border:`1px solid ${dataStatus[s.key]==="ok"?"rgba(34,197,94,0.15)":dataStatus[s.key]==="error"?"rgba(239,68,68,0.15)":"rgba(245,158,11,0.1)"}`}}>
              <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"4px"}}><StatusDot status={dataStatus[s.key]||"loading"}/><span style={{fontSize:"11px",fontWeight:600,color:"#94a3b8"}}>{s.label}</span></div>
              <div style={{fontSize:"9px",color:"#2d3748"}}>{s.note}</div>
              <div style={{fontSize:"9px",color:dataStatus[s.key]==="ok"?"#22c55e":dataStatus[s.key]==="error"?"#ef4444":"#f59e0b",marginTop:"3px",fontFamily:"monospace"}}>{dataStatus[s.key]==="ok"?"✓ Online":dataStatus[s.key]==="error"?"✗ Offline":"⧗ Carregando"}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <SecTitle icon="💧" sub="Volume diário estimado">Top Pools por Liquidez</SecTitle>
        <div style={{display:"grid",gridTemplateColumns:"18px 1fr 70px 60px 50px",gap:"6px",padding:"0 0 8px",borderBottom:"1px solid rgba(255,255,255,0.04)",fontSize:"8px",color:"#2d3748",letterSpacing:"1px",fontFamily:"monospace"}}>
          <span>#</span><span>POOL</span><span style={{textAlign:"right"}}>VOL 24H</span><span style={{textAlign:"right"}}>V/TVL</span><span style={{textAlign:"center"}}>LIQ</span>
        </div>
        {topByVol.map((p,i)=>{
          const vol1d=(p.volumeUsd7d||0)/7, ratio=p.tvlUsd>0?vol1d/p.tvlUsd:0, liq=getLiqLabel(p._liqScore||0);
          return (
            <div key={p.pool||i} style={{display:"grid",gridTemplateColumns:"18px 1fr 70px 60px 50px",gap:"6px",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.02)",fontSize:"11px",alignItems:"center"}}>
              <span style={{color:"#2d3748",fontFamily:"monospace",fontSize:"9px"}}>{i+1}</span>
              <div style={{minWidth:0}}><div style={{color:"#94a3b8",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.symbol?.replace(/_/g,"/")}</div><div style={{fontSize:"9px",color:"#2d3748"}}>{p.project}</div></div>
              <div style={{textAlign:"right",color:vol1d>10e6?"#22c55e":vol1d>1e6?"#f59e0b":"#64748b",fontFamily:"monospace",fontSize:"10px",fontWeight:600}}>{fmtK(vol1d)}</div>
              <div style={{textAlign:"right",color:"#475569",fontFamily:"monospace",fontSize:"9px"}}>{ratio>0?`${(ratio*100).toFixed(0)}%`:"—"}</div>
              <div style={{textAlign:"center"}}><Badge color={liq.color} sm>{liq.label}</Badge></div>
            </div>
          );
        })}
      </Card>
      <Card>
        <SecTitle icon="📊" sub="FDV/TVL — quanto o mercado paga por $ de liquidez">Valuation Engine — FDV vs TVL</SecTitle>
        {dataStatus.fdv==="loading"?<div style={{textAlign:"center",padding:"30px"}}><Spin size={18}/></div>:valuation.length===0?<div style={{textAlign:"center",padding:"20px",fontSize:"11px",color:"#334155"}}>FDV indisponível</div>:(
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px"}}>
            {valuation.map(v=>{
              const rat=getFdvRating(v.ratio);
              return (
                <div key={v.proto} style={{padding:"10px",background:"rgba(0,0,0,0.2)",borderRadius:"8px",border:`1px solid ${rat.color}18`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}><span style={{fontSize:"11px",fontWeight:700,color:"#94a3b8",textTransform:"capitalize"}}>{v.proto}</span><Badge color={rat.color} sm>{rat.label}</Badge></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"4px"}}>
                    {[{l:"FDV",v:fmtK(v.fdv),c:"#a5b4fc"},{l:"TVL",v:fmtK(v.tvl),c:"#3b82f6"},{l:"Ratio",v:v.ratio?`${v.ratio.toFixed(1)}x`:"—",c:rat.color}].map(m=>(
                      <div key={m.l} style={{textAlign:"center"}}><div style={{fontSize:"10px",fontWeight:700,color:m.c,fontFamily:"monospace"}}>{m.v}</div><div style={{fontSize:"8px",color:"#2d3748"}}>{m.l}</div></div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <Card>
        <SecTitle icon="🛡" sub="Proxy baseado em auditorias públicas conhecidas">Audit Score Proxy</SecTitle>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px"}}>
          {auditList.map(([proto,a])=>{
            const c=a.score>=85?"#22c55e":a.score>=70?"#f59e0b":a.score>=55?"#f97316":"#ef4444";
            return (
              <div key={proto} style={{padding:"9px",background:"rgba(0,0,0,0.2)",borderRadius:"7px",border:`1px solid ${c}15`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}><span style={{fontSize:"10px",fontWeight:700,color:"#94a3b8",textTransform:"capitalize"}}>{proto.replace(/-/g," ")}</span><span style={{fontSize:"11px",fontWeight:800,color:c,fontFamily:"monospace"}}>{a.score}</span></div>
                <div style={{height:"2px",background:"rgba(255,255,255,0.04)",borderRadius:"1px",marginBottom:"4px",overflow:"hidden"}}><div style={{height:"100%",width:`${a.score}%`,background:c,borderRadius:"1px"}}/></div>
                <div style={{fontSize:"8px",color:"#2d3748",lineHeight:1.4}}>{a.auditors.slice(0,2).join(", ")}{a.hacks>0&&<span style={{color:"#ef4444"}}> · ⚠</span>}{a.bounty&&<span style={{color:"#22c55e"}}> · 💰</span>}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ─── STRATEGIES TAB ───────────────────────────────────────────────────────────
function StrategiesTab({pools, prices, volData}) {
  const mkt = getMarketContext(prices);
  const [ilRatio, setIlRatio] = useState(2);
  const ilLoss = calcIL(ilRatio);
  const groups = [
    {type:"Stable Yield",icon:"🏦",color:"#22c55e",desc:"Capital preservation + yield. Zero IL. Ideal para bear/lateral.",ideal:"Bear / Lateral",pools:pools.filter(p=>isPairSS(p.symbol)&&p._score>=55).slice(0,4)},
    {type:"Range Trading",icon:"📐",color:"#3b82f6",desc:"LP concentrada num range apertado. Muito sensível à vol.",ideal:"Lateral",pools:pools.filter(p=>isPairSV(p.symbol)&&p.apy<40&&p._score>=55).slice(0,4)},
    {type:"High Yield Farming",icon:"🌾",color:"#f59e0b",desc:"Yield agressivo via token rewards. Verifique a vol antes.",ideal:"Bull market",pools:pools.filter(p=>p.apy>=40&&p._score>=45).slice(0,4)},
    {type:"Lending Loop",icon:"🔄",color:"#a78bfa",desc:"Lending recursivo para yield alavancado.",ideal:"Estável",pools:pools.filter(p=>!isPairSS(p.symbol)&&!isPairSV(p.symbol)&&p._score>=60).slice(0,4)},
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
      <div style={{background:`${mkt.color}0a`,border:`1px solid ${mkt.color}18`,borderRadius:"10px",padding:"12px 16px",display:"flex",alignItems:"center",gap:"12px"}}>
        <span style={{fontSize:"22px"}}>{mkt.icon}</span>
        <div><div style={{fontSize:"11px",fontWeight:700,color:mkt.color,marginBottom:"2px"}}>MERCADO: {mkt.mode}</div><div style={{fontSize:"10px",color:"#475569"}}>{mkt.advice}</div></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
        {groups.map(g=>(
          <Card key={g.type} glow={g.color} style={{padding:"16px"}}>
            <div style={{display:"flex",gap:"8px",marginBottom:"8px",alignItems:"center"}}><span style={{fontSize:"17px"}}>{g.icon}</span><div><div style={{fontSize:"12px",fontWeight:700,color:g.color}}>{g.type}</div><div style={{fontSize:"8px",color:"#2d3748",letterSpacing:"1px"}}>{g.ideal.toUpperCase()}</div></div></div>
            <p style={{fontSize:"10px",color:"#475569",lineHeight:1.6,marginBottom:"10px"}}>{g.desc}</p>
            {g.pools.map(p=>{
              const tokens2=extractTokens(p.symbol);
              const vt=tokens2.filter(t=>!isStable(t)&&VOLATILITY_COIN_MAP[t]);
              const pv=vt.length>0?(vt.map(t=>volData[VOLATILITY_COIN_MAP[t]]?.annualVol).filter(Boolean).reduce((a,b)=>a+b,0)/vt.length):null;
              const vl=getVolLabel(pv);
              return (
                <div key={p.pool} style={{display:"flex",justifyContent:"space-between",padding:"5px 7px",background:"rgba(0,0,0,0.22)",borderRadius:"5px",marginBottom:"3px"}}>
                  <div><div style={{fontSize:"10px",color:"#64748b",fontWeight:600}}>{p.symbol?.replace(/_/g,"/")}</div><div style={{fontSize:"8px",color:"#2d3748"}}>{p.project}</div></div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:"10px",color:g.color,fontFamily:"monospace",fontWeight:700}}>{fmt(p.apy)}%</div>
                    {pv&&<div style={{fontSize:"8px",color:vl.color}}>vol {pv.toFixed(0)}%</div>}
                  </div>
                </div>
              );
            })}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── CALC TAB ─────────────────────────────────────────────────────────────────
function CalcTab({prices}) {
  const [brl,setBrl]=useState("10000");
  const [alloc,setAlloc]=useState({btc:30,eth:20,sol:10,stable:25,caixa:15});
  const [capUsd,setCapUsd]=useState("5000");
  const [apy,setApy]=useState("35");
  const [meses,setMeses]=useState("12");
  const total=Object.values(alloc).reduce((a,b)=>a+b,0);
  const usd=Number(brl.replace(/\./g,"").replace(",","."))/6.0;
  const c=Number(capUsd.replace(",","."))||0,r=Number(apy)/100,m=Number(meses);
  const lucro=c*(Math.pow(1+r,m/12)-1);
  const items=[
    {key:"btc",label:"₿ Bitcoin",color:"#f59e0b",price:prices?.bitcoin?.usd,sym:"BTC"},
    {key:"eth",label:"Ξ Ethereum",color:"#6366f1",price:prices?.ethereum?.usd,sym:"ETH"},
    {key:"sol",label:"◎ Solana",color:"#a78bfa",price:prices?.solana?.usd,sym:"SOL"},
    {key:"stable",label:"$ Stablecoins",color:"#22c55e",price:1,sym:"USDC"},
    {key:"caixa",label:"🏦 Caixa BRL",color:"#64748b",price:null,sym:null},
  ];
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
      <Card>
        <SecTitle icon="🧮">Alocação de Capital</SecTitle>
        <div style={{marginBottom:"14px"}}>
          <div style={{fontSize:"9px",color:"#334155",letterSpacing:"1px",marginBottom:"4px",fontFamily:"monospace"}}>CAPITAL (R$)</div>
          <div style={{position:"relative"}}><span style={{position:"absolute",left:"11px",top:"50%",transform:"translateY(-50%)",color:"#22c55e",fontSize:"12px"}}>R$</span><input value={brl} onChange={e=>setBrl(e.target.value.replace(/[^0-9,.]/g,""))} style={{width:"100%",padding:"9px 11px 9px 34px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"8px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"14px"}}/></div>
          {total!==100&&<div style={{fontSize:"10px",color:"#ef4444",marginTop:"3px"}}>Total: {total}%</div>}
        </div>
        {items.map(({key,label,color,price,sym})=>{
          const usdAmt=usd*(alloc[key]/100), coins=price&&usdAmt?usdAmt/price:null;
          return (
            <div key={key} style={{marginBottom:"11px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}>
                <span style={{fontSize:"11px",color:"#64748b"}}>{label}</span>
                <div style={{display:"flex",gap:"7px",alignItems:"center"}}>
                  <span style={{fontSize:"10px",color:"#334155",fontFamily:"monospace"}}>{key==="caixa"?`R$ ${fmt(Number(brl.replace(/\./g,"").replace(",","."))*alloc[key]/100,0)}`:coins?`${fmt(coins,key==="btc"?6:4)} ${sym}`:`$${fmt(usdAmt)}`}</span>
                  <span style={{fontSize:"11px",color,fontWeight:700,minWidth:"34px",textAlign:"right",fontFamily:"monospace"}}>{alloc[key]}%</span>
                </div>
              </div>
              <input type="range" min={0} max={100} value={alloc[key]} onChange={e=>setAlloc(p=>({...p,[key]:Number(e.target.value)}))} style={{width:"100%",accentColor:color,height:"3px",cursor:"pointer"}}/>
            </div>
          );
        })}
      </Card>
      <Card>
        <SecTitle icon="📈">Projeção de Rendimento</SecTitle>
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {[{label:"Capital ($)",val:capUsd,set:setCapUsd},{label:"APY (%)",val:apy,set:setApy},{label:"Período (meses)",val:meses,set:setMeses}].map(({label,val,set})=>(
            <div key={label}>
              <div style={{fontSize:"9px",color:"#334155",letterSpacing:"1px",marginBottom:"3px",fontFamily:"monospace"}}>{label}</div>
              <input value={val} onChange={e=>set(e.target.value.replace(/[^0-9,.]/g,""))} style={{width:"100%",padding:"8px 11px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"7px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"14px"}}/>
            </div>
          ))}
          <div style={{padding:"14px",background:"rgba(34,197,94,0.05)",borderRadius:"9px",border:"1px solid rgba(34,197,94,0.1)"}}>
            <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"1px",marginBottom:"5px",fontFamily:"monospace"}}>LUCRO ESTIMADO</div>
            <div style={{fontSize:"28px",fontWeight:700,color:"#22c55e",fontFamily:"monospace"}}>+${fmt(lucro)}</div>
            <div style={{fontSize:"12px",color:"#475569",marginTop:"3px"}}>Total: ${fmt(c+lucro)} em {meses} meses</div>
            <div style={{fontSize:"9px",color:"#2d3748",marginTop:"6px"}}>⚠ APY varia. Não garantido.</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── PLAN TAB ─────────────────────────────────────────────────────────────────
function PlanTab() {
  const def=[
    {id:1,tarefa:"Definir alocação inicial (aba Calculadora)",prazo:"Esta semana",feito:false},
    {id:2,tarefa:"Filtrar pools seguras (score ≥ 65) na aba Pools",prazo:"2 dias",feito:false},
    {id:3,tarefa:"Verificar Volatility Score antes de entrar em pool volátil",prazo:"Antes de aportar",feito:false},
    {id:4,tarefa:"Usar LP Range Suggester para definir faixas",prazo:"Antes de aportar",feito:false},
    {id:5,tarefa:"Registrar posições na aba Portfolio",prazo:"Após aportar",feito:false},
    {id:6,tarefa:"Verificar Diversification Score (meta: ≥70)",prazo:"Semanal",feito:false},
    {id:7,tarefa:"Configurar carteira na rede Base ou Arbitrum",prazo:"Esta semana",feito:false},
    {id:8,tarefa:"Configurar DCA semanal de BTC",prazo:"Recorrente",feito:false},
  ];
  const [acoes,setAcoes]=useState(def);
  const [objetivo,setObjetivo]=useState("100 BTC");
  const feitas=acoes.filter(a=>a.feito).length;
  useEffect(()=>{(async()=>{try{const r=await window.storage?.get("meu-plano-v6");if(r){const d=JSON.parse(r.value);setAcoes(d.acoes||def);setObjetivo(d.objetivo||"100 BTC");}}catch{}})();},[]);
  const save=async()=>{try{await window.storage?.set("meu-plano-v6",JSON.stringify({acoes,objetivo}));}catch{}};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
      <Card style={{background:"linear-gradient(135deg,#0c1e3d,#070f1a)",border:"1px solid rgba(99,102,241,0.18)"}}>
        <SecTitle icon="🎯">Norte Aspiracional</SecTitle>
        <div style={{display:"flex",gap:"14px",alignItems:"center"}}>
          <input value={objetivo} onChange={e=>setObjetivo(e.target.value)} style={{fontSize:"24px",fontWeight:700,color:"#a5b4fc",background:"transparent",border:"none",fontFamily:"Georgia,serif",flex:1}}/>
          <button onClick={save} style={{padding:"7px 14px",borderRadius:"6px",background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.28)",color:"#a5b4fc",fontSize:"9px",cursor:"pointer",fontFamily:"monospace",letterSpacing:"1px"}}>SALVAR</button>
        </div>
      </Card>
      <Card>
        <SecTitle icon="✅" right={<div style={{display:"flex",alignItems:"center",gap:"8px"}}><div style={{width:"70px",height:"3px",borderRadius:"2px",background:"rgba(255,255,255,0.04)",overflow:"hidden"}}><div style={{height:"100%",width:`${(feitas/acoes.length)*100}%`,background:"linear-gradient(90deg,#6366f1,#22c55e)",transition:"width 0.4s"}}/></div><span style={{fontSize:"9px",color:"#334155",fontFamily:"monospace"}}>{feitas}/{acoes.length}</span></div>}>Plano de Ação</SecTitle>
        {acoes.map(a=>(
          <div key={a.id} onClick={()=>setAcoes(p=>p.map(x=>x.id===a.id?{...x,feito:!x.feito}:x))} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px",borderRadius:"7px",cursor:"pointer",marginBottom:"6px",background:a.feito?"rgba(34,197,94,0.04)":"rgba(0,0,0,0.16)",border:`1px solid ${a.feito?"rgba(34,197,94,0.13)":"rgba(255,255,255,0.04)"}`,opacity:a.feito?0.55:1,transition:"all 0.2s"}}>
            <div style={{width:"16px",height:"16px",borderRadius:"50%",flexShrink:0,border:`2px solid ${a.feito?"#22c55e":"#1e293b"}`,background:a.feito?"#22c55e":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>{a.feito&&<span style={{color:"#000",fontSize:"9px",fontWeight:700}}>✓</span>}</div>
            <input value={a.tarefa} onChange={e=>setAcoes(p=>p.map(x=>x.id===a.id?{...x,tarefa:e.target.value}:x))} onClick={e=>e.stopPropagation()} style={{flex:1,background:"transparent",border:"none",color:a.feito?"#334155":"#94a3b8",fontSize:"12px",fontFamily:"Georgia,serif",textDecoration:a.feito?"line-through":"none"}}/>
            <span style={{fontSize:"9px",color:"#2d3748",fontFamily:"monospace",whiteSpace:"nowrap"}}>{a.prazo}</span>
          </div>
        ))}
        <button onClick={()=>setAcoes(p=>[...p,{id:Date.now(),tarefa:"Nova tarefa",prazo:"Esta semana",feito:false}])} style={{width:"100%",padding:"7px",borderRadius:"6px",background:"transparent",border:"1px dashed rgba(99,102,241,0.15)",color:"#2d3748",fontSize:"10px",cursor:"pointer"}}>+ adicionar</button>
      </Card>
    </div>
  );
}

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
  const [dataStatus,   setDataStatus]   = useState({defillama:"loading",coingecko:"loading",uniswap:"loading",fdv:"loading",vol:"loading"});
  const [selectedPool, setSelectedPool] = useState(null);
  const [advisorPool,  setAdvisorPool]  = useState(null);
  const [riskFilter,   setRiskFilter]   = useState("medium");
  const [chainFilter,  setChainFilter]  = useState("all");
  const [pairFilter,   setPairFilter]   = useState("all");
  const [sortBy,       setSortBy]       = useState("score");
  const [search,       setSearch]       = useState("");

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
      }catch{}
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
      }catch{}
    }
    setVolData(result);
    setVolLoading(false);
    setDataStatus(s=>({...s,vol:Object.keys(result).length>0?"ok":"error"}));
  },[]);

  useEffect(()=>{ fetchPrices(); fetchPools(); fetchUniswap(); fetchFdv(); fetchVolatility(); },[]);
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
      return {...enriched,_score:calcScore(enriched)};
    }).sort((a,b)=>b._score-a._score);
  },[rawPools,uniswapMap,fdvMap]);

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

        {tab==="portfolio"  && <PortfolioTab  pools={allPools} prices={prices} volData={volData}/>}
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