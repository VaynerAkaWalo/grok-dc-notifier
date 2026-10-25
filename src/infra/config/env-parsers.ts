const millisecondsPerUnit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

type DurationUnit = keyof typeof millisecondsPerUnit;

const durationPattern = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/;

export function parseDuration(value: string): number | undefined {
  const match = durationPattern.exec(value.trim());

  if (!match?.[1]) {
    return undefined;
  }

  const unit = (match[2] ?? "ms") as DurationUnit;
  const ms = Number(match[1]) * millisecondsPerUnit[unit];

  return ms > 0 ? ms : undefined;
}

export function parseIdList(value: string | undefined): Set<string> {
  const ids = (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return new Set(ids);
}
