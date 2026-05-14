export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortObjectKeys(value), undefined, 2)}\n`;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const child = value[key];

      if (child !== undefined) {
        acc[key] = sortObjectKeys(child);
      }

      return acc;
    }, {});
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
