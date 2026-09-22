const sections = [
  ["experience", "Experience"], ["projects", "Projects"], ["education", "Education"],
  ["accomplishments", "Accomplishments"], ["certifications", "Certifications"],
];

function dateLabel(item) {
  const end = item.current ? "Present" : item.end_date;
  return [item.start_date, end].filter(Boolean).join(" – ");
}

export function ResumePaper({ content = {}, profile = {}, compact = false, className = "" }) {
  const location = [profile.city, profile.region, profile.country].filter(Boolean).join(", ");
  const contact = [profile.preferred_email, profile.phone, location, profile.linkedin, profile.github, profile.portfolio].filter(Boolean);
  return (
    <article className={`resume-paper bg-white text-[#111827] shadow-xl ${compact ? "resume-paper--compact" : ""} ${className}`}>
      <header className="border-b border-[#7b8492] pb-2 text-center">
        <h1 className="font-serif text-[1.75em] font-bold uppercase tracking-[0.12em]">{profile.full_name || "Your Name"}</h1>
        <p className="mt-1 break-words text-[0.68em] leading-4 text-[#374151]">{contact.join("  •  ") || "Contact details from your Career Profile"}</p>
      </header>
      {content.summary && <section className="mt-3"><h2 className="resume-paper-heading">Professional Summary</h2><p className="mt-1 text-[0.72em] leading-[1.5]">{content.summary}</p></section>}
      {content.skills?.length > 0 && <section className="mt-3"><h2 className="resume-paper-heading">Skills</h2><p className="mt-1 text-[0.72em] leading-[1.5]">{content.skills.map((item) => item.name).filter(Boolean).join(" • ")}</p></section>}
      {sections.map(([key, label]) => content[key]?.length > 0 && <section key={key} className="mt-3">
        <h2 className="resume-paper-heading">{label}</h2>
        <div className="space-y-2">{content[key].map((item, index) => <div key={item.item_id || `${key}-${index}`}>
          <div className="mt-1 flex items-start justify-between gap-3 text-[0.76em]"><div><strong>{item.title}</strong>{item.organization && <span> — {item.organization}</span>}</div><span className="shrink-0 text-[0.9em]">{dateLabel(item)}</span></div>
          {item.location && <p className="text-[0.66em] italic text-[#4b5563]">{item.location}</p>}
          {item.bullets?.length > 0 && <ul className="ml-4 mt-0.5 list-disc space-y-0.5 text-[0.7em] leading-[1.45]">{item.bullets.map((bullet, bulletIndex) => bullet && <li key={bulletIndex}>{bullet}</li>)}</ul>}
        </div>)}</div>
      </section>)}
    </article>
  );
}
