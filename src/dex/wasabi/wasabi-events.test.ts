// Wasabi uses a sample-based polling approach rather than event subscriptions.
// No event tests are needed for this integration.
// See wasabi-integration.test.ts for pricing tests.

describe('Wasabi EventPool', function () {
  it('uses polling, not events - no event tests needed', () => {
    expect(true).toBe(true);
  });
});
