import { useEffect, useState } from "react";
import { VOLATILITY_COIN_MAP } from "../constants";
import { calcChainConcentration, calcDiversificationScore, calcPortfolioScore, calcRiskConcentration, extractTokens, fmt, getPair, getRisk, getStrategy, getVolLabel, isStable } from "../utils";
import { Badge, Card, SecTitle } from "../components/primitives";
import { readPersisted, writePersisted } from "../persist";
import { PoolAnalysisPanel } from "../components/PoolAnalysisPanel";

// ─── 11. PORTFOLIO TAB ────────────────────────────────────────────────────────
export function PortfolioTab({
  pools, volData, walletPools = [], walletLoading = false,
  onFetchWalletPools, onFetchWalletPoolTx, onFetchWalletAssets, onSuggestRebuild,
  fetchExternal, prices,           // ★ NEW
}) {
  const STORAGE_KEY = "portfolio-positions-v3";
  const [positions, setPositions] = useState([]);
  const [showAdd,   setShowAdd]   = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [newPos,    setNewPos]    = useState({
    symbol:"", protocol:"", chain:"Ethereum",
    valueUSD:"", entryPrice:"", entryDate: new Date().toISOString().slice(0,10),
    // ── new fields ──
    tokenContract:"", quantity:"", avgCostUSD:"", notes:""
  });
  const [poolSearch,setPoolSearch]= useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [txHash, setTxHash] = useState("0x4353b87721b13688efde117ccbdbe5b2dbcf42bcd369af4bff1a511b35275711");
  const [rebuildAdvice, setRebuildAdvice] = useState(null);
  const [selectedWalletPool, setSelectedWalletPool] = useState(null);
  const [analysisPool, setAnalysisPool] = useState(null);

  const importWalletAssets = async () => {
    const imported = await onFetchWalletAssets?.(walletAddress);
    if (!imported?.length) return;
    const importedPositions = imported.map(asset => ({
      id: `wallet-${asset.chain}-${asset.symbol}`,
      symbol: asset.symbol,
      protocol: asset.protocol,
      chain: asset.chain,
      valueUSD: Number(asset.valueUSD || 0),
      entryPrice: Number(asset.priceUsd || 0),
      entryDate: new Date().toISOString().slice(0,10),
      amount: asset.amount,
      source: asset.source,
      _score: asset._score || asset.matchedPool?._score || 50,
      _liqScore: asset._liqScore || asset.matchedPool?._liqScore || 0,
      apy: asset.apy || asset.matchedPool?.apy || 0,
      tokenContract:"", quantity:"", avgCostUSD:"", notes:""
    }));
    const manualPositions = positions.filter(p => !String(p.id).startsWith("wallet-"));
    const updated = [...manualPositions, ...importedPositions];
    setPositions(updated);
    save(updated);
  };

  useEffect(()=>{
    (async()=>{
      try{
        const raw = await readPersisted(STORAGE_KEY);
        if(raw){ setPositions(JSON.parse(raw)||[]); }
        else {
          // migrate from v2
          const oldRaw = await readPersisted("portfolio-positions-v2");
          if(oldRaw){
            const old = JSON.parse(oldRaw)||[];
            const migrated = old.map(p=>({...p, tokenContract:"", quantity:"", avgCostUSD:"", notes:""}));
            setPositions(migrated);
          }
        }
      }catch{/* noop */}
    })();
  },[]);

  const save = async(pos) => {
    const ok = await writePersisted(STORAGE_KEY, JSON.stringify(pos));
    if(ok){ setSaved(true); setTimeout(()=>setSaved(false),2000); }
  };

  const addPosition = () => {
    if(!newPos.symbol||!newPos.valueUSD) return;
    const matchPool = pools.find(p=>p.symbol?.toLowerCase().replace(/_/g,"/").includes(newPos.symbol.toLowerCase())||newPos.symbol.toLowerCase().includes(p.project?.toLowerCase()));
    const enriched = {
      id: Date.now(), ...newPos,
      valueUSD: Number(newPos.valueUSD),
      entryPrice: Number(newPos.entryPrice)||0,
      quantity: Number(newPos.quantity)||0,
      avgCostUSD: Number(newPos.avgCostUSD)||0,
      _score: matchPool?._score||50,
      _liqScore: matchPool?._liqScore||0,
      apy: matchPool?.apy||0,
    };
    const updated = [...positions, enriched];
    setPositions(updated);
    save(updated);
    setNewPos({symbol:"",protocol:"",chain:"Ethereum",valueUSD:"",entryPrice:"",entryDate:new Date().toISOString().slice(0,10),tokenContract:"",quantity:"",avgCostUSD:"",notes:""});
    setShowAdd(false);
  };

  const removePosition = (id) => {
    const updated = positions.filter(p=>p.id!==id);
    setPositions(updated);
    save(updated);
  };

  const updatePosition = (id, field, value) => {
    const updated = positions.map(p => p.id===id ? {...p, [field]: value} : p);
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

  // total invested cost (sum of avgCostUSD * quantity or valueUSD as fallback)
  const totalCost = positions.reduce((a,p)=> {
    if(p.avgCostUSD && p.quantity) return a + p.avgCostUSD * p.quantity;
    if(p.entryPrice && p.quantity) return a + p.entryPrice * p.quantity;
    return a + (p.valueUSD||0);
  }, 0);
  const totalPnL = totalValue - totalCost;
  const pnlPct   = totalCost > 0 ? (totalPnL / totalCost)*100 : 0;

  const filteredPools = pools.filter(p=>poolSearch?p.symbol?.toLowerCase().includes(poolSearch.toLowerCase())||p.project?.toLowerCase().includes(poolSearch.toLowerCase()):true).slice(0,6);

  const divColor = divScore>=70?"#22c55e":divScore>=40?"#f59e0b":"#ef4444";
  const selectedRisk = selectedWalletPool ? getRisk(selectedWalletPool._score || selectedWalletPool.matchedPool?._score || 0) : null;
  const selectedPair = selectedWalletPool ? getPair(selectedWalletPool.symbol) : null;
  const selectedStrategy = selectedWalletPool ? getStrategy(selectedWalletPool.matchedPool || selectedWalletPool) : null;

  const inputStyle = {padding:"6px 8px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"6px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"11px",width:"100%"};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
      <Card>
        <SecTitle icon="🧷" sub="Busque por carteira ou pela tx da Base da sua posição Uniswap v4">Carteira on-chain</SecTitle>
        <div style={{display:"flex",gap:"8px",marginBottom:"10px"}}>
          <input
            value={walletAddress}
            onChange={e=>setWalletAddress(e.target.value.trim())}
            placeholder="0x..."
            style={{flex:1,padding:"8px 10px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"7px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"11px"}}
          />
          <button disabled={walletLoading} onClick={()=>onFetchWalletPools?.(walletAddress)} style={{padding:"8px 12px",borderRadius:"7px",fontSize:"10px",background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.3)",color:"#a5b4fc",cursor:walletLoading?"not-allowed":"pointer",opacity:walletLoading?0.6:1,fontFamily:"monospace"}}>Buscar pools ativas</button>
          <button disabled={walletLoading} onClick={importWalletAssets} style={{padding:"8px 12px",borderRadius:"7px",fontSize:"10px",background:"rgba(14,165,233,0.12)",border:"1px solid rgba(14,165,233,0.3)",color:"#7dd3fc",cursor:walletLoading?"not-allowed":"pointer",opacity:walletLoading?0.6:1,fontFamily:"monospace"}}>Importar ativos</button>
        </div>
        <div style={{display:"flex",gap:"8px",marginBottom:"10px"}}>
          <input
            value={txHash}
            onChange={e=>setTxHash(e.target.value.trim())}
            placeholder="0x... tx da Base"
            style={{flex:1,padding:"8px 10px",background:"rgba(0,0,0,0.3)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"7px",color:"#f1f5f9",fontFamily:"monospace",fontSize:"11px"}}
          />
          <button disabled={walletLoading} onClick={()=>onFetchWalletPoolTx?.(txHash)} style={{padding:"8px 12px",borderRadius:"7px",fontSize:"10px",background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.3)",color:"#86efac",cursor:walletLoading?"not-allowed":"pointer",opacity:walletLoading?0.6:1,fontFamily:"monospace"}}>Buscar pela tx</button>
        </div>

        {/* Wallet pools results */}
        {walletPools.length>0&&(
          <div style={{marginTop:"4px"}}>
            <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"6px"}}>POSIÇÕES ENCONTRADAS ON-CHAIN</div>
            {walletPools.map((wp)=>{
              const risk2 = selectedRisk && selectedWalletPool?.id===wp.id ? selectedRisk : getRisk(wp._score||wp.matchedPool?._score||0);
              return (
                <div key={wp.id} onClick={()=>setSelectedWalletPool(v=>v?.id===wp.id?null:wp)} style={{padding:"8px 12px",background:selectedWalletPool?.id===wp.id?"rgba(99,102,241,0.08)":"rgba(0,0,0,0.2)",borderRadius:"7px",marginBottom:"5px",cursor:"pointer",border:`1px solid ${selectedWalletPool?.id===wp.id?"rgba(99,102,241,0.22)":"rgba(255,255,255,0.04)"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div><div style={{fontSize:"11px",fontWeight:600,color:"#94a3b8"}}>{wp.symbol}</div><div style={{fontSize:"9px",color:"#2d3748"}}>{wp.chain} · {wp.source}</div></div>
                    <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                      {wp.feeTier&&<Badge color="#6366f1" sm>{wp.feeTier/10000}% fee</Badge>}
                      {wp.matchedPool&&<Badge color={risk2.color} sm>Score {wp.matchedPool._score||"?"}</Badge>}
                    </div>
                  </div>
                </div>
              );
            })}
            {selectedWalletPool && (() => {
              const transfers = selectedWalletPool.transfers || [];
              
              // ETH pode vir como valor nativo da tx (positionValueEth) OU como transfer WETH
              const ethTransfer = transfers.find(t => ["ETH","WETH"].includes(t.symbol));
              const usdcTransfer = transfers.find(t => ["USDC","USDT","DAI"].includes(t.symbol));
              
              // positionValueEth é o ETH nativo enviado na tx (tx.value)
              const ethAmt = ethTransfer
                ? parseFloat(ethTransfer.formattedAmount)
                : selectedWalletPool.positionValueEth
                  ? parseFloat(selectedWalletPool.positionValueEth)
                  : null;
              const usdcAmt = usdcTransfer ? parseFloat(usdcTransfer.formattedAmount) : null;

              const ethPrice = prices?.ethereum?.usd || 0;

              // entryPrice = USDC / ETH  OU  preço atual como fallback
              const derivedEntryPrice = (ethAmt && usdcAmt && ethAmt > 0)
                ? usdcAmt / ethAmt
                : ethPrice || null;

              // valueUSD = ETH × preço + USDC  OU  positionValueEth × preço como fallback
              const derivedValueUSD = (() => {
                if (ethAmt && ethPrice) {
                  return ethAmt * ethPrice + (usdcAmt || 0);
                }
                if (selectedWalletPool.positionValueEth) {
                  return parseFloat(selectedWalletPool.positionValueEth) * ethPrice;
                }
                return selectedWalletPool.valueUSD || 0;
              })();

              return (
                <div style={{ marginTop: "10px" }}>
                  <PoolAnalysisPanel
                    key={selectedWalletPool.id}
                    pool={{
                      ...selectedWalletPool,
                      entryPrice: derivedEntryPrice,
                      _entryPrice: derivedEntryPrice,
                      valueUSD: derivedValueUSD,
                      feeTier: selectedWalletPool.feeTier || 3000,
                      rangeMin: null,
                      rangeMax: null,
                    }}
                    volData={volData}
                    prices={prices}
                    fetchExternal={fetchExternal}
                    onClose={() => setSelectedWalletPool(null)}
                  />
                </div>
              );
            })()}
          </div>
        )}
      </Card>

      {/* ── Portfolio Analytics ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px"}}>
        {[
          {label:"Portfólio Total",value:`$${fmt(totalValue,0)}`,color:"#3b82f6",sub:`${positions.length} posições`},
          {label:"Score Médio",value:portScore,color:portRisk.color,sub:portRisk.label,icon:portRisk.icon},
          {label:"Diversificação",value:`${divScore}%`,color:divColor,sub:divScore>=70?"Boa":"Concentrado"},
          {label:"APY Ponderado",value:`${fmt(weightedAPY,1)}%`,color:"#22c55e",sub:"estimado"},
        ].map(m=>(
          <div key={m.label} style={{padding:"12px",background:"rgba(0,0,0,0.2)",borderRadius:"9px",border:"1px solid rgba(255,255,255,0.04)"}}>
            <div style={{fontSize:"8px",color:"#2d3748",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"5px"}}>{m.label.toUpperCase()}</div>
            <div style={{fontSize:"20px",fontWeight:700,color:m.color,fontFamily:"monospace"}}>{m.icon?`${m.icon} `:""}{m.value}</div>
            <div style={{fontSize:"9px",color:"#334155",marginTop:"2px"}}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* ── PnL Summary ── */}
      {positions.some(p=>p.avgCostUSD||p.entryPrice)&&(
        <div style={{padding:"12px 16px",background:totalPnL>=0?"rgba(34,197,94,0.06)":"rgba(239,68,68,0.06)",border:`1px solid ${totalPnL>=0?"rgba(34,197,94,0.15)":"rgba(239,68,68,0.15)"}`,borderRadius:"9px",display:"flex",gap:"24px",alignItems:"center"}}>
          <div>
            <div style={{fontSize:"8px",color:"#334155",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"3px"}}>CUSTO TOTAL INVESTIDO</div>
            <div style={{fontSize:"16px",fontWeight:700,color:"#94a3b8",fontFamily:"monospace"}}>${fmt(totalCost,0)}</div>
          </div>
          <div>
            <div style={{fontSize:"8px",color:"#334155",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"3px"}}>P&L ESTIMADO</div>
            <div style={{fontSize:"20px",fontWeight:700,color:totalPnL>=0?"#22c55e":"#ef4444",fontFamily:"monospace"}}>{totalPnL>=0?"+":`-`}${fmt(Math.abs(totalPnL),0)}</div>
          </div>
          <div>
            <div style={{fontSize:"8px",color:"#334155",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"3px"}}>RETORNO</div>
            <div style={{fontSize:"20px",fontWeight:700,color:totalPnL>=0?"#22c55e":"#ef4444",fontFamily:"monospace"}}>{pnlPct>=0?"+":""}{fmt(pnlPct,1)}%</div>
          </div>
          <div style={{fontSize:"9px",color:"#2d3748",lineHeight:1.6,marginLeft:"auto",maxWidth:"180px"}}>⚠ P&L aproximado. Baseado nos custos médios e valor atual informado. Não inclui fees recebidos.</div>
        </div>
      )}

      {/* ── Risk concentration ── */}
      {positions.length>0&&(
        <Card style={{padding:"12px 16px"}}>
          <div style={{fontSize:"9px",color:"#2d3748",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"8px"}}>CONCENTRAÇÃO DE RISCO</div>
          <div style={{display:"flex",height:"8px",borderRadius:"4px",overflow:"hidden",gap:"2px",marginBottom:"6px"}}>
            {[{k:"low",c:"#22c55e"},{k:"medium",c:"#f59e0b"},{k:"high",c:"#f97316"},{k:"extreme",c:"#ef4444"}].map(({k,c})=>(
              riskConc[k]>0&&<div key={k} style={{height:"100%",width:`${riskConc[k]}%`,background:c,transition:"width 0.4s"}}/>
            ))}
          </div>
          <div style={{display:"flex",gap:"12px",flexWrap:"wrap"}}>
            {[{k:"low",label:"Baixo",c:"#22c55e"},{k:"medium",label:"Médio",c:"#f59e0b"},{k:"high",label:"Alto",c:"#f97316"},{k:"extreme",label:"Extremo",c:"#ef4444"}].map(({k,label,c})=>(
              <span key={k} style={{fontSize:"9px",color:c,fontFamily:"monospace"}}>{label}: {riskConc[k].toFixed(0)}%</span>
            ))}
          </div>
        </Card>
      )}

      {/* ── Positions ── */}
      <Card>
        <SecTitle icon="📋" right={
          <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
            {saved&&<span style={{fontSize:"9px",color:"#22c55e",fontFamily:"monospace"}}>✓ SALVO</span>}
            <button onClick={()=>setShowAdd(v=>!v)} style={{padding:"5px 12px",borderRadius:"6px",fontSize:"9px",background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.28)",color:"#a5b4fc",cursor:"pointer",fontFamily:"monospace",letterSpacing:"1px"}}>+ POSIÇÃO</button>
          </div>
        }>Minhas Posições</SecTitle>

        {/* Add form */}
        {showAdd&&(
          <div style={{padding:"16px",background:"rgba(99,102,241,0.05)",border:"1px solid rgba(99,102,241,0.18)",borderRadius:"10px",marginBottom:"14px"}}>
            <div style={{fontSize:"9px",color:"#3d4f63",letterSpacing:"2px",fontFamily:"monospace",marginBottom:"12px"}}>NOVA POSIÇÃO</div>

            {/* Pool search */}
            <div style={{marginBottom:"10px"}}>
              <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>BUSCAR POOL (opcional)</div>
              <input value={poolSearch} onChange={e=>setPoolSearch(e.target.value)} placeholder="Ex: USDC/ETH, uniswap..." style={{...inputStyle,marginBottom:"5px"}}/>
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

            {/* Row 1: symbol / protocol / chain */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"8px"}}>
              {[
                {label:"PAR / SÍMBOLO",   key:"symbol",   placeholder:"USDC/ETH"},
                {label:"PROTOCOLO",        key:"protocol", placeholder:"uniswap-v3"},
                {label:"REDE",             key:"chain",    placeholder:"Ethereum"},
              ].map(f=>(
                <div key={f.key}>
                  <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>{f.label}</div>
                  <input value={newPos[f.key]} onChange={e=>setNewPos(n=>({...n,[f.key]:e.target.value}))} placeholder={f.placeholder} style={inputStyle}/>
                </div>
              ))}
            </div>

            {/* Row 2: value / entry price / date */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"8px"}}>
              {[
                {label:"VALOR ATUAL (USD)", key:"valueUSD",   placeholder:"1000"},
                {label:"PREÇO ENTRADA ($)", key:"entryPrice", placeholder:"2000"},
                {label:"DATA ENTRADA",       key:"entryDate",  placeholder:"2025-01-01"},
              ].map(f=>(
                <div key={f.key}>
                  <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>{f.label}</div>
                  <input value={newPos[f.key]} onChange={e=>setNewPos(n=>({...n,[f.key]:e.target.value}))} placeholder={f.placeholder} style={inputStyle}/>
                </div>
              ))}
            </div>

            {/* Row 3: token contract / quantity / avg cost */}
            <div style={{borderTop:"1px solid rgba(255,255,255,0.05)",paddingTop:"10px",marginBottom:"8px"}}>
              <div style={{fontSize:"8px",color:"#6366f1",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"8px"}}>📄 DETALHES DO TOKEN (opcional)</div>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:"8px",marginBottom:"8px"}}>
                <div>
                  <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>CONTRATO DO TOKEN</div>
                  <input value={newPos.tokenContract} onChange={e=>setNewPos(n=>({...n,tokenContract:e.target.value.trim()}))} placeholder="0x... (endereço do contrato)" style={inputStyle}/>
                </div>
                <div>
                  <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>QUANTIDADE</div>
                  <input value={newPos.quantity} onChange={e=>setNewPos(n=>({...n,quantity:e.target.value.replace(/[^0-9.]/g,"")}))} placeholder="Ex: 1500.5" style={inputStyle}/>
                </div>
                <div>
                  <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>CUSTO MÉDIO ($)</div>
                  <input value={newPos.avgCostUSD} onChange={e=>setNewPos(n=>({...n,avgCostUSD:e.target.value.replace(/[^0-9.]/g,"")}))} placeholder="$ por token" style={inputStyle}/>
                </div>
              </div>
              <div>
                <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>NOTAS</div>
                <input value={newPos.notes} onChange={e=>setNewPos(n=>({...n,notes:e.target.value}))} placeholder="Observações, estratégia, lembrete..." style={inputStyle}/>
              </div>
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
            {/* Header */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 80px 70px 70px 60px 60px 28px",gap:"8px",padding:"0 8px 8px",borderBottom:"1px solid rgba(255,255,255,0.04)",fontSize:"8px",color:"#1e2d3d",letterSpacing:"1px",fontFamily:"monospace"}}>
              <span>POSIÇÃO</span><span style={{textAlign:"right"}}>VALOR</span><span style={{textAlign:"right"}}>APY</span><span style={{textAlign:"right"}}>CUSTO MÉD.</span><span style={{textAlign:"center"}}>SCORE</span><span style={{textAlign:"center"}}>RISCO</span><span></span>
            </div>

            {positions.map(pos=>{
              const risk2=getRisk(pos._score);
              const tokens2=extractTokens(pos.symbol);
              const volToks=tokens2.filter(t=>!isStable(t)&&VOLATILITY_COIN_MAP[t]);
              const posVol=volToks.length>0?(volToks.map(t=>volData[VOLATILITY_COIN_MAP[t]]?.annualVol).filter(Boolean).reduce((a,b)=>a+b,0)/volToks.length):null;
              const vl=getVolLabel(posVol);
              const costBasis = pos.avgCostUSD ? Number(pos.avgCostUSD) : (pos.entryPrice||0);
              const currentPerToken = pos.quantity>0 ? (pos.valueUSD||0) / pos.quantity : 0;
              const positionPnLPct = costBasis>0&&currentPerToken>0 ? ((currentPerToken-costBasis)/costBasis)*100 : null;
              const isExpanded = expandedId===pos.id;
              return (
                <div key={pos.id} style={{marginBottom:"4px"}}>
                  {/* Main row */}
                  <div
                    onClick={()=>setExpandedId(v=>v===pos.id?null:pos.id)}
                    style={{display:"grid",gridTemplateColumns:"1fr 80px 70px 70px 60px 60px 28px",gap:"8px",padding:"8px",borderRadius:isExpanded?"7px 7px 0 0":"7px",background:"rgba(0,0,0,0.15)",alignItems:"center",fontSize:"11px",cursor:"pointer",border:`1px solid ${isExpanded?"rgba(99,102,241,0.2)":"transparent"}`,borderBottom:isExpanded?"none":"1px solid transparent"}}>
                    <div>
                      <div style={{fontWeight:600,color:"#94a3b8",marginBottom:"1px",display:"flex",alignItems:"center",gap:"5px"}}>
                        {pos.symbol}
                        {pos.tokenContract&&<span title={pos.tokenContract} style={{fontSize:"8px",color:"#6366f1",background:"rgba(99,102,241,0.1)",padding:"1px 4px",borderRadius:"3px",fontFamily:"monospace",cursor:"help"}}>📄</span>}
                        {pos.notes&&<span title={pos.notes} style={{fontSize:"8px",color:"#f59e0b",background:"rgba(245,158,11,0.1)",padding:"1px 4px",borderRadius:"3px",cursor:"help"}}>📝</span>}
                      </div>
                      <div style={{fontSize:"9px",color:"#2d3748"}}>
                        {pos.protocol} · {pos.chain}
                        {posVol?<span style={{color:vl.color}}> · vol {posVol.toFixed(0)}%</span>:""}
                        {pos.quantity>0&&<span style={{color:"#475569"}}> · {fmt(pos.quantity,2)} tkn</span>}
                      </div>
                    </div>
                    <div style={{textAlign:"right",fontFamily:"monospace",color:"#3b82f6",fontWeight:700}}>${fmt(pos.valueUSD,0)}</div>
                    <div style={{textAlign:"right",fontFamily:"monospace",color:"#22c55e"}}>{pos.apy>0?`${fmt(pos.apy,1)}%`:"—"}</div>
                    <div style={{textAlign:"right",fontSize:"10px",fontFamily:"monospace"}}>
                      {costBasis>0?(
                        <div>
                          <div style={{color:"#64748b"}}>${fmt(costBasis,2)}</div>
                          {positionPnLPct!=null&&<div style={{fontSize:"8px",color:positionPnLPct>=0?"#22c55e":"#ef4444"}}>{positionPnLPct>=0?"+":""}{fmt(positionPnLPct,1)}%</div>}
                        </div>
                      ):<span style={{color:"#334155"}}>—</span>}
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{display:"inline-block",padding:"1px 6px",borderRadius:"20px",background:risk2.bg,color:risk2.color,fontSize:"10px",fontWeight:800,fontFamily:"monospace"}}>{pos._score}</div>
                    </div>
                    <div style={{textAlign:"center",fontSize:"9px",color:risk2.color,fontWeight:600}}>{risk2.icon}</div>
                    <button onClick={e=>{e.stopPropagation();removePosition(pos.id);}} style={{background:"none",border:"none",color:"#1e2d3d",cursor:"pointer",fontSize:"12px",padding:"2px"}}>✕</button>
                    <button
                      onClick={e => { e.stopPropagation(); setAnalysisPool(pos); setExpandedId(null); }}
                      style={{
                        background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
                        color: "#a5b4fc", cursor: "pointer", fontSize: "9px", padding: "2px 6px",
                        borderRadius: "5px", fontFamily: "monospace", whiteSpace: "nowrap",
                      }}
                      title="Abrir análise completa"
                    >
                      🔍
                  </button>
                  </div>

                  {/* Expanded detail panel */}
                  {isExpanded&&(
                    <div style={{padding:"12px 14px",background:"rgba(0,0,0,0.22)",border:"1px solid rgba(99,102,241,0.2)",borderTop:"none",borderRadius:"0 0 7px 7px"}}>
                      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:"8px",marginBottom:"8px"}}>
                        <div>
                          <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>CONTRATO DO TOKEN</div>
                          <input
                            value={pos.tokenContract||""}
                            onChange={e=>updatePosition(pos.id,"tokenContract",e.target.value.trim())}
                            placeholder="0x..."
                            style={{...inputStyle,fontSize:"10px"}}
                          />
                          {pos.tokenContract&&(
                            <a
                              href={`https://basescan.org/token/${pos.tokenContract}`}
                              target="_blank" rel="noopener noreferrer"
                              style={{fontSize:"8px",color:"#6366f1",marginTop:"3px",display:"block"}}
                            >🔗 Ver no Explorer →</a>
                          )}
                        </div>
                        <div>
                          <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>QUANTIDADE</div>
                          <input
                            value={pos.quantity||""}
                            onChange={e=>updatePosition(pos.id,"quantity",e.target.value.replace(/[^0-9.]/g,""))}
                            placeholder="0"
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>CUSTO MÉDIO ($)</div>
                          <input
                            value={pos.avgCostUSD||""}
                            onChange={e=>updatePosition(pos.id,"avgCostUSD",e.target.value.replace(/[^0-9.]/g,""))}
                            placeholder="$ por token"
                            style={inputStyle}
                          />
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"8px"}}>
                        <div>
                          <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>VALOR ATUAL (USD)</div>
                          <input
                            value={pos.valueUSD||""}
                            onChange={e=>updatePosition(pos.id,"valueUSD",Number(e.target.value.replace(/[^0-9.]/g,"")))}
                            placeholder="0"
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>PREÇO DE ENTRADA ($)</div>
                          <input
                            value={pos.entryPrice||""}
                            onChange={e=>updatePosition(pos.id,"entryPrice",Number(e.target.value.replace(/[^0-9.]/g,"")))}
                            placeholder="0"
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>DATA ENTRADA</div>
                          <input
                            value={pos.entryDate||""}
                            onChange={e=>updatePosition(pos.id,"entryDate",e.target.value)}
                            style={inputStyle}
                          />
                        </div>
                      </div>
                      <div>
                        <div style={{fontSize:"8px",color:"#334155",marginBottom:"3px",fontFamily:"monospace"}}>NOTAS</div>
                        <input
                          value={pos.notes||""}
                          onChange={e=>updatePosition(pos.id,"notes",e.target.value)}
                          placeholder="Estratégia, lembrete, observação..."
                          style={inputStyle}
                        />
                      </div>
                      {/* quick P&L detail */}
                      {pos.quantity>0&&costBasis>0&&(
                        <div style={{marginTop:"10px",padding:"8px 12px",background:"rgba(0,0,0,0.2)",borderRadius:"7px",display:"flex",gap:"20px",fontSize:"10px"}}>
                          <div><div style={{fontSize:"8px",color:"#2d3748",fontFamily:"monospace"}}>CUSTO TOTAL</div><div style={{color:"#94a3b8",fontFamily:"monospace",fontWeight:600}}>${fmt(costBasis*(pos.quantity||0),2)}</div></div>
                          <div><div style={{fontSize:"8px",color:"#2d3748",fontFamily:"monospace"}}>VALOR ATUAL</div><div style={{color:"#3b82f6",fontFamily:"monospace",fontWeight:600}}>${fmt(pos.valueUSD,2)}</div></div>
                          {positionPnLPct!=null&&(
                            <div><div style={{fontSize:"8px",color:"#2d3748",fontFamily:"monospace"}}>P&L</div><div style={{color:positionPnLPct>=0?"#22c55e":"#ef4444",fontFamily:"monospace",fontWeight:700}}>{positionPnLPct>=0?"+":""}{fmt(positionPnLPct,2)}%</div></div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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

            {/* Chain concentration */}
            {Object.keys(chainConc).length>1&&(
              <div style={{marginTop:"8px",padding:"10px",background:"rgba(0,0,0,0.1)",borderRadius:"7px"}}>
                <div style={{fontSize:"8px",color:"#1e2d3d",letterSpacing:"1px",fontFamily:"monospace",marginBottom:"5px"}}>REDE</div>
                <div style={{display:"flex",gap:"10px",flexWrap:"wrap"}}>
                  {Object.entries(chainConc).sort((a,b)=>b[1]-a[1]).map(([chain,pct])=>(
                    <span key={chain} style={{fontSize:"9px",color:"#475569",fontFamily:"monospace"}}>{chain}: <span style={{color:"#94a3b8",fontWeight:600}}>{pct.toFixed(0)}%</span></span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>


      {analysisPool && (
  <div style={{ marginTop: "4px" }}>
    <PoolAnalysisPanel
      pool={{
        // pass saved position fields through
        ...analysisPool,
        matchedPool: pools.find(p =>
          p.symbol?.toLowerCase().replace(/_/g,"/").includes(analysisPool.symbol?.toLowerCase()) ||
          analysisPool.symbol?.toLowerCase().includes(p.project?.toLowerCase())
        ) || null,
      }}
      volData={volData}
      prices={prices}
      fetchExternal={fetchExternal}
      onClose={() => setAnalysisPool(null)}
    />
  </div>
)}
    </div>
  );
}