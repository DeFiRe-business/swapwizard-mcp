export const MOCK_CL_POSITIONS = [
  {
    poolAddress: "0xPool1",
    liquidity: "1000000000000000000",
    tickLower: -887220,
    tickUpper: 887220,
    tokenId: "12345",
    dexName: "uniswap-v3",
  },
  {
    poolAddress: "0xPool2",
    liquidity: "500000000000000000",
    tickLower: -100,
    tickUpper: 100,
    tokenId: "12346",
    dexName: "pancakeswap-v3",
  },
];

export const MOCK_V2_POSITIONS = [
  {
    poolAddress: "0xV2Pool1",
    liquidity: "2000000000000000000",
    dexName: "sushiswap-v2",
  },
];

export const MOCK_MIXED_POSITIONS = [...MOCK_CL_POSITIONS, ...MOCK_V2_POSITIONS];

export const MOCK_EMPTY_POSITIONS: any[] = [];
