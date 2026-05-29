# Contributing to SwapWizard MCP Server

Thanks for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- Node.js 20+
- npm 10+
- A SwapWizard API key ([get one here](https://swapwizard.xyz/integrators))

## Setup

```bash
git clone https://github.com/DeFiRe-business/swapwizard-mcp.git
cd swapwizard-mcp
npm install
cp .env.example .env   # add your SWAPWIZARD_API_KEY
npm run dev
```

## Development

```bash
npm run dev          # run with tsx (hot reload)
npm run build        # compile TypeScript
npm test             # run tests
npm run test:watch   # tests in watch mode
```

## Project Structure

```
src/
  index.ts          # MCP server factory, tool definitions, API helpers
  http-server.ts    # HTTP/streamable-http transport wrapper
```

The server is built as a factory function `createServer(apiKey)` that registers all tools on an `McpServer` instance. Two transports are supported: stdio (default, for local MCP clients) and streamable-http (for remote hosting).

## Adding a New Tool

1. Add the tool inside `createServer()` using `server.tool(name, description, schema, handler)`
2. Use `safeApiCall()` to wrap the handler — this ensures errors are always returned as parseable JSON
3. Use Zod schemas for input validation (the MCP SDK validates before the handler runs)
4. Update the tool count in `README.md`, `llms.txt`, and the AI agents page if applicable

## Code Style

- TypeScript strict mode
- No comments unless the *why* is non-obvious
- Prefer explicit over clever
- All API errors must be JSON-parseable (use `safeApiCall`)

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new tool for token approval checks
fix: correct poolId prefix parsing for Uniswap V3
docs: update tool descriptions in README
```

## Pull Requests

1. Fork and create a feature branch from `main`
2. Keep changes focused — one fix or feature per PR
3. Ensure `npm run build` and `npm test` pass
4. Describe what changed and why in the PR body

## Reporting Issues

Open an issue on [GitHub](https://github.com/DeFiRe-business/swapwizard-mcp/issues) with:

- What you expected vs. what happened
- The tool name and parameters you used
- Any error messages (MCP response or API response)

## Security

If you find a security vulnerability, **do not** open a public issue. Email [contact@swapwizard.xyz](mailto:contact@swapwizard.xyz) instead.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
