import { SAFE_PROTOCOLS, MEDIUM_PROTOCOLS, VOLATILITY_COIN_MAP } from "../constants";
import { extractTokens, fmt, fmtK, getFdvRating, getLiqLabel, getPair, getRisk, getStrategy, getVolLabel, isPairSS, isPairSV, isStable } from "../utils";
import { Badge } from "./primitives";

// ─── POOL MODAL (with Volatility) ─────────────────────────────────────────────
export const PoolModal = ({pool,onClose,onAdvise,volData})=>{
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
            {label:"FDV/REV", value:pool._fdvRevenueRatio?`${pool._fdvRevenueRatio.toFixed(1)}x`:"—",color:pool._fdvRevenueRatio&&pool._fdvRevenueRatio<20?"#22c55e":pool._fdvRevenueRatio&&pool._fdvRevenueRatio<80?"#f59e0b":"#ef4444"},
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
