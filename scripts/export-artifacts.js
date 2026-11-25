#!/usr/bin/env node
// Copy { contractName, abi, bytecode } of every compiled contract in chain/artifacts into shared/artifacts/<Name>.json,
// the one place the backend and frontend read from. Run by `npm run compile` after `hardhat compile`.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'chain', 'artifacts', 'contracts');
const OUT = path.join(ROOT, 'shared', 'artifacts');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.json') && !e.name.endsWith('.dbg.json') ? [p] : [];
  });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const names = [];
for (const file of walk(SRC)) {
  const { contractName, abi, bytecode } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (names.includes(contractName)) throw new Error(`Two contracts are named ${contractName}; rename one`);
  names.push(contractName);
  fs.writeFileSync(path.join(OUT, `${contractName}.json`), JSON.stringify({ contractName, abi, bytecode }, null, 2) + '\n');
}
console.log(`Exported ${names.sort().join(', ')} to shared/artifacts`);
