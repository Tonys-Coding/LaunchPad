import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AppRouter } from "./App";
import { useAuth } from "@/context/AuthContext";

jest.mock("@/context/AuthContext", () => ({ AuthProvider: ({ children }) => children, useAuth: jest.fn() }));
jest.mock("@/context/ThemeContext", () => ({ ThemeProvider: ({ children }) => children, useTheme: () => ({ theme: "dark" }) }));
jest.mock("@/pages/Login", () => () => <h1>Login page</h1>);
jest.mock("@/pages/Dashboard", () => () => <h1>Dashboard page</h1>);
jest.mock("@/pages/Applications", () => () => <h1>Applications page</h1>);
jest.mock("@/pages/Board", () => () => <h1>Board page</h1>);
jest.mock("@/pages/Calendar", () => () => <h1>Calendar page</h1>);
jest.mock("@/pages/Library", () => () => <h1>Library page</h1>);
jest.mock("@/pages/ResumeStudio", () => () => <h1>Resume Studio page</h1>);
jest.mock("@/pages/Settings", () => () => <h1>Settings page</h1>);
jest.mock("@/pages/Legal", () => ({ Privacy: () => <h1>Privacy page</h1>, Terms: () => <h1>Terms page</h1> }));
jest.mock("sonner", () => ({ Toaster: () => null }));

let container;
let root;
async function show(path) {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><AppRouter /></MemoryRouter>);
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("protected pages redirect signed-out visitors to login", async () => {
  useAuth.mockReturnValue({ user: false, loading: false });
  await show("/applications");
  expect(container.textContent).toContain("Login page");
  expect(container.textContent).not.toContain("Applications page");
});

test("login redirects an authenticated user to the dashboard", async () => {
  useAuth.mockReturnValue({ user: { user_id: "user-1" }, loading: false });
  await show("/login");
  expect(container.textContent).toContain("Dashboard page");
});

test("authentication checks never flash protected content", async () => {
  useAuth.mockReturnValue({ user: null, loading: true });
  await show("/calendar");
  expect(container.textContent).not.toContain("Calendar page");
  expect(container.querySelector("svg")).not.toBeNull();
});

test("public legal pages remain available without an account", async () => {
  useAuth.mockReturnValue({ user: false, loading: false });
  await show("/privacy");
  expect(container.textContent).toContain("Privacy page");
});

test("authenticated users can open Resume Studio", async () => {
  useAuth.mockReturnValue({ user: { user_id: "user-1" }, loading: false });
  await show("/resumes");
  expect(container.textContent).toContain("Resume Studio page");
});
