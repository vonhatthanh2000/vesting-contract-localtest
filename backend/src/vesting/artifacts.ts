import * as fs from 'fs';
import * as path from 'path';
import { Interface, InterfaceAbi } from 'ethers';

// shared/artifacts sits outside backend/, so read at runtime (works from src/ under ts-jest and dist/ after build).
const ARTIFACTS = path.resolve(__dirname, '..', '..', '..', 'shared', 'artifacts');
type Artifact = { abi: InterfaceAbi; bytecode: string };
const load = (name: string): Artifact => JSON.parse(fs.readFileSync(path.join(ARTIFACTS, `${name}.json`), 'utf8'));

export const MultiVestingArtifact = load('MultiVesting');
export const MockUSDTArtifact = load('MockUSDT');
export const vestingIface = new Interface(MultiVestingArtifact.abi);
export const tokenIface = new Interface(MockUSDTArtifact.abi);
