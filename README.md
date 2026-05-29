<p align="center">
  <a href="https://swapwizard.xyz">
    <img src="./logo.png" alt="SwapWizard" width="200" />
  </a>
</p>

# SwapWizard MCP Server

[![npm](https://img.shields.io/npm/v/@swapwizard/mcp-server)](https://www.npmjs.com/package/@swapwizard/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Model Context Protocol (MCP) server for the [SwapWizard](https://swapwizard.xyz) DeFi API. Enables AI agents to get swap quotes, manage liquidity, and discover pools across 5 EVM chains.

**Non-custodial**: every tool returns `router`, `callData`, and `value` — the agent presents the transaction, the user signs with their own wallet. SwapWizard never holds keys.

## Quick Start

### 1. Get an API Key

Go to [swapwizard.xyz/integrators](https://swapwizard.xyz/integrators), connect your wallet, and sign a message (no gas cost).

### 2. Connect via MCP

#### Remote (no install)

```
URL: https://mcp.swapwizard.xyz/mcp
Transport: streamable-http
Header: X-API-Key: your-api-key
```

#### Local — Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "swapwizard": {
      "command": "npx",
      "args": ["-y", "@swapwizard/mcp-server"],
      "env": {
        "SWAPWIZARD_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Local — Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "swapwizard": {
      "command": "npx",
      "args": ["-y", "@swapwizard/mcp-server"],
      "env": {
        "SWAPWIZARD_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Local — Claude Code

```bash
claude mcp add swapwizard -e SWAPWIZARD_API_KEY=your-api-key -- npx -y @swapwizard/mcp-server
```

## Available Tools

| Tool | Description |
|------|-------------|
| `get_supported_chains` | List supported EVM chains with IDs, gas tokens, DEX list, and position config |
| `get_supported_dexes` | AMMs/DEX sources SwapWizard routes across per chain |
| `check_api_health` | API availability check |
| `search_liquidity_pools` | Discover pools by chain, tokens, type. Returns poolId, symbol, fee tier, protocol, APY, TVL, 24h volume |
| `list_user_lp_positions` | Full LP position details: value, fees, APR, in-range status, impermanent loss |
| `get_swap_quote` | Best swap route across all DEXes. Returns router + callData + value ready to sign |
| `get_clean_quote` | Swap quote excluding the caller's own LP position from pool state (for rebalancing) |
| `zap_into_lp_position` | Single-tx entry into any LP position from any token |
| `zap_out_of_lp_position` | Single-tx exit from any LP position into any token. Pass `sender` to auto-detect nftManager |

## Execution Model

Tools that return `router`, `callData`, `value` are executed by the user:

1. If the input token is not native, approve the router to spend the token amount (ERC-20 approve)
2. Send a transaction: `to: router`, `data: callData`, `value: value`

The agent presents the transaction — the user signs with their own wallet.

## Agent Flows

### Swap

1. `get_supported_chains` — find available chains
2. `get_swap_quote` — get best route + callData
3. User approves (if non-native) and signs the transaction

### Add Liquidity

1. `search_liquidity_pools` — find target pool by tokens
2. `zap_into_lp_position` — get router + callData
3. User approves and signs the transaction

### Remove Liquidity

1. `list_user_lp_positions` — get current positions
2. `zap_out_of_lp_position` — get router + callData (pass `sender` for auto-detection)
3. User signs the transaction

### Rebalance (with clean quote)

1. `list_user_lp_positions` — get position details
2. `get_clean_quote` — price excluding own liquidity
3. `zap_out_of_lp_position` — exit current position
4. `zap_into_lp_position` — enter new position

## Real-World Example

This is not a testnet demo. The following transaction was executed end-to-end by an AI agent using this MCP server on BNB Chain mainnet:

### Agent exits a WLFI/USDC Uniswap V3 position into USDC

**On-chain proof**: [`0xede1afbc...c16f16c`](https://bscscan.com/tx/0xede1afbc9c4a4eee23ca8b784e6c63335322cf4216da275a8670e3f06c16f16c) — Block 101133314, May 29 2026

The agent called `zap_out_of_lp_position` to exit a concentrated liquidity position on BNB Chain. SwapWizard's router handled the full operation atomically:

1. Burned the NFT position, receiving WLFI + USDC
2. Swapped WLFI → USDC via the best available route
3. Delivered **4.92 USDC** to the user's wallet in a single transaction

```
Tool:     zap_out_of_lp_position
Chain:    BNB Chain (56)
Pool:     WLFI / USDC — Uniswap V3
Router:   0xc664F80dff9655766398E86A6B95AF76660FA66d
Method:   removeLiquidityMulti
Gas used: 411,002
Result:   4.92 USDC received
```

The agent requested the quote, the user approved the NFT and signed — no manual parameter tuning, no contract interaction, no slippage calculation. The MCP server auto-detected `nftManager`, `dexName`, and `liquidityKind` from the `sender` address.

### PoC Bot Demos

Full end-to-end demonstrations of an autonomous agent using SwapWizard MCP to discover pools, enter positions, monitor, and exit — all through natural language:

#### English

https://github.com/DeFiRe-business/swapwizard-mcp/raw/main/demos/poc-demo-en.mp4

#### Español

https://github.com/DeFiRe-business/swapwizard-mcp/raw/main/demos/poc-demo-es.mp4

## Supported Chains

Ethereum (1), Arbitrum (42161), Base (8453), Polygon (137), BNB Chain (56)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SWAPWIZARD_API_KEY` | Yes | — | API key from [swapwizard.xyz/integrators](https://swapwizard.xyz/integrators) |
| `SWAPWIZARD_API_URL` | No | `https://api.swapwizard.xyz` | API base URL |

## Affiliate Integration

Earn fees by embedding SwapWizard in your site:

```html
<div data-swapwizard="swap" data-affiliate="0xYourAddress" data-theme="dark"></div>
<script src="https://swapwizard.xyz/widget.js" async></script>
```

Widget modes: `swap`, `pools`, or `full`. Configure at [swapwizard.xyz/developers](https://swapwizard.xyz/developers).

## Rate Limits

60 requests per minute per API key.

## Development

```bash
npm install
npm run dev          # run with tsx (hot reload)
npm run build        # compile TypeScript
npm test             # run tests
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Links

- [Website](https://swapwizard.xyz)
- [API Docs](https://swapwizard.xyz/api-docs)
- [AI Agent Docs](https://swapwizard.xyz/ai-agents)
- [npm](https://www.npmjs.com/package/@swapwizard/mcp-server)
- [Widget Configurator](https://swapwizard.xyz/developers)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
