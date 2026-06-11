#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

// ── Chains cache ──────────────────────────────────────────────────────────

let chainsCache: any[] | null = null;
let chainsCacheTime = 0;

function extractProtocols(chain: any): { name: string; slug: string | null }[] {
  if (!Array.isArray(chain.dexes)) return [];
  return chain.dexes
    .filter((d: any) => d.enabled && d.name !== "Split Router")
    .map((d: any) => ({ name: d.name, slug: d.slug ?? null }));
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
  version: "1.8.5",
  description: "Non-custodial DeFi execution layer for AI agents powered by the SwapWizard API — swap quotes and execution, zap in/out of LP positions including concentrated liquidity (Uniswap V3/V4, Aerodrome Slipstream, Algebra, PancakeSwap Infinity CL) with custom price-range management, routing across 22 AMMs, and pool discovery and analysis on 5 EVM chains.",
  websiteUrl: "https://swapwizard.xyz",
};

const SERVER_INSTRUCTIONS = `
## Setup requirements

- **SwapWizard API key** — sign in with your wallet at https://swapwizard.xyz/integrators (SIWE, no gas cost).
- **Alchemy RPC URL** — pass as rpcUrl to list_user_lp_positions and get_clean_quote. Without it, position discovery is slower and recently created positions may not appear.
- **Private key or wallet signer** — required to sign and broadcast on-chain transactions (approvals and the main tx). SwapWizard never signs or broadcasts on your behalf.
- **MCP client config** — when creating a \`.mcp.json\` file for the remote endpoint, set \`"type": "streamable-http"\` and \`"url": "https://mcp.swapwizard.xyz/mcp"\` with an \`"X-API-Key"\` header.
- **Security: use environment variables** — NEVER hardcode secrets in code or config files. Store API keys, private keys, and RPC URLs in environment variables (e.g. \`SWAPWIZARD_API_KEY\`, \`WALLET_PRIVATE_KEY\`, \`ALCHEMY_RPC_URL\`) and reference them from your configuration.

## poolId rule

- search_liquidity_pools returns a \`poolId\` field (string) → pass it **as-is** to zap_into_lp_position and zap_out_of_lp_position. Do NOT construct, modify, or guess poolId values.
- search_liquidity_pools returns an \`id\` field (number) → use it **only** for analyze_pool.

## Operational flows

- **Swap**: get_supported_chains → get_swap_quote → approve router → wait for on-chain confirmation → get_swap_quote again (fresh quote) → send tx to router.
- **Zap in**: search_liquidity_pools → zap_into_lp_position → approve router → wait for on-chain confirmation → zap_into_lp_position again (fresh quote) → send tx to router. The \`deposits\` array accepts ANY token — it does not have to be one of the pool's tokens. SwapWizard handles all intermediate swaps, the LP mint, and price-range setup in a single transaction.
- **Zap out**: list_user_lp_positions → zap_out_of_lp_position → setApprovalForAll(router, true) on the nftManager → wait for on-chain confirmation → zap_out_of_lp_position again (fresh quote) → send tx to router. The \`withdrawals\` array accepts ANY output token — you can exit into any token, not just the pool's underlying tokens. SwapWizard handles the LP burn, fee collection, and intermediate swaps in a single transaction.
- **Analyze**: search_liquidity_pools → analyze_pool with the numeric id.

## Transaction execution

- Quote tools return \`router\`, \`callData\`, and \`value\`.
- Send the transaction to the \`router\` contract address with \`data: callData\` and \`value: value\`. This requires a private key or wallet signer.
- ALWAYS fetch a fresh quote after the approval is confirmed — the previous quote expires and its callData becomes stale.

## Approval rules

- **ERC-20 tokens** (swaps, zap in): call \`approve(router, amount)\` on the input token contract.
- **NFT-based positions** (zap out): call \`setApprovalForAll(router, true)\` on the \`nftManager\` contract. Do NOT use \`approve(router, tokenId)\` — most position managers only check operator approval.
- **PCS Infinity BIN positions**: call \`approveForAll(router, true)\` on the \`nftManager\`.
- **Classic LP pools** (Curve, Balancer, Uniswap V2, Solidly): approve the LP token as a standard ERC-20.
`.trim();

