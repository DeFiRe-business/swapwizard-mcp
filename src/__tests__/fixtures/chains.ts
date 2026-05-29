export const MOCK_CHAINS = [
  {
    chainId: 1,
    name: "Ethereum",
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    positionConfig: {
      v3NftManagers: [
        { address: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", dexName: "uniswap-v3", dexKind: "uniswapV3" },
        { address: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364", dexName: "pancakeswap-v3", dexKind: "uniswapV3", factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" },
      ],
      v4PositionManager: "0xV4POSITION",
      v4StateView: "0xV4STATE",
      balancerV2Vault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    },
  },
  {
    chainId: 56,
    name: "BNB Chain",
    weth: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    positionConfig: {
      v3NftManagers: [
        { address: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613", dexName: "pancakeswap-v3", dexKind: "uniswapV3" },
      ],
      algebraNftManager: "0xALGEBRA_NFT",
      algebraFactory: "0xALGEBRA_FACTORY",
      algebraDexName: "thena-algebra",
      pcsInfinityCLPositionManager: "0xPCS_INF_CL",
      pcsInfinityBinPositionManager: "0xPCS_INF_BIN",
      v4ClPoolManager: "0xV4_CL_POOL",
    },
  },
  {
    chainId: 8453,
    name: "Base",
    weth: "0x4200000000000000000000000000000000000006",
    positionConfig: {
      v3NftManagers: [
        { address: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1", dexName: "uniswap-v3", dexKind: "uniswapV3" },
      ],
      aerodromeSugar: "0xAERO_SUGAR",
    },
  },
  {
    chainId: 137,
    name: "Polygon",
    weth: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
  },
  {
    chainId: 42161,
    name: "Arbitrum",
    weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    positionConfig: {
      v3NftManagers: [],
      thenaPairApi: "https://api.thena.fi/pairs",
    },
  },
];
