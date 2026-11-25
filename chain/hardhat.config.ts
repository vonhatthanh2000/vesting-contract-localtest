import { HardhatUserConfig } from "hardhat/config";

// Local node only: chainId 31337, default 20 accounts, empty on every restart.
// Sources live in ../contracts. `npm run compile` builds them and exports ABI + bytecode to ../shared/artifacts.
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris", // BSC-compatible (no PUSH0)
    },
  },
  // Root is the repo so ../contracts counts as local; build output stays in chain/.
  paths: { root: "..", sources: "contracts", cache: "chain/cache", artifacts: "chain/artifacts" },
  networks: { hardhat: { chainId: 31337 } },
};

export default config;
