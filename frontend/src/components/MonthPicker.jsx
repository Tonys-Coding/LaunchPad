import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, X } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MonthPicker({ value, onChange, testid, placeholder = "Pick a month", clearable, id }) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : null;
  const [year, setYear] = useState(selected ? selected.getFullYear() : new Date().getFullYear());

  const pick = (m) => {
    onChange(`${year}-${String(m + 1).padStart(2, "0")}-01`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          data-testid={testid}
          className="w-full flex items-center gap-2 bg-surface-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm text-left focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none transition-all"
        >
          <CalIcon size={16} className="text-on-surface-variant shrink-0" />
          <span className={`flex-1 ${value ? "text-on-surface" : "text-on-surface-variant"}`}>
            {value ? format(selected, "MMM yyyy") : placeholder}
          </span>
          {clearable && value && (
            <X size={15} className="text-on-surface-variant hover:text-danger" onClick={(e) => { e.stopPropagation(); onChange(""); }} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 bg-popover border-outline-variant" align="start">
        <div className="flex items-center justify-between mb-3">
          <button type="button" onClick={() => setYear((y) => y - 1)} className="p-1.5 rounded-lg hover:bg-surface-high text-on-surface-variant" data-testid="month-prev-year">
            <ChevronLeft size={16} />
          </button>
          <span className="font-heading font-semibold text-on-surface">{year}</span>
          <button type="button" onClick={() => setYear((y) => y + 1)} className="p-1.5 rounded-lg hover:bg-surface-high text-on-surface-variant" data-testid="month-next-year">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MONTHS.map((m, i) => {
            const isSel = selected && selected.getFullYear() === year && selected.getMonth() === i;
            return (
              <button
                key={m}
                type="button"
                data-testid={`month-${m}`}
                onClick={() => pick(i)}
                className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                  isSel ? "bg-brand text-on-brand" : "text-on-surface hover:bg-surface-high"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
