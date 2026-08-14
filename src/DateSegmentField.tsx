import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DateFormat } from "./types";
import {
  adjacentDateSegment,
  applyDateSegmentBackspace,
  applyDateSegmentDigit,
  dateSegmentLimits,
  dateSegmentOrder,
  formatDateParts,
  formatDateSegment,
  incrementDateSegment,
  parseDateInput,
  type DateSegmentKind,
} from "./lib/dateSegmentField";

const SEGMENT_LABELS: Record<DateSegmentKind, string> = {
  year: "年",
  month: "月",
  day: "日",
};

export function DateSegmentField({
  value,
  onChange,
  dateFormat,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  dateFormat: DateFormat;
  "aria-label": string;
}) {
  const parts = useMemo(
    () => parseDateInput(value) ?? { year: 1, month: 1, day: 1 },
    [value],
  );
  const order = useMemo(() => dateSegmentOrder(dateFormat), [dateFormat]);
  const [active, setActive] = useState<DateSegmentKind | null>(null);
  const [buffer, setBuffer] = useState("");
  const segmentRefs = useRef<Partial<Record<DateSegmentKind, HTMLSpanElement | null>>>({});
  const lastCommitted = useRef(value);

  useEffect(() => {
    setBuffer("");
  }, [dateFormat]);

  useEffect(() => {
    if (value === lastCommitted.current) return;
    lastCommitted.current = value;
    setBuffer("");
  }, [value]);

  function focusSegment(kind: DateSegmentKind) {
    setActive(kind);
    setBuffer("");
    segmentRefs.current[kind]?.focus();
  }

  function commit(nextParts: typeof parts) {
    const nextValue = formatDateParts(nextParts);
    lastCommitted.current = nextValue;
    if (nextValue !== value) onChange(nextValue);
  }

  function onSegmentKeyDown(kind: DateSegmentKind, event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setBuffer("");
      commit(incrementDateSegment(parts, kind, event.key === "ArrowUp" ? 1 : -1));
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      focusSegment(adjacentDateSegment(dateFormat, kind, event.key === "ArrowLeft" ? -1 : 1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusSegment(order[0]!);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusSegment(order.at(-1)!);
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = applyDateSegmentBackspace(parts, kind, buffer);
      setBuffer(next.buffer);
      commit(next.parts);
      return;
    }
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      const next = applyDateSegmentDigit(parts, kind, buffer, event.key);
      setBuffer(next.buffer);
      commit(next.parts);
      const index = order.indexOf(kind);
      if (next.advance && index >= 0 && index < order.length - 1) {
        focusSegment(order[index + 1]!);
      }
    }
  }

  return (
    <span
      className="due-date-input date-segment-field"
      role="group"
      aria-label={ariaLabel}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          focusSegment(order[0]!);
        }
      }}
    >
      {order.map((kind, index) => {
        const limits = dateSegmentLimits(kind, parts);
        const selected = active === kind;
        return (
          <span className="date-segment-unit" key={kind}>
            {index > 0 && <span className="date-segment-sep" aria-hidden="true">/</span>}
            <span
              ref={(node) => {
                segmentRefs.current[kind] = node;
              }}
              className={selected ? "date-segment selected" : "date-segment"}
              role="spinbutton"
              tabIndex={0}
              aria-label={SEGMENT_LABELS[kind]}
              aria-valuenow={parts[kind]}
              aria-valuemin={limits.min}
              aria-valuemax={limits.max}
              aria-valuetext={formatDateSegment(parts, kind, selected ? buffer : "")}
              onFocus={() => {
                setActive(kind);
                setBuffer("");
              }}
              onBlur={() => {
                setActive((current) => (current === kind ? null : current));
                setBuffer("");
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                focusSegment(kind);
              }}
              onKeyDown={(event) => onSegmentKeyDown(kind, event)}
            >
              {formatDateSegment(parts, kind, selected ? buffer : "")}
            </span>
          </span>
        );
      })}
    </span>
  );
}
