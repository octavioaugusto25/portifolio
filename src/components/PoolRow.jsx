import { VOLATILITY_COIN_MAP } from "../constants";
import { extractTokens, fmt, fmtK, getPair, getRisk, getStrategy, getVolLabel, isStable } from "../utils";

// ─── POOL ROW ─────────────────────────────────────────────────────────────────
export const PoolRow = ({pool,i,onSelect,selected,volData})=>{
  const risk  = getRisk(pool._score);
  const pair  = getPair(pool.symbol);
  const strat = getStrategy(pool);
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
