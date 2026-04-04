if (typeof BigInt !== 'undefined') {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    get() {
      return () => this.toString();
    },
  });
}
