import {
  CalendarDays,
  CheckCircle2,
  Search,
  Target,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { FeatureModulePreferences } from "./featureModulePreferences";

export type PrimaryAppSection = "tasks" | "calendar" | "focus" | "mindmap" | "search";

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
    section: "calendar",
    label: "日历",
    icon: CalendarDays,
    enabled: (preferences) => preferences.calendarEnabled,
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
