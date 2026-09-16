import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

jest.mock("@/context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("@/context/ThemeContext", () => ({ useTheme: jest.fn() }));
jest.mock("@/lib/api", () => ({ __esModule: true, default: { put: jest.fn().mockResolvedValue({ data: {} }) } }));
jest.mock("@/components/Avatar", () => ({ Avatar: () => <span>Avatar</span> }));

let container;
let root;
async function click(element) { await act(async () => { element.click(); }); }

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useAuth.mockReturnValue({ user: { name: "Beta User", email: "beta@example.com", preferences: { timezone: "UTC" } }, setUser: jest.fn(), logout: jest.fn() });
  useTheme.mockReturnValue({ theme: "dark", toggle: jest.fn() });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("mobile navigation identifies its controls, focuses close, and closes with Escape", async () => {
  await act(async () => { root.render(<MemoryRouter><Layout title="Settings"><p>Page</p></Layout></MemoryRouter>); });
  const open = container.querySelector('[data-testid="mobile-menu-open"]');
  expect(open.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('[data-testid="topbar-add-application"]')).toBeNull();
  await click(open);
  const drawer = document.querySelector('[role="dialog"][aria-label="Navigation menu"]');
  const close = document.querySelector('[aria-label="Close navigation menu"]');
  expect(drawer).not.toBeNull();
  expect(document.activeElement).toBe(close);
  expect(container.querySelector('button[aria-label="Switch to light mode"]')).not.toBeNull();
  expect(container.querySelector('button[aria-label="Log out"]')).not.toBeNull();
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(document.querySelector('[role="dialog"][aria-label="Navigation menu"]')).toBeNull();
});
