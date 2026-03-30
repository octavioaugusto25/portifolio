import { AUDIT_PROXY, PROTOCOL_COIN_MAP } from "../constants";
import { fmtK, getFdvRating, getLiqLabel } from "../utils";
import { Badge, Card, SecTitle, Spin, StatusDot } from "../components/primitives";

// ─── LIQUIDITY TAB ────────────────────────────────────────────────────────────
export function LiquidezTab({pools, fdvData, dataStatus}) {
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
          {[
            {label:"DeFiLlama",key:"defillama",note:"TVL, APY, Vol 7d"},
            {label:"CoinGecko Prices",key:"coingecko",note:"BTC, ETH, SOL"},
            {label:"CoinGecko FDV",key:"fdv",note:"FDV e Market Cap"},
            {label:"Uniswap Subgraph",key:"uniswap",note:"TxCount, Volume"},
            {label:"Curve API",key:"curve",note:"Pools e liquidez"},
            {label:"Balancer API",key:"balancer",note:"Pools e metrics"},
            {label:"Aave API",key:"aave",note:"Lending pools"},
            {label:"Compound API",key:"compound",note:"Mercados de lending"},
            {label:"Dune API",key:"dune",note:"Analytics avançado"},
            {label:"CertiK",key:"certik",note:"Auditoria / segurança"},
            {label:"DeFiSafety",key:"defisafety",note:"Risk ratings"},
          ].map(s=>(
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

