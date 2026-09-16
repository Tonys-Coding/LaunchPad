import { useState, useEffect } from "react";

const COLORS = [
  "#e3ba51", "#d9a441", "#a9791f", "#c9873f", "#c05a3a",
  "#8faa4e", "#b8a67e", "#c86f4a",
];

function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

function guessDomain(name) {
  const clean = (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean ? `${clean}.com` : null;
}

export function CompanyLogo({ name = "", domain, size = 44, className = "" }) {
  const [errored, setErrored] = useState(false);
  const resolvedDomain = domain || guessDomain(name);
  const src = resolvedDomain ? `https://icons.duckduckgo.com/ip3/${resolvedDomain}.ico` : null;
  const initials = (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  useEffect(() => setErrored(false), [name, domain]);

  const style = { width: size, height: size, minWidth: size };

  if (!src || errored) {
    return (
      <div
        data-testid="company-logo-fallback"
        className={`rounded-xl flex items-center justify-center font-heading font-bold text-background ${className}`}
        style={{ ...style, backgroundColor: colorFor(name), fontSize: size * 0.38 }}
      >
        {initials}
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl overflow-hidden bg-white flex items-center justify-center border border-outline-variant ${className}`}
      style={style}
    >
      <img
        data-testid="company-logo-img"
        src={src}
        alt={name}
        onError={() => setErrored(true)}
        style={{ width: "100%", height: "100%", objectFit: "contain", padding: size * 0.14 }}
      />
    </div>
  );
}
