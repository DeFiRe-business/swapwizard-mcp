#!/usr/bin/env node

process.env.MCP_HTTP = "1";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createServer } from "./index.js";

const PORT = parseInt(process.env.MCP_PORT ?? "3902", 10);
const SLACK_WEBHOOK_URL = process.env.SLACK_MCP_WEBHOOK_URL ?? "";
const SLACK_CLIENT_BLACKLIST = new Set(
  (process.env.SLACK_MCP_CLIENT_BLACKLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0),
);

const app = createMcpExpressApp({ host: "0.0.0.0" });

const AUTH_FREE_METHODS = new Set(["initialize", "notifications/initialized", "tools/list"]);
const AUTH_FREE_TOOLS = new Set(["get_setup_guide"]);

function maskApiKey(key: string | undefined): string {
  if (!key) return "(none)";
  if (key.length <= 8) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

async function notifyInitializeToSlack(req: { headers: Record<string, unknown>; ip?: string }, body: any, apiKey: string | undefined): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    console.error("[slack] SLACK_MCP_WEBHOOK_URL no configurado — no se envía notificación de initialize");
    return;
  }
  const params = body?.params ?? {};
  const clientInfo = params.clientInfo ?? {};
  const clientName = String(clientInfo.name ?? "").toLowerCase();
  if (SLACK_CLIENT_BLACKLIST.has(clientName)) {
    console.log(`[slack] initialize de '${clientName}' omitido (en SLACK_MCP_CLIENT_BLACKLIST)`);
    return;
  }
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  const userAgent = (req.headers["user-agent"] as string | undefined) ?? "unknown";

  const lines = [
    `:electric_plug: *MCP initialize*`,
    `*Client:* ${clientInfo.name ?? "unknown"} v${clientInfo.version ?? "?"}`,
    `*Protocol:* ${params.protocolVersion ?? "unknown"}`,
    `*IP:* \`${ip}\``,
    `*User-Agent:* ${userAgent}`,
    `*API key:* \`${maskApiKey(apiKey)}\``,
    `*Capabilities:* \`\`\`${JSON.stringify(params.capabilities ?? {})}\`\`\``,
  ];

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });
  if (!res.ok) {
    console.error(`[slack] Error ${res.status}: ${await res.text()}`);
  }
}

app.post("/mcp", async (req, res) => {
  const body = req.body;
  const method = body?.method as string | undefined;
  const toolName = method === "tools/call" ? (body?.params?.name as string | undefined) : undefined;
  const isAuthFree = (method != null && AUTH_FREE_METHODS.has(method))
    || (toolName != null && AUTH_FREE_TOOLS.has(toolName));

  const apiKey = (req.headers["x-api-key"] as string | undefined)
    ?? (req.query?.apikey as string | undefined);

  if (method === "initialize") {
    notifyInitializeToSlack(req as any, body, apiKey).catch((err) => {
      console.error("[slack] Fallo enviando notificación de initialize:", err instanceof Error ? err.message : err);
    });
  }

  if (!apiKey && !isAuthFree) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Missing API key. Pass via X-API-Key header or ?apikey= query parameter." },
      id: body?.id ?? null,
    });
    return;
  }

  const server = createServer(apiKey ?? "");
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
  res.on("close", () => {
    transport.close();
    server.close();
  });
});

app.get("/mcp", (_req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  }));
});

app.delete("/mcp", (_req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  }));
});

app.listen(PORT, () => {
  console.log(`SwapWizard MCP HTTP server listening on port ${PORT}`);
});

process.on("SIGINT", () => {
  process.exit(0);
});
