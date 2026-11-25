/** Start/stop a throwaway `hardhat node` on E2E_PORT for an e2e spec (the specs run in band, one chain at a time). */
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import { E2E_PORT } from './e2e-env';

const CHAIN_DIR = path.resolve(__dirname, '..', '..', 'chain');
const HARDHAT = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', 'hardhat');

let chain: ChildProcess | undefined;

export function startChain(): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(HARDHAT, ['node', '--port', String(E2E_PORT)], { cwd: CHAIN_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    chain = p;
    const timer = setTimeout(() => reject(new Error('hardhat node did not start in 30s')), 30_000);
    p.stdout!.on('data', (b: Buffer) => {
      if (b.toString().includes('Started HTTP')) {
        clearTimeout(timer);
        resolve();
      }
    });
    p.on('exit', (code) => code && reject(new Error(`hardhat node exited with ${code}`)));
  });
}

export function stopChain(): Promise<void> {
  return new Promise((resolve) => {
    if (!chain || chain.exitCode !== null) return resolve();
    chain.once('exit', () => resolve());
    chain.kill('SIGTERM');
  });
}
