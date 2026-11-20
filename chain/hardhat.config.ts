import { HardhatUserConfig } from "hardhat/config";

// Local node only: chainId 31337, default 20 accounts, empty on every restart.
const config: HardhatUserConfig = {
  networks: { hardhat: { chainId: 31337 } },
};

export default config;
