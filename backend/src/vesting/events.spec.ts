import { EventFragment, getAddress, id } from 'ethers';
import { vestingIface } from './artifacts';
import { blockChunks, decodeLog } from './events';

const ADDR = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';

describe('blockChunks', () => {
  it('splits into inclusive windows of at most 10 000 blocks', () => {
    expect(blockChunks(0, 25_000)).toEqual([
      [0, 9_999],
      [10_000, 19_999],
      [20_000, 25_000],
    ]);
  });
  it('a single block, and an empty range', () => {
    expect(blockChunks(5, 5)).toEqual([[5, 5]]);
    expect(blockChunks(6, 5)).toEqual([]);
  });
});

describe('decodeLog', () => {
  const events: EventFragment[] = [];
  vestingIface.forEachEvent((e) => events.push(e));

  it('the vault ABI has every event the UI shows', () => {
    expect(events.map((e) => e.name).sort()).toEqual(
      [
        'Claimed',
        'EmergencyWithdrawn',
        'OwnershipTransferStarted',
        'OwnershipTransferred',
        'Paused',
        'StakeholderAdded',
        'StakeholderRemoved',
        'StakeholderReplaced',
        'TokenUpdated',
        'Unpaused',
      ].sort(),
    );
  });

  it.each(events.map((e) => [e.name, e] as const))('%s: addresses checksummed, steps as numbers, amounts formatted', (_n, ev) => {
    const values = ev.inputs.map((i) => (i.type === 'address' ? ADDR : /step/i.test(i.name) ? 3n : 5n * 10n ** 18n));
    const log = vestingIface.encodeEventLog(ev, values);
    const out = decodeLog(vestingIface, log)!;
    expect(out.name).toBe(ev.name);
    for (const i of ev.inputs) {
      const expected = i.type === 'address' ? getAddress(ADDR) : /step/i.test(i.name) ? 3 : '5.0';
      expect(out.args[i.name]).toBe(expected);
    }
  });

  it('a log the ABI does not know is skipped (null), not thrown', () => {
    expect(decodeLog(vestingIface, { topics: [id('Transfer(address,address,uint256)')], data: '0x' })).toBeNull();
    expect(decodeLog(vestingIface, { topics: [], data: '0x' })).toBeNull();
  });

  it('a known topic with malformed data is skipped too', () => {
    const topic = vestingIface.getEvent('EmergencyWithdrawn')!.topicHash;
    expect(decodeLog(vestingIface, { topics: [topic], data: '0x1234' })).toBeNull();
  });
});
