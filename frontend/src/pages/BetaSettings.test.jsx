import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import Login from "./Login";
import Settings from "./Settings";
import { Privacy, Terms } from "./Legal";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() },
  formatApiErrorDetail: (value) => value || "Please try again.",
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", preference: "dark", setPreference: jest.fn() }) }));
jest.mock("@/components/Layout", () => ({ Layout: ({ children }) => <main>{children}</main> }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let container;
let root;
const buttons = () => [...document.querySelectorAll("button")];
const button = (label) => buttons().find((item) => item.textContent.trim() === label);
async function render(component) {
  await act(async () => { root.render(<MemoryRouter>{component}</MemoryRouter>); });
}
async function click(element) { await act(async () => { element.click(); }); }
async function fill(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useAuth.mockReturnValue({ user: { name: "Beta User", email: "beta@example.com", auth_provider: "google" }, setUser: jest.fn(), logout: jest.fn() });
  api.get.mockResolvedValue({ data: { configured: false, connected: false } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("invite-only login hides registration while retaining existing-account sign-in", async () => {
  api.get.mockResolvedValue({ data: { google: true, email_registration: false, invite_only: true } });
  await render(<Login />);
  expect(button("Sign up")).toBeUndefined();
  expect(container.textContent).toContain("New accounts require an invited Google account");
  expect(container.querySelector('a[href^="/api/auth/google/start"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="auth-submit"]')).not.toBeNull();
});

test("failed provider configuration never exposes email signup", async () => {
  api.get.mockRejectedValue(new Error("offline"));
  await render(<Login />);
  expect(button("Sign up")).toBeUndefined();
});

test("local registration remains available when enabled by the server", async () => {
  api.get.mockResolvedValue({ data: { email_registration: true } });
  await render(<Login />);
  await click(button("Sign up"));
  expect(container.querySelector('[data-testid="auth-name"]')).not.toBeNull();
});

test.each([["Privacy Policy", Privacy], ["Terms of Use", Terms]])("legal page renders without authentication: %s", async (title, Page) => {
  useAuth.mockReturnValue({ user: false });
  await render(<Page />);
  expect(container.querySelector("h1").textContent).toBe(title);
});

test("export failure restores the button and explains retry", async () => {
  await render(<Settings />);
  api.get.mockRejectedValueOnce(new Error("storage unavailable"));
  await click(button("Download"));
  expect(api.get).toHaveBeenLastCalledWith("/settings/export", { responseType: "blob" });
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Please try again"));
  expect(button("Download").disabled).toBe(false);
});

test("profile and account preferences save only the authenticated user's values", async () => {
  const updatedUser = { name: "Updated User", email: "beta@example.com", auth_provider: "google", preferences: { theme: "dark", timezone: "America/Chicago" } };
  api.put.mockResolvedValue({ data: updatedUser });
  await render(<Settings />);
  await fill(document.getElementById("settings-name"), " Updated User ");
  await click(button("Save profile"));
  expect(api.put).toHaveBeenCalledWith("/settings/profile", { name: "Updated User" });
  await fill(document.getElementById("settings-timezone"), "America/Chicago");
  await click(button("Save preferences"));
  expect(api.put).toHaveBeenCalledWith("/settings/preferences", { theme: "dark", timezone: "America/Chicago" });
  expect(useAuth().setUser).toHaveBeenCalledWith(updatedUser);
});

test("deletion requires matching email and remains retryable after expired authentication", async () => {
  await render(<Settings />);
  await click(button("Delete account"));
  expect(button("Delete permanently").disabled).toBe(true);
  await fill(document.getElementById("delete-account-email"), "wrong@example.com");
  expect(button("Delete permanently").disabled).toBe(true);
  await fill(document.getElementById("delete-account-email"), "beta@example.com");
  expect(button("Delete permanently").disabled).toBe(false);
  api.delete.mockRejectedValueOnce({ response: { data: { detail: "Sign back in before deleting your account." } } });
  await click(button("Delete permanently"));
  expect(api.delete).toHaveBeenCalledWith("/settings/account", { data: { confirmation_email: "beta@example.com" } });
  expect(document.querySelector('[role="alert"]').textContent).toContain("Sign back in");
  expect(useAuth().setUser).not.toHaveBeenCalled();
  expect(button("Delete permanently").disabled).toBe(false);
});

test("canceling account deletion never calls the API", async () => {
  await render(<Settings />);
  await click(button("Delete account"));
  await click(button("Cancel"));
  expect(api.delete).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
