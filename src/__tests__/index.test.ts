import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server, extractProtocols, buildPositionConfig, _resetForTesting } from "../index.js";
import { MOCK_CHAINS } from "./fixtures/chains.js";
import { MOCK_CL_POSITIONS, MOCK_V2_POSITIONS, MOCK_MIXED_POSITIONS, MOCK_EMPTY_POSITIONS } from "./fixtures/positions.js";
import { MOCK_QUOTE, MOCK_HEALTH, MOCK_POOLS, MOCK_ADD_LIQUIDITY, MOCK_REMOVE_LIQUIDITY } from "./fixtures/quotes.js";
import { makePositionsLibCode } from "./fixtures/positionsLib.js";
import { setupFetchMock, getPostBody, countFetchCalls, findFetchCall } from "./helpers/fetchMock.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

let client: Client;

function parseTool(result: any): any {
  return JSON.parse(result.content[0].text);
}

function isToolError(result: any): boolean {
  return result.isError === true;
}

function errorText(result: any): string {
  return result.content[0].text;
}

// ── Unit: extractProtocols ──────────────────────────────────────────────────

describe("extractProtocols", () => {
  it("extracts multiple dexNames from v3NftManagers", () => {
    const chain = { positionConfig: { v3NftManagers: [{ dexName: "uniswap-v3" }, { dexName: "sushi-v3" }] } };
    expect(extractProtocols(chain)).toEqual(["uniswap-v3", "sushi-v3"]);
  });

  it("skips v3NftManagers entries without dexName", () => {
    const chain = { positionConfig: { v3NftManagers: [{ dexName: "uniswap-v3" }, { address: "0x..." }] } };
    expect(extractProtocols(chain)).toEqual(["uniswap-v3"]);
  });

  it("adds algebraDexName when both algebraNftManager and algebraDexName present", () => {
    const chain = { positionConfig: { algebraNftManager: "0x1", algebraDexName: "quickswap-v3" } };
    expect(extractProtocols(chain)).toEqual(["quickswap-v3"]);
  });

  it("does NOT add algebra when algebraDexName missing", () => {
    const chain = { positionConfig: { algebraNftManager: "0x1" } };
    expect(extractProtocols(chain)).toEqual([]);
  });

  it("does NOT add algebra when algebraNftManager missing", () => {
    const chain = { positionConfig: { algebraDexName: "quickswap-v3" } };
    expect(extractProtocols(chain)).toEqual([]);
  });

  it("adds uniswap-v4 when v4PositionManager present", () => {
    const chain = { positionConfig: { v4PositionManager: "0x1" } };
    expect(extractProtocols(chain)).toEqual(["uniswap-v4"]);
  });

  it("adds balancer-v2 when balancerV2Vault present", () => {
    const chain = { positionConfig: { balancerV2Vault: "0x1" } };
    expect(extractProtocols(chain)).toEqual(["balancer-v2"]);
  });

  it("adds pancakeswap-infinity-cl", () => {
    const chain = { positionConfig: { pcsInfinityCLPositionManager: "0x1" } };
    expect(extractProtocols(chain)).toEqual(["pancakeswap-infinity-cl"]);
  });

  it("adds pancakeswap-infinity-bin", () => {
    const chain = { positionConfig: { pcsInfinityBinPositionManager: "0x1" } };
    expect(extractProtocols(chain)).toEqual(["pancakeswap-infinity-bin"]);
  });

  it("adds pancakeswap-v4-cl", () => {
    const chain = { positionConfig: { v4ClPoolManager: "0x1" } };
    expect(extractProtocols(chain)).toEqual(["pancakeswap-v4-cl"]);
  });

  it("adds aerodrome", () => {
    const chain = { positionConfig: { aerodromeSugar: "0x1" } };
    expect(extractProtocols(chain)).toEqual(["aerodrome"]);
  });

  it("adds thena", () => {
    const chain = { positionConfig: { thenaPairApi: "https://api" } };
    expect(extractProtocols(chain)).toEqual(["thena"]);
  });

  it("returns all protocols for kitchen-sink chain", () => {
    const chain = {
      positionConfig: {
        v3NftManagers: [{ dexName: "uni-v3" }],
        algebraNftManager: "0x1", algebraDexName: "algebra",
        v4PositionManager: "0x1",
        balancerV2Vault: "0x1",
        pcsInfinityCLPositionManager: "0x1",
        pcsInfinityBinPositionManager: "0x1",
        v4ClPoolManager: "0x1",
        aerodromeSugar: "0x1",
        thenaPairApi: "https://api",
      },
    };
    const result = extractProtocols(chain);
    expect(result).toHaveLength(9);
    expect(result).toContain("uni-v3");
    expect(result).toContain("algebra");
    expect(result).toContain("uniswap-v4");
    expect(result).toContain("balancer-v2");
    expect(result).toContain("aerodrome");
    expect(result).toContain("thena");
  });

  it("returns empty array when positionConfig missing", () => {
    expect(extractProtocols({})).toEqual([]);
  });

  it("returns empty array when positionConfig is null", () => {
    expect(extractProtocols({ positionConfig: null })).toEqual([]);
  });

  it("returns empty array when positionConfig is empty object", () => {
    expect(extractProtocols({ positionConfig: {} })).toEqual([]);
  });

  it("returns empty array when v3NftManagers is empty", () => {
    expect(extractProtocols({ positionConfig: { v3NftManagers: [] } })).toEqual([]);
  });

  it("skips v3NftManagers when not an array", () => {
    expect(extractProtocols({ positionConfig: { v3NftManagers: "not-array" } })).toEqual([]);
  });
});

