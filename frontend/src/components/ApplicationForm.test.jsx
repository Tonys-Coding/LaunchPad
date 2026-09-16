import { act } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationForm } from "./ApplicationForm";

jest.mock("@/components/CompanyLogo", () => ({ CompanyLogo: () => <span>Logo</span> }));
jest.mock("@/components/DatePicker", () => ({
  DatePicker: ({ id, testid, placeholder }) => <button id={id} data-testid={testid}>{placeholder}</button>,
}));
jest.mock("@/components/MonthPicker", () => ({
  MonthPicker: ({ id, testid, placeholder }) => <button id={id} data-testid={testid}>{placeholder}</button>,
}));

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("advanced mode keeps focus on editable controls instead of the dialog", async () => {
  await act(async () => {
    root.render(<ApplicationForm open onOpenChange={jest.fn()} onSubmit={jest.fn()} />);
  });
  const advanced = document.querySelector('[data-testid="form-mode-advanced"]');
  await act(async () => advanced.click());

  const company = document.querySelector('[data-testid="form-company-name"]');
  expect(document.activeElement).toBe(company);
  expect(document.querySelector('[data-testid="application-form-dialog"]').className).toContain("overflow-hidden");

  const setInputValue = (value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(company, value);
    company.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => setInputValue("A"));
  expect(document.activeElement).toBe(company);
  expect(document.querySelector('[data-testid="form-company-name"]')).toBe(company);
  await act(async () => setInputValue("AB"));
  expect(document.activeElement).toBe(company);
  expect(company.value).toBe("AB");

  const jobLabel = [...document.querySelectorAll("label")].find((item) => item.textContent.includes("Job / Internship title"));
  expect(jobLabel.control).toBe(document.querySelector('[data-testid="form-job-title"]'));
});