function createServer(apiKey: string): McpServer {
  const apiGet = makeApiGet(apiKey);
  const apiPost = makeApiPost(apiKey);

  let guideRead = false;

  function withGuide<T extends { content: Array<{ type: "text"; text: string }>; isError?: true }>(result: T): T {
    if (guideRead) return result;
    guideRead = true;
    const guideBlock = {
      type: "text" as const,
      text: `⚠️ SETUP GUIDE — read this before proceeding:\n\n${SERVER_INSTRUCTIONS}\n\n--- End of guide. Tool response follows below. ---\n`,
    };
    return { ...result, content: [guideBlock, ...result.content] } as T;
  }

  async function guidedApiCall(fn: () => Promise<unknown>) {
    const result = await safeApiCall(fn);
    return withGuide(result);
  }

  async function getChainsConfig(): Promise<any[]> {
    const now = Date.now();
    if (chainsCache && now - chainsCacheTime < 300_000) return chainsCache;
    const data = await apiGet("/chains") as any[];
    chainsCache = data;
    chainsCacheTime = now;
    return data;
  }

  const server = new McpServer(SERVER_META, { instructions: SERVER_INSTRUCTIONS });

  server.tool(
    "get_setup_guide",
    `Returns the complete setup and usage guide for SwapWizard. Call this FIRST before using any other tool. Covers: required configuration (API key, Alchemy RPC URL, private key), how to use poolId correctly, step-by-step operational flows for swap/zap in/zap out/analyze, transaction execution details, and approval rules.`,
    {},
    async () => {
      guideRead = true;
      return jsonResult({ guide: SERVER_INSTRUCTIONS });
    },
  );

  server.tool(
    "get_supported_chains",
    `Maps to GET /chains. Lists supported EVM chains with chain IDs and native gas tokens: Ethereum, Arbitrum, Base, Polygon, BNB Chain.`,
    {},
    async () => guidedApiCall(() => apiGet("/chains")),
  );

  server.tool(
    "check_api_health",
    `Maps to GET /health. Returns service availability. Use to confirm the API is responsive before attempting operations.`,
    {},
    async () => guidedApiCall(() => apiGet("/health")),
  );

  server.tool(
    "get_supported_dexes",
    `Returns the AMMs / DEX sources SwapWizard routes across per chain. Each DEX includes its display name and slug (e.g. "uniswap-v3") — use the slug as the 'project' filter in search_liquidity_pools to filter pools by protocol.`,
    {
      chainId: z.number().int().optional().describe("EVM chain ID to filter results. If omitted, returns protocols for all supported chains."),
    },
    async ({ chainId }) => guidedApiCall(async () => {
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
    `Maps to GET /pools. Discovers liquidity pools across supported AMMs and chains, returning id, poolId, symbol, fee tier, protocol, dexKind, APY, TVL (USD), 24h/7d volume (USD), and stablecoin flags. KEY PARAMETERS: Use \`trending: true\` to get only pools currently trending on GeckoTerminal, optionally with \`timeframe\` ("5m", "1h", "6h", "24h") to select the trending ranking window — default is 5m. Use \`sortBy\` ("apy", "tvl", "volume1d", "volume7d") with \`sortOrder\` ("asc", "desc") to control ranking — default is tvl desc. Use \`topPerVenue\` to limit to top N pools per DEX by APY. Supports filtering by protocol/DEX, tokens, pool type, stablecoin status, and free-text search, with pagination. Required upstream step before zap_into_lp_position. IMPORTANT: The response contains two ID fields — \`poolId\` (string) must be passed AS-IS to zap_into_lp_position and zap_out_of_lp_position (do NOT construct or modify it), and \`id\` (number) is used only for analyze_pool.`,
    {
      chainId: z.number().int().describe("EVM chain ID (e.g. 56 for BSC, 1 for Ethereum)"),
      project: z.string().optional().describe("Filter by protocol/DEX name (e.g. uniswap-v3, pancakeswap-v3, aerodrome-v2)"),
      dexKind: z.string().optional().describe("Filter by DEX kind (e.g. UNIV3_SR02)"),
      tokens: z.string().optional().describe("Comma-separated token addresses to filter pools by"),
      search: z.string().optional().describe("Search by symbol or project name"),
      poolType: z.enum(["classic", "concentrated"]).optional().describe("Filter by pool type"),
      stableOnly: z.boolean().optional().describe("Show only stablecoin pairs"),
      semiStableOnly: z.boolean().optional().describe("Show only pools with exactly one stablecoin"),
      sortBy: z.enum(["apy", "tvl", "volume1d", "volume7d"]).optional().describe("Sort field (default: tvl)"),
      sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort direction (default: desc)"),
      topPerVenue: z.number().int().optional().describe("Limit to top N pools per venue by APY"),
      trending: z.boolean().optional().describe("If true, return only pools currently trending on GeckoTerminal"),
      timeframe: z.enum(["5m", "1h", "6h", "24h"]).optional().describe("Trending ranking window (default: 5m). Only applies with trending=true. Sent to the API as trendingDuration."),
      page: z.number().int().optional().describe("Page number, 0-based (default: 0)"),
      pageSize: z.number().int().optional().describe("Results per page, max 200 (default: 50)"),
    },
    async ({ chainId, project, dexKind, tokens, search, poolType, stableOnly, semiStableOnly, sortBy, sortOrder, topPerVenue, trending, timeframe, page, pageSize }) => {
      const params: Record<string, string> = { chainId: String(chainId) };
      if (project) params.project = project;
      if (dexKind) params.dexKind = dexKind;
      if (tokens) params.tokens = tokens;
      if (search) params.search = search;
      if (poolType) params.poolType = poolType;
      if (stableOnly) params.stableOnly = "true";
      if (semiStableOnly) params.semiStableOnly = "true";
      if (trending) params.trending = "true";
      if (trending && timeframe) params.trendingDuration = timeframe;
      if (sortBy) params.sortBy = sortBy;
      if (sortOrder) params.sortOrder = sortOrder;
      if (topPerVenue !== undefined) params.topPerVenue = String(topPerVenue);
      if (page !== undefined) params.page = String(page);
      if (pageSize !== undefined) params.pageSize = String(pageSize);
      return guidedApiCall(() => apiGet("/pools", params));
    },
  );

  server.tool(
    "analyze_pool",
    `Maps to GET /pools/analyze/:id. Returns real-time momentum data for a specific pool from GeckoTerminal: multi-timeframe volume (5m, 15m, 30m, 1h, 6h), price changes (5m–24h), buy/sell transaction counts, unique traders (24h), and reserve in USD. Data is cached for 10 minutes; stale entries are refreshed on-demand. Use the numeric id field returned by search_liquidity_pools.`,
    {
      id: z.number().int().describe("Pool numeric ID (from the id field in search_liquidity_pools response)"),
    },
    async ({ id }) => guidedApiCall(() => apiGet(`/pools/analyze/${id}`)),
  );

  server.tool(
    "list_user_lp_positions",
    `Maps to GET /positions. Reads all LP positions a wallet holds on a given chain by calling the SwapWizard API, which discovers positions across all supported protocols: Uniswap V2/V3/V4, Aerodrome, Thena, SushiSwap, PancakeSwap, Algebra, Balancer, Curve, and all Solidly forks. Each position includes positionId, nftManager, dexName, liquidityKind, token addresses, amounts, fees, in-range status, APR, and USD values. The API uses Alchemy's NFT APIs for optimal position discovery — pass an Alchemy RPC URL via rpcUrl for fastest results. Without an Alchemy key, the API falls back to on-chain scanning which may be slower and newly created positions may take longer to appear. IMPORTANT: Always call this BEFORE zap_out_of_lp_position — pass the returned positionId, nftManager, dexName, and liquidityKind directly to zap_out_of_lp_position.`,
    {
      chainId: z.number().int().describe("EVM chain ID"),
      owner: z.string().describe("Wallet address to query positions for"),
      rpcUrl: z.string().optional().describe("Custom RPC endpoint URL. If the URL is from Alchemy, the API auto-extracts the key for accelerated NFT-based position discovery."),
    },
    async ({ chainId, owner, rpcUrl }) => guidedApiCall(async () => {
      const params: Record<string, string> = {
        chainId: String(chainId),
        owner,
      };
      if (rpcUrl) params.rpc_url = rpcUrl;
      const data = await apiGet("/positions", params) as { positions: any[]; warnings?: string[] };
      return data.positions ?? [];
    }),
  );

  server.tool(
    "get_swap_quote",
    `Maps to POST /quote. Returns the best swap quote across all integrated DEX protocols, with router, callData, value, price impact, route summary, and gas estimate in one response. Surplus and positive slippage are returned to the user in the same transaction. Supports an optional affiliateCode (registered affiliate wallet address) forwarded to the API so the affiliate fee is paid on-chain to that address. Supports an excludePositions parameter that prices the swap excluding the caller's own LP position from pool state. Returns signable data only; never signs or broadcasts. EXECUTION FLOW: (1) If the input token is non-native, send an ERC-20 approve to the router and WAIT for on-chain confirmation. (2) Call this tool again for a fresh quote (quotes expire). (3) Send the tx to the router contract: to=router, data=callData, value=value. This requires a private key or wallet signer. ⚠️ PRICE IMPACT: The response includes a priceImpact field. Agents MUST present this value to the user and request explicit confirmation before executing. High price impact means the user will receive significantly less value than expected. ⚠️ ZERO OUTPUT: If the swap amount is too small relative to the token pair price ratio, the API returns HTTP 400 with "swap amount too small: output rounds to zero for this pair". Increase the amount or use a different pair.`,
    {
      chainId: z.number().int().describe("EVM chain ID (e.g. 56 for BSC)"),
      tokenIn: z.string().describe("Input token address (0x0000...0000 for native coin)"),
      tokenOut: z.string().describe("Output token address"),
      side: z.enum(["exactIn", "exactOut"]).describe("Quote direction"),
      amount: z.string().describe("Amount as stringified uint256 in token decimals"),
      slippageBps: z.number().int().min(0).max(10000).optional().describe("Slippage tolerance in basis points (default: 100 = 1%)"),
      affiliateCode: z.string().optional().describe("Optional affiliate wallet address registered on-chain with SwapWizard — forwarded to the API so the affiliate fee for this operation is paid to that address. Omit if you have no affiliate."),
      excludePositions: z.array(z.object({
        poolAddress: z.string().describe("Pool contract address"),
        liquidity: z.string().describe("Position liquidity as uint256 string"),
        tickLower: z.number().int().describe("Lower tick bound"),
        tickUpper: z.number().int().describe("Upper tick bound"),
      })).optional().describe("Positions to subtract from pool state during simulation — for a clean quote that excludes self-impact. Get these from list_user_lp_positions."),
    },
    async (params) => guidedApiCall(() => apiPost("/quote", params)),
  );

  server.tool(
    "get_clean_quote",
    `Maps to POST /quote with excludePositions=true. Shortcut to get_swap_quote that prices the swap as if the caller's own LP position were not in the pool, for concentrated-liquidity positions in the active tick range. Use when an agent holds a significant position in the pool it is about to trade against (rebalancing, exit, treasury sizing) and needs a quote unaffected by its own liquidity. Returns the same router/callData/value execution fields as get_swap_quote, and likewise supports an optional affiliateCode (registered affiliate wallet address) forwarded to the API. EXECUTION FLOW: same as get_swap_quote — approve (wait for confirmation), fresh quote, then send tx to the router contract (requires private key or wallet signer). ⚠️ PRICE IMPACT: The response includes a priceImpact field. Agents MUST present this value to the user and request explicit confirmation before executing. ⚠️ ZERO OUTPUT: If the swap amount is too small relative to the token pair price ratio, the API returns HTTP 400 with "swap amount too small: output rounds to zero for this pair". Increase the amount or use a different pair.`,
    {
      chainId: z.number().int().describe("EVM chain ID (e.g. 56 for BSC)"),
      owner: z.string().describe("Wallet address whose LP positions will be excluded from pool state during quoting"),
      tokenIn: z.string().describe("Input token address (0x0000...0000 for native coin)"),
      tokenOut: z.string().describe("Output token address"),
      side: z.enum(["exactIn", "exactOut"]).describe("Quote direction"),
      amount: z.string().describe("Amount as stringified uint256 in token decimals"),
      slippageBps: z.number().int().min(0).max(10000).optional().describe("Slippage tolerance in basis points (default: 100 = 1%)"),
      affiliateCode: z.string().optional().describe("Optional affiliate wallet address registered on-chain with SwapWizard — forwarded to the API so the affiliate fee for this operation is paid to that address. Omit if you have no affiliate."),
      rpcUrl: z.string().optional().describe("Custom RPC endpoint URL for position discovery."),
    },
    async ({ chainId, owner, tokenIn, tokenOut, side, amount, slippageBps, affiliateCode, rpcUrl }) => guidedApiCall(async () => {
      const posParams: Record<string, string> = { chainId: String(chainId), owner };
      if (rpcUrl) posParams.rpc_url = rpcUrl;
      const posData = await apiGet("/positions", posParams) as { positions: any[] };
      const positions = posData.positions ?? [];

      let excludePositions: Array<{
        poolAddress: string;
        liquidity: string;
        tickLower: number;
        tickUpper: number;
      }> | undefined;

      if (positions.length > 0) {
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
    `Maps to POST /addliquidity/quote. Builds a single-transaction zap to enter an LP position from ANY input token — the deposit token does NOT have to be one of the pool's underlying tokens. SwapWizard handles all intermediate swaps, the LP mint, and price-range setup in a single transaction. FULL CONCENTRATED LIQUIDITY SUPPORT: for CL pools (Uniswap V3/V4, PancakeSwap V3/Infinity CL, Aerodrome Slipstream, SushiSwap V3, Algebra forks like Camelot/THENA/QuickSwap, Fluid, Balancer V3) you can set a custom price range via tickLower/tickUpper — omit them for the protocol's default range. Classic pools (Curve, Balancer V2, Uniswap V2, Solidly) are also supported. Surplus returned to the user. Supports an optional affiliateCode (registered affiliate wallet address) forwarded to the API so the affiliate fee is paid on-chain to that address. IMPORTANT: The poolId parameter MUST come verbatim from the poolId field in the search_liquidity_pools response — do NOT construct or modify it. EXECUTION FLOW: (1) If the deposit token is non-native, send an ERC-20 approve to the router and WAIT for on-chain confirmation. (2) Call this tool again for a fresh quote (quotes expire). (3) Send the tx to the router contract: to=router, data=callData, value=value. This requires a private key or wallet signer. ⚠️ PRICE IMPACT: The response includes a priceImpact field. Agents MUST present this value to the user and request explicit confirmation before executing. ⚠️ ZERO OUTPUT: If an internal swap amount is too small, the API returns HTTP 400 with "swap amount too small: output rounds to zero". Increase the deposit amount.`,
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
      affiliateCode: z.string().optional().describe("Optional affiliate wallet address registered on-chain with SwapWizard — forwarded to the API so the affiliate fee for this operation is paid to that address. Omit if you have no affiliate."),
    },
    async (params) => guidedApiCall(() => apiPost("/addliquidity/quote", params)),
  );

  server.tool(
    "zap_out_of_lp_position",
    `Maps to POST /removeliquidity/quote. Builds a single-transaction zap to exit an LP position into ANY output token — you can withdraw into any token, not just the pool's underlying tokens. SwapWizard handles LP burn, fee collection, and intermediate swaps in a single transaction. Supports an optional affiliateCode (registered affiliate wallet address) forwarded to the API so the affiliate fee is paid on-chain to that address. REQUIRED WORKFLOW: First call list_user_lp_positions, then pass the returned fields (positionId, nftManager, dexName, liquidityKind) here along with sender, poolId, and withdrawals. EXECUTION FLOW: (1) APPROVE — For NFT-based positions, call setApprovalForAll(router, true) on the nftManager contract (do NOT use approve(router, tokenId)). For PCS Infinity BIN, call approveForAll(router, true). For classic LP pools (Curve, Balancer, Uniswap V2, Solidly), approve the LP token as a standard ERC-20. (2) WAIT for the approve tx to be confirmed on-chain. (3) Call this tool again for a fresh quote (quotes expire). (4) Send the tx to the router contract: to=router, data=callData, value=value. This requires a private key or wallet signer. ⚠️ PRICE IMPACT: The response includes a priceImpact field. Agents MUST present this value to the user and request explicit confirmation before executing.`,
    {
      chainId: z.number().int().describe("EVM chain ID"),
      positionId: z.string().describe("Position identifier from list_user_lp_positions. For CL positions: NFT token ID. For classic pools: LP token contract address."),
      poolId: z.string().optional().describe("Pool identifier from search_liquidity_pools — pass if available."),
      nftManager: z.string().optional().describe("NFT position manager contract address from list_user_lp_positions. Required for CL positions (Uniswap V3/V4, PancakeSwap V3/Infinity CL, SushiSwap V3, Algebra)."),
      dexName: z.string().optional().describe("DEX project name from list_user_lp_positions (e.g. 'Uniswap V3', 'PancakeSwap V3', 'curve-dex')."),
      liquidityKind: z.string().optional().describe("Liquidity kind from list_user_lp_positions (e.g. UNIV3, UNIV4, ALGEBRA, SLIPSTREAM, PCS_INF_CL, CURVE, UNIV2, SOLIDLY)."),
      withdrawals: z.array(z.object({
        token: z.string().describe("Token address to withdraw to"),
      })).min(1).describe("Tokens to receive after removal"),
      sender: z.string().describe("Wallet address of the position owner."),
      percent: z.number().int().min(1).max(100).optional().describe("Percentage of position to remove (default: 100). For classic LP pools (UniV2, Solidly, Curve, Balancer) use 99 instead of 100 to avoid reverts from LP balance race conditions between RPC nodes."),
      affiliateCode: z.string().optional().describe("Optional affiliate wallet address registered on-chain with SwapWizard — forwarded to the API so the affiliate fee for this operation is paid to that address. Omit if you have no affiliate."),
    },
    async ({ chainId, positionId, poolId, nftManager, dexName, liquidityKind, withdrawals, sender, percent, affiliateCode }) => guidedApiCall(async () => {
      if (!nftManager && dexName) {
        const chains = await getChainsConfig();
        const chain = chains.find((c: any) => c.chainId === chainId);
        const pc = chain?.positionConfig;
        if (pc) {
          if (pc.v3NftManagers) {
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
          if (!nftManager && dexName === "uniswap-v4" && pc.v4PositionManager) {
            nftManager = pc.v4PositionManager;
          }
          if (!nftManager && dexName === "pancakeswap-infinity-cl" && pc.pcsInfinityCLPositionManager) {
            nftManager = pc.pcsInfinityCLPositionManager;
          }
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

      const payload: Record<string, unknown> = { chainId, positionId, withdrawals, sender };
      if (poolId) payload.poolId = poolId;
      if (nftManager) payload.nftManager = nftManager;
      if (dexName) payload.dexName = dexName;
      if (liquidityKind) payload.liquidityKind = liquidityKind;
      if (percent) payload.percent = percent;
      if (affiliateCode) payload.affiliateCode = affiliateCode;

      return apiPost("/removeliquidity/quote", payload);
    }),
  );

  return server;
}

// ── Exports ────────────────────────────────────────────────────────────────

export { createServer, extractProtocols };

export function _resetForTesting() {
  chainsCache = null;
  chainsCacheTime = 0;
}

// ── Start (stdio mode) ────────────────────────────────────────────────────

if (!process.env.VITEST && !process.env.MCP_HTTP) {
  const apiKey = process.env.SWAPWIZARD_API_KEY ?? "";
  if (!apiKey) {
    console.error("Warning: SWAPWIZARD_API_KEY not set — tool calls that hit the API will fail.");
  }
  const server = createServer(apiKey);
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
