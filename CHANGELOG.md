# Changelog

All notable changes to `@swapwizard/mcp-server` are documented here.

## [1.8.4] - 2026-06-11

### Added
- **`timeframe` parameter** in `search_liquidity_pools` — selects the trending ranking window (`5m`, `1h`, `6h`, `24h`) when `trending: true`. Optional; defaults to the API's window (5m). Sent to the API as `trendingDuration`.

### Improved
- **Affiliate documentation** — the four quote tools (`get_swap_quote`, `get_clean_quote`, `zap_into_lp_position`, `zap_out_of_lp_position`) now document the optional `affiliateCode` parameter (affiliate wallet address registered on-chain, forwarded to the API so the fee is paid to that address) in both the tool descriptions and the parameter docs.

## [1.8.1] - 2026-06-09

### Improved
- **`search_liquidity_pools` description** — key parameters (`trending`, `sortBy`, `sortOrder`, `topPerVenue`) now called out explicitly in the tool description so agents discover them without inspecting the schema.

## [1.8.0] - 2026-06-09

### Added
- **Forced guide injection** — if an agent calls any tool without having called `get_setup_guide` first, the full setup guide is automatically prepended to the first tool response. Ensures every agent receives configuration and usage instructions regardless of whether it proactively reads the guide.

### Removed
- Test suite (outdated and unmaintained).

## [1.7.1] - 2026-06-09

### Improved
- **MCP instructions & get_setup_guide** — added security recommendation to store API keys, private keys, and RPC URLs in environment variables (`SWAPWIZARD_API_KEY`, `WALLET_PRIVATE_KEY`, `ALCHEMY_RPC_URL`) instead of hardcoding them.

## [1.7.0] - 2026-06-09

### Added
- **`get_setup_guide` tool** — returns the complete setup and usage guide (API key, Alchemy RPC, private key, poolId rules, flows, tx execution, approvals). Call this first before using any other tool.

### Improved
- **Tool descriptions reinforced** — `search_liquidity_pools` now explicitly states the poolId rule (pass as-is, do not construct). `zap_into_lp_position` clarifies deposits accept ANY token. `zap_out_of_lp_position` clarifies withdrawals accept ANY output token. All quote tools now mention that sending the tx requires a private key or wallet signer.
- Tool count: 11 (was 10).

## [1.6.2] - 2026-06-09

### Improved
- **MCP instructions** — added `streamable-http` transport type guidance for `.mcp.json` configuration. Clarified that zap in accepts any input token and zap out accepts any output token (SwapWizard handles all intermediate swaps automatically).

## [1.6.1] - 2026-06-09

### Added
- **MCP `instructions`** — operational guide sent to the agent on connection: setup requirements (API key, Alchemy RPC URL, private key/signer), poolId rule, step-by-step flows (swap, zap in, zap out, analyze), transaction execution details, and approval rules.

### Changed
- `description` in server metadata trimmed to a one-liner. All operational guidance moved to `instructions` (MCP protocol field).

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
