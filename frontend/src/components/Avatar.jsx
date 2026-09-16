import { useState, useEffect } from "react";

export function Avatar({ src, name, size = 36, className = "" }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [src]);
  const initial = (name || "U").trim()[0]?.toUpperCase() || "U";
  const style = { width: size, height: size, minWidth: size };

  if (src && !err) {
    return (
      <img
        src={src}
        alt={name || "avatar"}
        referrerPolicy="no-referrer"
        onError={() => setErr(true)}
        style={style}
        className={`rounded-full object-cover border border-outline-variant ${className}`}
      />
    );
  }
  return (
    <div
      style={{ ...style, fontSize: size * 0.42 }}
      className={`rounded-full bg-brand-container flex items-center justify-center text-white font-semibold font-heading ${className}`}
    >
      {initial}
    </div>
  );
}
