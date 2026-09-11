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
import { parseEstimateHoursText } from "./lib/taskHours";
import { isYunxiaoQuickCreateInput } from "./lib/yunxiaoQuickCreate";
import { mergeLabelIds } from "./lib/taskTitleTokens";
import { TaskTitleTokenChips, TaskTitleTokenMenu } from "./TaskTitleTokenMenu";
import { useTaskTitleTokens } from "./useTaskTitleTokens";
import type {
  DateTimePreferences,
  Label,
  LabelPermissionLevel,
  Member,
  ReminderSchedule,
  Task,
  TaskKind,
  UserLabelOrder,
} from "./types";

function createDraftTask(due: ParsedTaskDue | null): Task {
  const timestamp = new Date().toISOString();
  return {
    id: "quick-add-draft",
    workspace_id: "",
    parent_task_id: null,
    position: 0,
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
    estimate_hours: null,
    actual_hours: null,
    estimate_pomodoros: null,
    actual_pomodoros: null,
    assignee_id: null,
    cli_assignee: null,
    created_by: "",
    completed_at: null,
    deleted_at: null,
    version: 1,
    created_at: timestamp,
    description_mentions: [],
    updated_at: timestamp,
    external_id: null,
    connector_id: null,
    connector_platform: null,
    label_ids: [],
    participant_ids: [],
    children: [],
    reminders: [],
    reminder_persistent: false,
  };
}

export type QuickAddSubmitPayload = {
  title: string;
  due: ParsedTaskDue | null;
  estimateHours: number | null;
  assigneeId: string | null;
  labelIds: string[];
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
  members,
  labels,
  labelPermissionLevels,
  userLabelOrder,
  currentUserId,
  defaultLabelIds = [],
  defaultAssigneeId = null,
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
  members: Member[];
  labels: Label[];
  labelPermissionLevels: Record<string, LabelPermissionLevel | undefined>;
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>;
  currentUserId: string;
  defaultLabelIds?: string[];
  defaultAssigneeId?: string | null;
  onSubmit: (payload: QuickAddSubmitPayload) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tokens = useTaskTitleTokens({
    members,
    labels,
    labelPermissionLevels,
    userLabelOrder,
    currentUserId,
    defaultAssigneeId,
    features: { assignee: true, labels: true },
    inputRef,
  });
  const [due, setDue] = useState<ParsedTaskDue | null>(null);
  const [dateMatch, setDateMatch] = useState<ParsedTaskDateMatch | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [dueManual, setDueManual] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [dueAnchor, setDueAnchor] = useState<{ left: number; top: number } | null>(null);
  const dueChipRef = useRef<HTMLButtonElement>(null);
  const timeZone = systemTimeZone();
  const title = tokens.title;

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
    if (kind !== "todo" || isYunxiaoQuickCreateInput(title)) {
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
    if (tokens.token) return;
    const payload = tokens.toSubmitPayload();
    const raw = payload.title;
    if (!raw || !online || busy || !canManage) return;

    if (isYunxiaoQuickCreateInput(raw)) {
      const previous = {
        title: tokens.title,
        assigneeId: tokens.assigneeId,
        labelIds: tokens.labelIds,
      };
      tokens.reset();
      setDue(null);
      setDateMatch(null);
      setDismissedKey(null);
      setDueManual(false);
      setDueOpen(false);
      try {
        await onSubmit({
          title: raw.trim(),
          due: null,
          estimateHours: null,
          assigneeId: previous.assigneeId,
          labelIds: mergeLabelIds(defaultLabelIds, previous.labelIds),
        });
      } catch {
        tokens.setTitle((current) => current || previous.title);
        tokens.setAssigneeId((current) =>
          current === (defaultAssigneeId ?? null) ? previous.assigneeId : current);
        tokens.setLabelIds((current) => (current.length > 0 ? current : previous.labelIds));
      }
      return;
    }

    let submitTitle = raw;
    let submitDue = due;
    let estimateHours: number | null = null;

    const hoursParsed = parseEstimateHoursText(submitTitle);
    if (hoursParsed) {
      estimateHours = hoursParsed.estimateHours;
      submitTitle = hoursParsed.title.trim() || raw;
    }

    if (kind === "todo" && dateMatch) {
      const parsed = parseTaskDateText(submitTitle, { now, timeZone });
      if (parsed) {
        submitTitle = parsed.title.trim() || submitTitle;
        if (!dueManual) submitDue = parsed.due;
      } else {
        const fromOriginal = parseTaskDateText(raw, { now, timeZone });
        if (fromOriginal && matchKey(fromOriginal.match) === matchKey(dateMatch)) {
          let afterDate = fromOriginal.title.trim() || raw;
          const hoursAfterDate = parseEstimateHoursText(afterDate);
          if (hoursAfterDate) {
            estimateHours = hoursAfterDate.estimateHours;
            afterDate = hoursAfterDate.title.trim() || afterDate;
          } else if (!hoursParsed) {
            const hoursInRaw = parseEstimateHoursText(raw);
            if (hoursInRaw) estimateHours = hoursInRaw.estimateHours;
          }
          submitTitle = afterDate;
          if (!dueManual) submitDue = fromOriginal.due;
        }
      }
    }

    if (!submitTitle) return;

    const previous = {
      title: tokens.title,
      assigneeId: tokens.assigneeId,
      labelIds: tokens.labelIds,
    };
    tokens.reset();
    setDue(null);
    setDateMatch(null);
    setDismissedKey(null);
    setDueManual(false);
    setDueOpen(false);

    try {
      await onSubmit({
        title: submitTitle,
        due: kind === "todo" ? submitDue : null,
        estimateHours,
        assigneeId: previous.assigneeId,
        labelIds: mergeLabelIds(defaultLabelIds, previous.labelIds),
      });
    } catch {
      tokens.setTitle((current) => current || previous.title);
      tokens.setAssigneeId((current) =>
        current === (defaultAssigneeId ?? null) ? previous.assigneeId : current);
      tokens.setLabelIds((current) => (current.length > 0 ? current : previous.labelIds));
    }
  }

  const draftTask = useMemo(() => createDraftTask(due), [due]);
  const showHighlight = Boolean(dateMatch && kind === "todo" && !tokens.token);

  return (
    <form className="quick-add" onSubmit={(event) => void handleSubmit(event)}>
      {leadingIcon}
      <div className="quick-add-field task-title-token-field">
        <input
          ref={inputRef}
          data-quick-add-input=""
          className={showHighlight ? "quick-add-input has-date-mark" : "quick-add-input"}
          value={title}
          onChange={tokens.handleChange}
          onClick={handleInputClick}
          onKeyDown={(event) => {
            if (tokens.handleKeyDown(event)) return;
          }}
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
        {tokens.token && (
          <TaskTitleTokenMenu
            kind={tokens.token.kind}
            assigneeCandidates={tokens.assigneeCandidates}
            labelCandidates={tokens.labelCandidates}
            labelTreeLabels={labels}
            activeIndex={tokens.activeIndex}
            onSelectAssignee={tokens.selectAssignee}
            onSelectLabel={tokens.selectLabel}
          />
        )}
      </div>
      {title && !tokens.token && <kbd>Enter</kbd>}
      <TaskTitleTokenChips
        assignee={tokens.assignee}
        labels={tokens.selectedLabels}
        disabled={!online || busy}
        onRemoveAssignee={tokens.removeAssignee}
        onRemoveLabel={tokens.removeLabel}
      />
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
