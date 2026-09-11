import { validateRow } from './validate';
import { UNLIMITED_RESERVES } from '../../../src/constants';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const base = { dex: 'd', id: '1', address: A };

describe('validateRow', () => {
  it('accepts plain and directional rows', () => {
    expect(
      validateRow({ ...base, reserves: { [A]: '1', [B]: '0' } }, 'd'),
    ).toBeNull();
    expect(
      validateRow(
        { ...base, reserves: { [`${A}_${B}`]: UNLIMITED_RESERVES } },
        'd',
      ),
    ).toBeNull();
  });

  it('rejects contract violations', () => {
    expect(
      validateRow({ ...base, reserves: { [A]: '1', [B]: '2' } }, 'other'),
    ).toMatch(/dex/);
    expect(
      validateRow(
        { ...base, address: A.toUpperCase(), reserves: { [A]: '1', [B]: '2' } },
        'd',
      ),
    ).toMatch(/address/);
    expect(validateRow({ ...base, reserves: {} }, 'd')).toMatch(/no reserves/);
    expect(validateRow({ ...base, reserves: { [A]: '1' } }, 'd')).toMatch(
      /single plain/,
    );
    expect(
      validateRow({ ...base, reserves: { [A]: '1', [`${A}_${B}`]: '2' } }, 'd'),
    ).toMatch(/mixed/);
    expect(
      validateRow({ ...base, reserves: { [A]: '01', [B]: '2' } }, 'd'),
    ).toMatch(/value/);
    expect(
      validateRow({ ...base, reserves: { [A]: '-1', [B]: '2' } }, 'd'),
    ).toMatch(/value/);
    expect(
      validateRow({ ...base, reserves: { [`${A}_${A}`]: '1' } }, 'd'),
    ).toMatch(/src == dest/);
    expect(
      validateRow({ ...base, reserves: { [`${A}_x`]: '1' } }, 'd'),
    ).toMatch(/key/);
    expect(
      validateRow({ ...base, id: '', reserves: { [A]: '1', [B]: '2' } }, 'd'),
    ).toMatch(/id/);
  });
});
