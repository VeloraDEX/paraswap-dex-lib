import { corruptHexTail } from '../utils';

// TEST-ONLY helper backing GetDexParamOptions.forceRfqRevert (staging fallback
// campaign). Guards the byte-layout invariants every RFQ getDexParam relies on
// when corrupting a maker signature.
describe('corruptHexTail (forceRfqRevert)', () => {
  const sig = '0x' + 'ab'.repeat(65); // canonical 65-byte ECDSA signature

  it('preserves length and 0x prefix', () => {
    const c = corruptHexTail(sig, 1);
    expect(c.length).toBe(sig.length);
    expect(c.startsWith('0x')).toBe(true);
  });

  it('actually changes the bytes', () => {
    expect(corruptHexTail(sig, 1)).not.toBe(sig);
  });

  it('corrupts a 32-byte window ending offsetFromEnd bytes from the end', () => {
    const c = corruptHexTail(sig, 1).slice(2);
    const raw = sig.slice(2);
    // last byte (the offset) is untouched
    expect(c.slice(-2)).toBe(raw.slice(-2));
    // the 32 bytes before it differ
    expect(c.slice(-66, -2)).not.toBe(raw.slice(-66, -2));
    // everything before the window is untouched
    expect(c.slice(0, -66)).toBe(raw.slice(0, -66));
  });

  it('inversion is deterministic and non-identity per nibble', () => {
    // 0xa -> 0x5, 0xb -> 0x4: no nibble maps to itself, so any signed window
    // is guaranteed to change.
    const c = corruptHexTail('0x' + 'ab'.repeat(32), 0).slice(2);
    expect(c).toBe('54'.repeat(32));
  });

  it('handles offsetFromEnd = 0 (corrupt the final 32 bytes)', () => {
    const c = corruptHexTail(sig, 0);
    expect(c.length).toBe(sig.length);
    expect(c.slice(-64)).not.toBe(sig.slice(-64));
  });
});
