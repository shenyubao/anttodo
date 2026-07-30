import { Check, Flag } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { TaskPriority } from "./types";

export const PRIORITY_OPTIONS: ReadonlyArray<{
  value: TaskPriority;
  label: string;
  color: string;
}> = [
  { value: "high", label: "高优先级", color: "#e25555" },
  { value: "medium", label: "中优先级", color: "#ffac38" },
  { value: "low", label: "低优先级", color: "#4772fa" },
  { value: "none", label: "无优先级", color: "#9ca0a6" },
];

export function getPriorityOption(priority: TaskPriority) {
  return PRIORITY_OPTIONS.find((option) => option.value === priority)!;
}

export function PriorityControl({
  priority,
  online,
  onChange,
}: {
  priority: TaskPriority;
  online: boolean;
  onChange: (priority: TaskPriority) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentOption = getPriorityOption(priority);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setError("");
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setError("");
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;

    const positionMenu = () => {
      const trigger = triggerRef.current!.getBoundingClientRect();
      const menu = menuRef.current!;
      const gap = 8;
      const inset = 12;
      const width = Math.min(164, window.innerWidth - inset * 2);
      const height = menu.offsetHeight;
      const left = Math.min(
        Math.max(trigger.right - width, inset),
        Math.max(inset, window.innerWidth - width - inset),
      );
      const preferredTop = trigger.bottom + gap;
      const top = preferredTop + height <= window.innerHeight - inset
        ? preferredTop
        : Math.max(inset, trigger.top - height - gap);
      setPosition({ width, left, top });
    };

    positionMenu();
    itemRefs.current[PRIORITY_OPTIONS.findIndex((option) => option.value === priority)]?.focus();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [error, open, priority]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const activeIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    let nextIndex = activeIndex;
    if (event.key === "ArrowDown") nextIndex = (activeIndex + 1) % PRIORITY_OPTIONS.length;
    else if (event.key === "ArrowUp") {
      nextIndex = (activeIndex - 1 + PRIORITY_OPTIONS.length) % PRIORITY_OPTIONS.length;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = PRIORITY_OPTIONS.length - 1;
    else return;
    event.preventDefault();
    itemRefs.current[nextIndex]?.focus();
  }

  async function selectPriority(nextPriority: TaskPriority) {
    if (nextPriority === priority) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onChange(nextPriority);
      setOpen(false);
      triggerRef.current?.focus();
    } catch {
      setError("保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="priority-control" ref={rootRef}>
      <button
        ref={triggerRef}
        className="priority-trigger"
        type="button"
        aria-label={`设置优先级，当前${currentOption.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-priority={priority}
        disabled={!online}
        style={{ "--priority-color": currentOption.color } as CSSProperties}
        onClick={() => {
          setOpen((value) => !value);
          setError("");
        }}
      >
        <Flag />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="priority-menu"
          role="menu"
          aria-label="设置优先级"
          style={position}
          onKeyDown={moveFocus}
        >
          {PRIORITY_OPTIONS.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={priority === option.value}
              data-priority={option.value}
              disabled={busy}
              style={{ "--priority-color": option.color } as CSSProperties}
              onClick={() => void selectPriority(option.value)}
            >
              <Flag />
              <span>{option.label}</span>
              {priority === option.value && <Check className="priority-check" />}
            </button>
          ))}
          {error && <p className="priority-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
