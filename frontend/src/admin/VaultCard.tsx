import { useState } from 'react';
import { api, type Deployment, type VaultBalance } from '../lib/api';
import { shortAddr } from '../lib/format';
import { validateAmount } from '../lib/validation';
import { btn, card, input } from './ui';

type Act = (label: string, fn: () => Promise<unknown>) => void;

/**
 * Vault controls: pause state, fund (any mock token), emergency withdraw, deploy a mock token, setToken, and the
 * vault's balance per mock token. Writes other than fund/deploy are signed by the Act-as account.
 */
export function VaultCard({
  deployment,
  balances,
  actAs,
  disabled,
  onAct,
}: {
  deployment: Deployment | null;
  balances: VaultBalance[];
  actAs: number;
  disabled: boolean;
  onAct: Act;
}) {
  const [fundAmount, setFundAmount] = useState('1200');
  const [fundToken, setFundToken] = useState(''); // '' = the vault's current token
  const [to, setTo] = useState('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  const [amount, setAmount] = useState('1200');
  const [newToken, setNewToken] = useState('');
  const fundErr = validateAmount(fundAmount);
  const tokens = deployment?.mockTokens ?? [];

  return (
    <section className={`${card} space-y-3 text-sm`}>
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Vault</h2>
        {deployment && (
          <span className={`rounded px-2 py-0.5 text-xs ${deployment.paused ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
            {deployment.paused ? 'Paused' : 'Active'}
          </span>
        )}
        <button
          type="button"
          className={btn}
          disabled={disabled}
          onClick={() =>
            deployment?.paused
              ? onAct(`Unpaused as #${actAs}`, () => api.unpause(actAs))
              : onAct(`Paused as #${actAs}`, () => api.pause(actAs))
          }
        >
          {deployment?.paused ? 'Unpause' : 'Pause'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Fund amount" className={`${input} w-28`} disabled={disabled} value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
        <select aria-label="Fund token" className={`${input} font-mono`} disabled={disabled} value={fundToken} onChange={(e) => setFundToken(e.target.value)}>
          <option value="">current token</option>
          {tokens.map((t) => (
            <option key={t} value={t}>{shortAddr(t)}</option>
          ))}
        </select>
        <button type="button" className={btn} disabled={disabled || !!fundErr} onClick={() => onAct(`Funded ${fundAmount}`, () => api.fund(fundAmount, fundToken || undefined))}>
          Fund
        </button>
        {fundErr && fundAmount !== '' && <span className="text-xs text-red-600">{fundErr}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span>Emergency withdraw</span>
        <input aria-label="Withdraw to" className={`${input} w-96 font-mono`} disabled={disabled} value={to} onChange={(e) => setTo(e.target.value)} />
        <input aria-label="Withdraw amount" className={`${input} w-28`} disabled={disabled} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="button" className={btn} disabled={disabled} onClick={() => onAct(`Withdrew ${amount} as #${actAs}`, () => api.emergencyWithdraw(to.trim(), amount.trim(), actAs))}>
          Withdraw
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} disabled={disabled} onClick={() => onAct('Deployed a mock token', api.deployMockToken)}>
          Deploy mock token
        </button>
        <input
          aria-label="New token"
          list="mock-tokens"
          placeholder="token address"
          className={`${input} w-96 font-mono`}
          disabled={disabled}
          value={newToken}
          onChange={(e) => setNewToken(e.target.value)}
        />
        <datalist id="mock-tokens">
          {tokens.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <button type="button" className={btn} disabled={disabled || !newToken.trim()} onClick={() => onAct(`Set token as #${actAs}`, () => api.setToken(newToken.trim(), actAs))}>
          Set token
        </button>
      </div>

      <table className="text-left text-xs">
        <thead>
          <tr>
            <th className="pr-4">Token</th>
            <th className="pr-4">Vault balance</th>
            <th />
          </tr>
        </thead>
        <tbody aria-label="Vault balances">
          {balances.map((b) => (
            <tr key={b.token} className="font-mono">
              <td className="pr-4" title={b.token}>{shortAddr(b.token)}</td>
              <td className="pr-4">{b.vaultBalance}</td>
              <td className="font-sans">
                {b.current ? <span className="text-green-700">current</span> : b.vaultBalance !== '0.0' ? <span className="text-amber-700">stranded</span> : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
