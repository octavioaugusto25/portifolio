import { useEffect, useState } from "react";
import { VOLATILITY_COIN_MAP } from "../constants";
import { calcChainConcentration, calcDiversificationScore, calcPortfolioScore, calcRiskConcentration, extractTokens, fmt, getRisk, getVolLabel, isStable } from "../utils";
import { Card, SecTitle } from "../components/primitives";

// ─── 11. PORTFOLIO TAB ────────────────────────────────────────────────────────
export function PortfolioTab({pools, volData, walletPools = [], walletLoading = false, onFetchWalletPools, onSuggestRebuild}) {
  const STORAGE_KEY = "portfolio-positions-v2";
  const [positions, setPositions] = useState([]);
  const [showAdd,   setShowAdd]   = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [newPos,    setNewPos]    = useState({symbol:"",protocol:"",chain:"Ethereum",valueUSD:"",entryPrice:"",entryDate:new Date().toISOString().slice(0,10)});
  const [poolSearch,setPoolSearch]= useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [rebuildAdvice, setRebuildAdvice] = useState(null);

  useEffect(()=>{
    (async()=>{ try{ const r=await window.storage?.get(STORAGE_KEY); if(r){setPositions(JSON.parse(r.value)||[]);} }catch{/* noop */} })();
  },[]);

  const save = async(pos) => {
    try{ await window.storage?.set(STORAGE_KEY, JSON.stringify(pos)); setSaved(true); setTimeout(()=>setSaved(false),2000); }catch{/* noop */}
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
      <Card>
        <SecTitle icon="🧷" sub="Cole seu endereço para buscar posições LP ativas (Uniswap v3)">Carteira on-chain</SecTitle>
        <div style={{display:"flex",gap:"8px",marginBottom:"10px"}}>
          <input
            value={walletAddress}
            onChange={e=>setWalletAddress(e.target.value.trim())}
            placeholder="0x..."
            style={{flex:1,padding:"8px 10px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"7px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"11px"}}
          />
          <button onClick={()=>onFetchWalletPools?.(walletAddress)} style={{padding:"8px 12px",borderRadius:"7px",fontSize:"10px",background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.3)",color:"#a5b4fc",cursor:"pointer",fontFamily:"monospace"}}>Buscar pools ativas</button>
        </div>
        {walletLoading&&<div style={{fontSize:"10px",color:"#475569"}}>Buscando posições on-chain...</div>}
        {!walletLoading && walletPools.length>0 && (
          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
            {walletPools.map(wp=>(
              <div key={wp.id} style={{padding:"8px",borderRadius:"7px",background:"rgba(0,0,0,0.2)",display:"flex",justifyContent:"space-between",gap:"10px",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:"11px",fontWeight:700,color:"#94a3b8"}}>{wp.symbol} <span style={{fontSize:"9px",color:"#334155"}}>fee {wp.feeTier}</span></div>
                  <div style={{fontSize:"9px",color:"#334155"}}>TVL ${fmt(wp.tvlUsd,0)} · Match local: {wp.matchedPool?`Score ${wp.matchedPool._score}`:"não encontrado"}</div>
                </div>
                <button onClick={()=>setRebuildAdvice(onSuggestRebuild?.(wp.matchedPool||null)||null)} style={{padding:"5px 9px",borderRadius:"6px",fontSize:"9px",background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.3)",color:"#22c55e",cursor:"pointer"}}>Estratégia remontar</button>
              </div>
            ))}
          </div>
        )}
        {!walletLoading && walletAddress && walletPools.length===0 && (
          <div style={{fontSize:"10px",color:"#475569"}}>Nenhuma posição ativa encontrada para esse endereço (ou endpoint indisponível).</div>
        )}
        {rebuildAdvice && (
          <div style={{marginTop:"10px",padding:"10px",background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:"8px"}}>
            <div style={{fontSize:"10px",fontWeight:700,color:"#a5b4fc",marginBottom:"3px"}}>{rebuildAdvice.title}</div>
            <div style={{fontSize:"10px",color:"#94a3b8",lineHeight:1.6}}>{rebuildAdvice.action}</div>
            <div style={{fontSize:"9px",color:"#64748b",marginTop:"4px"}}>Cadência sugerida: {rebuildAdvice.cadence}</div>
          </div>
        )}
      </Card>

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
