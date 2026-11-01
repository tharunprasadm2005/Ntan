export function parseSerialNumbers(input: string): string[] {
  const seen = new Set<string>();
  const serials: string[] = [];
  for (const raw of input.split(/[\n,;]+/)) {
    const value = raw.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      serials.push(value);
    }
  }
  return serials;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
