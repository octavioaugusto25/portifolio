import { useState } from "react";
import { VOLATILITY_COIN_MAP } from "../constants";
import { calcIL, fmt, getVolLabel, suggestLPRange } from "../utils";
import { Badge, Card, SecTitle, Spin } from "../components/primitives";

// ─── 7. VOLATILITY TAB ────────────────────────────────────────────────────────
export function VolatilityTab({volData, volLoading, prices}) {
  const [ilRatio,     setIlRatio]     = useState(2);
  const [selectedTok, setSelectedTok] = useState("ETH");
  const [sigma,       setSigma]       = useState(1.5);
  const [horizonDays, setHorizonDays] = useState(30);
  const [customPrice, setCustomPrice] = useState("");

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
              Fórmula usada: <span style={{fontFamily:"monospace",color:"#94a3b8"}}>IL = 2√r/(1+r) - 1</span>, onde <span style={{fontFamily:"monospace"}}>r</span> é o multiplicador de preço.<br/>
              IL permanece latente enquanto você está no pool. Só se materializa ao retirar. Stable/stable pools têm IL≈0.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
