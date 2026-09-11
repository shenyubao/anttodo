import {
  CalendarDays,
  CheckCircle2,
  FileText,
  Goal,
  Grid2X2,
  Search,
  Target,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { FeatureModulePreferences } from "./featureModulePreferences";

export type PrimaryAppSection = "tasks" | "weekly_reports" | "okr" | "calendar" | "matrix" | "focus" | "mindmap" | "search";

export type PrimaryNavigationItem = {
  section: PrimaryAppSection;
  label: string;
  railLabel?: string;
  icon: LucideIcon;
  enabled: (preferences: FeatureModulePreferences) => boolean;
};

export const PRIMARY_NAVIGATION_ITEMS: readonly PrimaryNavigationItem[] = [
  {
    section: "tasks",
    label: "待办",
    railLabel: "任务",
    icon: CheckCircle2,
    enabled: () => true,
  },
  {
    section: "weekly_reports",
    label: "周报",
    icon: FileText,
    enabled: (preferences) => preferences.weeklyReportsEnabled,
  },
  {
    section: "okr",
    label: "OKR",
    icon: Goal,
    enabled: (preferences) => preferences.okrEnabled,
  },
  {
    section: "calendar",
    label: "日历",
    icon: CalendarDays,
    enabled: (preferences) => preferences.calendarEnabled,
  },
  {
    section: "matrix",
    label: "四象限",
    icon: Grid2X2,
    enabled: (preferences) => preferences.matrixEnabled,
  },
  {
    section: "focus",
    label: "番茄专注",
    icon: Target,
    enabled: (preferences) => preferences.focusEnabled,
  },
  {
    section: "mindmap",
    label: "思维导图",
    icon: Workflow,
    enabled: (preferences) => preferences.mindMapEnabled,
  },
  {
    section: "search",
    label: "搜索",
    icon: Search,
    enabled: () => true,
  },
];

export function visiblePrimaryNavigationItems(preferences: FeatureModulePreferences) {
  return PRIMARY_NAVIGATION_ITEMS.filter((item) => item.enabled(preferences));
}
