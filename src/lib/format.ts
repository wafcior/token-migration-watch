export function shortenAddress(addr: string, head = 4, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function formatMarketCap(mc: number | null | undefined): string {
  if (mc == null || !isFinite(mc)) return "—";
  if (mc >= 1_000_000_000) return `$${(mc / 1_000_000_000).toFixed(2)}B`;
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
  if (mc >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`;
  return `$${mc.toFixed(0)}`;
}

const plLong = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatPolishWarsaw(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  // Replace the comma Intl puts before time with " ·"
  return plLong.format(d).replace(/,\s*(\d{2}:\d{2})$/, " · $1");
}

export function relativeFromNow(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "—";
  const diff = Date.now() - d;
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s temu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min temu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} godz. temu`;
  const days = Math.floor(h / 24);
  return `${days} dni temu`;
}

/** Next 09:00 or 17:00 in Europe/Warsaw, returned as a Date (UTC instant). */
export function nextWarsawSlot(now: Date = new Date()): Date {
  // Determine current Warsaw H/M.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(fmt.find((p) => p.type === t)?.value);
  const hour = get("hour");
  const minute = get("minute");

  // Determine offset between Warsaw local clock and UTC at this moment, in minutes.
  // Build a UTC date with Warsaw wall-clock fields, then compare to `now`.
  const warsawWall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    minute,
    get("second"),
  );
  const offsetMs = warsawWall - now.getTime(); // Warsaw is ahead of UTC by this much

  let targetHour: number;
  let dayShift = 0;
  if (hour < 9) targetHour = 9;
  else if (hour < 17) targetHour = 17;
  else {
    targetHour = 9;
    dayShift = 1;
  }

  // Construct target instant: Warsaw wall-clock at targetHour:00, then subtract offset to get UTC ms.
  const targetWarsawWall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day") + dayShift,
    targetHour,
    0,
    0,
  );
  return new Date(targetWarsawWall - offsetMs);
}

export function formatCountdown(target: Date, now: Date = new Date()): string {
  let diff = Math.max(0, target.getTime() - now.getTime());
  const h = Math.floor(diff / 3_600_000);
  diff -= h * 3_600_000;
  const m = Math.floor(diff / 60_000);
  diff -= m * 60_000;
  const s = Math.floor(diff / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
