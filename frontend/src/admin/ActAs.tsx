import type { Account } from '../lib/api';
import { shortAddr } from '../lib/format';
import { input } from './ui';

/** "owner", "pending owner", "stakeholder" (or nothing) for one account. */
export function roleLabel(a: Account): string {
  return [a.isOwner && 'owner', a.isPendingOwner && 'pending owner', a.isStakeholder && 'stakeholder'].filter(Boolean).join(', ');
}

/** Which Hardhat account signs every admin write (sent as `as`). */
export function ActAs({
  accounts,
  value,
  disabled,
  onChange,
}: {
  accounts: Account[];
  value: number;
  disabled: boolean;
  onChange: (index: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      Act as
      <select aria-label="Act as" className={`${input} font-mono`} disabled={disabled} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {(accounts.length ? accounts : [{ index: 0 } as Account]).map((a) => (
          <option key={a.index} value={a.index}>
            #{a.index}
            {a.address ? ` ${shortAddr(a.address)}` : ''}
            {a.address && roleLabel(a) ? ` (${roleLabel(a)})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
