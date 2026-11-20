export type StepStatus = 'claimed' | 'unlocked' | 'locked';

/**
 * Status of step `index` (0-based). `lastClaimedStep` is the number of steps already claimed
 * (the contract's counter), and `chainTime` is the latest block timestamp, never the browser clock.
 */
export function stepStatus(index: number, unlockTime: number, lastClaimedStep: number, chainTime: number): StepStatus {
  if (index < lastClaimedStep) return 'claimed';
  return unlockTime <= chainTime ? 'unlocked' : 'locked';
}
