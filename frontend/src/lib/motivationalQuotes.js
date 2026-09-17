export const MOTIVATIONAL_QUOTES = [
  "One thoughtful application can change the direction of your week.",
  "Progress is built one well-aimed step at a time.",
  "Your next opportunity only needs one strong introduction.",
  "Consistency turns a difficult search into a workable routine.",
  "A small step today keeps momentum on your side.",
  "You do not need every door to open—just the right one.",
  "Each application is practice in recognizing your own value.",
  "Keep the goal small enough to start and meaningful enough to matter.",
  "The work you do today gives tomorrow more options.",
  "A focused application is stronger than a rushed stack of them.",
  "Your experience is growing, even before the offer arrives.",
  "Momentum begins with the application in front of you.",
  "Showing up for your goal is already a form of progress.",
  "A clear next step is more useful than a perfect plan.",
  "Every application makes your search sharper and more intentional.",
  "Keep moving—the right match cannot find a search that stopped.",
  "Today’s effort is building a wider set of possibilities.",
  "The strongest routines leave room for patience and persistence.",
  "Your career grows through repeated, deliberate choices.",
  "One completed application is better than five unfinished intentions.",
  "Make today’s goal a promise you can keep to yourself.",
  "The next yes often follows several useful not-yets.",
  "Small wins make a long search feel possible.",
  "Apply with purpose, then give yourself credit for finishing.",
];

export function dateKeyInTimezone(timezone, value = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

export function dailyMotivationalQuote(timezone, value = new Date()) {
  const dateKey = dateKeyInTimezone(timezone, value);
  const hash = [...dateKey].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 0);
  return { dateKey, text: MOTIVATIONAL_QUOTES[hash % MOTIVATIONAL_QUOTES.length] };
}
