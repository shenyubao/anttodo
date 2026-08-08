export function FocusNotes({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <section className="focus-notes">
      <h3>专注笔记</h3>
      <textarea
        value={value}
        disabled={disabled}
        placeholder="记录你的想法..."
        aria-label="专注笔记"
        onChange={(event) => onChange(event.target.value)}
      />
    </section>
  );
}
