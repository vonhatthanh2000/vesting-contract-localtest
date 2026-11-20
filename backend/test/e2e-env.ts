import * as os from 'os';
import * as path from 'path';

// The e2e spec starts its own Hardhat node on 8546, so it never touches `npm run chain` (8545)
// or the real backend/deployment.json. Set before config.ts is imported.
export const E2E_PORT = 8546;
process.env.RPC_URL = `http://127.0.0.1:${E2E_PORT}`;
process.env.DEPLOYMENT_FILE = path.join(os.tmpdir(), `vesting-e2e-deployment-${process.pid}.json`);
