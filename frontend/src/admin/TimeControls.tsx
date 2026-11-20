import { useState } from 'react';
import { validateDays } from '../lib/validation';
import { btn, input } from './ui';

export function TimeControls({ disabled, onSkip }: { disabled: boolean; onSkip: (days: number) => void }) {
  const [custom, setCustom] = useState('7');
  const err = validateDays(custom);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">Skip time:</span>
      <button className={btn} disabled={disabled} onClick={() => onSkip(30)}>+30 days</button>
      <button className={btn} disabled={disabled} onClick={() => onSkip(1)}>+1 day</button>
      <input aria-label="Custom days" className={`${input} w-20`} disabled={disabled} value={custom} onChange={(e) => setCustom(e.target.value)} />
      <button className={btn} disabled={disabled || !!err} onClick={() => onSkip(Number(custom))}>+N days</button>
      {err && custom !== '' && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
