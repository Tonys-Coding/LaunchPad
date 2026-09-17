import { act } from "react";
import { createRoot } from "react-dom/client";
import { useRefreshOnReturn } from "./useRefreshOnReturn";

function Harness({ refresh }) {
  useRefreshOnReturn(refresh, 30000);
  return null;
}

let container;
let root;

beforeEach(() => {
  jest.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.useRealTimers();
});

test("refreshes external data when the dashboard regains focus and while it remains open", async () => {
  const refresh = jest.fn();
  await act(async () => root.render(<Harness refresh={refresh} />));

  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(refresh).toHaveBeenCalledTimes(1);

  await act(async () => jest.advanceTimersByTime(30000));
  expect(refresh).toHaveBeenCalledTimes(2);
});
