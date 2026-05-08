#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.SWAPWIZARD_API_URL ?? "https://swapwizard.xyz").replace(/\/$/, "");
const API_KEY = process.env.SWAPWIZARD_API_KEY ?? "";

if (!API_KEY) {
  console.error("SWAPWIZARD_API_KEY environment variable is required");
  process.exit(1);
}

async function apiGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`/api/v2.0${path}`, API_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": API_KEY },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const url = new URL(`/api/v2.0${path}`, API_URL);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

const server = new McpServer({
  name: "swapwizard",
  version: "1.0.0",
});

// ── GET /chains ─────────────────────────────────────────────────────────────

server.tool(
  "swapwizard_chains",
  "List all blockchain networks available on SwapWizard with their chain IDs and pool counts.",
  {},
  async () => {
    const data = await apiGet("/chains");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── GET /health ─────────────────────────────────────────────────────────────

server.tool(
  "swapwizard_health",
  "Check if the SwapWizard API is healthy and get uptime.",
  {},
  async () => {
    const data = await apiGet("/health");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── GET /pools ──────────────────────────────────────────────────────────────

server.tool(
  "swapwizard_pools",
  "Search liquidity pools by chain, tokens, and pool type. Use this to find which pools are available for liquidity operations.",
  {
    chainId: z.number().int().describe("EVM chain ID (e.g. 56 for BSC, 1 for Ethereum)"),
    tokens: z.string().optional().describe("Comma-separated token addresses to filter pools by"),
    poolType: z.enum(["classic", "concentrated"]).optional().describe("Filter by pool type"),
  },
  async ({ chainId, tokens, poolType }) => {
    const params: Record<string, string> = { chainId: String(chainId) };
    if (tokens) params.tokens = tokens;
    if (poolType) params.poolType = poolType;
    const data = await apiGet("/pools", params);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── GET /positions ──────────────────────────────────────────────────────────

server.tool(
  "swapwizard_positions",
  "List all liquidity positions (V3 NFT, V2 LP, etc.) owned by a wallet address on a specific chain. The returned positions can be used with excludePositions in quotes or with remove liquidity.",
  {
    chainId: z.number().int().describe("EVM chain ID"),
    owner: z.string().describe("Wallet address to query positions for"),
  },
  async ({ chainId, owner }) => {
    const data = await apiGet("/positions", { chainId: String(chainId), owner });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── POST /quote ─────────────────────────────────────────────────────────────

server.tool(
  "swapwizard_quote",
  `Get the best swap quote across all DEXes on a chain. Returns the optimal route with pre-encoded callData ready for on-chain execution.

The response includes:
- router: contract address to send the transaction to
- callData: ABI-encoded transaction data for eth_sendTransaction
- value: native token value to send ("0" for ERC-20 input)

Use excludePositions to simulate prices as if your liquidity positions were already removed from the pool — useful for rebalancing strategies.`,
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
    })).optional().describe("Positions to subtract from pool state during simulation. Get these from swapwizard_positions."),
  },
  async (params) => {
    const data = await apiPost("/quote", params);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── POST /addliquidity/quote ────────────────────────────────────────────────

server.tool(
  "swapwizard_add_liquidity",
  `Quote an add-liquidity operation. Calculates optimal token split, quotes swap legs, and returns pre-encoded callData for the SwapWizardLiquidityRouter.

You can deposit any token(s) — the router handles swapping to the correct ratio automatically (zap). The response includes router address and callData for execution.`,
  {
    chainId: z.number().int().describe("EVM chain ID"),
    poolId: z.string().describe("Pool identifier from swapwizard_pools (e.g. 'pancakeswap-v3:0x36696...')"),
    deposits: z.array(z.object({
      token: z.string().describe("Token address (0x0000...0000 for native)"),
      amount: z.string().describe("Amount as stringified uint256 in token decimals"),
    })).min(1).describe("Tokens and amounts to deposit"),
    sender: z.string().optional().describe("Wallet address of the sender (for simulation)"),
    tickLower: z.number().int().optional().describe("Custom lower tick for concentrated liquidity"),
    tickUpper: z.number().int().optional().describe("Custom upper tick for concentrated liquidity"),
    affiliateCode: z.string().optional().describe("Registered affiliate wallet address"),
  },
  async (params) => {
    const data = await apiPost("/addliquidity/quote", params);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── POST /removeliquidity/quote ─────────────────────────────────────────────

server.tool(
  "swapwizard_remove_liquidity",
  `Quote a remove-liquidity operation. Reads the on-chain position, estimates underlying tokens, and returns pre-encoded callData for the SwapWizardLiquidityRouter.

Use swapwizard_positions first to get the position details needed for this endpoint.`,
  {
    chainId: z.number().int().describe("EVM chain ID"),
    poolId: z.string().describe("Pool identifier from swapwizard_pools"),
    tokenId: z.string().optional().describe("NFT token ID for concentrated liquidity positions"),
    withdrawals: z.array(z.object({
      token: z.string().describe("Token address to withdraw to"),
    })).optional().describe("Tokens to receive after removal"),
    sender: z.string().optional().describe("Wallet address of the position owner"),
    affiliateCode: z.string().optional().describe("Registered affiliate wallet address"),
  },
  async (params) => {
    const data = await apiPost("/removeliquidity/quote", params);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
