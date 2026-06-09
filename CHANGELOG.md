# Changelog

All notable changes to `@swapwizard/mcp-server` are documented here.

## [1.6.0] - 2026-06-09

### Added
- **`analyze_pool` tool** — returns real-time momentum data for a pool from GeckoTerminal: multi-timeframe volume (5m–6h), price changes (5m–24h), buy/sell counts, unique traders, and reserve in USD. Maps to `GET /pools/analyze/:id`.
- **`trending` filter** in `search_liquidity_pools` — pass `trending: true` to return only pools currently trending on GeckoTerminal.

### Changed
- `search_liquidity_pools` response now includes a numeric `id` field for each pool, used as input to `analyze_pool`.
- Tool count: 10 (was 9).

## [1.1.7] - 2026-05-30

### Fixed
- **dexName resolution for PancakeSwap pools** — `pcs-` prefixed poolIds (used by pancakeswap-v3, pancakeswap-amm, pancakeswap-infinity-cl) were not matched by `POOL_PREFIX_TO_PROJECT`. Added API fallback: when no prefix matches, queries `/pools` to get the `project` field from the pool data.

## [1.1.6] - 2026-05-30

### Fixed
- **nftManager resolution for non-V3 protocols** — Strategy 1 now resolves nftManager from chain config for Uniswap V4 (`v4PositionManager`), PancakeSwap Infinity CL (`pcsInfinityCLPositionManager`), and Algebra-based DEXes like Camelot, THENA, QuickSwap (`algebraNftManager`). Previously only searched `v3NftManagers`.
- **Classic pool zap_out no longer requires positionId** — for V2, Balancer, Curve, and AMM pools where positions are LP tokens (not NFTs), `poolId` + `sender` is now sufficient. The API resolves the LP token automatically.
- **poolId now forwarded to API** — `zap_out_of_lp_position` was not passing `poolId` in the payload to `/removeliquidity/quote`, preventing server-side auto-detection of dexName and nftManager.

## [1.1.5] - 2026-05-29

### Fixed
- **nftManager auto-detection** — three bugs prevented it from working:
  - `fetchPositionPools` used wrong URL path (`/api/position-pools` instead of `/position-pools`)
  - `fetchPositionPools` did not send `X-API-Key` header (endpoint requires auth)
  - poolId prefix parsing looked for `:` but real poolIds use hyphens (`uni-gql-v3-56-0x...`)
- **JSON-parseable errors** — all tool handlers now return `{"error": "..."}` via `safeApiCall` wrapper instead of plain text exceptions
- **`tokenId` alias** — `zap_out_of_lp_position` accepts both `positionId` and `tokenId` to prevent schema validation errors

### Added
- `POOL_PREFIX_TO_PROJECT` mapping covering all pool ID formats (uni-gql-v3, sg-sushiswap-v3, sushi, thena, aero, curve, etc.)
- Two-strategy nftManager resolution: (1) from poolId prefix + chain config, (2) from on-chain user positions when `sender` is provided

### Changed
- Tool descriptions updated to guide agents to always pass `sender` for auto-detection

## [1.1.2] - 2026-05-29

### Fixed
- `zap_out_of_lp_position` param mapping: renamed `tokenId` to `positionId` to match API
- Added `nftManager`, `dexName`, `liquidityKind`, `percent` params to zap out tool
- Auto-detect `dexName` from `poolId` prefix and `nftManager` from chain config

### Changed
- `search_liquidity_pools` description updated to reflect APY, TVL, and 24h volume fields

## [1.1.0] - 2026-05-28

### Added
- Remote HTTP server (`dist/http-server.js`) with streamable-http transport
- Per-request API key extraction from `X-API-Key` header or `?apikey=` query param
- `get_clean_quote` tool for pricing swaps excluding the caller's own LP positions
- `get_supported_dexes` tool for listing DEX protocols per chain

### Changed
- Functional tool descriptions with execution model guidance
- Default API URL changed to `https://api.swapwizard.xyz`

## [1.0.0] - 2026-05-27

### Added
- MCP server with stdio transport
- `createServer(apiKey)` factory pattern
- Tools: `get_swap_quote`, `search_liquidity_pools`, `list_user_lp_positions`, `zap_into_lp_position`, `zap_out_of_lp_position`, `get_supported_chains`, `check_api_health`
- Client-side position reading via dynamically loaded `user-positions.mjs` library
- Affiliate integration support via `affiliateCode` parameter
