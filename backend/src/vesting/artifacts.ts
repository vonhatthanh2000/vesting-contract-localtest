import * as fs from 'fs';
import * as path from 'path';
import { Interface, InterfaceAbi } from 'ethers';

// shared/artifacts (written by `npm run compile`) sits outside backend/, so read at runtime (works from src/ under ts-jest and dist/ after build).
const ARTIFACTS = path.resolve(__dirname, '..', '..', '..', 'shared', 'artifacts');
type Artifact = { abi: InterfaceAbi; bytecode: string };
const load = (name: string): Artifact => JSON.parse(fs.readFileSync(path.join(ARTIFACTS, `${name}.json`), 'utf8'));

export const FamilyVestingArtifact = load('FamilyVesting');
export const MockUSDTArtifact = load('MockUSDT');
export const vestingIface = new Interface(FamilyVestingArtifact.abi);
export const tokenIface = new Interface(MockUSDTArtifact.abi);
