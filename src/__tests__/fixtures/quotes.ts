export const MOCK_QUOTE = {
  chainId: 1,
  tokenIn: "0xWETH",
  tokenOut: "0xUSDC",
  amountIn: "1000000000000000000",
  amountOut: "3500000000",
  priceImpact: "0.05",
  route: [{ protocol: "uniswap-v3", pool: "0xPool1" }],
  tx: {
    to: "0xRouter",
    data: "0xcalldata",
    value: "0",
    gasEstimate: "150000",
  },
};

export const MOCK_HEALTH = {
  status: "ok",
  uptime: 123456,
  version: "2.0.0",
};

export const MOCK_POOLS = [
  {
    poolId: "uniswap-v3:0xPool1",
    token0: { symbol: "WETH", address: "0xWETH" },
    token1: { symbol: "USDC", address: "0xUSDC" },
    fee: 3000,
    poolType: "concentrated",
  },
];

export const MOCK_ADD_LIQUIDITY = {
  router: "0xLiqRouter",
  callData: "0xaddliq",
  value: "0",
};

export const MOCK_REMOVE_LIQUIDITY = {
  router: "0xLiqRouter",
  callData: "0xremliq",
  value: "0",
};
