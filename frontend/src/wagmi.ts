import { http, createConfig } from 'wagmi';
import { defineChain } from 'viem';
import { injected } from 'wagmi/connectors';

export const hardhatLocal = defineChain({
  id: 31337,
  name: 'Hardhat Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
});

export const wagmiConfig = createConfig({
  chains: [hardhatLocal],
  connectors: [injected()],
  transports: { [hardhatLocal.id]: http() },
  pollingInterval: 1_000, // local chain: pick up new blocks (e.g. an admin time skip) within a second
});
