import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

const privacySections = [
  ["Information LaunchPad stores", "LaunchPad stores your account name and email, preferences, job applications, notes, calendar events, application goals, Career Library records, and files you choose to attach. This information is private to your account."],
  ["Google services", "Google Sign-In provides your verified email, name, profile picture, and Google account identifier. If you separately connect Google Calendar, LaunchPad stores an encrypted refresh credential and creates events only in a dedicated LaunchPad calendar. It does not import or read your other calendars."],
  ["Image scanning and AI", "Local event-flyer and job-posting scanning runs on LaunchPad's server and uploaded images are discarded after processing. The extension can also read limited job-listing text from the current page after you explicitly request it. Improve with AI is optional. When you choose it, the selected image with limited OCR text, or the limited job-page text, is sent to Google's Gemini API for extraction and is not stored by LaunchPad."],
  ["Other services", "LaunchPad may request event icons from Iconify, company icons from DuckDuckGo, fonts from Google Fonts, and profile pictures from the identity provider. Those services receive ordinary network information such as your IP address."],
  ["Retention and deletion", "Your account data is kept until you delete it. Account deletion removes primary records, sessions, encrypted integration credentials, and attachments. Encrypted operational backups expire through the backup retention schedule within approximately 30 days. Events already sent to Google Calendar remain there unless you remove them in Google."],
  ["Your choices", "You can export your account data, disconnect Google Calendar, sign out other devices, or permanently delete your account from Settings. For beta support or privacy questions, contact the LaunchPad operator who invited you."],
];

const termsSections = [
  ["Beta service", "LaunchPad is an invite-only beta provided to help you organize job-search and career information. Features may change, experience interruptions, or contain errors while the service is being tested."],
  ["Your account", "Keep access to your sign-in account secure and use LaunchPad only through your own account. You are responsible for reviewing dates, extracted flyer or job-posting details, application information, and exported calendar events before relying on them."],
  ["Acceptable use", "Do not use LaunchPad to break the law, interfere with the service, bypass limits, access another person's data, distribute malware, or upload content you do not have permission to use."],
  ["Third-party services", "Google, Gemini, Iconify, DuckDuckGo, and other linked services operate under their own terms and policies. LaunchPad cannot guarantee that an external service will remain available or preserve synchronized content."],
  ["No guarantees", "LaunchPad does not guarantee interviews, employment, calendar delivery, reminder delivery, or uninterrupted availability. Keep independent copies of information you cannot afford to lose."],
  ["Access and changes", "The operator may suspend access needed to protect users or the service. Material beta changes will be communicated to invited users when practical. You may stop using LaunchPad and delete your account at any time."],
];

function LegalPage({ kind }) {
  const privacy = kind === "privacy";
  const title = privacy ? "Privacy Policy" : "Terms of Use";
  const Icon = privacy ? ShieldCheck : FileText;
  const sections = privacy ? privacySections : termsSections;

  return (
    <main className="launchpad-shell lp-grid min-h-screen bg-background px-5 py-8 text-on-surface sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <Link to="/login" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-on-surface-variant transition-colors hover:text-brand">
          <ArrowLeft size={16} /> Back to sign in
        </Link>
        <article className="lp-panel lp-chamfer-dual lp-crosshair p-6 sm:p-10">
          <header className="mb-8 flex items-center gap-4 border-b border-outline-variant pb-6">
            <span className="lp-chamfer-chip flex h-12 w-12 shrink-0 items-center justify-center border border-outline-variant bg-surface-high text-brand"><Icon size={23} /></span>
            <div><p className="lp-eyebrow mb-1">LaunchPad beta</p><h1 className="font-heading text-3xl font-bold">{title}</h1></div>
          </header>
          <p className="mb-8 text-sm text-on-surface-variant">Effective September 10, 2026</p>
          <div className="space-y-7">
            {sections.map(([heading, body]) => (
              <section key={heading}>
                <h2 className="mb-2 font-heading text-lg font-semibold">{heading}</h2>
                <p className="leading-7 text-on-surface-variant">{body}</p>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}

export function Privacy() { return <LegalPage kind="privacy" />; }
export function Terms() { return <LegalPage kind="terms" />; }
