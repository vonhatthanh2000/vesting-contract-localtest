import { assertLocalRpc } from './config';

describe('assertLocalRpc', () => {
  it.each(['http://127.0.0.1:8545', 'http://localhost:8545', 'ws://localhost:8546'])('accepts %s', (u) => {
    expect(() => assertLocalRpc(u)).not.toThrow();
  });
  it.each(['https://bsc-dataseed.binance.org', 'http://10.0.0.5:8545', 'http://localhost.evil.com', 'not a url'])('refuses %s', (u) => {
    expect(() => assertLocalRpc(u)).toThrow();
  });
});
