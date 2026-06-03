#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const API_URL = (process.env.SWAPWIZARD_API_URL ?? "https://api.swapwizard.xyz").replace(/\/$/, "");

// ── API helpers (key injected per-call) ────────────────────────────────────

function makeApiGet(apiKey: string) {
  return async (path: string, params?: Record<string, string>): Promise<unknown> => {
    const url = new URL(`/api/v2.0${path}`, API_URL);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v) url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }
    return res.json();
  };
}

function makeApiPost(apiKey: string) {
  return async (path: string, body: unknown): Promise<unknown> => {
    const url = new URL(`/api/v2.0${path}`, API_URL);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text}`);
    }
    return res.json();
  };
}

// ── Positions library (shared, loaded once) ────────────────────────────────

let positionsLib: any = null;

async function loadPositionsLib(): Promise<any> {
  if (positionsLib) return positionsLib;
  const bundleUrl = `${API_URL}/lib/user-positions.mjs`;
  const res = await fetch(bundleUrl);
  if (!res.ok) throw new Error(`Failed to download positions library: ${res.status}`);
  const code = await res.text();
  const tmpPath = join(tmpdir(), `swapwizard-user-positions-${Date.now()}.mjs`);
  writeFileSync(tmpPath, code, "utf-8");
  positionsLib = await import(pathToFileURL(tmpPath).href);
  return positionsLib;
}

async function fetchPositionPools(chainId: number, apiKey: string): Promise<any[]> {
  const url = new URL("/position-pools", API_URL);
  url.searchParams.set("chainId", String(chainId));
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`position-pools ${res.status}: ${body}`);
  }
  const data = await res.json() as { pools: any[] };
  return data.pools;
}

function buildPositionConfig(chain: any, publicRpcs: Record<number, string[]>): any {
  const pc = chain.positionConfig;
  return {
    chainId: chain.chainId,
    rpcUrls: publicRpcs[chain.chainId] ?? [],
    weth: chain.weth,
    v3NftManagers: pc?.v3NftManagers?.map((m: any) => ({
      address: m.address,
      dexName: m.dexName,
      dexKind: m.dexKind,
      ...(m.factory ? { factory: m.factory } : {}),
    })) ?? [],
    ...(pc?.algebraNftManager ? { algebraNftManager: pc.algebraNftManager } : {}),
    ...(pc?.algebraFactory ? { algebraFactory: pc.algebraFactory } : {}),
    ...(pc?.algebraDexName ? { algebraDexName: pc.algebraDexName } : {}),
    ...(pc?.v4PositionManager ? { v4PositionManager: pc.v4PositionManager } : {}),
    ...(pc?.v4StateView ? { v4StateView: pc.v4StateView } : {}),
    ...(pc?.balancerV2Vault ? { balancerV2Vault: pc.balancerV2Vault } : {}),
    ...(pc?.pcsInfinityCLPositionManager ? { pcsInfinityCLPositionManager: pc.pcsInfinityCLPositionManager } : {}),
    ...(pc?.v4ClPoolManager ? { v4ClPoolManager: pc.v4ClPoolManager } : {}),
    ...(pc?.pcsInfinityBinPositionManager ? { pcsInfinityBinPositionManager: pc.pcsInfinityBinPositionManager } : {}),
    ...(pc?.pcsInfinityBinPoolManager ? { pcsInfinityBinPoolManager: pc.pcsInfinityBinPoolManager } : {}),
    ...(pc?.aerodromeSugar ? { aerodromeSugar: pc.aerodromeSugar } : {}),
    ...(pc?.thenaPairApi ? { thenaPairApi: pc.thenaPairApi } : {}),
  };
}

function extractProtocols(chain: any): string[] {
  const pc = chain.positionConfig;
  const protocols: string[] = [];
  if (pc?.v3NftManagers && Array.isArray(pc.v3NftManagers)) {
    for (const m of pc.v3NftManagers) {
      if (m.dexName) protocols.push(m.dexName);
    }
  }
  if (pc?.algebraNftManager && pc?.algebraDexName) {
    protocols.push(pc.algebraDexName);
  }
  if (pc?.v4PositionManager) protocols.push("uniswap-v4");
  if (pc?.balancerV2Vault) protocols.push("balancer-v2");
  if (pc?.pcsInfinityCLPositionManager) protocols.push("pancakeswap-infinity-cl");
  if (pc?.pcsInfinityBinPositionManager) protocols.push("pancakeswap-infinity-bin");
  if (pc?.v4ClPoolManager) protocols.push("pancakeswap-v4-cl");
  if (pc?.aerodromeSugar) protocols.push("aerodrome");
  if (pc?.thenaPairApi) protocols.push("thena");
  return protocols;
}

// ── Tool response helpers ─────────────────────────────────────────────────

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

async function safeApiCall(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return jsonResult(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
      isError: true as const,
    };
  }
}

// ── Server factory ─────────────────────────────────────────────────────────

const SERVER_META = {
  name: "swapwizard",
  version: "1.1.8",
  description: "Execution model: SwapWizard is non-custodial and returns signable transaction data — it never signs or broadcasts. Tools that return router, callData, and value (get_swap_quote, get_clean_quote, zap_into_lp_position, zap_out_of_lp_position) are completed by the caller as follows: (1) if the input token is not the chain's native token, the user must first approve the router address to spend the input token amount (a standard ERC-20 approve); (2) then submit a transaction with to: router, data: callData, value: value, signed and broadcast by the user's own wallet. The agent should present this transaction to the user for signing, not attempt to hold keys or sign on the user's behalf. The API key authenticates access to the quoting service only; it never controls user funds.",
  websiteUrl: "https://swapwizard.xyz",
};

function createServer(apiKey: string): McpServer {
  const apiGet = makeApiGet(apiKey);
  const apiPost = makeApiPost(apiKey);

  let chainsCache: any[] | null = null;
  let chainsCacheTime = 0;

  async function getChainsConfig(): Promise<any[]> {
    const now = Date.now();
    if (chainsCache && now - chainsCacheTime < 300_000) return chainsCache;
    const data = await apiGet("/chains") as any[];
    chainsCache = data;
    chainsCacheTime = now;
    return data;
  }

  const server = new McpServer(SERVER_META);

  server.tool(
    "get_supported_chains",
    `Maps to GET /chains. Lists supported EVM chains with chain IDs and native gas tokens: Ethereum, Arbitrum, Base, Polygon, BNB Chain.`,
    {},
    async () => safeApiCall(() => apiGet("/chains")),
  );

  server.tool(
    "check_api_health",
    `Maps to GET /health. Returns service availability. Use to confirm the API is responsive before attempting operations.`,
    {},
    async () => safeApiCall(() => apiGet("/health")),
  );

  server.tool(
    "get_supported_dexes",
    `Returns the AMMs / DEX sources SwapWizard routes across per chain. Use to check routing coverage before quoting.`,
    {
      chainId: z.number().int().optional().describe("EVM chain ID to filter results. If omitted, returns protocols for all supported chains."),
    },
    async ({ chainId }) => safeApiCall(async () => {
      const chains = await getChainsConfig();
      const filtered = chainId != null
        ? chains.filter((c: any) => c.chainId === chainId)
        : chains;

      if (chainId != null && filtered.length === 0) {
        throw new Error(`Chain ${chainId} not supported`);
      }

      const result = filtered.map((chain: any) => ({
        chainId: chain.chainId,
        chainName: chain.name ?? chain.chainName,
        protocols: extractProtocols(chain),
      }));

      return { chains: result };
    }),
  );

  server.tool(
    "search_liquidity_pools",
    `Maps to GET /pools. Discovers liquidity pools across supported AMMs and chains, returning poolId, symbol, fee tier, protocol, APY, TVL (USD), and 24h volume (USD). Required upstream step before zap_into_lp_position.`,
    {
      chainId: z.number().int().describe("EVM chain ID (e.g. 56 for BSC, 1 for Ethereum)"),
      tokens: z.string().optional().describe("Comma-separated token addresses to filter pools by"),
      poolType: z.enum(["classic", "concentrated"]).optional().describe("Filter by pool type"),
    },
    async ({ chainId, tokens, poolType }) => {
      const params: Record<string, string> = { chainId: String(chainId) };
      if (tokens) params.tokens = tokens;
      if (poolType) params.poolType = poolType;
      return safeApiCall(() => apiGet("/pools", params));
    },
  );

  server.tool(
    "list_user_lp_positions",
    `Client-side library call. Returns full details of every LP position a wallet holds across all supported protocols and chains: current value, unclaimed fees, in-range/out-of-range status, APR, share of in-range liquidity, impermanent-loss estimate. Each position includes positionId, nftManager, dexName, and liquidityKind — these are the exact fields required by zap_out_of_lp_position. IMPORTANT: Always call this BEFORE zap_out_of_lp_position to obtain nftManager, dexName, and liquidityKind for the target position.`,
    {
      chainId: z.number().int().describe("EVM chain ID"),
      owner: z.string().describe("Wallet address to query positions for"),
    },
    async ({ chainId, owner }) => safeApiCall(async () => {
      const [lib, chains, pools] = await Promise.all([
        loadPositionsLib(),
        getChainsConfig(),
        fetchPositionPools(chainId, apiKey),
      ]);
      const chain = chains.find((c: any) => c.chainId === chainId);
      if (!chain) throw new Error(`Chain ${chainId} not supported`);
      const config = buildPositionConfig(chain, lib.PUBLIC_RPCS);
      return lib.readAllPositions(owner, config, pools);
    }),
  );

  server.tool(
    "get_swap_quote",
    `Maps to POST /quote. Returns the best swap quote across all integrated DEX protocols, with router, callData, value, price impact, route summary, and gas estimate in one response. Surplus and positive slippage are returned to the user in the same transaction. Supports an excludePositions parameter that prices the swap excluding the caller's own LP position from pool state. Returns signable data only; never signs or broadcasts. To execute the returned quote, approve the router if the input token is non-native, then send a transaction with to: router, data: callData, value: value from the user's wallet (see server execution model).`,
    {
      chainId: z.number().int().describe("EVM chain ID (e.g. 56 for BSC)"),
      tokenIn: z.string().describe("Input token address (0x0000...0000 for native coin)"),
      tokenOut: z.string().describe("Output token address"),
      side: z.enum(["exactIn", "exactOut"]).describe("Quote direction"),
      amount: z.string().describe("Amount as stringified uint256 in token decimals"),
      slippageBps: z.number().int().min(0).max(10000).optional().describe("Slippage tolerance in basis points (default: 100 = 1%)"),
      affiliateCode: z.string().optional().describe("Registered affiliate wallet address"),
      excludePositions: z.array(z.object({
        poolAddress: z.string().describe("Pool contract address"),
        liquidity: z.string().describe("Position liquidity as uint256 string"),
        tickLower: z.number().int().describe("Lower tick bound"),
        tickUpper: z.number().int().describe("Upper tick bound"),
      })).optional().describe("Positions to subtract from pool state during simulation — for a clean quote that excludes self-impact. Get these from list_user_lp_positions."),
    },
    async (params) => safeApiCall(() => apiPost("/quote", params)),
  );

  server.tool(
    "get_clean_quote",
    `Maps to POST /quote with excludePositions=true. Shortcut to get_swap_quote that prices the swap as if the caller's own LP position were not in the pool, for concentrated-liquidity positions in the active tick range. Use when an agent holds a significant position in the pool it is about to trade against (rebalancing, exit, treasury sizing) and needs a quote unaffected by its own liquidity. Returns the same router/callData/value execution fields as get_swap_quote; execute the same way.`,
    {
      chainId: z.number().int().describe("EVM chain ID (e.g. 56 for BSC)"),
      owner: z.string().describe("Wallet address whose LP positions will be excluded from pool state during quoting"),
      tokenIn: z.string().describe("Input token address (0x0000...0000 for native coin)"),
      tokenOut: z.string().describe("Output token address"),
      side: z.enum(["exactIn", "exactOut"]).describe("Quote direction"),
      amount: z.string().describe("Amount as stringified uint256 in token decimals"),
      slippageBps: z.number().int().min(0).max(10000).optional().describe("Slippage tolerance in basis points (default: 100 = 1%)"),
      affiliateCode: z.string().optional().describe("Registered affiliate wallet address"),
    },
    async ({ chainId, owner, tokenIn, tokenOut, side, amount, slippageBps, affiliateCode }) => safeApiCall(async () => {
      const [lib, chains, pools] = await Promise.all([
        loadPositionsLib(),
        getChainsConfig(),
        fetchPositionPools(chainId, apiKey),
      ]);

      const chain = chains.find((c: any) => c.chainId === chainId);
      if (!chain) throw new Error(`Chain ${chainId} not supported`);
      const config = buildPositionConfig(chain, lib.PUBLIC_RPCS);
      const positions = await lib.readAllPositions(owner, config, pools);

      let excludePositions: Array<{
        poolAddress: string;
        liquidity: string;
        tickLower: number;
        tickUpper: number;
      }> | undefined;

      if (Array.isArray(positions) && positions.length > 0) {
        const mapped = positions
          .filter((p: any) =>
            p.poolAddress && p.liquidity &&
            p.tickLower !== undefined && p.tickUpper !== undefined
          )
          .map((p: any) => ({
            poolAddress: p.poolAddress,
            liquidity: String(p.liquidity),
            tickLower: Number(p.tickLower),
            tickUpper: Number(p.tickUpper),
          }));
        if (mapped.length > 0) excludePositions = mapped;
      }

      const quoteParams: Record<string, unknown> = {
        chainId, tokenIn, tokenOut, side, amount,
      };
      if (slippageBps !== undefined) quoteParams.slippageBps = slippageBps;
      if (affiliateCode) quoteParams.affiliateCode = affiliateCode;
      if (excludePositions) quoteParams.excludePositions = excludePositions;

      return apiPost("/quote", quoteParams);
    }),
  );

  server.tool(
    "zap_into_lp_position",
    `Maps to POST /addliquidity/quote. Builds a single-transaction zap to enter an LP position from any input token: handles intermediate swaps, the LP mint, and price-range setup for concentrated liquidity. Supports Uniswap V3/V4, Curve, Balancer, Aerodrome. Surplus returned to the user. Requires a poolId from search_liquidity_pools. Returns router, callData, value: to execute, approve the router if the input token is non-native, then send to: router, data: callData, value: value from the user's wallet (see server execution model).`,
    {
      chainId: z.number().int().describe("EVM chain ID"),
      poolId: z.string().describe("Pool identifier from search_liquidity_pools (e.g. 'pancakeswap-v3:0x36696...')"),
      deposits: z.array(z.object({
        token: z.string().describe("Token address (0x0000...0000 for native)"),
        amount: z.string().describe("Amount as stringified uint256 in token decimals"),
      })).min(1).describe("Tokens and amounts to deposit"),
      sender: z.string().optional().describe("Wallet address of the sender (for simulation)"),
      tickLower: z.number().int().optional().describe("Custom lower tick for concentrated liquidity"),
      tickUpper: z.number().int().optional().describe("Custom upper tick for concentrated liquidity"),
      affiliateCode: z.string().optional().describe("Registered affiliate wallet address"),
    },
    async (params) => safeApiCall(() => apiPost("/addliquidity/quote", params)),
  );

  server.tool(
    "zap_out_of_lp_position",
    `Maps to POST /removeliquidity/quote. Builds a single-transaction zap to exit an LP position into any output token: handles LP burn, intermediate swaps, and fee collection. Surplus returned to the user. WORKFLOW: Before calling this tool, ALWAYS call list_user_lp_positions first to read the position — it returns nftManager, dexName, and liquidityKind which you MUST pass here. Also pass sender (wallet address) and poolId (from search_liquidity_pools). Without nftManager the call WILL fail for concentrated-liquidity positions (Uniswap V3/V4, PancakeSwap V3, SushiSwap V3, Algebra, etc.). Returns router, callData, value: execute by sending to: router, data: callData, value: value from the user's wallet (see server execution model).`,
    {
      chainId: z.number().int().describe("EVM chain ID"),
      positionId: z.string().optional().describe("NFT token ID (for concentrated liquidity) or LP token address (for classic pools). Alias: tokenId."),
      tokenId: z.string().optional().describe("Alias for positionId — accepts the tokenId field returned by list_user_lp_positions."),
      poolId: z.string().optional().describe("Pool identifier from search_liquidity_pools (e.g. 'pancakeswap-v3:0x36696...'). ALWAYS pass this — it is the same poolId used during zap_into_lp_position and enables auto-detection of dexName and nftManager."),
      nftManager: z.string().optional().describe("NFT position manager contract address. Auto-detected from poolId or sender — only pass if you have it from list_user_lp_positions and did not pass poolId."),
      dexName: z.string().optional().describe("DEX project name (e.g. 'pancakeswap-v3', 'uniswap-v3'). Auto-detected from poolId — only pass if poolId is not available."),
      liquidityKind: z.string().optional().describe("Liquidity kind override: UNIV3, UNIV4, ALGEBRA, SLIPSTREAM, PCS_INF_CL, PCS_INF_BIN, CURVE, BAL_V2, BAL_V3, UNIV2, SOLIDLY. Auto-detected — only pass to override."),
      withdrawals: z.array(z.object({
        token: z.string().describe("Token address to withdraw to"),
      })).min(1).describe("Tokens to receive after removal"),
      sender: z.string().optional().describe("Wallet address of the position owner. ALWAYS pass this — it is required for auto-detection of nftManager, dexName, and liquidityKind from on-chain data."),
      percent: z.number().int().min(1).max(100).optional().describe("Percentage of position to remove (default: 100)"),
      affiliateCode: z.string().optional().describe("Registered affiliate wallet address"),
    },
    async ({ chainId, positionId, tokenId, poolId, nftManager, dexName, liquidityKind, withdrawals, sender, percent, affiliateCode }) => safeApiCall(async () => {
      const resolvedPositionId = positionId ?? tokenId;
      if (!resolvedPositionId && !poolId) throw new Error("positionId (or tokenId) is required — or provide poolId for classic pools");
      // Extract dexName from poolId prefix (e.g. "uni-gql-v3-56-0x..." → "uniswap-v3")
      if (!dexName && poolId) {
        const POOL_PREFIX_TO_PROJECT: Record<string, string> = {
          "uni-gql-v3": "uniswap-v3",
          "uni-gql-v4": "uniswap-v4",
          "uni-gql-v2": "uniswap-v2",
          "sg-sushiswap-v3": "sushiswap-v3",
          "sg-uniswap-v3": "uniswap-v3",
          "sushi": "sushiswap-v3",
          "thena": "thena-fusion",
          "aero": "aerodrome-slipstream",
          "curve": "curve-dex",
        };
        // Match longest prefix first (sg-sushiswap-v3 before sg-)
        const sortedPrefixes = Object.keys(POOL_PREFIX_TO_PROJECT).sort((a, b) => b.length - a.length);
        for (const prefix of sortedPrefixes) {
          if (poolId.startsWith(prefix + "-")) {
            dexName = POOL_PREFIX_TO_PROJECT[prefix];
            break;
          }
        }
        // Also support legacy colon format (e.g. "pancakeswap-v3:0x...")
        if (!dexName) {
          const colonIdx = poolId.indexOf(":");
          if (colonIdx > 0) dexName = poolId.substring(0, colonIdx);
        }
        // Fallback: look up the pool in the API to get the project field
        if (!dexName) {
          try {
            const pools = await apiGet("/pools", { chainId: String(chainId) }) as any;
            const poolList = pools?.pools ?? (Array.isArray(pools) ? pools : []);
            const match = poolList.find((p: any) => p.poolId === poolId);
            if (match?.project) dexName = match.project;
          } catch (_) { /* best-effort */ }
        }
      }

      // Strategy 1: resolve nftManager from dexName + chain config
      if (!nftManager && dexName) {
        const chains = await getChainsConfig();
        const chain = chains.find((c: any) => c.chainId === chainId);
        const pc = chain?.positionConfig;
        if (pc) {
          // 1a. V3-style NftManagers (Uniswap V3, SushiSwap V3, PancakeSwap V3, Aerodrome, etc.)
          if (!nftManager && pc.v3NftManagers) {
            const PROJECT_TO_DEX: Record<string, string> = {
              "uniswap-v3": "Uniswap V3",
              "sushiswap-v3": "SushiSwap V3",
              "pancakeswap-amm-v3": "PancakeSwap V3",
              "pancakeswap-v3": "PancakeSwap V3",
              "aerodrome-slipstream": "Aerodrome Slipstream",
              "camelot-v3": "Camelot",
              "thena-fusion": "THENA",
              "quickswap-v3": "QuickSwap",
            };
            const displayName = PROJECT_TO_DEX[dexName] ?? dexName;
            const manager = pc.v3NftManagers.find(
              (m: any) => m.dexName === displayName || m.dexName === dexName,
            );
            if (manager) nftManager = manager.address;
          }
          // 1b. Uniswap V4 PositionManager
          if (!nftManager && dexName === "uniswap-v4" && pc.v4PositionManager) {
            nftManager = pc.v4PositionManager;
          }
          // 1c. PancakeSwap Infinity CL PositionManager
          if (!nftManager && dexName === "pancakeswap-infinity-cl" && pc.pcsInfinityCLPositionManager) {
            nftManager = pc.pcsInfinityCLPositionManager;
          }
          // 1d. Algebra-based DEXes (Camelot, THENA, QuickSwap)
          if (!nftManager && pc.algebraNftManager && pc.algebraDexName) {
            const ALGEBRA_PROJECTS: Record<string, string> = {
              "camelot-v3": "Camelot",
              "thena-fusion": "THENA",
              "quickswap-v3": "QuickSwap",
            };
            const algebraDisplayName = ALGEBRA_PROJECTS[dexName];
            if (algebraDisplayName && algebraDisplayName === pc.algebraDexName) {
              nftManager = pc.algebraNftManager;
            }
          }
        }
      }

      // Strategy 2: resolve from user's on-chain positions
      if (!nftManager && sender) {
        try {
          const [lib, chains, pools] = await Promise.all([
            loadPositionsLib(),
            getChainsConfig(),
            fetchPositionPools(chainId, apiKey),
          ]);
          const chain = chains.find((c: any) => c.chainId === chainId);
          if (chain) {
            const config = buildPositionConfig(chain, lib.PUBLIC_RPCS);
            const positions = await lib.readAllPositions(sender, config, pools);
            const match = Array.isArray(positions)
              ? positions.find((p: any) => String(p.positionId) === String(resolvedPositionId))
              : undefined;
            if (match) {
              if (match.nftManager) nftManager = match.nftManager;
              if (!dexName && match.dexName) dexName = match.dexName;
              if (!liquidityKind && match.liquidityKind) liquidityKind = match.liquidityKind;
            }
          }
        } catch (_) { /* best-effort — fall through to API validation */ }
      }

      // Strategy 3: brute-force ownerOf(positionId) on all known managers via RPC
      if (!nftManager && resolvedPositionId) {
        try {
          const [lib, chains3] = await Promise.all([loadPositionsLib(), getChainsConfig()]);
          const chain = chains3.find((c: any) => c.chainId === chainId);
          const pc = chain?.positionConfig;
          const rpcUrls: string[] = lib.PUBLIC_RPCS?.[chainId] ?? [];
          if (pc && rpcUrls.length > 0) {
            const candidates: Array<{ address: string; dex: string; kind?: string }> = [];
            if (pc.v4PositionManager) candidates.push({ address: pc.v4PositionManager, dex: "uniswap-v4", kind: "UNIV4" });
            if (pc.pcsInfinityCLPositionManager) candidates.push({ address: pc.pcsInfinityCLPositionManager, dex: "pancakeswap-infinity-cl", kind: "PCS_INF_CL" });
            if (pc.algebraNftManager && pc.algebraDexName) {
              const ALGEBRA_REV: Record<string, string> = { Camelot: "camelot-v3", THENA: "thena-fusion", QuickSwap: "quickswap-v3" };
              candidates.push({ address: pc.algebraNftManager, dex: ALGEBRA_REV[pc.algebraDexName] ?? pc.algebraDexName, kind: "ALGEBRA" });
            }
            if (pc.v3NftManagers) {
              const DEX_TO_PROJECT: Record<string, string> = {
                "Uniswap V3": "uniswap-v3", "SushiSwap V3": "sushiswap-v3",
                "PancakeSwap V3": "pancakeswap-v3", "PancakeSwap V3 (old)": "pancakeswap-v3",
                "Aerodrome Slipstream": "aerodrome-slipstream",
              };
              for (const m of pc.v3NftManagers) {
                candidates.push({ address: m.address, dex: DEX_TO_PROJECT[m.dexName] ?? m.dexName, kind: m.dexKind ?? "UNIV3" });
              }
            }
            // ownerOf(uint256) selector = 0x6352211e
            const tokenIdHex = BigInt(resolvedPositionId).toString(16).padStart(64, "0");
            const callData = "0x6352211e" + tokenIdHex;
            const rpcUrl = rpcUrls[0];
            for (const candidate of candidates) {
              try {
                const res = await fetch(rpcUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: candidate.address, data: callData }, "latest"] }),
                });
                const json = await res.json() as any;
                if (json.result && json.result.length === 66 && !json.error) {
                  nftManager = candidate.address;
                  if (!dexName) dexName = candidate.dex;
                  if (!liquidityKind) liquidityKind = candidate.kind;
                  break;
                }
              } catch (_) { continue; }
            }
          }
        } catch (_) { /* best-effort */ }
      }

      const payload: Record<string, unknown> = { chainId, withdrawals };
      if (resolvedPositionId) payload.positionId = resolvedPositionId;
      if (poolId) payload.poolId = poolId;
      if (nftManager) payload.nftManager = nftManager;
      if (dexName) payload.dexName = dexName;
      if (liquidityKind) payload.liquidityKind = liquidityKind;
      if (sender) payload.sender = sender;
      if (percent) payload.percent = percent;
      if (affiliateCode) payload.affiliateCode = affiliateCode;

      return apiPost("/removeliquidity/quote", payload);
    }),
  );

  return server;
}

// ── Exports ────────────────────────────────────────────────────────────────

export { createServer, extractProtocols, buildPositionConfig };

export function _resetForTesting() {
  positionsLib = null;
}

// ── Start (stdio mode) ────────────────────────────────────────────────────

if (!process.env.VITEST && !process.env.MCP_HTTP) {
  const apiKey = process.env.SWAPWIZARD_API_KEY ?? "";
  if (!apiKey) {
    console.error("SWAPWIZARD_API_KEY environment variable is required");
    process.exit(1);
  }
  const server = createServer(apiKey);
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
