import { useState } from 'react';
import type { AddStakeholderInput } from '../lib/api';
import { validateAddForm, type AddForm } from '../lib/validation';
import { btn, input } from './ui';

const DEFAULTS: AddForm = {
  user: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Hardhat account #1
  totalAmount: '1200',
  steps: '12',
  intervalDays: '30',
  firstUnlockInDays: '30',
};

const FIELDS: { key: keyof AddForm; label: string; width: string }[] = [
  { key: 'user', label: 'User', width: 'w-96' },
  { key: 'totalAmount', label: 'Total', width: 'w-28' },
  { key: 'steps', label: 'Steps', width: 'w-16' },
  { key: 'intervalDays', label: 'Interval (days)', width: 'w-20' },
  { key: 'firstUnlockInDays', label: 'First unlock in (days)', width: 'w-20' },
];

export function AddStakeholderForm({ disabled, onAdd }: { disabled: boolean; onAdd: (input: AddStakeholderInput) => void }) {
  const [form, setForm] = useState<AddForm>(DEFAULTS);
  const { errors, input: valid } = validateAddForm(form);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onAdd(valid);
      }}
    >
      {FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col text-xs">
          {f.label}
          <input
            aria-label={f.label}
            className={`${input} ${f.width} font-mono ${errors[f.key] ? 'border-red-400' : ''}`}
            disabled={disabled}
            value={form[f.key]}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
          />
          <span className="h-4 text-red-600">{errors[f.key] ?? ''}</span>
        </label>
      ))}
      <button type="submit" className={`${btn} mb-4`} disabled={disabled || !valid}>Add stakeholder</button>
    </form>
  );
}
