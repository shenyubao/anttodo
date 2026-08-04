import type { FormEvent } from "react";

export function TaskSectionComposer({
  variant,
  name,
  busy,
  onNameChange,
  onSubmit,
  onCancel,
}: {
  variant: "list" | "kanban";
  name: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    void onSubmit();
  }

  return (
    <form
      className={variant === "list" ? "add-task-section-form" : "kanban-section-form"}
      onSubmit={submit}
    >
      <input
        autoFocus
        value={name}
        maxLength={100}
        disabled={busy}
        aria-label="分组名称"
        placeholder="分组名称"
        onChange={(event) => onNameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        onBlur={() => {
          if (!name.trim() && !busy) onCancel();
        }}
      />
      {variant === "list" && (
        <>
          <button type="submit" disabled={busy || !name.trim()}>添加</button>
          <button type="button" disabled={busy} onClick={onCancel}>取消</button>
        </>
      )}
    </form>
  );
}
