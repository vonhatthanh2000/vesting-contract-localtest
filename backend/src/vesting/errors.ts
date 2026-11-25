import { HttpException } from '@nestjs/common';
import { Interface } from 'ethers';

export const notDeployed = () => new HttpException({ error: 'NotDeployed' }, 409);
export const noCode = () => new HttpException({ error: 'NoCode' }, 400);
export const noNextUnlock = () => new HttpException({ error: 'NoNextUnlock' }, 400);
export const timeInPast = () => new HttpException({ error: 'TimeInPast' }, 400);
export const badRequest = (message: string) => new HttpException({ error: 'BadRequest', message }, 400);

/** Map a contract revert to 400 { error: <CustomErrorName> }; rethrow anything else unchanged. */
export function toHttpError(e: any, ifaces: Interface[]): unknown {
  if (e instanceof HttpException) return e;
  if (e?.revert?.name) return new HttpException({ error: e.revert.name }, 400);
  const data: unknown = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === 'string' && data.length >= 10) {
    for (const iface of ifaces) {
      const parsed = iface.parseError(data);
      if (parsed) return new HttpException({ error: parsed.name }, 400);
    }
  }
  return e;
}
