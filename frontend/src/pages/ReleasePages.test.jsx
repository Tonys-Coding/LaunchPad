import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import Applications, { applicationImportPreview } from "./Applications";
import CalendarPage from "./Calendar";
import Board from "./Board";
import Library from "./Library";
import api from "@/lib/api";

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() },
  formatApiErrorDetail: (value) => value || "Please try again.",
}));
jest.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ theme: "dark" }) }));
jest.mock("@/components/Layout", () => ({ Layout: ({ children, title }) => <main aria-label={title}>{children}</main> }));
jest.mock("@/components/CompanyLogo", () => ({ CompanyLogo: ({ name }) => <span>{name} logo</span> }));
jest.mock("@/components/ApplicationForm", () => ({
  ApplicationForm: ({ open, onSubmit }) => open ? <button data-testid="mock-application-save" onClick={() => onSubmit({ company_name: "New Co", job_title: "Analyst", day_applied: "2026-09-15" })}>Save application</button> : null,
}));
jest.mock("@/components/ApplicationDetail", () => ({
  ApplicationDetail: ({ open, app }) => open ? <section data-testid="mock-application-detail">{app?.job_title}</section> : null,
}));
jest.mock("@/components/EventForm", () => ({ EventForm: ({ open }) => open ? <section data-testid="mock-event-form">Event form</section> : null }));
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogDescription: ({ children }) => <p>{children}</p>,
  DialogFooter: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
}));
jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }) => open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }) => <div>{children}</div>,
  AlertDialogCancel: ({ children, ...props }) => <button {...props}>{children}</button>,
  AlertDialogAction: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock("@/components/ui/accordion", () => ({
  Accordion: ({ children }) => <div>{children}</div>,
  AccordionItem: ({ children }) => <div>{children}</div>,
  AccordionTrigger: ({ children }) => <button>{children}</button>,
  AccordionContent: ({ children }) => <div>{children}</div>,
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const app = {
  app_id: "app-1", company_name: "Acme", job_title: "Engineer", day_applied: "2026-09-15",
  status: "Applied", start_date_tbd: true, pay_amount: null,
};

let container;
let root;
const buttons = () => [...document.querySelectorAll("button")];
const button = (label) => buttons().find((item) => item.textContent.trim() === label);
const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
async function render(component) {
  await act(async () => { root.render(<MemoryRouter>{component}</MemoryRouter>); });
  await flush();
}
async function click(element) { await act(async () => { element.click(); }); await flush(); }

beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.put.mockResolvedValue({ data: {} });
  api.post.mockResolvedValue({ data: { created: 1 } });
  api.delete.mockResolvedValue({ data: {} });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("application CSV validation accepts supported rows and explains skipped rows", () => {
  const preview = applicationImportPreview([
    "company_name,job_title,day_applied,status,pay_amount,pay_period,confidence_level",
    "Acme,Engineer,2026-09-15,Applied,25,hourly,High",
    "Bad Date,Role,09/15/2026,Applied,,,",
  ].join("\n"));
  expect(preview.items).toHaveLength(1);
  expect(preview.items[0]).toMatchObject({ company_name: "Acme", pay_amount: 25, pay_period: "hourly" });
  expect(preview.skipped).toEqual([{ row: 3, reason: "day_applied must use YYYY-MM-DD" }]);
});

test("applications show a retry state, recover, and open a card from the keyboard", async () => {
  api.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: [app] });
  await render(<Applications />);
  expect(container.querySelector('[data-testid="applications-load-error"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="applications-empty"]')).toBeNull();
  await click(button("Try again"));
  const card = container.querySelector('[data-testid="application-card-app-1"]');
  expect(card.getAttribute("tabindex")).toBe("0");
  await act(async () => { card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(container.querySelector('[data-testid="mock-application-detail"]').textContent).toBe("Engineer");
  expect(container.querySelector('[data-testid="filter-all"]').getAttribute("aria-pressed")).toBe("true");
});

test("application creation posts the draft and refreshes the list", async () => {
  api.get.mockResolvedValue({ data: [app] });
  await render(<Applications />);
  await click(container.querySelector('[data-testid="applications-add-button"]'));
  await click(container.querySelector('[data-testid="mock-application-save"]'));
  expect(api.post).toHaveBeenCalledWith("/applications", expect.objectContaining({ company_name: "New Co" }));
  expect(api.get).toHaveBeenCalledTimes(2);
});

test("calendar isolates integration failure and exposes keyboard-safe day and event actions", async () => {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const item = { id: "event:event-1", event_id: "event-1", source: "event", title: "Career Fair", category: "Career Fair", all_day: true, start_date: date, end_date: date, icon: "calendar-check" };
  api.get.mockImplementation((url) => {
    if (url === "/calendar/items") return Promise.resolve({ data: [item] });
    if (url === "/integrations/google-calendar") return Promise.reject(new Error("integration unavailable"));
    return Promise.resolve({ data: [] });
  });
  await render(<CalendarPage />);
  expect(container.querySelector('[data-testid="calendar-load-error"]')).toBeNull();
  expect(container.querySelector('[role="grid"]')).not.toBeNull();
  expect(container.querySelector('button[aria-label^="Add event on "]')).not.toBeNull();
  const eventButton = container.querySelector('button[aria-label="Open Career Fair"]');
  expect(eventButton).not.toBeNull();
  expect(eventButton.closest("button")).toBe(eventButton);
  await click(eventButton);
  expect(document.querySelector('[role="dialog"]').textContent).toContain("Career Fair");
  expect(button("Academic").getAttribute("aria-pressed")).toBe("true");
});

test("calendar feed failure is distinct from an empty month and can be retried", async () => {
  let attempts = 0;
  api.get.mockImplementation((url) => {
    if (url === "/calendar/items") {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: { configured: false, connected: false } });
  });
  await render(<CalendarPage />);
  expect(container.querySelector('[data-testid="calendar-load-error"]')).not.toBeNull();
  await click(button("Try again"));
  expect(container.querySelector('[data-testid="calendar-load-error"]')).toBeNull();
  expect(container.querySelector('[data-testid="month-grid"]')).not.toBeNull();
});

test("board shows a retry state and opens cards with Enter", async () => {
  api.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: [app] });
  await render(<Board />);
  expect(container.querySelector('[data-testid="board-load-error"]')).not.toBeNull();
  await click(button("Try again"));
  const card = container.querySelector('[data-testid="board-card-app-1"]');
  await act(async () => { card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(container.querySelector('[data-testid="mock-application-detail"]').textContent).toBe("Engineer");
});

test("Career Library preserves a visible retry path", async () => {
  api.get.mockRejectedValueOnce({ response: { data: { detail: "Library unavailable" } } }).mockResolvedValue({ data: { skills: [], experiences: [], summary: {} } });
  await render(<Library />);
  expect(container.textContent).toContain("Library unavailable");
  await click(button("Try again"));
  expect(container.textContent).toContain("Build your skill set");
  expect(button("Skills (0)").getAttribute("aria-pressed")).toBe("true");
});