// ── Unit: buildPositionConfig ───────────────────────────────────────────────

describe("buildPositionConfig", () => {
  const rpcs: Record<number, string[]> = { 1: ["https://rpc1"], 56: ["https://rpc56"] };

  it("builds full config with all positionConfig fields", () => {
    const config = buildPositionConfig(MOCK_CHAINS[0], rpcs);
    expect(config.chainId).toBe(1);
    expect(config.rpcUrls).toEqual(["https://rpc1"]);
    expect(config.weth).toBe(MOCK_CHAINS[0].weth);
    expect(config.v3NftManagers).toHaveLength(2);
    expect(config.v4PositionManager).toBe("0xV4POSITION");
    expect(config.balancerV2Vault).toBeDefined();
  });

  it("maps v3NftManagers with factory correctly", () => {
    const config = buildPositionConfig(MOCK_CHAINS[0], rpcs);
    const withFactory = config.v3NftManagers.find((m: any) => m.factory);
    const withoutFactory = config.v3NftManagers.find((m: any) => !m.factory);
    expect(withFactory?.factory).toBe("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865");
    expect(withoutFactory?.factory).toBeUndefined();
  });

  it("handles missing positionConfig", () => {
    const config = buildPositionConfig(MOCK_CHAINS[3], rpcs); // Polygon
    expect(config.chainId).toBe(137);
    expect(config.v3NftManagers).toEqual([]);
    expect(config.algebraNftManager).toBeUndefined();
  });

  it("falls back to empty rpcUrls for unknown chainId", () => {
    const config = buildPositionConfig(MOCK_CHAINS[0], { 999: ["https://rpc"] });
    expect(config.rpcUrls).toEqual([]);
  });

  it("includes algebra fields for BSC chain", () => {
    const config = buildPositionConfig(MOCK_CHAINS[1], rpcs);
    expect(config.algebraNftManager).toBe("0xALGEBRA_NFT");
    expect(config.algebraFactory).toBe("0xALGEBRA_FACTORY");
    expect(config.algebraDexName).toBe("thena-algebra");
  });

  it("includes aerodromeSugar for Base chain", () => {
    const config = buildPositionConfig(MOCK_CHAINS[2], rpcs);
    expect(config.aerodromeSugar).toBe("0xAERO_SUGAR");
  });

  it("includes thenaPairApi for Arbitrum chain", () => {
    const config = buildPositionConfig(MOCK_CHAINS[4], rpcs);
    expect(config.thenaPairApi).toBe("https://api.thena.fi/pairs");
  });
});

// ── Integration tests ───────────────────────────────────────────────────────

