// ─── PRIMITIVES ───────────────────────────────────────────────────────────────
export const Card     = ({children,style={},glow,onClick})=>(
  <div onClick={onClick} style={{background:"#0b1520",border:`1px solid ${glow?`${glow}25`:"rgba(255,255,255,0.06)"}`,borderRadius:"14px",padding:"18px",boxShadow:glow?`0 0 30px ${glow}06`:"none",cursor:onClick?"pointer":undefined,...style}}>{children}</div>
);
export const Spin     = ({size=14})=>(
  <div style={{width:`${size}px`,height:`${size}px`,border:"2px solid rgba(255,255,255,0.07)",borderTop:"2px solid #6366f1",borderRadius:"50%",animation:"spin 0.8s linear infinite",display:"inline-block"}}/>
);
export const Chg      = ({val})=>!val?null:(
  <span style={{fontSize:"11px",color:val>=0?"#22c55e":"#ef4444",fontFamily:"monospace"}}>{val>=0?"▲":"▼"} {Math.abs(val).toFixed(2)}%</span>
);
export const Badge    = ({children,color="#3b82f6",sm})=>(
  <span style={{padding:sm?"1px 6px":"3px 9px",borderRadius:"20px",fontSize:sm?"9px":"10px",fontWeight:700,background:`${color}15`,color,border:`1px solid ${color}28`,whiteSpace:"nowrap"}}>{children}</span>
);
export const SecTitle = ({icon,children,right,sub})=>(
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
export const StatusDot= ({status})=>{
  const c=status==="ok"?"#22c55e":status==="loading"?"#f59e0b":status==="error"?"#ef4444":"#475569";
  return <div style={{width:"7px",height:"7px",borderRadius:"50%",background:c,flexShrink:0,animation:status==="loading"?"pulse 1.2s ease infinite":"none"}}/>;
};

