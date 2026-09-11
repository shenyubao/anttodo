import { Check, Circle } from "lucide-react";
import type { TaskStatus } from "./types";

export function TaskStatusIcon({ status, empty = "circle" }: { status: TaskStatus; empty?: "circle" | "none" }) {
  if (status === "cancelled") return <svg className="task-cancelled-icon" data-task-status="cancelled" viewBox="0 0 17 17" aria-hidden="true">
    <rect width="17" height="17" rx="4" fill="currentColor" />
    <path d="m5.5 5.5 6 6m0-6-6 6" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
  </svg>;
  if (status === "completed") return <Check data-task-status="completed" />;
  return empty === "none" ? null : <Circle data-task-status="open" />;
}