describe("MCP Integration", () => {
  let mockFetch: ReturnType<typeof setupFetchMock>;

  beforeAll(async () => {
    mockFetch = setupFetchMock();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  beforeEach(() => {
    mockFetch.mockClear();
    _resetForTesting();
    mockFetch = setupFetchMock();
  });

  // ── Server metadata ─────────────────────────────────────────────────────

  describe("server metadata", () => {
    it("reports correct name and version", () => {
      const info = client.getServerVersion();
      expect(info?.name).toBe("swapwizard");
      expect(info?.version).toBe("1.1.0");
    });

    it("description mentions atomic DeFi execution layer", () => {
      const info = client.getServerVersion();
      expect(info?.description).toContain("Atomic DeFi execution layer");
    });

    it("description mentions API key requirement", () => {
      const info = client.getServerVersion();
      expect(info?.description).toContain("API key");
    });

    it("lists exactly 9 tools", async () => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(9);
    });

    it("lists all expected tool names", async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("get_supported_chains");
      expect(names).toContain("check_api_health");
      expect(names).toContain("get_supported_dexes");
      expect(names).toContain("search_liquidity_pools");
      expect(names).toContain("list_user_lp_positions");
      expect(names).toContain("get_swap_quote");
      expect(names).toContain("get_clean_quote");
      expect(names).toContain("zap_into_lp_position");
      expect(names).toContain("zap_out_of_lp_position");
    });

    it("get_swap_quote has correct required properties", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "get_swap_quote");
      const required = (tool?.inputSchema as any).required ?? [];
      expect(required).toContain("chainId");
      expect(required).toContain("tokenIn");
      expect(required).toContain("tokenOut");
      expect(required).toContain("side");
      expect(required).toContain("amount");
    });

    it("get_clean_quote requires owner", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "get_clean_quote");
      const required = (tool?.inputSchema as any).required ?? [];
      expect(required).toContain("owner");
    });

    it("zap_into_lp_position requires deposits", async () => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "zap_into_lp_position");
      const required = (tool?.inputSchema as any).required ?? [];
      expect(required).toContain("deposits");
    });
  });

  // ── get_supported_chains ────────────────────────────────────────────────

  describe("get_supported_chains", () => {
    it("returns chains data", async () => {
      const result = await client.callTool({ name: "get_supported_chains", arguments: {} });
      const data = parseTool(result);
      expect(data).toHaveLength(MOCK_CHAINS.length);
      expect(data[0].chainId).toBe(1);
    });

    it("sends X-API-Key header", async () => {
      await client.callTool({ name: "get_supported_chains", arguments: {} });
      const call = findFetchCall(mockFetch, /\/api\/v2\.0\/chains/);
      expect(call).toBeDefined();
      expect(call![1]?.headers).toHaveProperty("X-API-Key", "test-api-key");
    });

    it("calls correct URL path", async () => {
      await client.callTool({ name: "get_supported_chains", arguments: {} });
      const call = findFetchCall(mockFetch, /\/api\/v2\.0\/chains/);
      expect(call![0]).toContain("/api/v2.0/chains");
    });

    it("propagates API errors", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/api\/v2\.0\/chains/,
        handler: () => new Response("Service down", { status: 500 }),
      }]);
      const result = await client.callTool({ name: "get_supported_chains", arguments: {} });
      expect(isToolError(result)).toBe(true);
    });
  });

  // ── check_api_health ────────────────────────────────────────────────────

  describe("check_api_health", () => {
    it("returns health data", async () => {
      const result = await client.callTool({ name: "check_api_health", arguments: {} });
      const data = parseTool(result);
      expect(data.status).toBe("ok");
      expect(data.uptime).toBe(123456);
    });

    it("calls correct URL path", async () => {
      await client.callTool({ name: "check_api_health", arguments: {} });
      const call = findFetchCall(mockFetch, /\/api\/v2\.0\/health/);
      expect(call![0]).toContain("/api/v2.0/health");
    });

    it("propagates API errors", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/api\/v2\.0\/health/,
        handler: () => new Response("timeout", { status: 503 }),
      }]);
      const result = await client.callTool({ name: "check_api_health", arguments: {} });
      expect(isToolError(result)).toBe(true);
    });
  });

  // ── get_supported_dexes ─────────────────────────────────────────────────

  describe("get_supported_dexes", () => {
    it("returns all chains when no chainId", async () => {
      const result = await client.callTool({ name: "get_supported_dexes", arguments: {} });
      const data = parseTool(result);
      expect(data.chains).toHaveLength(MOCK_CHAINS.length);
    });

    it("returns correct protocols for Ethereum (chainId=1)", async () => {
      const result = await client.callTool({ name: "get_supported_dexes", arguments: { chainId: 1 } });
      const data = parseTool(result);
      expect(data.chains).toHaveLength(1);
      const protos = data.chains[0].protocols;
      expect(protos).toContain("uniswap-v3");
      expect(protos).toContain("pancakeswap-v3");
      expect(protos).toContain("uniswap-v4");
      expect(protos).toContain("balancer-v2");
    });

    it("returns correct protocols for BSC (chainId=56)", async () => {
      const result = await client.callTool({ name: "get_supported_dexes", arguments: { chainId: 56 } });
      const data = parseTool(result);
      const protos = data.chains[0].protocols;
      expect(protos).toContain("pancakeswap-v3");
      expect(protos).toContain("thena-algebra");
      expect(protos).toContain("pancakeswap-infinity-cl");
      expect(protos).toContain("pancakeswap-infinity-bin");
      expect(protos).toContain("pancakeswap-v4-cl");
    });

    it("returns aerodrome for Base (chainId=8453)", async () => {
      const result = await client.callTool({ name: "get_supported_dexes", arguments: { chainId: 8453 } });
      const data = parseTool(result);
      expect(data.chains[0].protocols).toContain("aerodrome");
      expect(data.chains[0].protocols).toContain("uniswap-v3");
    });

    it("returns empty protocols for chain without positionConfig", async () => {
      const result = await client.callTool({ name: "get_supported_dexes", arguments: { chainId: 137 } });
      const data = parseTool(result);
      expect(data.chains[0].protocols).toEqual([]);
    });

    it("returns thena for Arbitrum (chainId=42161)", async () => {
      const result = await client.callTool({ name: "get_supported_dexes", arguments: { chainId: 42161 } });
      const data = parseTool(result);
      expect(data.chains[0].protocols).toContain("thena");
    });

    it("errors for unknown chainId", async () => {
      const result = await client.callTool({ name: "get_supported_dexes", arguments: { chainId: 99999 } });
      expect(isToolError(result)).toBe(true);
      expect(errorText(result)).toContain("99999");
    });

    it("returns correct structure with chainName", async () => {
      const result = await client.callTool({ name: "get_supported_dexes", arguments: { chainId: 1 } });
      const data = parseTool(result);
      expect(data.chains[0]).toHaveProperty("chainId", 1);
      expect(data.chains[0]).toHaveProperty("chainName", "Ethereum");
      expect(data.chains[0]).toHaveProperty("protocols");
    });

    it("uses cached chains on second call", async () => {
      await client.callTool({ name: "get_supported_dexes", arguments: {} });
      const count1 = countFetchCalls(mockFetch, /\/api\/v2\.0\/chains/);
      await client.callTool({ name: "get_supported_dexes", arguments: {} });
      const count2 = countFetchCalls(mockFetch, /\/api\/v2\.0\/chains/);
      expect(count2).toBe(count1);
    });
  });

  // ── search_liquidity_pools ──────────────────────────────────────────────

  describe("search_liquidity_pools", () => {
    it("returns pool data", async () => {
      const result = await client.callTool({ name: "search_liquidity_pools", arguments: { chainId: 1 } });
      const data = parseTool(result);
      expect(data).toEqual(MOCK_POOLS);
    });

    it("sends chainId as query param", async () => {
      await client.callTool({ name: "search_liquidity_pools", arguments: { chainId: 1 } });
      const call = findFetchCall(mockFetch, /\/api\/v2\.0\/pools/);
      expect(call![0]).toContain("chainId=1");
    });

    it("sends tokens query param when provided", async () => {
      await client.callTool({ name: "search_liquidity_pools", arguments: { chainId: 1, tokens: "0xA,0xB" } });
      const call = findFetchCall(mockFetch, /\/api\/v2\.0\/pools/);
      expect(call![0]).toContain("tokens=");
    });

    it("sends poolType query param when provided", async () => {
      await client.callTool({ name: "search_liquidity_pools", arguments: { chainId: 1, poolType: "concentrated" } });
      const call = findFetchCall(mockFetch, /\/api\/v2\.0\/pools/);
      expect(call![0]).toContain("poolType=concentrated");
    });

    it("omits optional params when not provided", async () => {
      await client.callTool({ name: "search_liquidity_pools", arguments: { chainId: 1 } });
      const call = findFetchCall(mockFetch, /\/api\/v2\.0\/pools/);
      expect(call![0]).not.toContain("tokens=");
      expect(call![0]).not.toContain("poolType=");
    });

    it("propagates API errors", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/api\/v2\.0\/pools/,
        handler: () => new Response("Bad request", { status: 400 }),
      }]);
      const result = await client.callTool({ name: "search_liquidity_pools", arguments: { chainId: 1 } });
      expect(isToolError(result)).toBe(true);
    });
  });

  // ── list_user_lp_positions ──────────────────────────────────────────────

  describe("list_user_lp_positions", () => {
    it("returns positions for valid chain and owner", async () => {
      const result = await client.callTool({
        name: "list_user_lp_positions",
        arguments: { chainId: 1, owner: "0xOwner" },
      });
      const data = parseTool(result);
      expect(data).toEqual(MOCK_CL_POSITIONS);
    });

    it("errors for unknown chainId", async () => {
      const result = await client.callTool({
        name: "list_user_lp_positions",
        arguments: { chainId: 99999, owner: "0xOwner" },
      });
      expect(isToolError(result)).toBe(true);
      expect(errorText(result)).toContain("99999");
    });

    it("fetches position-pools endpoint", async () => {
      await client.callTool({
        name: "list_user_lp_positions",
        arguments: { chainId: 1, owner: "0xOwner" },
      });
      const call = findFetchCall(mockFetch, /\/position-pools/);
      expect(call).toBeDefined();
    });

    it("downloads positions library", async () => {
      await client.callTool({
        name: "list_user_lp_positions",
        arguments: { chainId: 1, owner: "0xOwner" },
      });
      const call = findFetchCall(mockFetch, /user-positions\.mjs/);
      expect(call).toBeDefined();
    });

    it("caches positions library on subsequent calls", async () => {
      await client.callTool({ name: "list_user_lp_positions", arguments: { chainId: 1, owner: "0xOwner" } });
      const count1 = countFetchCalls(mockFetch, /user-positions\.mjs/);
      await client.callTool({ name: "list_user_lp_positions", arguments: { chainId: 1, owner: "0xOwner" } });
      const count2 = countFetchCalls(mockFetch, /user-positions\.mjs/);
      expect(count2).toBe(count1);
    });

    it("propagates position-pools fetch error", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/api\/position-pools/,
        handler: () => new Response("error", { status: 500 }),
      }]);
      const result = await client.callTool({
        name: "list_user_lp_positions",
        arguments: { chainId: 1, owner: "0xOwner" },
      });
      expect(isToolError(result)).toBe(true);
    });

    it("propagates positions library download failure", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/lib\/user-positions\.mjs/,
        handler: () => new Response("not found", { status: 404 }),
      }]);
      const result = await client.callTool({
        name: "list_user_lp_positions",
        arguments: { chainId: 1, owner: "0xOwner" },
      });
      expect(isToolError(result)).toBe(true);
    });
  });

  // ── get_swap_quote ──────────────────────────────────────────────────────

  describe("get_swap_quote", () => {
    const baseArgs = {
      chainId: 1, tokenIn: "0xWETH", tokenOut: "0xUSDC", side: "exactIn", amount: "1000000000000000000",
    };

    it("returns quote data", async () => {
      const result = await client.callTool({ name: "get_swap_quote", arguments: baseArgs });
      expect(parseTool(result)).toEqual(MOCK_QUOTE);
    });

    it("sends POST to /quote with correct body", async () => {
      await client.callTool({ name: "get_swap_quote", arguments: baseArgs });
      const body = getPostBody(mockFetch, /\/api\/v2\.0\/quote/);
      expect(body.chainId).toBe(1);
      expect(body.tokenIn).toBe("0xWETH");
      expect(body.side).toBe("exactIn");
    });

    it("sends correct headers", async () => {
      await client.callTool({ name: "get_swap_quote", arguments: baseArgs });
      const calls = mockFetch.mock.calls as Array<[any, any]>;
      const call = calls.find((c) => /\/quote/.test(String(c[0])) && c[1]?.method === "POST");
      expect(call![1].headers["X-API-Key"]).toBe("test-api-key");
      expect(call![1].headers["Content-Type"]).toBe("application/json");
    });

    it("includes slippageBps when provided", async () => {
      await client.callTool({ name: "get_swap_quote", arguments: { ...baseArgs, slippageBps: 50 } });
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).slippageBps).toBe(50);
    });

    it("includes affiliateCode when provided", async () => {
      await client.callTool({ name: "get_swap_quote", arguments: { ...baseArgs, affiliateCode: "0xAff" } });
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).affiliateCode).toBe("0xAff");
    });

    it("includes excludePositions when provided", async () => {
      const positions = [{ poolAddress: "0xP", liquidity: "100", tickLower: -100, tickUpper: 100 }];
      await client.callTool({ name: "get_swap_quote", arguments: { ...baseArgs, excludePositions: positions } });
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).excludePositions).toEqual(positions);
    });

    it("handles exactOut side", async () => {
      await client.callTool({ name: "get_swap_quote", arguments: { ...baseArgs, side: "exactOut" } });
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).side).toBe("exactOut");
    });

    it("propagates API errors", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/api\/v2\.0\/quote/, method: "POST",
        handler: () => new Response("Invalid amount", { status: 400 }),
      }]);
      const result = await client.callTool({ name: "get_swap_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(true);
    });

    it("propagates rate limit errors with status code", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/api\/v2\.0\/quote/, method: "POST",
        handler: () => new Response("Too many requests", { status: 429 }),
      }]);
      const result = await client.callTool({ name: "get_swap_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(true);
      expect(errorText(result)).toContain("429");
    });
  });

  // ── get_clean_quote ─────────────────────────────────────────────────────

  describe("get_clean_quote", () => {
    const baseArgs = {
      chainId: 1, owner: "0xOwner", tokenIn: "0xWETH", tokenOut: "0xUSDC",
      side: "exactIn" as const, amount: "1000000000000000000",
    };

    it("populates excludePositions from CL positions", async () => {
      const result = await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(false);
      const body = getPostBody(mockFetch, /\/api\/v2\.0\/quote/);
      expect(body.excludePositions).toHaveLength(2);
      expect(body.excludePositions[0].poolAddress).toBe("0xPool1");
      expect(body.excludePositions[0].liquidity).toBe("1000000000000000000");
      expect(body.excludePositions[0].tickLower).toBe(-887220);
      expect(body.excludePositions[0].tickUpper).toBe(887220);
    });

    it("sends no excludePositions for V2-only positions", async () => {
      _resetForTesting();
      mockFetch = setupFetchMock([{
        pattern: /\/lib\/user-positions\.mjs/,
        handler: () => new Response(makePositionsLibCode(MOCK_V2_POSITIONS), {
          status: 200, headers: { "Content-Type": "application/javascript" },
        }),
      }]);
      const result = await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(false);
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).excludePositions).toBeUndefined();
    });

    it("excludes only CL positions from mixed set", async () => {
      _resetForTesting();
      mockFetch = setupFetchMock([{
        pattern: /\/lib\/user-positions\.mjs/,
        handler: () => new Response(makePositionsLibCode(MOCK_MIXED_POSITIONS), {
          status: 200, headers: { "Content-Type": "application/javascript" },
        }),
      }]);
      const result = await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(false);
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).excludePositions).toHaveLength(2);
    });

    it("sends no excludePositions when zero positions", async () => {
      _resetForTesting();
      mockFetch = setupFetchMock([{
        pattern: /\/lib\/user-positions\.mjs/,
        handler: () => new Response(makePositionsLibCode(MOCK_EMPTY_POSITIONS), {
          status: 200, headers: { "Content-Type": "application/javascript" },
        }),
      }]);
      const result = await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(false);
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).excludePositions).toBeUndefined();
    });

    it("passes slippageBps to quote", async () => {
      await client.callTool({ name: "get_clean_quote", arguments: { ...baseArgs, slippageBps: 200 } });
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).slippageBps).toBe(200);
    });

    it("passes affiliateCode to quote", async () => {
      await client.callTool({ name: "get_clean_quote", arguments: { ...baseArgs, affiliateCode: "0xAff" } });
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).affiliateCode).toBe("0xAff");
    });

    it("omits slippageBps when not provided", async () => {
      await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).slippageBps).toBeUndefined();
    });

    it("errors for unknown chainId", async () => {
      const result = await client.callTool({ name: "get_clean_quote", arguments: { ...baseArgs, chainId: 99999 } });
      expect(isToolError(result)).toBe(true);
      expect(errorText(result)).toContain("99999");
    });

    it("handles null from readAllPositions", async () => {
      _resetForTesting();
      mockFetch = setupFetchMock([{
        pattern: /\/lib\/user-positions\.mjs/,
        handler: () => new Response(
          `export const PUBLIC_RPCS = {};
           export async function readAllPositions() { return null; }`,
          { status: 200, headers: { "Content-Type": "application/javascript" } },
        ),
      }]);
      const result = await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(false);
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).excludePositions).toBeUndefined();
    });

    it("filters positions missing poolAddress", async () => {
      _resetForTesting();
      mockFetch = setupFetchMock([{
        pattern: /\/lib\/user-positions\.mjs/,
        handler: () => new Response(makePositionsLibCode([{ liquidity: "100", tickLower: 0, tickUpper: 1 }] as any), {
          status: 200, headers: { "Content-Type": "application/javascript" },
        }),
      }]);
      const result = await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(false);
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).excludePositions).toBeUndefined();
    });

    it("filters positions missing liquidity", async () => {
      _resetForTesting();
      mockFetch = setupFetchMock([{
        pattern: /\/lib\/user-positions\.mjs/,
        handler: () => new Response(makePositionsLibCode([{ poolAddress: "0xP", tickLower: 0, tickUpper: 1 }] as any), {
          status: 200, headers: { "Content-Type": "application/javascript" },
        }),
      }]);
      const result = await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(false);
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).excludePositions).toBeUndefined();
    });

    it("filters positions missing tickLower", async () => {
      _resetForTesting();
      mockFetch = setupFetchMock([{
        pattern: /\/lib\/user-positions\.mjs/,
        handler: () => new Response(makePositionsLibCode([{ poolAddress: "0xP", liquidity: "100", tickUpper: 1 }] as any), {
          status: 200, headers: { "Content-Type": "application/javascript" },
        }),
      }]);
      const result = await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      expect(isToolError(result)).toBe(false);
      expect(getPostBody(mockFetch, /\/api\/v2\.0\/quote/).excludePositions).toBeUndefined();
    });

    it("verifies POST body structure", async () => {
      await client.callTool({ name: "get_clean_quote", arguments: baseArgs });
      const body = getPostBody(mockFetch, /\/api\/v2\.0\/quote/);
      expect(body.chainId).toBe(1);
      expect(body.tokenIn).toBe("0xWETH");
      expect(body.tokenOut).toBe("0xUSDC");
      expect(body.side).toBe("exactIn");
      expect(body.amount).toBe("1000000000000000000");
    });
  });

  // ── zap_into_lp_position ────────────────────────────────────────────────

  describe("zap_into_lp_position", () => {
    const baseArgs = {
      chainId: 1, poolId: "uniswap-v3:0xPool1",
      deposits: [{ token: "0xWETH", amount: "1000000000000000000" }],
    };

    it("returns liquidity data", async () => {
      const result = await client.callTool({ name: "zap_into_lp_position", arguments: baseArgs });
      expect(parseTool(result)).toEqual(MOCK_ADD_LIQUIDITY);
    });

    it("sends POST to /addliquidity/quote", async () => {
      await client.callTool({ name: "zap_into_lp_position", arguments: baseArgs });
      const body = getPostBody(mockFetch, /\/addliquidity\/quote/);
      expect(body.chainId).toBe(1);
      expect(body.poolId).toBe("uniswap-v3:0xPool1");
      expect(body.deposits).toHaveLength(1);
    });

    it("includes optional params when provided", async () => {
      await client.callTool({
        name: "zap_into_lp_position",
        arguments: { ...baseArgs, sender: "0xSender", tickLower: -100, tickUpper: 100, affiliateCode: "0xAff" },
      });
      const body = getPostBody(mockFetch, /\/addliquidity\/quote/);
      expect(body.sender).toBe("0xSender");
      expect(body.tickLower).toBe(-100);
      expect(body.affiliateCode).toBe("0xAff");
    });

    it("handles multiple deposits", async () => {
      await client.callTool({
        name: "zap_into_lp_position",
        arguments: { ...baseArgs, deposits: [{ token: "0xA", amount: "1" }, { token: "0xB", amount: "2" }] },
      });
      expect(getPostBody(mockFetch, /\/addliquidity\/quote/).deposits).toHaveLength(2);
    });

    it("propagates API errors", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/addliquidity\/quote/, method: "POST",
        handler: () => new Response("Pool not found", { status: 404 }),
      }]);
      const result = await client.callTool({ name: "zap_into_lp_position", arguments: baseArgs });
      expect(isToolError(result)).toBe(true);
    });
  });

  // ── zap_out_of_lp_position ──────────────────────────────────────────────

  describe("zap_out_of_lp_position", () => {
    const baseArgs = { chainId: 1, poolId: "uniswap-v3:0xPool1" };

    it("returns removal data", async () => {
      const result = await client.callTool({ name: "zap_out_of_lp_position", arguments: baseArgs });
      expect(parseTool(result)).toEqual(MOCK_REMOVE_LIQUIDITY);
    });

    it("sends POST to /removeliquidity/quote", async () => {
      await client.callTool({ name: "zap_out_of_lp_position", arguments: baseArgs });
      const body = getPostBody(mockFetch, /\/removeliquidity\/quote/);
      expect(body.chainId).toBe(1);
      expect(body.poolId).toBe("uniswap-v3:0xPool1");
    });

    it("includes tokenId when provided", async () => {
      await client.callTool({ name: "zap_out_of_lp_position", arguments: { ...baseArgs, tokenId: "12345" } });
      expect(getPostBody(mockFetch, /\/removeliquidity\/quote/).tokenId).toBe("12345");
    });

    it("includes withdrawals when provided", async () => {
      await client.callTool({
        name: "zap_out_of_lp_position",
        arguments: { ...baseArgs, withdrawals: [{ token: "0xUSDC" }] },
      });
      expect(getPostBody(mockFetch, /\/removeliquidity\/quote/).withdrawals).toEqual([{ token: "0xUSDC" }]);
    });

    it("includes sender and affiliateCode", async () => {
      await client.callTool({
        name: "zap_out_of_lp_position",
        arguments: { ...baseArgs, sender: "0xOwner", affiliateCode: "0xAff" },
      });
      const body = getPostBody(mockFetch, /\/removeliquidity\/quote/);
      expect(body.sender).toBe("0xOwner");
      expect(body.affiliateCode).toBe("0xAff");
    });

    it("propagates API errors", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/removeliquidity\/quote/, method: "POST",
        handler: () => new Response("error", { status: 500 }),
      }]);
      const result = await client.callTool({ name: "zap_out_of_lp_position", arguments: baseArgs });
      expect(isToolError(result)).toBe(true);
    });
  });

  // ── Cache: getChainsConfig TTL ──────────────────────────────────────────

  describe("getChainsConfig cache", () => {
    it("re-fetches after TTL expires", async () => {
      vi.useFakeTimers();
      _resetForTesting();
      mockFetch = setupFetchMock();

      await client.callTool({ name: "get_supported_dexes", arguments: {} });
      expect(countFetchCalls(mockFetch, /\/api\/v2\.0\/chains/)).toBe(1);

      vi.advanceTimersByTime(299_999);
      await client.callTool({ name: "get_supported_dexes", arguments: {} });
      expect(countFetchCalls(mockFetch, /\/api\/v2\.0\/chains/)).toBe(1);

      vi.advanceTimersByTime(2);
      await client.callTool({ name: "get_supported_dexes", arguments: {} });
      expect(countFetchCalls(mockFetch, /\/api\/v2\.0\/chains/)).toBe(2);

      vi.useRealTimers();
    });

    it("_resetForTesting clears cache", async () => {
      await client.callTool({ name: "get_supported_dexes", arguments: {} });
      const count1 = countFetchCalls(mockFetch, /\/api\/v2\.0\/chains/);
      _resetForTesting();
      await client.callTool({ name: "get_supported_dexes", arguments: {} });
      expect(countFetchCalls(mockFetch, /\/api\/v2\.0\/chains/)).toBe(count1 + 1);
    });
  });

  // ── Error: API error codes ──────────────────────────────────────────────

  describe("API error propagation", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      it(`propagates HTTP ${status}`, async () => {
        mockFetch = setupFetchMock([{
          pattern: /\/api\/v2\.0\/chains/,
          handler: () => new Response(`Error ${status}`, { status }),
        }]);
        const result = await client.callTool({ name: "get_supported_chains", arguments: {} });
        expect(isToolError(result)).toBe(true);
        expect(errorText(result)).toContain(String(status));
      });
    }

    it("includes response body in error message", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/api\/v2\.0\/chains/,
        handler: () => new Response("Invalid chainId parameter", { status: 400 }),
      }]);
      const result = await client.callTool({ name: "get_supported_chains", arguments: {} });
      expect(errorText(result)).toContain("Invalid chainId parameter");
    });

    it("propagates network fetch errors", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/api\/v2\.0\/chains/,
        handler: () => { throw new TypeError("fetch failed"); },
      }]);
      const result = await client.callTool({ name: "get_supported_chains", arguments: {} });
      expect(isToolError(result)).toBe(true);
    });

    it("propagates position-pools error with prefix", async () => {
      mockFetch = setupFetchMock([{
        pattern: /\/api\/position-pools/,
        handler: () => new Response("pool error", { status: 500 }),
      }]);
      const result = await client.callTool({
        name: "list_user_lp_positions", arguments: { chainId: 1, owner: "0xOwner" },
      });
      expect(isToolError(result)).toBe(true);
      expect(errorText(result)).toContain("position-pools");
    });

    it("propagates positions library download failure", async () => {
      _resetForTesting();
      mockFetch = setupFetchMock([{
        pattern: /\/lib\/user-positions\.mjs/,
        handler: () => new Response("not found", { status: 404 }),
      }]);
      const result = await client.callTool({
        name: "list_user_lp_positions", arguments: { chainId: 1, owner: "0xOwner" },
      });
      expect(isToolError(result)).toBe(true);
      expect(errorText(result)).toContain("Failed to download positions library");
    });
  });
});
