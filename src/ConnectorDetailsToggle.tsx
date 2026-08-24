export function ConnectorDetailsToggle({
  expanded,
  detailsId,
  onToggle,
}: {
  expanded: boolean;
  detailsId: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="connector-details-toggle"
      aria-expanded={expanded}
      aria-controls={expanded ? detailsId : undefined}
      onClick={onToggle}
    >
      {expanded ? "隐藏详情" : "查看详情"}
    </button>
  );
}
