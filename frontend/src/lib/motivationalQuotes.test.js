import { MOTIVATIONAL_QUOTES, dailyMotivationalQuote, dateKeyInTimezone } from "./motivationalQuotes";

test("daily motivation stays stable for a local day and rotates on the next day", () => {
  const first = new Date("2026-09-17T12:00:00Z");
  const later = new Date("2026-09-17T22:00:00Z");
  const tomorrow = new Date("2026-09-18T22:00:00Z");

  expect(dateKeyInTimezone("America/Chicago", first)).toBe("2026-09-17");
  expect(dailyMotivationalQuote("America/Chicago", first)).toEqual(
    dailyMotivationalQuote("America/Chicago", later),
  );
  expect(dailyMotivationalQuote("America/Chicago", tomorrow).text).not.toBe(
    dailyMotivationalQuote("America/Chicago", first).text,
  );
  expect(MOTIVATIONAL_QUOTES).toHaveLength(24);
});

test("invalid timezones safely fall back to a UTC date", () => {
  const value = new Date("2026-09-17T23:30:00Z");
  expect(dateKeyInTimezone("Not/A-Timezone", value)).toBe("2026-09-17");
});
