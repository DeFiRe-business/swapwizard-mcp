#!/usr/bin/env node

process.env.MCP_HTTP = "1";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createServer } from "./index.js";

const PORT = parseInt(process.env.MCP_PORT ?? "3902", 10);

const app = createMcpExpressApp({ host: "0.0.0.0" });

app.post("/mcp", async (req, res) => {
  const apiKey = (req.headers["x-api-key"] as string | undefined)
    ?? (req.query?.apikey as string | undefined);
  if (!apiKey) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Missing API key. Pass via X-API-Key header or ?apikey= query parameter." },
      id: null,
    });
    return;
  }

  const server = createServer(apiKey);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
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
