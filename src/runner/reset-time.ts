const LIMIT_REGEX = /You've hit your limit · resets (?<reset>.+?)$/;
const TIME_REGEX = /^(\d{1,2})(?::(\d{2}))?(am|pm)\s+\(([^)]+)\)$/i;

// Returns ms such that: local_clock_as_utc - actual_utc = offset
// Positive for timezones ahead of UTC (e.g. UTC+1 → 3600000)
function getTimezoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));

  return localAsUtc - date.getTime();
}

export function parseResetTime(limitMessage: string, now?: Date): Date | null {
  const limitMatch = LIMIT_REGEX.exec(limitMessage);
  if (!limitMatch?.groups?.['reset']) return null;

  const resetStr = limitMatch.groups['reset'].trim();
  const timeMatch = TIME_REGEX.exec(resetStr);
  if (!timeMatch) return null;

  const hourRaw = parseInt(timeMatch[1]!, 10);
  const minutes = timeMatch[2] !== undefined ? parseInt(timeMatch[2], 10) : 0;
  const meridiem = timeMatch[3]!.toLowerCase();
  const timeZone = timeMatch[4]!;

  let hour24 = hourRaw;
  if (meridiem === 'pm' && hourRaw < 12) hour24 = hourRaw + 12;
  if (meridiem === 'am' && hourRaw === 12) hour24 = 0;

  const reference = now ?? new Date();

  let year: number, month: number, day: number;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(reference);
    const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);
    year = get('year');
    month = get('month');
    day = get('day');
  } catch {
    return null;
  }

  let offsetMs: number;
  try {
    offsetMs = getTimezoneOffsetMs(timeZone, reference);
  } catch {
    return null;
  }

  // local_clock_as_utc = Date.UTC(year, month-1, day, hour24, minutes)
  // actual_utc = local_clock_as_utc - offsetMs
  const resetUtc = new Date(Date.UTC(year, month - 1, day, hour24, minutes) - offsetMs);

  if (resetUtc <= reference) {
    return new Date(resetUtc.getTime() + 86_400_000);
  }

  return resetUtc;
}
