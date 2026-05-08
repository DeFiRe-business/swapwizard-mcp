<p align="center">
  <a href="https://swapwizard.xyz">
    <img src="./logo.png" alt="SwapWizard" width="200" />
  </a>
</p>

# SwapWizard MCP Server

Model Context Protocol (MCP) server for the [SwapWizard](https://swapwizard.xyz) DeFi API. Enables AI agents to get swap quotes, manage liquidity, and discover pools across multiple EVM chains.

## Quick Start

### 1. Get an API Key

Go to [SwapWizard API Docs](https://swapwizard.xyz/api-docs), connect your wallet, and sign to get your API key.

### 2. Configure your AI client

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "swapwizard": {
      "command": "npx",
      "args": ["-y", "@swapwizard/mcp-server"],
      "env": {
        "SWAPWIZARD_API_URL": "https://swapwizard.xyz",
        "SWAPWIZARD_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "swapwizard": {
      "command": "npx",
      "args": ["-y", "@swapwizard/mcp-server"],
      "env": {
        "SWAPWIZARD_API_URL": "https://swapwizard.xyz",
        "SWAPWIZARD_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Claude Code

```bash
claude mcp add swapwizard -- npx -y @swapwizard/mcp-server
```

Then set environment variables `SWAPWIZARD_API_URL` and `SWAPWIZARD_API_KEY`.

## Available Tools

| Tool | Description |
|------|-------------|
| `swapwizard_chains` | List all available blockchain networks |
| `swapwizard_health` | API health check and uptime |
| `swapwizard_pools` | Search pools by chain, tokens, and type |
| `swapwizard_positions` | List liquidity positions for a wallet |
| `swapwizard_quote` | Get best swap quote with pre-encoded callData |
| `swapwizard_add_liquidity` | Quote add-liquidity with automatic zap |
| `swapwizard_remove_liquidity` | Quote remove-liquidity for a position |

## Tools Detail

### swapwizard_chains

List all blockchain networks available on SwapWizard.

```
No parameters required.
```

### swapwizard_pools

Search liquidity pools.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | number | Yes | EVM chain ID (e.g. 56 for BSC) |
| `tokens` | string | No | Comma-separated token addresses |
| `poolType` | string | No | `"classic"` or `"concentrated"` |

### swapwizard_positions

List liquidity positions owned by a wallet.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | number | Yes | EVM chain ID |
| `owner` | string | Yes | Wallet address |

### swapwizard_quote

Get the best swap quote across all DEXes. The response includes `router`, `callData`, and `value` ready for `eth_sendTransaction`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | number | Yes | EVM chain ID |
| `tokenIn` | string | Yes | Input token address (`0x0000...0000` for native) |
| `tokenOut` | string | Yes | Output token address |
| `side` | string | Yes | `"exactIn"` or `"exactOut"` |
| `amount` | string | Yes | Amount as uint256 string in token decimals |
| `slippageBps` | number | No | Slippage in basis points (default: 100 = 1%) |
| `affiliateCode` | string | No | Registered affiliate wallet |
| `excludePositions` | array | No | Positions to subtract from pool state (see below) |

#### excludePositions

Simulate swap prices **as if your liquidity positions had been removed**. Useful for rebalancing bots that need to know the real price after withdrawing their own liquidity.

Each position object:

| Field | Type | Description |
|-------|------|-------------|
| `poolAddress` | string | Pool contract address |
| `liquidity` | string | Position liquidity as uint256 string |
| `tickLower` | number | Lower tick bound |
| `tickUpper` | number | Upper tick bound |

Get these values from `swapwizard_positions`.

### swapwizard_add_liquidity

Quote an add-liquidity operation with automatic zap.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | number | Yes | EVM chain ID |
| `poolId` | string | Yes | Pool ID from `swapwizard_pools` |
| `deposits` | array | Yes | `[{ token, amount }]` — tokens and amounts to deposit |
| `sender` | string | No | Wallet address for simulation |
| `tickLower` | number | No | Custom lower tick (concentrated) |
| `tickUpper` | number | No | Custom upper tick (concentrated) |
| `affiliateCode` | string | No | Registered affiliate wallet |

### swapwizard_remove_liquidity

Quote a remove-liquidity operation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | number | Yes | EVM chain ID |
| `poolId` | string | Yes | Pool ID from `swapwizard_pools` |
| `tokenId` | string | No | NFT token ID (concentrated positions) |
| `withdrawals` | array | No | `[{ token }]` — tokens to receive |
| `sender` | string | No | Position owner wallet |
| `affiliateCode` | string | No | Registered affiliate wallet |

## Example Agent Flow

### Swap

1. `swapwizard_chains` → find available chains
2. `swapwizard_quote` → get best route + callData
3. User signs and sends the transaction to `router` with `callData` and `value`

### Add Liquidity

1. `swapwizard_chains` → find available chains
2. `swapwizard_pools` → find target pool (filter by tokens)
3. `swapwizard_add_liquidity` → get router + callData
4. User approves tokens and sends the transaction

### Remove Liquidity

1. `swapwizard_positions` → list wallet positions
2. `swapwizard_remove_liquidity` → get router + callData
3. User approves (NFT or LP token) and sends the transaction

### Strategic Rebalancing (with excludePositions)

1. `swapwizard_positions` → get current positions
2. `swapwizard_quote` with `excludePositions` → simulate price after removing your liquidity
3. Compare prices across pools to decide the optimal move
4. Execute remove → swap → add in sequence

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SWAPWIZARD_API_URL` | No | `https://swapwizard.xyz` | Base URL of the SwapWizard API |
| `SWAPWIZARD_API_KEY` | Yes | — | API key from wallet authentication |

## Rate Limits

The public API is rate-limited to **60 requests per minute** per API key.

## Development

```bash
npm install
npm run dev
```

## License

MIT
