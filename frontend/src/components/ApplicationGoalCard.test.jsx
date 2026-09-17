import { act } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationGoalCard } from "./ApplicationGoalCard";

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { user_id: "user_goal_test", preferences: { timezone: "America/Chicago" } } }),
}));

let container;
let root;
const baseGoal = {
  configured: true,
  cadence: "daily",
  target: 2,
  timezone: "America/Chicago",
  period_start: "2026-09-17",
  period_end: "2026-09-17",
  count: 1,
  remaining: 1,
  complete: false,
  progress_percent: 50,
  days_remaining: 0,
};
const callbacks = {
  onRetry: jest.fn(),
  onSave: jest.fn(),
  onRemove: jest.fn(),
  onAddApplication: jest.fn(),
};

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("shows a daily quote and celebrates when progress crosses the target", async () => {
  await act(async () => root.render(
    <ApplicationGoalCard goal={baseGoal} loading={false} error={false} {...callbacks} />,
  ));
  expect(document.querySelector('[data-testid="application-goal-quote"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="application-goal-celebration"]')).toBeNull();

  await act(async () => root.render(
    <ApplicationGoalCard
      goal={{ ...baseGoal, count: 2, remaining: 0, complete: true, progress_percent: 100 }}
      loading={false}
      error={false}
      {...callbacks}
    />,
  ));

  const celebration = document.querySelector('[data-testid="application-goal-celebration"]');
  expect(celebration).not.toBeNull();
  expect(celebration.textContent).toContain("You reached your daily application goal!");
  expect(window.localStorage.getItem("launchpad-goal-celebrated:user_goal_test:daily:2026-09-17:2")).toBe("1");
});
