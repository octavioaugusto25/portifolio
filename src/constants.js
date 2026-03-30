// ─── APIS ─────────────────────────────────────────────────────────────────────
export const COINGECKO = "https://api.coingecko.com/api/v3";
export const DEFILLAMA_YIELDS = "https://yields.llama.fi/pools";
export const UNISWAP_SUBGRAPH = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";
export const UNISWAP_ALT = "https://api.thegraph.com/subgraphs/name/messari/uniswap-v3-ethereum";
export const CURVE_API = "https://api.curve.fi/api/getPools/ethereum/main";
export const BALANCER_API = "https://api-v3.balancer.fi/";
export const AAVE_API = "https://aave-api-v2.aave.com/data/pools";
export const COMPOUND_API = "https://api.compound.finance/api/v2/ctoken";
export const DUNE_API = "https://api.dune.com/api/v1";
export const CERTIK_API = "https://www.certik.com/";
export const DEFISAFETY_API = "https://www.defisafety.com/";
export const ETH_RPC = "https://eth.llamarpc.com";
export const UNISWAP_V3_NPM = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
export const TOKEN_SYMBOL_BY_ADDRESS = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
  "0x6b175474e89094c44da98b954eedeac495271d0f": "DAI",
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "WBTC",
};

// ─── PROTOCOL LISTS ───────────────────────────────────────────────────────────
export const SAFE_PROTOCOLS = [
  "uniswap-v3", "uniswap-v2", "curve", "aave-v3", "aave-v2", "compound",
  "balancer", "gmx", "trader-joe", "velodrome", "aerodrome", "camelot",
  "orca", "raydium", "jupiter", "pancakeswap", "sushiswap", "convex-finance",
  "lido", "rocket-pool", "pendle", "kamino", "meteora", "drift"
];
export const MEDIUM_PROTOCOLS = [
  "stargate", "gains-network", "exactly", "morpho", "euler", "spark",
  "frax", "synthetix", "lyra", "polynomial", "kwenta", "vertex",
  "hyperliquid", "marinade", "jito", "save", "mango"
];
export const CHAINS_OK = ["Ethereum", "Arbitrum", "Base", "Solana", "Optimism"];
export const STABLES = ["USDC", "USDT", "DAI", "FRAX", "LUSD", "crvUSD", "GHO", "PYUSD", "USDS", "FDUSD"];

// ─── AUDIT PROXY ──────────────────────────────────────────────────────────────
export const AUDIT_PROXY = {
  "uniswap": { score: 95, auditors: ["Trail of Bits", "ABDK"], hacks: 0, bounty: true },
  "curve": { score: 88, auditors: ["Trail of Bits", "Chainsecurity"], hacks: 1, bounty: true },
  "aave": { score: 93, auditors: ["OpenZeppelin", "Sigma Prime", "Peckshield"], hacks: 0, bounty: true },
  "compound": { score: 88, auditors: ["OpenZeppelin", "Trail of Bits"], hacks: 0, bounty: true },
  "balancer": { score: 84, auditors: ["Trail of Bits", "Certik"], hacks: 1, bounty: true },
  "gmx": { score: 78, auditors: ["ABDK", "Quantstamp"], hacks: 0, bounty: true },
  "lido": { score: 91, auditors: ["Sigma Prime", "Quantstamp", "Chainsecurity"], hacks: 0, bounty: true },
  "rocket-pool": { score: 88, auditors: ["Sigma Prime", "Trail of Bits"], hacks: 0, bounty: true },
  "pendle": { score: 76, auditors: ["Ackee Blockchain", "Certik"], hacks: 0, bounty: false },
  "convex-finance": { score: 80, auditors: ["Mixbytes", "Certik"], hacks: 0, bounty: false },
  "sushiswap": { score: 68, auditors: ["Quantstamp"], hacks: 1, bounty: true },
  "pancakeswap": { score: 70, auditors: ["Certik", "Peckshield"], hacks: 0, bounty: false },
  "velodrome": { score: 73, auditors: ["Spearbit"], hacks: 0, bounty: false },
  "aerodrome": { score: 71, auditors: ["Spearbit"], hacks: 0, bounty: false },
  "morpho": { score: 83, auditors: ["Trail of Bits", "Chainsecurity"], hacks: 0, bounty: true },
  "trader-joe": { score: 65, auditors: ["Certik"], hacks: 0, bounty: false },
  "orca": { score: 70, auditors: ["Kudelski Security"], hacks: 0, bounty: false },
  "raydium": { score: 63, auditors: ["Kudelski Security"], hacks: 1, bounty: false },
  "kamino": { score: 68, auditors: ["Sec3"], hacks: 0, bounty: false },
  "meteora": { score: 62, auditors: ["Sec3"], hacks: 0, bounty: false },
  "spark": { score: 78, auditors: ["Chainsecurity"], hacks: 0, bounty: false },
  "euler": { score: 48, auditors: ["Halborn", "Sherlock"], hacks: 1, bounty: false },
  "synthetix": { score: 75, auditors: ["Iosiro", "Trail of Bits"], hacks: 0, bounty: true },
  "frax": { score: 67, auditors: ["Trail of Bits"], hacks: 0, bounty: false },
  "stargate": { score: 65, auditors: ["Quantstamp"], hacks: 0, bounty: false },
  "camelot": { score: 66, auditors: ["Paladin", "Solidity Finance"], hacks: 0, bounty: false },
  "drift": { score: 67, auditors: ["Ottersec"], hacks: 0, bounty: false },
  "marinade": { score: 72, auditors: ["Neodyme"], hacks: 0, bounty: false },
  "jito": { score: 70, auditors: ["Neodyme", "Ottersec"], hacks: 0, bounty: false },
};

// ─── COINGECKO ID MAP ─────────────────────────────────────────────────────────
export const PROTOCOL_COIN_MAP = {
  "uniswap": "uniswap", "curve": "curve-dao-token", "aave": "aave",
  "compound": "compound-governance-token", "balancer": "balancer", "gmx": "gmx",
  "pendle": "pendle", "lido": "lido-dao", "synthetix": "havven", "frax": "frax-share",
  "sushiswap": "sushi", "pancakeswap": "pancakeswap-token", "rocket-pool": "rocket-pool",
  "convex-finance": "convex-finance", "morpho": "morpho", "velodrome": "velodrome-finance",
  "aerodrome": "aerodrome-finance",
};

// ─── VOLATILITY COIN MAP (CoinGecko IDs for price history) ───────────────────
export const VOLATILITY_COIN_MAP = {
  "ETH": "ethereum", "BTC": "bitcoin", "SOL": "solana", "BNB": "binancecoin",
  "ARB": "arbitrum", "OP": "optimism", "AVAX": "avalanche-2", "MATIC": "matic-network",
  "UNI": "uniswap", "AAVE": "aave", "CRV": "curve-dao-token", "GMX": "gmx",
  "PENDLE": "pendle", "LINK": "chainlink", "LDO": "lido-dao",
};
