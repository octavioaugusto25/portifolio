import { useEffect, useState } from "react";
import { fmt } from "../utils";
import { Card, SecTitle } from "../components/primitives";

// ─── CALC TAB ─────────────────────────────────────────────────────────────────
export function CalcTab({prices, market}) {
  const [brl,setBrl]=useState("10000");
  const [alloc,setAlloc]=useState({btc:30,eth:20,sol:10,stable:25,caixa:10,learn:5});
  const [capUsd,setCapUsd]=useState("5000");
  const [apy,setApy]=useState("35");
  const [meses,setMeses]=useState("12");
  const [autoSync,setAutoSync]=useState(true);
  const [lastSync,setLastSync]=useState(null);
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
    {key:"learn",label:"📚 Aprender",color:"#e879f9",price:null,sym:null},
  ];
  const mode = market?.mode || "LATERAL";
  const cycleTarget = mode.includes("BULL")
    ? { btc:40, alt:40, passive:10, cash:5, learn:5 }
    : mode.includes("BEAR")
      ? { btc:60, alt:5, passive:10, cash:25, learn:0 }
      : { btc:50, alt:20, passive:15, cash:15, learn:0 };
  const currentCycle = {
    btc: alloc.btc,
    alt: alloc.eth + alloc.sol,
    passive: alloc.stable,
    cash: alloc.caixa,
    learn: alloc.learn,
  };
  const applyCycleTarget = () => {
    const altHalf = cycleTarget.alt / 2;
    setAlloc({
      btc: cycleTarget.btc,
      eth: altHalf,
      sol: altHalf,
      stable: cycleTarget.passive,
      caixa: cycleTarget.cash,
      learn: cycleTarget.learn,
    });
    setLastSync(new Date());
  };
  useEffect(()=>{
    if(autoSync) applyCycleTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[mode, autoSync]);
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
      <Card>
        <SecTitle icon="🧭" sub={`Ciclo do BTC: ${mode}`}>Alocação por ciclo BTC</SecTitle>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"12px"}}>
          {Object.entries(cycleTarget).map(([k,v])=>(
            <div key={k} style={{padding:"7px",background:"rgba(0,0,0,0.2)",borderRadius:"7px",fontSize:"10px",display:"flex",justifyContent:"space-between"}}>
              <span style={{color:"#64748b"}}>{k.toUpperCase()}</span>
              <span style={{color:"#a5b4fc",fontFamily:"monospace"}}>{currentCycle[k].toFixed(1)}% / alvo {v}%</span>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:"8px",marginBottom:"12px"}}>
          <button onClick={applyCycleTarget} style={{flex:1,padding:"7px 10px",borderRadius:"7px",border:"1px solid rgba(99,102,241,0.3)",background:"rgba(99,102,241,0.12)",color:"#a5b4fc",fontSize:"10px",cursor:"pointer"}}>Sincronizar agora</button>
          <button onClick={()=>setAutoSync(v=>!v)} style={{padding:"7px 10px",borderRadius:"7px",border:"1px solid rgba(34,197,94,0.3)",background:autoSync?"rgba(34,197,94,0.14)":"rgba(0,0,0,0.2)",color:autoSync?"#22c55e":"#94a3b8",fontSize:"10px",cursor:"pointer"}}>{autoSync?"Auto Sync ON":"Auto Sync OFF"}</button>
        </div>
        <div style={{fontSize:"9px",color:"#64748b",marginBottom:"12px"}}>Última sincronização: {lastSync?lastSync.toLocaleTimeString("pt-BR"):"—"}</div>
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
