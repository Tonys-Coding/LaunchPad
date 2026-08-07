import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar as CalIcon, X } from "lucide-react";

export function DatePicker({ value, onChange, disabled, placeholder = "Pick a date", testid, clearable }) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid={testid}
          className="w-full flex items-center gap-2 bg-surface-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm text-left focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <CalIcon size={16} className="text-on-surface-variant shrink-0" />
          <span className={`flex-1 ${value ? "text-on-surface" : "text-on-surface-variant"}`}>
            {value ? format(selected, "PP") : placeholder}
          </span>
          {clearable && value && !disabled && (
            <X
              size={15}
              className="text-on-surface-variant hover:text-danger"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-popover border-outline-variant" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => { if (d) { onChange(format(d, "yyyy-MM-dd")); setOpen(false); } }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
