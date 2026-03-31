/**
 * api/proxy.js  —  Vercel Serverless Function
 *
 * Fica em:  <raiz do projeto>/api/proxy.js
 * (NÃO dentro de src/)
 *
 * O que faz:
 *   - Repassa requisições do frontend para APIs externas (CORS bypass)
 *   - Injeta chaves de IA automaticamente quando o destino é Anthropic ou Groq
 *   - Allowlist de domínios: só deixa passar o que está na lista
 *   - Não tenta parsear JSON — manda a resposta crua de volta (evita os 500)
 *
 * Como configurar no Vercel:
 *   1. Vá em Project → Settings → Environment Variables
 *   2. Adicione:  GROQ_API_KEY = gsk_...
 *   3. Faça redeploy
 */

// ─── DOMAIN ALLOWLIST ─────────────────────────────────────────────────────────
const ALLOWED_DOMAINS = [
  // Prices & pools
  "api.coingecko.com",
  "yields.llama.fi",
  "coins.llama.fi",       // ← DeFiLlama Coins API (resolve ANZ, USDz, etc.)
  "api.llama.fi",
  // Subgraphs
  "api.thegraph.com",
  // EVM RPCs — Base
  "base.llamarpc.com",
  "mainnet.base.org",
  "base-mainnet.g.alchemy.com",
  // EVM RPCs — Ethereum
  "eth.llamarpc.com",
  "cloudflare-eth.com",
  // EVM RPCs — Arbitrum
  "arbitrum.llamarpc.com",
  "arb1.arbitrum.io",
  // EVM RPCs — Polygon
  "polygon.llamarpc.com",
  "polygon-rpc.com",
  "rpc-mainnet.matic.network",
  // AI
  "api.anthropic.com",
  "api.groq.com",
  // DeFi protocol APIs (optional, for future tabs)
  "api.curve.fi",
  "api-v3.balancer.fi",
];

// ─── CORS headers returned to the browser ─────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key,anthropic-version",
};

export default async function handler(req, res) {
  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  // Only POST (all calls go through POST)
  if (req.method !== "POST") {
    res.writeHead(405, CORS);
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  const { url, method = "GET", headers: extraHeaders = {}, body = null } = req.body || {};

  if (!url) {
    res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing url" }));
  }

  // ── Domain check ────────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Invalid URL" }));
  }

  const isAllowed = ALLOWED_DOMAINS.some(
    (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
  );
  if (!isAllowed) {
    res.writeHead(403, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: `Domain not allowed: ${parsed.hostname}` }));
  }

  // ── Build outgoing headers ────────────────────────────────────────────────
  const outHeaders = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  // Inject Anthropic key from env — never expose it to the frontend
  if (parsed.hostname === "api.anthropic.com") {
    const key = process.env.ANTHROPIC_API_KEY || "";
    if (!key) {
      res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured in Vercel env vars" }));
    }
    outHeaders["x-api-key"]           = key;
    outHeaders["anthropic-version"]   = "2023-06-01";
    // Remove any key the frontend might have tried to send
    delete outHeaders["Authorization"];
  }

  // Inject Groq key from env — OpenAI-compatible API
  if (parsed.hostname === "api.groq.com") {
    const key = process.env.GROQ_API_KEY || "";
    if (!key) {
      res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "GROQ_API_KEY not configured in Vercel env vars" }));
    }
    outHeaders["Authorization"] = `Bearer ${key}`;
  }

  // ── Forward request ───────────────────────────────────────────────────────
  const fetchOptions = { method, headers: outHeaders };

  if (body !== null && method !== "GET" && method !== "HEAD") {
    fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  try {
    const upstream = await fetch(url, fetchOptions);

    // Read as text — never try to parse JSON here (avoids 500 on RPC binary/text responses)
    const text = await upstream.text();

    const ct = upstream.headers.get("content-type") || "application/json";
    res.writeHead(upstream.status, {
      ...CORS,
      "Content-Type": ct,
    });
    res.end(text);

  } catch (err) {
    res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Upstream fetch failed", detail: err.message }));
  }
}
