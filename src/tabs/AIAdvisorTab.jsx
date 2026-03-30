import { useEffect, useRef, useState } from "react";
import { fmt, fmtK, getLiqLabel, getMarketContext, getRisk } from "../utils";
import { Badge, Card, Spin } from "../components/primitives";

// ─── AI ADVISOR ───────────────────────────────────────────────────────────────
// fetchExternal: proxy wrapper do App.jsx — injeta a API key server-side.
// Sem isso, a chamada à Anthropic falha com 401 em produção.
export function AIAdvisorTab({ pools, prices, initialPool, fetchExternal }) {
  const [messages,   setMessages]   = useState([]);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [ctxPool,    setCtxPool]    = useState(initialPool || null);
  const [poolSearch, setPoolSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (!messages.length) setMessages([{
      role: "assistant",
      content: initialPool
        ? `Analisei o pool **${initialPool.symbol?.replace(/_/g, "/")}** (${initialPool.project} · ${initialPool.chain}) — Score ${initialPool._score}/100, APY ${initialPool.apy?.toFixed(1)}%. O que quer saber?`
        : "Olá! Sou seu advisor DeFi. Posso analisar pools, explicar riscos, sugerir estratégias e LP ranges. Selecione um pool ou faça uma pergunta!"
    }]);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const buildSystem = () => {
    const mkt = getMarketContext(prices);
    const top = pools.slice(0, 12).map(p =>
      `${p.symbol?.replace(/_/g, "/")} | ${p.project} | ${p.chain} | APY:${p.apy?.toFixed(1)}% | TVL:${fmtK(p.tvlUsd)} | Score:${p._score} | Liq:${getLiqLabel(p._liqScore || 0).label}`
    ).join("\n");
    const pCtx = ctxPool
      ? `\nPOOL EM ANÁLISE:\n- ${ctxPool.symbol?.replace(/_/g, "/")} (${ctxPool.project}, ${ctxPool.chain})\n- APY: ${ctxPool.apy?.toFixed(2)}% | TVL: ${fmtK(ctxPool.tvlUsd)} | Score: ${ctxPool._score}/100\n- ${ctxPool._auditEntry ? `Auditado: ${ctxPool._auditEntry.auditors.join(", ")} | Hacks: ${ctxPool._auditEntry.hacks}` : "Audit: desconhecido"}`
      : "";
    return `You are an expert DeFi advisor with deep knowledge of liquidity pools, yield farming, impermanent loss, smart contract risk, tokenomics, and LP range management.\n\nMARKET: ${mkt.mode} | BTC $${prices?.bitcoin?.usd?.toLocaleString() || "?"} (${prices?.bitcoin?.change24h?.toFixed(1) || 0}%) | ETH $${prices?.ethereum?.usd?.toLocaleString() || "?"} | SOL $${prices?.solana?.usd?.toLocaleString() || "?"}\n\nTOP POOLS:\n${top}${pCtx}\n\nRules:\n- Respond in Brazilian Portuguese (pt-BR)\n- Be direct, practical, data-driven\n- Reference specific numbers from context\n- Mention IL and volatility when relevant\n- Always note DYOR\n- Concise (3-6 sentences) unless asked for detail`;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMsgs = [...messages, { role: "user", content: text }];
    setMessages(newMsgs);
    setLoading(true);

    // ── Usa o proxy (fetchExternal) para injetar a API key server-side ──────
    // Se fetchExternal não foi passado (ex: teste local), cai no fetch direto
    const caller = fetchExternal || ((url, opts) => fetch(url, opts));

    try {
      const r = await caller("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildSystem(),
          messages: newMsgs.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const d = await r.json();
      const text_ = d.content?.find(b => b.type === "text")?.text;
      setMessages(p => [...p, {
        role: "assistant",
        content: text_ || (d.error ? `⚠ Erro API: ${d.error.message || d.error}` : "Sem resposta.")
      }]);
    } catch {
      setMessages(p => [...p, { role: "assistant", content: "⚠ Erro de conexão. Verifique o proxy e a API Key no Vercel." }]);
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = ctxPool ? [
    `Análise completa do ${ctxPool.symbol?.replace(/_/g, "/")}`,
    `Score ${ctxPool._score} justifica aportar?`,
    `Qual o risco de IL nesse pool?`,
    `APY ${ctxPool.apy?.toFixed(1)}% é sustentável?`,
    `Compare com alternativas mais seguras`,
  ] : [
    "Quais os pools mais seguros agora?",
    "Como interpretar o Volatility Score?",
    "O que é LP Range e como escolher?",
    "Diferença entre Stable Yield e High Yield Farming",
    "Como diversificar um portfólio DeFi?",
  ];

  const filtered = pools
    .filter(p => p.symbol?.toLowerCase().includes(poolSearch.toLowerCase()) || p.project?.toLowerCase().includes(poolSearch.toLowerCase()))
    .slice(0, 8);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "14px", height: "600px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <Card style={{ padding: "14px" }}>
          <div style={{ fontSize: "9px", color: "#2d3748", letterSpacing: "2px", fontFamily: "monospace", marginBottom: "8px" }}>CONTEXTO</div>
          {ctxPool ? (
            <div style={{ background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.18)", borderRadius: "8px", padding: "9px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#a5b4fc", marginBottom: "2px" }}>{ctxPool.symbol?.replace(/_/g, "/")}</div>
              <div style={{ fontSize: "9px", color: "#334155" }}>{ctxPool.project} · {ctxPool.chain}</div>
              <div style={{ display: "flex", gap: "4px", marginTop: "5px", flexWrap: "wrap" }}>
                <Badge color={getRisk(ctxPool._score).color} sm>Score {ctxPool._score}</Badge>
                <Badge color="#22c55e" sm>{fmt(ctxPool.apy)}%</Badge>
              </div>
              <button onClick={() => setCtxPool(null)} style={{ marginTop: "6px", fontSize: "9px", color: "#334155", background: "none", border: "none", cursor: "pointer", padding: 0 }}>✕ remover</button>
            </div>
          ) : (
            <div style={{ fontSize: "10px", color: "#334155", lineHeight: 1.6 }}>Análise geral.<br />Selecione um pool para contexto.</div>
          )}
          <button onClick={() => setShowSearch(!showSearch)} style={{ marginTop: "8px", width: "100%", padding: "5px", borderRadius: "6px", fontSize: "10px", background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.18)", color: "#7c85d4", cursor: "pointer" }}>
            🔍 Selecionar pool
          </button>
          {showSearch && (
            <div style={{ marginTop: "6px" }}>
              <input
                value={poolSearch}
                onChange={e => setPoolSearch(e.target.value)}
                placeholder="Buscar..."
                style={{ width: "100%", padding: "5px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "5px", color: "#f1f5f9", fontSize: "10px", fontFamily: "monospace", marginBottom: "4px" }}
              />
              <div style={{ maxHeight: "140px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
                {filtered.map(p => (
                  <div
                    key={p.pool}
                    onClick={() => { setCtxPool(p); setShowSearch(false); setPoolSearch(""); }}
                    style={{ padding: "5px 7px", borderRadius: "5px", cursor: "pointer", fontSize: "10px", background: "rgba(0,0,0,0.2)" }}
                  >
                    <div style={{ fontWeight: 600, color: "#94a3b8" }}>{p.symbol?.replace(/_/g, "/")}</div>
                    <div style={{ fontSize: "8px", color: "#334155" }}>{p.project} · Score {p._score}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card style={{ padding: "14px", flex: 1 }}>
          <div style={{ fontSize: "9px", color: "#2d3748", letterSpacing: "2px", fontFamily: "monospace", marginBottom: "8px" }}>PERGUNTAS RÁPIDAS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {quickPrompts.map((q, i) => (
              <button
                key={i}
                onClick={() => setInput(q)}
                style={{ padding: "7px 9px", borderRadius: "7px", fontSize: "10px", textAlign: "left", background: "rgba(0,0,0,0.18)", border: "1px solid rgba(255,255,255,0.04)", color: "#475569", cursor: "pointer", lineHeight: 1.4 }}
              >{q}</button>
            ))}
          </div>
        </Card>
      </div>

      <Card style={{ display: "flex", flexDirection: "column", padding: "0", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              {m.role === "assistant" && (
                <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", flexShrink: 0, marginTop: "2px" }}>🤖</div>
              )}
              <div style={{
                maxWidth: "78%", padding: "10px 13px",
                borderRadius: m.role === "user" ? "13px 13px 3px 13px" : "13px 13px 13px 3px",
                background: m.role === "user" ? "rgba(99,102,241,0.18)" : "rgba(0,0,0,0.28)",
                border: `1px solid ${m.role === "user" ? "rgba(99,102,241,0.28)" : "rgba(255,255,255,0.05)"}`,
                fontSize: "12px", color: "#cbd5e1", lineHeight: 1.7, whiteSpace: "pre-wrap"
              }}>
                {m.content.replace(/\*\*(.*?)\*\*/g, "$1")}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>🤖</div>
              <div style={{ padding: "10px 14px", borderRadius: "13px 13px 13px 3px", background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.05)", display: "flex", gap: "8px", alignItems: "center" }}>
                <Spin /><span style={{ fontSize: "11px", color: "#334155" }}>Analisando…</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div style={{ padding: "14px", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: "8px" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="Pergunte sobre pools, ranges, IL, estratégias…"
            style={{ flex: 1, padding: "9px 13px", background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "9px", color: "#f1f5f9", fontSize: "13px", fontFamily: "Inter, Segoe UI, Roboto, sans-serif" }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              padding: "9px 16px", borderRadius: "9px", fontSize: "10px",
              background: loading || !input.trim() ? "rgba(99,102,241,0.06)" : "rgba(99,102,241,0.2)",
              border: `1px solid ${loading || !input.trim() ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.35)"}`,
              color: loading || !input.trim() ? "#2d3748" : "#a5b4fc",
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              fontFamily: "monospace", letterSpacing: "1px"
            }}
          >SEND →</button>
        </div>
      </Card>
    </div>
  );
}