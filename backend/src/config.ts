import 'dotenv/config';

// Local chain only: writes are signed by the Hardhat node's unlocked accounts. Never point this at a public RPC.
export const config = {
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  port: Number(process.env.PORT ?? 3001),
  // Comma-separated list of frontend origins allowed by CORS.
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:30141,https://thanh-30141.motcaigido.xyz')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  deploymentFile: process.env.DEPLOYMENT_FILE, // default backend/deployment.json (resolved in VestingService)
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
