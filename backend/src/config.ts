import 'dotenv/config';

// Public Hardhat keys and a local chain only. Never point this at a public RPC.
export const config = {
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  ownerKey: process.env.OWNER_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  port: Number(process.env.PORT ?? 3001),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  deploymentFile: process.env.DEPLOYMENT_FILE, // default resolved in DeploymentStore
};

export function assertLocalRpc(rpcUrl: string): void {
  let host: string;
  try {
    host = new URL(rpcUrl).hostname;
  } catch {
    throw new Error(`RPC_URL is not a valid URL: ${rpcUrl}`);
  }
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`Refusing to start: RPC_URL must be localhost or 127.0.0.1 (got ${host}). This testbed signs with public Hardhat keys.`);
  }
}
