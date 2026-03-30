import { VOLATILITY_COIN_MAP } from "../constants";
import { extractTokens, fmt, getMarketContext, getVolLabel, isPairSS, isPairSV, isStable } from "../utils";
import { Card } from "../components/primitives";

// ─── STRATEGIES TAB ───────────────────────────────────────────────────────────
export function StrategiesTab({pools, prices, volData}) {
  const mkt = getMarketContext(prices);
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
