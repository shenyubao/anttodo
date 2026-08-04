import { CalendarDays } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { DueDateControl } from "./DueDateControl";
import {
  formatDueWithPreferences,
  systemTimeZone,
} from "./lib/dateTimePreferences";
import {
  matchKey,
  parseTaskDateText,
  type ParsedTaskDateMatch,
  type ParsedTaskDue,
} from "./lib/parseTaskDateText";
import type {
  DateTimePreferences,
  ReminderSchedule,
  Task,
  TaskKind,
} from "./types";

function createDraftTask(due: ParsedTaskDue | null): Task {
  const timestamp = new Date().toISOString();
  return {
    id: "quick-add-draft",
    workspace_id: "",
    title: "",
    description: "",
    kind: "todo",
    status: "open",
    priority: "low",
    due_at: due?.due_at ?? null,
    due_start_at: due?.due_start_at ?? null,
    due_is_all_day: due?.due_is_all_day ?? false,
    due_timezone: due?.due_timezone ?? systemTimeZone(),
    recurrence: null,
    assignee_id: null,
    cli_assignee: null,
    created_by: "",
    completed_at: null,
    deleted_at: null,
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    label_ids: [],
    participant_ids: [],
    subtasks: [],
    reminders: [],
    reminder_persistent: false,
  };
}

export type QuickAddSubmitPayload = {
  title: string;
  due: ParsedTaskDue | null;
};

export function QuickAddForm({
  online,
  canManage,
  busy,
  kind,
  placeholder,
  now,
  dateTimePreferences,
  leadingIcon,
  settings,
  onSubmit,
}: {
  online: boolean;
  canManage: boolean;
  busy: boolean;
  kind: TaskKind;
  placeholder: string;
  now: Date;
  dateTimePreferences: DateTimePreferences;
  leadingIcon: ReactNode;
  settings: ReactNode;
  onSubmit: (payload: QuickAddSubmitPayload) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<ParsedTaskDue | null>(null);
  const [dateMatch, setDateMatch] = useState<ParsedTaskDateMatch | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [dueManual, setDueManual] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [dueAnchor, setDueAnchor] = useState<{ left: number; top: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dueChipRef = useRef<HTMLButtonElement>(null);
  const timeZone = systemTimeZone();

  function openDuePicker() {
    const rect = dueChipRef.current?.getBoundingClientRect();
    if (rect) {
      setDueAnchor({ left: rect.left, top: rect.bottom + 8 });
    } else {
      setDueAnchor(null);
    }
    setDueOpen(true);
  }

  useEffect(() => {
    if (kind !== "todo") {
      setDateMatch(null);
      setDue(null);
      setDueManual(false);
      setDismissedKey(null);
      setDueOpen(false);
      return;
    }

    const parsed = parseTaskDateText(title, { now, timeZone });
    if (!parsed) {
      setDateMatch(null);
      setDismissedKey(null);
      if (!dueManual) setDue(null);
      return;
    }

    const key = matchKey(parsed.match);
    if (dismissedKey === key) {
      setDateMatch(null);
      return;
    }

    if (dismissedKey) setDismissedKey(null);
    setDateMatch(parsed.match);
    if (!dueManual) setDue(parsed.due);
  }, [kind, now, timeZone, title, dismissedKey, dueManual]);

  function handleTitleChange(value: string) {
    setTitle(value);
  }

  function dismissRecognition() {
    if (!dateMatch) return;
    setDismissedKey(matchKey(dateMatch));
    setDateMatch(null);
    setDue(null);
    setDueManual(false);
    inputRef.current?.focus();
  }

  function handleInputClick() {
    const input = inputRef.current;
    if (!input || !dateMatch) return;
    const caret = input.selectionStart;
    if (caret == null) return;
    if (caret >= dateMatch.start && caret < dateMatch.end) {
      dismissRecognition();
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const raw = title.trim();
    if (!raw || !online || busy || !canManage) return;

    let submitTitle = raw;
    let submitDue = due;

    if (kind === "todo" && dateMatch) {
      const parsed = parseTaskDateText(title, { now, timeZone });
      if (parsed && matchKey(parsed.match) === matchKey(dateMatch)) {
        submitTitle = parsed.title.trim() || raw;
        if (!dueManual) submitDue = parsed.due;
      }
    }

    if (!submitTitle) return;

    const previousTitle = title;
    setTitle("");
    setDue(null);
    setDateMatch(null);
    setDismissedKey(null);
    setDueManual(false);
    setDueOpen(false);

    try {
      await onSubmit({
        title: submitTitle,
        due: kind === "todo" ? submitDue : null,
      });
    } catch {
      setTitle((current) => current || previousTitle);
    }
  }

  const draftTask = useMemo(() => createDraftTask(due), [due]);
  const showHighlight = Boolean(dateMatch && kind === "todo");

  return (
    <form className="quick-add" onSubmit={(event) => void handleSubmit(event)}>
      {leadingIcon}
      <div className="quick-add-field">
        <input
          ref={inputRef}
          className={showHighlight ? "quick-add-input has-date-mark" : "quick-add-input"}
          value={title}
          onChange={(event) => handleTitleChange(event.target.value)}
          onClick={handleInputClick}
          placeholder={placeholder}
          disabled={!online || !canManage}
        />
        {showHighlight && dateMatch && (
          <div className="quick-add-mirror" aria-hidden="true">
            <span>{title.slice(0, dateMatch.start)}</span>
            <button
              type="button"
              className="quick-add-date-mark"
              tabIndex={-1}
              title="点击取消识别"
              onMouseDown={(event) => {
                event.preventDefault();
                dismissRecognition();
              }}
            >
              {title.slice(dateMatch.start, dateMatch.end)}
            </button>
            <span>{title.slice(dateMatch.end)}</span>
          </div>
        )}
      </div>
      {title && <kbd>Enter</kbd>}
      {due && kind === "todo" && (
        <div className="quick-add-due">
          <button
            ref={dueChipRef}
            type="button"
            className="quick-add-due-chip"
            aria-label="修改到期时间"
            aria-haspopup="dialog"
            aria-expanded={dueOpen}
            disabled={!online || busy}
            onClick={() => {
              if (dueOpen) {
                setDueOpen(false);
                return;
              }
              openDuePicker();
            }}
          >
            <CalendarDays />
            <span>
              {formatDueWithPreferences(
                {
                  due_at: due.due_at,
                  due_start_at: due.due_start_at,
                  due_is_all_day: due.due_is_all_day,
                  due_timezone: due.due_timezone,
                },
                dateTimePreferences,
              )}
            </span>
          </button>
          {dueOpen && dueAnchor && (
            <DueDateControl
              task={draftTask}
              online={online && !busy}
              now={now}
              preferences={dateTimePreferences}
              autoOpen
              showTrigger={false}
              anchorPoint={dueAnchor}
              onClose={() => setDueOpen(false)}
              onSave={async (patch, _schedule: ReminderSchedule) => {
                setDue({
                  due_at: patch.due_at,
                  due_start_at: patch.due_start_at,
                  due_is_all_day: patch.due_is_all_day,
                  due_timezone: patch.due_timezone ?? systemTimeZone(),
                });
                setDueManual(true);
                setDueOpen(false);
              }}
            />
          )}
        </div>
      )}
      {settings}
    </form>
  );
}
