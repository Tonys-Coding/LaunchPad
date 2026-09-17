import { localCalendarDate } from "./dates";

test("formats the browser's calendar date instead of deriving it from UTC", () => {
  const browserLocalValue = {
    getFullYear: () => 2026,
    getMonth: () => 8,
    getDate: () => 17,
  };
  expect(localCalendarDate(browserLocalValue)).toBe("2026-09-17");
});
