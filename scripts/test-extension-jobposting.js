const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require(path.join(__dirname, "..", "frontend", "node_modules", "jsdom"));

const popupSource = fs.readFileSync(path.join(__dirname, "..", "extension", "popup.js"), "utf8");
const functionStart = popupSource.indexOf("function extractJobPostingFromPage()");
const functionEnd = popupSource.indexOf("\n\nasync function readApplicationPage", functionStart);
assert(functionStart >= 0 && functionEnd > functionStart, "JobPosting extraction function was not found");
const functionSource = popupSource.slice(functionStart, functionEnd);

const posting = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Software Engineering Intern",
  description: "<p>Build accessible products.</p>",
  hiringOrganization: {
    "@type": "Organization",
    name: "Example Labs",
    sameAs: "https://www.example.com/careers",
  },
  baseSalary: {
    "@type": "MonetaryAmount",
    value: { "@type": "QuantitativeValue", value: 28, unitText: "HOUR" },
  },
  jobStartDate: "2027-05-17",
};

const dom = new JSDOM(`<!doctype html><html><head><title>Example job</title></head><body>
  <script type="application/ld+json">${JSON.stringify(posting)}</script>
  <main><h1>Fallback title</h1></main>
</body></html>`, { url: "https://jobs.example.com/openings/123" });

const extract = new Function(
  "document",
  "location",
  `${functionSource}; return extractJobPostingFromPage();`,
);
const result = extract(dom.window.document, dom.window.location);

assert.equal(result.sourceUrl, "https://jobs.example.com/openings/123");
assert.equal(result.structuredFields.company_name, "Example Labs");
assert.equal(result.structuredFields.job_title, "Software Engineering Intern");
assert.equal(result.structuredFields.company_domain, "example.com");
assert.equal(result.structuredFields.expected_start_date, "2027-05-17");
assert.equal(result.structuredFields.pay_amount, 28);
assert.equal(result.structuredFields.pay_period, "hourly");
assert.equal(result.structuredFields.description, "Build accessible products.");

console.log("structured JobPosting extraction passed");
