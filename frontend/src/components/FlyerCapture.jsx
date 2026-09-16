import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileImage, Loader2, ScanLine, Sparkles, Upload } from "lucide-react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const MAX_FLYER_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function FlyerCapture({ onExtract, startOpen = false }) {
  const { user } = useAuth();
  const preferredTimezone = user?.preferences?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const inputRef = useRef(null);
  const [expanded, setExpanded] = useState(startOpen);
  const [analyzing, setAnalyzing] = useState(false);
  const [improving, setImproving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState("");
  const [flyerFile, setFlyerFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { if (startOpen) setExpanded(true); }, [startOpen]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const analyze = async (file) => {
    if (!file) return;
    setExpanded(true);
    setError("");
    setResult(null);
    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Choose a PNG, JPEG, or WebP screenshot.");
      return;
    }
    if (file.size > MAX_FLYER_BYTES) {
      setError("The screenshot must be smaller than 8 MB.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setFlyerFile(file);
    setAnalyzing(true);
    try {
      const payload = new FormData();
      payload.append("image", file, file.name || "flyer.png");
      payload.append("timezone", preferredTimezone);
      const response = await api.post("/events/extract-flyer", payload);
      setResult(response.data);
      onExtract(response.data.fields, response.data);
    } catch (failure) {
      setError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setAnalyzing(false);
    }
  };

  const improveWithAI = async () => {
    if (!flyerFile || !result?.ai_available) return;
    setImproving(true);
    setError("");
    try {
      const payload = new FormData();
      payload.append("image", flyerFile, flyerFile.name || "flyer.png");
      payload.append("timezone", preferredTimezone);
      if (result.ocr_preview) payload.append("ocr_text", result.ocr_preview);
      const response = await api.post("/events/improve-flyer", payload);
      setResult(response.data);
      onExtract(response.data.fields, response.data);
    } catch (failure) {
      setError(formatApiErrorDetail(failure.response?.data?.detail));
    } finally {
      setImproving(false);
    }
  };

  const pasted = (event) => {
    const file = [...(event.clipboardData?.files || [])].find((item) => ALLOWED_TYPES.has(item.type));
    if (file) {
      event.preventDefault();
      analyze(file);
    }
  };

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-low overflow-hidden" onPaste={pasted}>
      <button type="button" onClick={() => setExpanded((current) => !current)} className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-surface-high/60 transition-colors">
        <span className="flex items-center gap-2.5"><span className="w-9 h-9 rounded-lg bg-brand/10 text-brand flex items-center justify-center"><ScanLine size={19} /></span><span className="text-sm font-semibold">Fill from a flyer</span></span>
        <span className="text-xs text-on-surface-variant">{expanded ? "Hide" : "Open"}</span>
      </button>
      {expanded && <div className="border-t border-outline-variant p-3 space-y-3">
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { analyze(event.target.files?.[0]); event.target.value = ""; }} />
        <button
          type="button"
          disabled={analyzing}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); analyze(event.dataTransfer.files?.[0]); }}
          className={`w-full min-h-28 rounded-xl border-2 border-dashed flex items-center justify-center gap-3 px-4 py-4 transition-colors ${dragging ? "border-brand bg-brand/10" : "border-outline-variant bg-surface-mid/40 hover:border-on-surface-variant"}`}
        >
          {preview ? <img src={preview} alt="Flyer ready to scan" className="w-16 h-16 rounded-lg object-cover border border-outline-variant" /> : <FileImage size={30} className="text-on-surface-variant" />}
          <span className="text-left"><span className="block text-sm font-medium">{analyzing ? "Reading the flyer…" : preview ? "Choose another screenshot" : "Choose a screenshot"}</span><span className="block text-xs text-on-surface-variant mt-1">You can also paste with ⌘V or drop an image here</span></span>
          {analyzing ? <Loader2 size={20} className="animate-spin text-brand" /> : <Upload size={18} className="text-on-surface-variant" />}
        </button>
        {error && <p role="alert" className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{error}</p>}
        {result && <div aria-live="polite" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-emerald-500 flex items-center gap-2"><CheckCircle2 size={16} /> {result.ai_enhanced ? "Draft improved with AI—review it before saving" : "Draft filled—review it before saving"}</p>
            {!result.ai_enhanced && <button type="button" onClick={improveWithAI} disabled={!result.ai_available || improving} title={result.ai_available ? "Ask Gemini to re-read this flyer" : "Add a Gemini API key to enable this option"} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20 disabled:opacity-45 disabled:cursor-not-allowed">{improving ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {improving ? "Improving…" : "Improve with AI"}</button>}
          </div>
          {!result.ai_available && !result.ai_enhanced && <p className="mt-1.5 text-xs text-on-surface-variant">AI improvement becomes available after a Gemini API key is added.</p>}
          {result.ai_enhanced && Number.isInteger(result.ai_remaining_today) && <p className="mt-1.5 text-xs text-on-surface-variant">{result.ai_remaining_today} AI improvements remaining today.</p>}
          {result.warnings?.length > 0 && <ul className="mt-2 space-y-1 text-xs text-on-surface-variant list-disc pl-4">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        </div>}
      </div>}
    </div>
  );
}
