import { vi } from "vitest";
import { MOCK_CHAINS } from "../fixtures/chains.js";
import { MOCK_QUOTE, MOCK_HEALTH, MOCK_POOLS, MOCK_ADD_LIQUIDITY, MOCK_REMOVE_LIQUIDITY } from "../fixtures/quotes.js";
import { POSITIONS_LIB_CODE } from "../fixtures/positionsLib.js";

export interface MockRoute {
  pattern: RegExp | string;
  method?: "GET" | "POST";
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

const defaultRoutes: MockRoute[] = [
  {
    pattern: /\/api\/v2\.0\/chains/,
    handler: () => Response.json(MOCK_CHAINS),
  },
  {
    pattern: /\/api\/v2\.0\/health/,
    handler: () => Response.json(MOCK_HEALTH),
  },
  {
    pattern: /\/api\/v2\.0\/pools/,
    handler: () => Response.json(MOCK_POOLS),
  },
  {
    pattern: /\/api\/v2\.0\/addliquidity\/quote/,
    method: "POST",
    handler: () => Response.json(MOCK_ADD_LIQUIDITY),
  },
  {
    pattern: /\/api\/v2\.0\/removeliquidity\/quote/,
    method: "POST",
    handler: () => Response.json(MOCK_REMOVE_LIQUIDITY),
  },
  {
    pattern: /\/api\/v2\.0\/quote/,
    method: "POST",
    handler: () => Response.json(MOCK_QUOTE),
  },
  {
    pattern: /\/lib\/user-positions\.mjs/,
    handler: () =>
      new Response(POSITIONS_LIB_CODE, {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      }),
  },
  {
    pattern: /\/api\/v2\.0\/position-pools/,
    handler: () => Response.json({ pools: [] }),
  },
];

export function setupFetchMock(overrides?: MockRoute[]) {
  const routes = [...(overrides ?? []), ...defaultRoutes];

  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    for (const route of routes) {
      const matchesPattern =
        typeof route.pattern === "string"
          ? url.includes(route.pattern)
          : route.pattern.test(url);
      const matchesMethod = !route.method || route.method === method;

      if (matchesPattern && matchesMethod) {
        return route.handler(url, init);
      }
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

export function getPostBody(mockFetch: ReturnType<typeof setupFetchMock>, urlPattern: RegExp): any {
  const calls = mockFetch.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>;
  const call = calls.find(
    (c) => urlPattern.test(String(c[0])) && c[1]?.method === "POST",
  );
  return call ? JSON.parse(call[1]!.body as string) : undefined;
}

export function countFetchCalls(mockFetch: ReturnType<typeof setupFetchMock>, urlPattern: RegExp): number {
  const calls = mockFetch.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>;
  return calls.filter((c) => urlPattern.test(String(c[0]))).length;
}

export function findFetchCall(mockFetch: ReturnType<typeof setupFetchMock>, urlPattern: RegExp): [string, RequestInit | undefined] | undefined {
  const calls = mockFetch.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>;
  const call = calls.find((c) => urlPattern.test(String(c[0])));
  return call ? [String(call[0]), call[1]] : undefined;
}
