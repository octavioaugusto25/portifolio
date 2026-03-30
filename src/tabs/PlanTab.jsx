import { useEffect, useState } from "react";
import { Card, SecTitle } from "../components/primitives";
import { readPersisted, writePersisted } from "../persist";

// ─── PLAN TAB ─────────────────────────────────────────────────────────────────
export function PlanTab() {
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
  useEffect(()=>{(async()=>{try{const raw=await readPersisted("meu-plano-v6");if(raw){const d=JSON.parse(raw);setAcoes(d.acoes||def);setObjetivo(d.objetivo||"100 BTC");}}catch{/* noop */}})();},[]);
  const save=async()=>{await writePersisted("meu-plano-v6",JSON.stringify({acoes,objetivo}));};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
      <Card style={{background:"linear-gradient(135deg,#0c1e3d,#070f1a)",border:"1px solid rgba(99,102,241,0.18)"}}>
        <SecTitle icon="🎯">Norte Aspiracional</SecTitle>
        <div style={{display:"flex",gap:"14px",alignItems:"center"}}>
          <input value={objetivo} onChange={e=>setObjetivo(e.target.value)} style={{fontSize:"24px",fontWeight:700,color:"#a5b4fc",background:"transparent",border:"none",fontFamily:"Inter, Segoe UI, Roboto, sans-serif",flex:1}}/>
          <button onClick={save} style={{padding:"7px 14px",borderRadius:"6px",background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.28)",color:"#a5b4fc",fontSize:"9px",cursor:"pointer",fontFamily:"monospace",letterSpacing:"1px"}}>SALVAR</button>
        </div>
      </Card>
      <Card>
        <SecTitle icon="✅" right={<div style={{display:"flex",alignItems:"center",gap:"8px"}}><div style={{width:"70px",height:"3px",borderRadius:"2px",background:"rgba(255,255,255,0.04)",overflow:"hidden"}}><div style={{height:"100%",width:`${(feitas/acoes.length)*100}%`,background:"linear-gradient(90deg,#6366f1,#22c55e)",transition:"width 0.4s"}}/></div><span style={{fontSize:"9px",color:"#334155",fontFamily:"monospace"}}>{feitas}/{acoes.length}</span></div>}>Plano de Ação</SecTitle>
        {acoes.map(a=>(
          <div key={a.id} onClick={()=>setAcoes(p=>p.map(x=>x.id===a.id?{...x,feito:!x.feito}:x))} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px",borderRadius:"7px",cursor:"pointer",marginBottom:"6px",background:a.feito?"rgba(34,197,94,0.04)":"rgba(0,0,0,0.16)",border:`1px solid ${a.feito?"rgba(34,197,94,0.13)":"rgba(255,255,255,0.04)"}`,opacity:a.feito?0.55:1,transition:"all 0.2s"}}>
            <div style={{width:"16px",height:"16px",borderRadius:"50%",flexShrink:0,border:`2px solid ${a.feito?"#22c55e":"#1e293b"}`,background:a.feito?"#22c55e":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>{a.feito&&<span style={{color:"#000",fontSize:"9px",fontWeight:700}}>✓</span>}</div>
            <input value={a.tarefa} onChange={e=>setAcoes(p=>p.map(x=>x.id===a.id?{...x,tarefa:e.target.value}:x))} onClick={e=>e.stopPropagation()} style={{flex:1,background:"transparent",border:"none",color:a.feito?"#334155":"#94a3b8",fontSize:"12px",fontFamily:"Inter, Segoe UI, Roboto, sans-serif",textDecoration:a.feito?"line-through":"none"}}/>
            <span style={{fontSize:"9px",color:"#2d3748",fontFamily:"monospace",whiteSpace:"nowrap"}}>{a.prazo}</span>
          </div>
        ))}
        <button onClick={()=>setAcoes(p=>[...p,{id:Date.now(),tarefa:"Nova tarefa",prazo:"Esta semana",feito:false}])} style={{width:"100%",padding:"7px",borderRadius:"6px",background:"transparent",border:"1px dashed rgba(99,102,241,0.15)",color:"#2d3748",fontSize:"10px",cursor:"pointer"}}>+ adicionar</button>
      </Card>
    </div>
  );
}
