import { MOCK_CL_POSITIONS } from "./positions.js";

export function makePositionsLibCode(positions: any[] = MOCK_CL_POSITIONS): string {
  return `
    export const PUBLIC_RPCS = {
      1: ["https://rpc.ankr.com/eth"],
      56: ["https://rpc.ankr.com/bsc"],
      8453: ["https://rpc.ankr.com/base"],
      137: ["https://rpc.ankr.com/polygon"],
      42161: ["https://rpc.ankr.com/arb"],
    };
    export async function readAllPositions(owner, config, pools) {
      return ${JSON.stringify(positions)};
    }
  `;
}

export const POSITIONS_LIB_CODE = makePositionsLibCode();
