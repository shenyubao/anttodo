import { OkrNoteContent, OkrNoteEditor } from "./OkrNoteEditor";
import type { TaskRichTextEditorHandle } from "./TaskRichTextEditor";
import { AssigneePicker } from "./AssigneePicker";
import { okrObjectiveHistory } from "./lib/okrHistory";
import { loadOkrKeyResultHistory } from "./lib/weeklyReportOkrApi";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Ellipsis,
  Eye,
  FileText,
  Goal,
  GripVertical,
  History,
  Import,
  LockKeyhole,
  Menu,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserPlus,
  ListTodo,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { MemberAvatar } from "./MemberAvatar";
import { TaskStatusIcon } from "./TaskStatusIcon";
import { OkrTaskComposer, type OkrTaskCreation } from "./OkrTaskComposer";
import type {
  CommentMention,
  Member,
  MyActiveOkrTree,
  OkrBreakdown,
  OkrCycle,
  OkrDisplayPreferences,
  OkrKeyResult,
  OkrMetricUnit,
  OkrObjective,
  OkrProgressRecord,
  OkrProgressStatus,
  OkrSet,
  OkrLinkedTaskSummary,
  UserGroup,
  WorkspaceRole,
} from "./types";
import { supabase } from "./lib/supabase";
import {
  buildOkrChanges,
  saveOkrChanges,
  createOkrCycle,
  createOkrKeyResult,
  createOkrKeyResultWithBalancedWeights,
  createOkrObjective,
  deleteOkrCycle,
  deleteOkrKeyResult,
  deleteOkrObjective,
  ensureOkrSet,
  loadAlignableOkrObjectives,
  loadOkrCycles,
  loadOkrDisplayPreferences,
  loadOkrProgressRecordCounts,
  loadOkrProgressRecords,
  updateOkrObjectiveStatus,
  loadOkrLinkedTasks,
  loadOkrLinkedTaskCounts,
  okrLinkedTaskCountsKey,
  loadOkrSet,
  loadOkrVersions,
  loadVisibleOkrOwnerIds,
  saveOkrDisplayPreferences,
  saveOkrSetVisibility,
  updateOkrCycle,
  updateOkrKeyResult,
  updateOkrKeyResultWeights,
  updateOkrObjective,
  updateOkrProgress,
  okrLinkedTasksKey,
} from "./lib/okrApi";
import { parseAppRoute } from "./lib/appRoute";
import { createDemoOkrData, createDemoOkrLinkedTasks } from "./lib/demoOkr";
import {
  automaticOkrStatus,
  equalOkrWeights,
  filterVisibleOkrMembers,
  importedOkrObjectives,
  OKR_STATUS_LABELS,
  okrBreakdownsValid,
  okrMetricUnitLabel,
  okrObjectiveProgress,
  okrProgressPercent,
  okrPublishBlockingMessage,
  okrRealtimeAffectsDiscoverability,
  okrSnapshotDiff,
  okrWeightsValid,
  withDefaultOkrWeights,
  withRebalancedOkrWeights,
} from "./lib/okr";

type OkrWorkspaceProps = {
  workspaceId: string;
  currentUserId: string;
  currentRole: WorkspaceRole;
  members: Member[];
  userGroups: UserGroup[];
  online: boolean;
  initialOwnerId?: string;
  initialCycleId?: string;
  initialTargetRevision?: number;
  initialTarget?: { kind: "objective" | "key_result"; id: string; initialTab?: "tasks" | "notes" };
  onNavigate: (ownerId: string, cycleId: string) => void;
  onOpenTask?: (taskId: string) => void;
  taskCreation?: OkrTaskCreation;
  onMenu: () => void;
  onNotice: (message: string, tone?: "success" | "error") => void;
};

export type ProgressTarget = {
  kind: "objective" | "key_result";
  id: string;
  label: string;
  title: string;
  startValue: number;
  targetValue: number;
  currentValue: number | null;
  status: OkrProgressStatus;
  score: number | null;
  progressMode?: OkrObjective["progress_mode"];
  statusMode: OkrObjective["status_mode"];
  metricUnit: OkrMetricUnit;
  customUnit: string | null;
  initialTab?: "progress" | "tasks" | "records" | "notes";
};

const UNITS: OkrMetricUnit[] = ["percent", "cny", "usd", "none", "custom"];
const STATUSES: OkrProgressStatus[] = ["none", "normal", "risk", "delayed"];

function activeCycle(cycles: OkrCycle[]) {
  const today = new Date().toISOString().slice(0, 10);
  return cycles.find((cycle) => cycle.status === "active"
    && cycle.starts_on <= today && cycle.ends_on >= today)
    ?? cycles.find((cycle) => cycle.status === "active")
    ?? cycles.find((cycle) => cycle.status === "closed")
    ?? cycles[0]
    ?? null;
}

function memberName(members: Member[], userId: string) {
  return members.find((member) => member.user_id === userId)?.profile?.display_name ?? "团队成员";
}

function cycleKey(workspaceId: string) {
  return ["okr-cycles", workspaceId] as const;
}

function setKey(workspaceId: string, cycleId: string, ownerId: string) {
  return ["okr-set", workspaceId, cycleId, ownerId] as const;
}

function emptyPreferences(userId: string, workspaceId: string, cycleId: string): OkrDisplayPreferences {
  return {
    user_id: userId,
    workspace_id: workspaceId,
    cycle_id: cycleId,
    show_progress: true,
    show_score: false,
    show_weight: true,
    apply_all_cycles: false,
  };
}

export function OkrWorkspace(props: OkrWorkspaceProps) {
  const client = supabase!;
  const queryClient = useQueryClient();
  const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
  const backendAvailable = Boolean(supabase) && !demoMode;
  const demoData = useMemo(() => demoMode ? createDemoOkrData(props.workspaceId) : null,
    [demoMode, props.workspaceId]);
  const canManageCycles = backendAvailable && props.online
    && (props.currentRole === "owner" || props.currentRole === "admin");
  const [ownerId, setOwnerId] = useState(props.initialOwnerId ?? props.currentUserId);
  const [cycleId, setCycleId] = useState(props.initialCycleId ?? "");
  const [memberSearch, setMemberSearch] = useState("");
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [cycleManagerOpen, setCycleManagerOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingObjectiveId, setEditingObjectiveId] = useState<string | null>(null);
  const [objectiveDraft, setObjectiveDraft] = useState<OkrObjective | null>(null);
  const [progressTarget, setProgressTarget] = useState<ProgressTarget | null>(null);
  const consumedTargetRef = useRef<string | null>(null);
  const initialRoutePairRef = useRef(props.initialTarget
    ? `${props.initialOwnerId ?? props.currentUserId}:${props.initialCycleId ?? ""}`
    : null);
  const [statusEditor, setStatusEditor] = useState<{ target: ProgressTarget; anchor: HTMLElement } | null>(null);
  const [alignmentObjective, setAlignmentObjective] = useState<OkrObjective | null>(null);
  const [draggingObjectiveId, setDraggingObjectiveId] = useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<"saved" | "saving" | "invalid" | "offline">("saved");
  const autosaveSignatureRef = useRef("");
  const hydratedObjectiveIdRef = useRef<string | null>(null);
  const persistGenerationRef = useRef(0);
  const lastPersistedDraftRef = useRef<OkrObjective | null>(null);

  const latestDraftRef = useRef(objectiveDraft);
  latestDraftRef.current = objectiveDraft;
  const writableRef = useRef(props.online && backendAvailable);
  writableRef.current = props.online && backendAvailable;
  const contextRef = useRef("");
  contextRef.current = `${props.workspaceId}:${cycleId}:${ownerId}`;
  const saveTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveRequestRef = useRef(0);
  const pendingOkrSavesRef = useRef(0);
  const manualSavingRef = useRef(false);
  const [savingObjective, setSavingObjective] = useState(false);

  const persistObjectiveDraft = useCallback((draft: OkrObjective, publish = false, others: OkrObjective[] = []) => {
    const request = ++saveRequestRef.current;
    const context = contextRef.current;
    const key = setKey(props.workspaceId, cycleId, ownerId);
    const save = async () => {
      // A queued autosave is superseded by the latest draft or an explicit save.
      if (!publish && request !== saveRequestRef.current) return false;
      if (hydratedObjectiveIdRef.current !== draft.id || context !== contextRef.current) return false;
      if (!writableRef.current || !navigator.onLine) throw new Error("离线时 OKR 仅可查看");
      const cached = queryClient.getQueryData<OkrSet | null>(key);
      const previous = lastPersistedDraftRef.current;
      const changes = buildOkrChanges([draft, ...others], [
        ...(previous ? [previous] : []),
        ...(cached?.objectives.filter((item) => item.id !== draft.id) ?? []),
      ]);
      pendingOkrSavesRef.current += 1;
      try {
        if (changes.objectives.length || publish) await queryClient.cancelQueries({ queryKey: key });
        const saved = await saveOkrChanges(client, draft.set_id, changes, publish);
        if (saved) {
          queryClient.setQueryData(key, saved);
          queryClient.setQueriesData<MyActiveOkrTree | null>(
            { queryKey: ["my-active-okr-tree", props.workspaceId, ownerId] },
            (current) => current?.set?.id === saved.id ? { ...current, set: saved } : current,
          );
        }
        // Advance the baseline before the next queued request computes its diff.
        if (hydratedObjectiveIdRef.current === draft.id) {
          lastPersistedDraftRef.current = structuredClone(draft);
          autosaveSignatureRef.current = JSON.stringify(draft);
        }
        return true;
      } finally {
        pendingOkrSavesRef.current -= 1;
      }
    };
    const pending = saveTailRef.current.then(save, save);
    saveTailRef.current = pending.catch(() => {});
    return pending;
  }, [client, props.online, props.workspaceId, cycleId, ownerId, queryClient]);

  useEffect(() => () => {
    hydratedObjectiveIdRef.current = null;
    saveRequestRef.current += 1;
    persistGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    if (props.online) return;
    // Unsent editor work must never turn into an offline write queue.
    saveRequestRef.current += 1;
    persistGenerationRef.current += 1;
    hydratedObjectiveIdRef.current = null;
    lastPersistedDraftRef.current = null;
    setEditingObjectiveId(null);
    setObjectiveDraft(null);
  }, [props.online]);

  useEffect(() => {
    if (!props.initialTarget) return;
    const incomingOwner = props.initialOwnerId ?? props.currentUserId;
    const incomingCycle = props.initialCycleId ?? cycleId;
    initialRoutePairRef.current = `${incomingOwner}:${incomingCycle}`;
    setOwnerId(incomingOwner);
    if (incomingCycle) setCycleId(incomingCycle);
  }, [props.initialOwnerId, props.initialCycleId, props.initialTarget?.id, props.initialTarget?.kind,
    props.initialTarget?.initialTab, props.initialTargetRevision]);

  const cyclesQuery = useQuery({
    queryKey: cycleKey(props.workspaceId),
    queryFn: () => loadOkrCycles(client, props.workspaceId),
    enabled: backendAvailable,
  });
  const cycles = demoData?.cycles ?? cyclesQuery.data ?? [];

  useEffect(() => {
    if (cycleId && cycles.some((cycle) => cycle.id === cycleId)) return;
    const selected = activeCycle(cycles);
    if (selected) setCycleId(selected.id);
  }, [cycleId, cycles]);

  useEffect(() => {
    if (!cycleId) return;
    const pair = `${ownerId}:${cycleId}`;
    if (initialRoutePairRef.current === pair) {
      initialRoutePairRef.current = null;
      return;
    }
    props.onNavigate(ownerId, cycleId);
  }, [cycleId, ownerId]);

  useEffect(() => {
    const handlePopState = () => {
      const route = parseAppRoute(window.location.hash.replace(/^#/, ""))
        ?? parseAppRoute(window.location.pathname);
      if (route?.kind !== "okr" || route.workspaceId !== props.workspaceId) return;
      if (route.ownerId) setOwnerId(route.ownerId);
      if (route.cycleId) setCycleId(route.cycleId);
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("hashchange", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("hashchange", handlePopState);
    };
  }, [props.workspaceId]);

  const ownerIdsQuery = useQuery({
    queryKey: ["okr-visible-owners", props.workspaceId, cycleId],
    queryFn: () => loadVisibleOkrOwnerIds(client, props.workspaceId, cycleId),
    enabled: backendAvailable && Boolean(cycleId),
  });
  const okrSetQuery = useQuery({
    queryKey: setKey(props.workspaceId, cycleId, ownerId),
    queryFn: () => loadOkrSet(client, props.workspaceId, cycleId, ownerId),
    enabled: backendAvailable && Boolean(cycleId && ownerId),
  });
  const preferencesQuery = useQuery({
    queryKey: ["okr-display-v2", props.currentUserId, props.workspaceId, cycleId],
    queryFn: () => loadOkrDisplayPreferences(client, props.currentUserId, props.workspaceId, cycleId),
    enabled: backendAvailable && Boolean(cycleId),
  });
  const alignableObjectivesQuery = useQuery({
    queryKey: ["okr-alignable-objectives", props.workspaceId, cycleId],
    queryFn: () => loadAlignableOkrObjectives(client, props.workspaceId, cycleId),
    enabled: backendAvailable && Boolean(cycleId),
  });
  const selectedCycle = cycles.find((cycle) => cycle.id === cycleId) ?? null;
  const demoSets = demoData?.sets.filter((set) => set.cycle_id === cycleId);
  const okrSet = demoData
    ? demoSets?.find((set) => set.owner_id === ownerId) ?? null
    : okrSetQuery.data ?? null;
  const alignableObjectives = demoSets
    ? demoSets.flatMap((set) => set.objectives.map((objective) => ({
        id: objective.id, title: objective.title, ownerId: set.owner_id,
      })))
    : alignableObjectivesQuery.data ?? [];
  const objectiveIds = okrSet?.objectives.map((objective) => objective.id) ?? [];
  const keyResultIds = okrSet?.objectives.flatMap((objective) => objective.key_results.map((keyResult) => keyResult.id)) ?? [];
  const linkedTaskCountsQuery = useQuery({
    queryKey: okrLinkedTaskCountsKey(props.workspaceId, okrSet?.id, keyResultIds),
    queryFn: () => loadOkrLinkedTaskCounts(client, props.workspaceId, keyResultIds),
    enabled: backendAvailable && Boolean(okrSet),
  });
  const demoTaskCounts = useMemo(() => {
    if (!demoMode) return undefined;
    const counts: Record<string, number> = {};
    for (const task of createDemoOkrLinkedTasks(props.workspaceId)) {
      counts[task.key_result_id] = (counts[task.key_result_id] ?? 0) + 1;
    }
    return counts;
  }, [demoMode, props.workspaceId]);
  const linkedTaskCounts = demoMode ? demoTaskCounts : linkedTaskCountsQuery.data;
  const progressCountsQuery = useQuery({
    queryKey: ["okr-progress-counts", okrSet?.id, okrSet?.updated_at],
    queryFn: () => loadOkrProgressRecordCounts(client, objectiveIds, keyResultIds),
    enabled: backendAvailable && Boolean(okrSet),
  });
  const progressCounts = progressCountsQuery.data ?? { objectives: {}, keyResults: {} };
  const editable = backendAvailable && props.online
    && ownerId === props.currentUserId
    && selectedCycle?.status === "active";
  const preferences = preferencesQuery.data
    ?? emptyPreferences(props.currentUserId, props.workspaceId, cycleId);
  const owner = props.members.find((member) => member.user_id === ownerId);
  const visibleOwnerIds = new Set([props.currentUserId,
    ...(demoSets?.map((set) => set.owner_id) ?? ownerIdsQuery.data ?? [])]);
  const searchedMembers = filterVisibleOkrMembers(props.members, visibleOwnerIds, memberSearch);

  useEffect(() => {
    if (!props.initialTarget || !okrSet || !selectedCycle) return;
    if (ownerId !== (props.initialOwnerId ?? props.currentUserId)
      || (props.initialCycleId && cycleId !== props.initialCycleId)) return;
    const targetKey = `${props.initialTarget.kind}:${props.initialTarget.id}:${props.initialTarget.initialTab}:${props.initialTargetRevision ?? 0}`;
    if (consumedTargetRef.current === targetKey) return;
    const objectiveIndex = okrSet.objectives.findIndex((item) => item.id === props.initialTarget!.id
      || item.key_results.some((keyResult) => keyResult.id === props.initialTarget!.id));
    const objective = okrSet.objectives[objectiveIndex];
    if (!objective) return;
    if (props.initialTarget.kind === "objective") {
      const progress = okrObjectiveProgress(objective);
      setProgressTarget({
        kind: "objective",
        id: objective.id,
        label: `O${objectiveIndex + 1}`,
        title: objective.title,
        startValue: 0,
        targetValue: 100,
        currentValue: progress,
        status: objective.status_mode === "automatic" ? automaticOkrStatus(progress, selectedCycle) : objective.progress_status,
        score: objective.score,
        progressMode: "key_results",
        statusMode: objective.status_mode,
        metricUnit: objective.metric_unit,
        customUnit: objective.custom_unit,
        initialTab: props.initialTarget.initialTab ?? "tasks",
      });
    } else {
      const keyResultIndex = objective.key_results.findIndex((item) => item.id === props.initialTarget!.id);
      const keyResult = objective.key_results[keyResultIndex];
      if (!keyResult) return;
      const progress = okrProgressPercent(keyResult);
      setProgressTarget({
        kind: "key_result",
        id: keyResult.id,
        label: `KR${keyResultIndex + 1}`,
        title: keyResult.title,
        startValue: keyResult.start_value,
        targetValue: keyResult.target_value,
        currentValue: keyResult.current_value,
        status: keyResult.status_mode === "automatic" ? automaticOkrStatus(progress, selectedCycle) : keyResult.progress_status,
        score: keyResult.score,
        statusMode: keyResult.status_mode,
        metricUnit: keyResult.metric_unit,
        customUnit: keyResult.custom_unit,
        initialTab: props.initialTarget.initialTab ?? "tasks",
      });
    }
    consumedTargetRef.current = targetKey;
  }, [okrSet, props.initialTarget?.id, props.initialTarget?.kind, props.initialTarget?.initialTab, props.initialTargetRevision, ownerId, cycleId, selectedCycle]);

  useEffect(() => {
    if (ownerId === props.currentUserId || ownerIdsQuery.isLoading) return;
    if (!visibleOwnerIds.has(ownerId)) setOwnerId(props.currentUserId);
  }, [ownerId, ownerIdsQuery.isLoading, ownerIdsQuery.data, props.currentUserId, demoData, cycleId]);

  useEffect(() => {
    if (!backendAvailable || !cycleId) return;
    const channel = client.channel(`okr:${props.workspaceId}:${cycleId}`);
    let refreshTimer: number | undefined;
    const pendingTables = new Set<string>();
    let pendingDiscoverabilityChange = false;
    const flushRefresh = () => {
      refreshTimer = undefined;
      if (pendingOkrSavesRef.current > 0) {
        refreshTimer = window.setTimeout(flushRefresh, 120);
        return;
      }
      const changedTables = new Set(pendingTables);
      pendingTables.clear();
      const discoverabilityChanged = pendingDiscoverabilityChange;
      pendingDiscoverabilityChange = false;
      const invalidations: Array<Promise<unknown>> = [];
      const contentChanged = [...changedTables].some((table) => ![
        "okr_versions", "okr_progress_records", "task_okr_links",
        "tasks", "task_labels", "labels", "label_user_acl", "label_group_acl",
      ].includes(table));
      if (contentChanged) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: ["okr-set", props.workspaceId, cycleId] }),
          queryClient.invalidateQueries({ queryKey: ["my-active-okr-tree", props.workspaceId] }),
        );
      }
      if (discoverabilityChanged) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: ["okr-visible-owners", props.workspaceId, cycleId] }),
          queryClient.invalidateQueries({ queryKey: ["okr-alignable-objectives", props.workspaceId, cycleId] }),
        );
      }
      if (changedTables.has("okr_versions")) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: ["okr-versions"] }));
      }
      if (changedTables.has("okr_progress_records")) {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: ["okr-progress-records"] }),
          queryClient.invalidateQueries({ queryKey: ["okr-progress-counts"] }),
          queryClient.invalidateQueries({ queryKey: ["okr-objective-history", props.workspaceId] }),
          queryClient.invalidateQueries({ queryKey: ["weekly-report-okr", props.workspaceId] }),
        );
      }
      const taskContentChanged = ["task_okr_links", "tasks", "task_labels", "labels", "label_user_acl", "label_group_acl"]
        .some((table) => changedTables.has(table));
      const accessChanged = changedTables.has("okr_access_revisions") || changedTables.has("user_group_members");
      if (taskContentChanged || accessChanged) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: ["okr-linked-task-counts", props.workspaceId] }));
      }
      if (contentChanged || taskContentChanged) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: ["okr-linked-tasks", props.workspaceId] }));
      }
      void Promise.all(invalidations);
    };
    const scheduleRefresh = (table: string, eventType?: string) => {
      pendingTables.add(table);
      pendingDiscoverabilityChange ||= okrRealtimeAffectsDiscoverability(table, eventType);
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(flushRefresh, 120);
    };
    const tables = [
      "okr_sets", "okr_set_user_acl", "okr_set_group_acl", "okr_objectives",
      "okr_objective_user_acl", "okr_objective_group_acl", "okr_objective_responsibles",
      "okr_objective_alignments", "okr_key_results", "okr_key_result_user_acl",
      "okr_key_result_group_acl", "okr_key_result_responsibles", "okr_kr_breakdowns",
      "okr_progress_records", "okr_versions", "okr_note_mentions",
      "okr_access_revisions",
      "user_group_members",
      "task_okr_links", "tasks", "task_labels", "labels", "label_user_acl", "label_group_acl",
    ];
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table,
          // task_labels has no workspace_id; DELETE link events only carry the primary key.
          ...(["task_labels", "task_okr_links"].includes(table) ? {} : { filter: `workspace_id=eq.${props.workspaceId}` }) },
        (payload) => {
          const changedWorkspace = (payload.new as { workspace_id?: string } | undefined)?.workspace_id;
          if (changedWorkspace && changedWorkspace !== props.workspaceId) return;
          scheduleRefresh(table, payload.eventType);
        },
      );
    }
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "okr_cycles", filter: `workspace_id=eq.${props.workspaceId}` },
      () => { void queryClient.invalidateQueries({ queryKey: cycleKey(props.workspaceId) }); },
    );
    channel.subscribe();
    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      void client.removeChannel(channel);
    };
  }, [backendAvailable, client, cycleId, props.workspaceId, queryClient]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: setKey(props.workspaceId, cycleId, ownerId) }),
      queryClient.invalidateQueries({ queryKey: ["okr-visible-owners", props.workspaceId, cycleId] }),
    ]);
  }

  async function runOnline(action: () => Promise<void>, success?: string) {
    if (!props.online || !backendAvailable) {
      props.onNotice(demoMode ? "产品演示中的 OKR 为只读示例" : "离线时 OKR 仅可查看", "error");
      return;
    }
    try {
      await action();
      if (success) props.onNotice(success);
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "操作失败，请重试", "error");
    }
  }

  async function runOptimistic(
    update: (current: OkrSet) => OkrSet,
    action: () => Promise<void>,
    success?: string,
  ) {
    if (!props.online || !backendAvailable) {
      props.onNotice(demoMode ? "产品演示中的 OKR 为只读示例" : "离线时 OKR 仅可查看", "error");
      return false;
    }
    const key = setKey(props.workspaceId, cycleId, ownerId);
    const previous = queryClient.getQueryData<OkrSet | null>(key);
    if (previous) queryClient.setQueryData(key, update(previous));
    try {
      await action();
      if (success) props.onNotice(success);
      return true;
    } catch (error) {
      queryClient.setQueryData(key, previous);
      props.onNotice(error instanceof Error ? error.message : "操作失败，请重试", "error");
      return false;
    } finally {
      await refresh();
    }
  }

  function saveNote(target: { kind: "objective" | "key_result"; id: string }, note: string, ids: string[] = []) {
    const currentSet = okrSet;
    const parent = currentSet?.objectives.find((item) => item.id === target.id || item.key_results.some((kr) => kr.id === target.id));
    if (!currentSet || !parent || !editable || !navigator.onLine) return Promise.reject(new Error("离线时 OKR 仅可查看"));
    const mentions = noteMentions(ids, props.members);
    const changed = { id: target.id, fields: { note }, mentioned_user_ids: ids };
    const key = setKey(props.workspaceId, cycleId, ownerId);
    const save = async () => {
      if (!writableRef.current || !navigator.onLine) throw new Error("离线时 OKR 仅可查看");
      pendingOkrSavesRef.current += 1;
      try {
        await queryClient.cancelQueries({ queryKey: key });
        const succeeded = await runOptimistic((current) => ({ ...current, objectives: current.objectives.map((item) => item.id !== parent.id ? item
          : target.kind === "objective" ? { ...item, note, note_mentions: mentions }
          : { ...item, key_results: item.key_results.map((kr) => kr.id === target.id ? { ...kr, note, note_mentions: mentions } : kr) }) }), async () => {
          const saved = await saveOkrChanges(client, currentSet.id, { objectives: [target.kind === "objective" ? changed : { id: parent.id, key_results: [changed] }] });
          if (saved) queryClient.setQueryData(key, saved);
          if (target.kind === "objective" && lastPersistedDraftRef.current?.id === target.id) {
            lastPersistedDraftRef.current = { ...lastPersistedDraftRef.current, note, note_mentions: mentions };
          }
        });
        if (!succeeded) throw new Error("备注保存失败，请重试");
      } finally { pendingOkrSavesRef.current -= 1; }
    };
    const pending = saveTailRef.current.then(save, save);
    saveTailRef.current = pending.catch(() => {});
    return pending;
  }

  async function ensureSet() {
    if (!selectedCycle) throw new Error("请先选择有效周期");
    return okrSet ?? ensureOkrSet(client, props.workspaceId, selectedCycle.id, props.currentUserId);
  }

  async function addObjective() {
    await runOnline(async () => {
      const set = await ensureSet();
      const row = await createOkrObjective(client, {
        set_id: set.id,
        workspace_id: props.workspaceId,
        title: "添加 Objective：写下一个清晰、有挑战的目标",
        note: "",
        position: okrSet?.objectives.length ?? 0,
      });
      const objective: OkrObjective = {
        ...row,
        start_value: Number(row.start_value),
        target_value: Number(row.target_value),
        current_value: row.current_value === null ? null : Number(row.current_value),
        score: row.score === null ? null : Number(row.score),
        responsible_ids: [],
        user_acl_ids: [],
        group_acl_ids: [],
        alignment_target_id: null,
        key_results: [],
      };
      queryClient.setQueryData<OkrSet | null>(setKey(props.workspaceId, cycleId, ownerId), (current) => ({
        ...set,
        ...(current ?? {}),
        user_acl_ids: current?.user_acl_ids ?? set.user_acl_ids ?? [],
        group_acl_ids: current?.group_acl_ids ?? set.group_acl_ids ?? [],
        objectives: (current?.objectives ?? set.objectives ?? []).some((item) => item.id === objective.id)
          ? (current?.objectives ?? set.objectives ?? [])
          : [...(current?.objectives ?? set.objectives ?? []), objective],
      }));
      queryClient.setQueryData<string[]>(["okr-visible-owners", props.workspaceId, cycleId], (current = []) =>
        current.includes(props.currentUserId) ? current : [...current, props.currentUserId]);
      queryClient.setQueryData<Array<{ id: string; title: string; ownerId: string }>>(
        ["okr-alignable-objectives", props.workspaceId, cycleId],
        (current = []) => current.some((item) => item.id === objective.id)
          ? current
          : [...current, { id: objective.id, title: objective.title, ownerId: props.currentUserId }],
      );
      setEditingObjectiveId(row.id);
    });
  }

  useEffect(() => {
    if (!editingObjectiveId) {
      persistGenerationRef.current += 1;
      saveRequestRef.current += 1;
      hydratedObjectiveIdRef.current = null;
      lastPersistedDraftRef.current = null;
      setObjectiveDraft(null);
      return;
    }
    if (hydratedObjectiveIdRef.current === editingObjectiveId) return;
    const objective = okrSet?.objectives.find((item) => item.id === editingObjectiveId) ?? null;
    if (!objective) return;
    const draft = structuredClone(objective);
    draft.key_results = withDefaultOkrWeights(draft.key_results);
    persistGenerationRef.current += 1;
    saveRequestRef.current += 1;
    hydratedObjectiveIdRef.current = editingObjectiveId;
    lastPersistedDraftRef.current = structuredClone(objective);
    autosaveSignatureRef.current = JSON.stringify(objective);
    setAutosaveStatus(props.online ? "saved" : "offline");
    setObjectiveDraft(draft);
  }, [editingObjectiveId, okrSet]);

  useEffect(() => {
    if (!objectiveDraft || !editingObjectiveId || manualSavingRef.current) return;
    const signature = JSON.stringify(objectiveDraft);
    if (signature === autosaveSignatureRef.current) return;
    if (!props.online) {
      setAutosaveStatus("offline");
      return;
    }
    if (!objectiveDraft.title.trim()
      || !okrWeightsValid(objectiveDraft.key_results)
      || objectiveDraft.key_results.some((keyResult) => !okrBreakdownsValid(keyResult))) {
      setAutosaveStatus("invalid");
      return;
    }
    setAutosaveStatus("saving");
    const generation = persistGenerationRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (generation !== persistGenerationRef.current) return;
          const saved = await persistObjectiveDraft(objectiveDraft);
          if (!saved) return;
          if (generation !== persistGenerationRef.current
            || signature !== JSON.stringify(latestDraftRef.current)) return;
          setAutosaveStatus("saved");
        } catch (error) {
          if (generation !== persistGenerationRef.current) return;
          setAutosaveStatus("invalid");
          props.onNotice(error instanceof Error ? error.message : "自动保存失败", "error");
        }
      })();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [client, editingObjectiveId, objectiveDraft, persistObjectiveDraft, props.online]);

  async function saveObjective(publish: boolean) {
    const currentDraft = latestDraftRef.current;
    if (!currentDraft || !okrSet || manualSavingRef.current) return;
    if (!currentDraft.title.trim()) {
      props.onNotice("Objective 标题不能为空", "error");
      return;
    }
    const keyResults = withDefaultOkrWeights(currentDraft.key_results);
    const draft = keyResults === currentDraft.key_results
      ? currentDraft
      : { ...currentDraft, key_results: keyResults };
    const objectives = okrSet.objectives.map((item) => {
      const current = item.id === draft.id ? draft : item;
      const nextKeyResults = withDefaultOkrWeights(current.key_results);
      return nextKeyResults === current.key_results
        ? current
        : { ...current, key_results: nextKeyResults };
    });
    const invalidBreakdown = draft.key_results.find((kr) => !okrBreakdownsValid(kr));
    if (invalidBreakdown) {
      props.onNotice(`「${invalidBreakdown.title}」的拆解额度必须等于目标值`, "error");
      return;
    }
    if (!okrWeightsValid(draft.key_results)) {
      props.onNotice("Key Result 权重之和必须等于 100%", "error");
      return;
    }
    if (publish) {
      const blocking = okrPublishBlockingMessage(objectives);
      if (blocking) {
        props.onNotice(blocking, "error");
        return;
      }
    }
    persistGenerationRef.current += 1;
    const generation = persistGenerationRef.current;
    if (draft !== currentDraft) setObjectiveDraft(draft);
    manualSavingRef.current = true;
    setSavingObjective(true);
    try {
      await runOnline(async () => {
        const saved = await persistObjectiveDraft(draft, publish,
          publish ? objectives.filter((item) => item.id !== draft.id) : []);
        if (!saved || generation !== persistGenerationRef.current) return;
        setEditingObjectiveId(null);
        props.onNotice(publish ? "OKR 已发布" : "草稿已保存");
      });
    } finally {
      manualSavingRef.current = false;
      setSavingObjective(false);
    }
  }

  async function reorderObjectives(targetId: string) {
    if (!okrSet || !draggingObjectiveId || draggingObjectiveId === targetId) return;
    const ordered = [...okrSet.objectives];
    const from = ordered.findIndex((objective) => objective.id === draggingObjectiveId);
    const to = ordered.findIndex((objective) => objective.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    const positioned = ordered.map((objective, position) => ({ ...objective, position }));
    setDraggingObjectiveId(null);
    await runOptimistic(
      (current) => ({ ...current, objectives: positioned }),
      async () => { await Promise.all(positioned.map((objective) => updateOkrObjective(client, objective))); },
    );
  }

  async function saveAlignment(objective: OkrObjective, targetId: string | null) {
    await runOptimistic(
      (current) => ({
        ...current,
        objectives: current.objectives.map((item) => item.id === objective.id
          ? { ...item, alignment_target_id: targetId }
          : item),
      }),
      async () => { await updateOkrObjective(client, { ...objective, alignment_target_id: targetId }); },
      targetId ? "对齐关系已更新" : "已取消对齐",
    );
    setAlignmentObjective(null);
  }

  async function addKeyResult() {
    if (!objectiveDraft) return;
    await runOnline(async () => {
      const weights = equalOkrWeights(objectiveDraft.key_results.length + 1);
      const now = new Date().toISOString();
      const reweighted = objectiveDraft.key_results.map((keyResult, index) => ({
        ...keyResult,
        weight: weights[index] ?? keyResult.weight,
        updated_at: now,
      }));
      const row = await createOkrKeyResultWithBalancedWeights(client, {
        objective_id: objectiveDraft.id,
        workspace_id: props.workspaceId,
        title: "添加 Key Result：写一个清晰可衡量的关键结果",
        position: objectiveDraft.key_results.length,
        weight: weights.at(-1) ?? 100,
      }, reweighted);
      const keyResult: OkrKeyResult = {
        ...row,
        start_value: Number(row.start_value),
        target_value: Number(row.target_value),
        current_value: row.current_value === null ? null : Number(row.current_value),
        weight: Number(row.weight),
        score: row.score === null ? null : Number(row.score),
        responsible_ids: [],
        user_acl_ids: [],
        group_acl_ids: [],
        breakdowns: [],
      };
      const nextDraft = { ...objectiveDraft, key_results: [...reweighted, keyResult] };
      autosaveSignatureRef.current = JSON.stringify(nextDraft);
      setAutosaveStatus("saved");
      setObjectiveDraft(nextDraft);
      queryClient.setQueryData<OkrSet | null>(setKey(props.workspaceId, cycleId, ownerId), (current) => current ? {
        ...current,
        objectives: current.objectives.map((objective) => objective.id === objectiveDraft.id
          ? nextDraft
          : objective),
      } : current);
    });
  }

  async function removeObjective(objectiveId: string) {
    if (!window.confirm("删除后将同时移除该 Objective 下的 Key Result，是否继续？")) return;
    await runOptimistic(
      (current) => ({ ...current, objectives: current.objectives.filter((objective) => objective.id !== objectiveId) }),
      async () => { await deleteOkrObjective(client, objectiveId); },
      "Objective 已删除",
    );
  }

  async function applyProgress(
    target: ProgressTarget,
    value: number | null,
    status: OkrProgressStatus,
    detail: string,
  ) {
    const succeeded = await runOptimistic((current) => ({
      ...current,
      objectives: current.objectives.map((objective) => target.kind === "objective" && objective.id === target.id
        ? { ...objective, progress_status: status }
        : {
            ...objective,
            key_results: objective.key_results.map((keyResult) => target.kind === "key_result" && keyResult.id === target.id
              ? { ...keyResult, current_value: value, progress_status: status }
              : keyResult),
          }),
    }), async () => {
      if (target.kind === "objective") await updateOkrObjectiveStatus(client, target.id, status);
      else await updateOkrProgress(client, { kind: target.kind, id: target.id }, value, status, detail);
    }, "进度已更新");
    if (succeeded) {
      setProgressTarget((current) => current?.id === target.id
        ? { ...current, ...(target.kind === "key_result" ? { currentValue: value } : {}), status }
        : current);
      setStatusEditor((current) => current?.target.id === target.id
        ? { ...current, target: { ...current.target, ...(target.kind === "key_result" ? { currentValue: value } : {}), status } }
        : current);
    }
    return succeeded;
  }

  const cycleIndex = Math.max(0, cycles.findIndex((cycle) => cycle.id === cycleId));
  const adjacentCycle = cycles[cycleIndex - 1] ?? cycles[cycleIndex + 1];

  return (
    <div className="okr-layout">
      <button
        className={clsx("sidebar-scrim", mobileMembersOpen && "visible")}
        type="button"
        aria-label="关闭员工列表"
        onClick={() => setMobileMembersOpen(false)}
      />
      <aside className={clsx("okr-member-sidebar", mobileMembersOpen && "mobile-open")}>
        <div className="okr-member-search">
          <Search aria-hidden="true" />
          <input
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.target.value)}
            placeholder="搜索员工"
            aria-label="搜索员工"
          />
        </div>
        <div className="okr-member-caption">我的 OKR</div>
        <MemberRow
          member={props.members.find((member) => member.user_id === props.currentUserId)}
          active={ownerId === props.currentUserId}
          onClick={() => {
            setOwnerId(props.currentUserId);
            setMobileMembersOpen(false);
          }}
        />
        <div className="okr-member-caption">可查看的OKR</div>
        <div className="okr-member-list">
          {searchedMembers.filter((member) => member.user_id !== props.currentUserId).map((member) => (
            <MemberRow
              key={member.user_id}
              member={member}
              active={ownerId === member.user_id}
              onClick={() => {
                setOwnerId(member.user_id);
                setMobileMembersOpen(false);
              }}
            />
          ))}
          {!searchedMembers.length && <p className="okr-sidebar-empty">没有匹配的员工</p>}
        </div>
      </aside>

      <main className="okr-workspace">
        <header className="okr-header">
          <div className="okr-owner-title">
            <button className="mobile-menu" type="button" aria-label="打开导航" onClick={props.onMenu}>
              <Menu />
            </button>
            <button className="okr-mobile-members" type="button" aria-label="打开员工列表" onClick={() => setMobileMembersOpen(true)}>
              <UserPlus />
            </button>
            {owner && <MemberAvatar member={owner} className="okr-owner-avatar" />}
            <h1>{owner?.profile?.display_name ?? "我的 OKR"}</h1>
          </div>
          <div className={clsx("okr-cycle-switcher", adjacentCycle && "has-adjacent-cycle")}>
            <button
              type="button"
              aria-label="上一个周期"
              disabled={cycleIndex >= cycles.length - 1}
              onClick={() => setCycleId(cycles[cycleIndex + 1]?.id ?? cycleId)}
            ><ChevronLeft /></button>
            {adjacentCycle && <button className="okr-adjacent-cycle" type="button" onClick={() => setCycleId(adjacentCycle.id)}>
              {adjacentCycle.name}
            </button>}
            <select value={cycleId} onChange={(event) => setCycleId(event.target.value)} aria-label="OKR 周期">
              {!cycles.length && <option value="">暂无周期</option>}
              {cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}
            </select>
            <button
              type="button"
              aria-label="下一个周期"
              disabled={cycleIndex <= 0}
              onClick={() => setCycleId(cycles[cycleIndex - 1]?.id ?? cycleId)}
            ><ChevronRight /></button>
          </div>
          <div className="okr-header-actions">
            <button type="button" aria-label="更多" onClick={() => setMoreOpen((open) => !open)}><Ellipsis /></button>
            {moreOpen && (
              <div className="okr-more-menu" role="menu">
                {editable && <button role="menuitem" onClick={() => { setPermissionOpen(true); setMoreOpen(false); }}><LockKeyhole />权限设置</button>}
                <button role="menuitem" disabled={!backendAvailable || !props.online} onClick={() => { setDisplayOpen(true); setMoreOpen(false); }}><Eye />显示设置</button>
                {okrSet && backendAvailable && <button role="menuitem" onClick={() => { setHistoryOpen(true); setMoreOpen(false); }}><History />历史版本</button>}
                {editable && <button role="menuitem" onClick={() => {
                  setMoreOpen(false);
                  void runOnline(async () => {
                    await ensureSet();
                    await refresh();
                    setImportOpen(true);
                  });
                }}><Import />从其他周期导入</button>}
                {canManageCycles && <button role="menuitem" onClick={() => { setCycleManagerOpen(true); setMoreOpen(false); }}><Settings2 />周期管理</button>}
              </div>
            )}
          </div>
        </header>

        <div className="okr-scroll">
          {!selectedCycle ? (
            <EmptyOkr title="还没有 OKR 周期" detail={!backendAvailable
              ? "演示空间不连接数据库，请在正式团队空间使用 OKR。"
              : canManageCycles
                ? "请从右上角“更多”中创建周期。"
                : "请联系团队管理员创建周期。"} />
          ) : okrSetQuery.isLoading ? (
            <EmptyOkr title="正在加载 OKR" detail="请稍候…" />
          ) : !okrSet || okrSet.objectives.length === 0 ? (
            <EmptyOkr
              title={ownerId === props.currentUserId ? "开始制定本周期 OKR" : "该员工还没有发布 OKR"}
              detail={editable ? "用一个有挑战的 Objective 开始，再补充可衡量的 Key Result。" : "切换员工或周期查看其他 OKR。"}
              action={editable ? <button className="button primary" onClick={() => void addObjective()}><Plus />添加 Objective</button> : null}
            />
          ) : (
            <div className="okr-objective-list">
              {okrSet.objectives.map((objective, objectiveIndex) => editingObjectiveId === objective.id && objectiveDraft ? (
                <ObjectiveEditor
                  key={objective.id}
                  objective={objectiveDraft}
                  busy={savingObjective}
                  index={objectiveIndex}
                  currentUserId={props.currentUserId}
                  members={props.members}
                  groups={props.userGroups}
                  preferences={preferences}
                  onChange={setObjectiveDraft}
                  onSaveNote={(note, ids) => saveNote({ kind: "objective", id: objective.id }, note, ids)}
                  onAddKeyResult={() => void addKeyResult()}
                  onRemoveKeyResult={(keyResultId) => {
                    void runOnline(async () => {
                      if (!objectiveDraft) return;
                      persistGenerationRef.current += 1;
                      const remaining = withRebalancedOkrWeights(
                        objectiveDraft.key_results.filter((keyResult) => keyResult.id !== keyResultId),
                      );
                      await deleteOkrKeyResult(client, keyResultId);
                      if (remaining.length) await updateOkrKeyResultWeights(client, remaining);
                      const nextDraft = { ...objectiveDraft, key_results: remaining };
                      lastPersistedDraftRef.current = structuredClone(nextDraft);
                      autosaveSignatureRef.current = JSON.stringify(nextDraft);
                      setAutosaveStatus("saved");
                      setObjectiveDraft(nextDraft);
                    });
                  }}
                  onCancel={() => setEditingObjectiveId(null)}
                  onSave={() => void saveObjective(false)}
                  onPublish={() => void saveObjective(true)}
                  online={props.online}
                  autosaveStatus={autosaveStatus}
                />
              ) : (
                <ObjectiveCard
                  key={objective.id}
                  objective={objective}
                  index={objectiveIndex}
                  members={props.members}
                  cycle={selectedCycle}
                  preferences={preferences}
                  editable={editable}
                  dragging={draggingObjectiveId === objective.id}
                  alignmentLabel={alignableObjectives.find((item) => item.id === objective.alignment_target_id)?.title}
                  objectiveRecordCount={progressCounts.objectives[objective.id] ?? 0}
                  keyResultRecordCounts={progressCounts.keyResults}
                  objectiveTaskCount={linkedTaskCounts ? objective.key_results.reduce((sum, kr) => sum + (linkedTaskCounts[kr.id] ?? 0), 0) : undefined}
                  keyResultTaskCounts={linkedTaskCounts}
                  onAlign={() => setAlignmentObjective(objective)}
                  onDragStart={() => setDraggingObjectiveId(objective.id)}
                  onDrop={() => void reorderObjectives(objective.id)}
                  onEdit={() => setEditingObjectiveId(objective.id)}
                  onDelete={() => void removeObjective(objective.id)}
                  onProgress={setProgressTarget}
                  onStatus={(target, anchor) => setStatusEditor((current) =>
                    current?.target.id === target.id ? null : { target, anchor })}
                  statusTargetId={statusEditor?.target.id}
                  onScore={async (kind, id, score) => {
                    await runOptimistic((current) => ({
                      ...current,
                      objectives: current.objectives.map((item) => item.id !== objective.id
                        ? item
                        : kind === "objective"
                          ? { ...item, score }
                          : {
                              ...item,
                              key_results: item.key_results.map((keyResult) => keyResult.id === id
                                ? { ...keyResult, score }
                                : keyResult),
                            }),
                    }), async () => {
                      if (kind === "objective") await updateOkrObjective(client, { ...objective, score });
                      else {
                        const kr = objective.key_results.find((item) => item.id === id);
                        if (kr) await updateOkrKeyResult(client, { ...kr, score });
                      }
                    });
                  }}
                />
              ))}
              {editable && (
                <div className="okr-add-actions">
                  <button className="okr-add-objective" type="button" onClick={() => void addObjective()}>
                    <span className="okr-action-icon"><Plus /></span>添加 Objective
                  </button>
                  <button className="okr-import-objectives" type="button" onClick={() => {
                    void runOnline(async () => {
                      await ensureSet();
                      await refresh();
                      setImportOpen(true);
                    });
                  }}>
                    <span className="okr-action-icon"><Import /></span>从其他周期导入
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <CycleManagerDialog
        open={cycleManagerOpen}
        onOpenChange={setCycleManagerOpen}
        cycles={cycles}
        workspaceId={props.workspaceId}
        userId={props.currentUserId}
        onChanged={async () => {
          await queryClient.invalidateQueries({ queryKey: cycleKey(props.workspaceId) });
        }}
        runOnline={runOnline}
      />
      <PermissionDialog
        open={permissionOpen}
        onOpenChange={setPermissionOpen}
        set={okrSet}
        members={props.members}
        groups={props.userGroups}
        onSave={async (visibility, userIds, groupIds) => { await runOptimistic((current) => ({
          ...current,
          visibility,
          user_acl_ids: userIds,
          group_acl_ids: groupIds,
        }), async () => {
          if (!okrSet) return;
          await saveOkrSetVisibility(client, okrSet.id, props.workspaceId, visibility, userIds, groupIds);
          setPermissionOpen(false);
        }, "权限已更新"); }}
      />
      <DisplaySettingsDialog
        open={displayOpen}
        onOpenChange={setDisplayOpen}
        preferences={preferences}
        cycleId={cycleId}
        onSave={(next) => runOnline(async () => {
          await saveOkrDisplayPreferences(client, next);
          await queryClient.invalidateQueries({ queryKey: ["okr-display-v2", props.currentUserId, props.workspaceId] });
          setDisplayOpen(false);
        }, "显示设置已保存")}
      />
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} set={okrSet} />
      <AlignmentDialog
        open={Boolean(alignmentObjective)}
        onOpenChange={(open) => { if (!open) setAlignmentObjective(null); }}
        objective={alignmentObjective}
        options={alignableObjectives.filter((item) => item.id !== alignmentObjective?.id)}
        members={props.members}
        onSave={(targetId) => alignmentObjective
          ? saveAlignment(alignmentObjective, targetId)
          : Promise.resolve()}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        cycles={cycles.filter((cycle) => cycle.id !== cycleId)}
        currentSet={okrSet}
        workspaceId={props.workspaceId}
        ownerId={props.currentUserId}
        onImported={refresh}
        runOnline={runOnline}
      />
      <StatusPopover
        editor={statusEditor}
        editable={editable}
        onClose={() => setStatusEditor(null)}
        onAdvanced={() => {
          if (!statusEditor) return;
          setProgressTarget(statusEditor.target);
          setStatusEditor(null);
        }}
        onSave={async (value, status) => {
          if (!statusEditor) return false;
          return applyProgress(statusEditor.target, value, status, "");
        }}
      />
      <ProgressDialog
        taskCreation={props.taskCreation}
        currentUserId={props.currentUserId}
        preferences={preferences}
        noteEntity={okrSet?.objectives.flatMap((item) => [item, ...item.key_results]).find((item) => item.id === progressTarget?.id)}
        onSaveNote={(note, ids) => progressTarget ? saveNote(progressTarget, note, ids) : Promise.reject(new Error("OKR 已不可用"))}
        online={props.online}
        onNotice={props.onNotice}
        backendAvailable={backendAvailable}
        objective={okrSet?.objectives.find((objective) => objective.id === progressTarget?.id)}
        open={Boolean(progressTarget)}
        onOpenChange={(open) => { if (!open) setProgressTarget(null); }}
        target={progressTarget}
        editable={editable}
        cycle={selectedCycle}
        members={props.members}
        workspaceId={props.workspaceId}
        demoMode={demoMode}
        onOpenTask={props.onOpenTask ?? (() => undefined)}
        onSave={async (value, status, detail) => {
          if (!progressTarget) return false;
          return applyProgress(progressTarget, value, status, detail);
        }}
      />
    </div>
  );
}

function MemberRow({ member, active, onClick }: {
  member?: Member;
  active: boolean;
  onClick: () => void;
}) {
  if (!member) return null;
  return (
    <button className={clsx("okr-member-row", active && "active")} type="button" onClick={onClick}>
      <MemberAvatar member={member} className="okr-member-avatar" />
      <span>{member.profile?.display_name ?? "团队成员"}</span>
    </button>
  );
}

function EmptyOkr({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="okr-empty">
      <Goal />
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function statusClass(status: OkrProgressStatus) {
  return `okr-status-${status}`;
}

function OkrProgressMeter({
  progress,
  status,
  className,
  statusOpen,
  onOpenDetail,
  onOpenStatus,
}: {
  progress: number | null;
  status: OkrProgressStatus;
  className: string;
  statusOpen?: boolean;
  onOpenDetail: () => void;
  onOpenStatus: (anchor: HTMLElement) => void;
}) {
  return (
    <div className={clsx(className, progress === null && "empty")}>
      {progress !== null && (
        <button className="okr-progress-meter-hit" type="button" onClick={onOpenDetail}>
          <span className="okr-progress-meter">
            <span className="okr-progress-current">{progress}%</span>
            <i><b style={{ width: `${progress}%` }} /></i>
          </span>
        </button>
      )}
      <button
        type="button"
        className={clsx("okr-status-trigger", statusClass(status), statusOpen && "open")}
        aria-haspopup="dialog"
        aria-expanded={statusOpen}
        aria-label={`状态 ${OKR_STATUS_LABELS[status]}`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpenStatus(event.currentTarget);
        }}
      >
        {OKR_STATUS_LABELS[status]}
      </button>
    </div>
  );
}

function StatusPopover({
  editor,
  editable,
  onClose,
  onAdvanced,
  onSave,
}: {
  editor: { target: ProgressTarget; anchor: HTMLElement } | null;
  editable: boolean;
  onClose: () => void;
  onAdvanced: () => void;
  onSave: (value: number | null, status: OkrProgressStatus) => Promise<boolean>;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<OkrProgressStatus>("none");
  const [submitting, setSubmitting] = useState(false);
  const target = editor?.target ?? null;
  const progressLocked = target?.progressMode === "key_results";
  const unit = target
    ? okrMetricUnitLabel(target.metricUnit, target.customUnit) || "%"
    : "%";
  useEffect(() => {
    setValue(target?.currentValue === null || target?.currentValue === undefined ? "" : String(target.currentValue));
    setStatus(target?.status ?? "none");
    setSubmitting(false);
  }, [target?.id, target?.kind, target?.currentValue, target?.status]);
  useLayoutEffect(() => {
    if (!editor) return;
    const place = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      const rect = editor.anchor.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const gap = 12;
      let placement: "left" | "right" = "left";
      let left = rect.left - width - gap;
      if (left < 12) {
        left = Math.min(rect.right + gap, window.innerWidth - width - 12);
        placement = "right";
      }
      let top = rect.top + rect.height / 2 - height / 2;
      top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
      popover.style.left = `${Math.max(12, left)}px`;
      popover.style.top = `${top}px`;
      popover.dataset.placement = placement;
      popover.style.setProperty("--okr-status-arrow-top", `${rect.top + rect.height / 2 - top}px`);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: MouseEvent) => {
      const node = event.target as Node | null;
      if (popoverRef.current?.contains(node) || editor.anchor.contains(node)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [editor, onClose]);
  if (!editor || !target) return null;
  return createPortal(
    <div
      ref={popoverRef}
      className="okr-status-popover"
      role="dialog"
      aria-label="更新状态"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="okr-status-popover-field">
        <span>状态<em>*</em></span>
        <div className="okr-status-popover-options" role="radiogroup" aria-label="状态">
          {STATUSES.map((item) => (
            <label key={item} className={`okr-status-option okr-status-option-${item}`}>
              <input
                type="radio"
                name={`okr-status-${target.id}`}
                checked={status === item}
                disabled={!editable}
                onChange={() => setStatus(item)}
              />
              {OKR_STATUS_LABELS[item]}
            </label>
          ))}
        </div>
      </div>
      <label className="okr-status-popover-field">
        <span>进度值</span>
        <span className="okr-status-popover-value">
          <input
            type="number"
            inputMode="decimal"
            aria-label="进度值"
            value={value}
            disabled={!editable || progressLocked}
            onChange={(event) => setValue(event.target.value)}
          />
          <em>{unit}</em>
        </span>
      </label>
      <footer>
        <button className="okr-status-popover-advanced" type="button" onClick={onAdvanced}>
          <Settings2 />高级设置
        </button>
        <div>
          <button className="button secondary" type="button" onClick={onClose}>取消</button>
          <button
            className="button primary"
            type="button"
            disabled={!editable || submitting}
            onClick={() => {
              void (async () => {
                setSubmitting(true);
                const succeeded = await onSave(value.trim() === "" ? null : Number(value), status);
                setSubmitting(false);
                if (succeeded) onClose();
              })();
            }}
          >
            {submitting ? "提交中…" : "提交"}
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}

function OkrResponsibleAvatars({ ids, members }: { ids: string[]; members: Member[] }) {
  return <span className="okr-responsibles">{ids.map((id) => {
    const member = members.find((item) => item.user_id === id);
    return member ? <span key={id} aria-label={memberName(members, id)}><MemberAvatar member={member}
      className="okr-responsible-avatar" title={memberName(members, id)} /></span> : null;
  })}</span>;
}

function NoteToggle({ expanded, onToggle, id }: { expanded: boolean; onToggle: () => void; id: string }) {
  return <button className="okr-note-toggle" type="button" aria-label={expanded ? "收起备注" : "展开备注"}
    aria-expanded={expanded} aria-controls={`okr-note-${id}`} onClick={(event) => { event.stopPropagation(); onToggle(); }}>
    {expanded ? <ChevronDown /> : <ChevronRight />}
  </button>;
}

function ObjectiveCard({ objective, index, members, cycle, preferences, editable, dragging, alignmentLabel, objectiveRecordCount, keyResultRecordCounts, objectiveTaskCount, keyResultTaskCounts, onAlign, onDragStart, onDrop, onEdit, onDelete, onProgress, onStatus, onScore, statusTargetId }: {
  objective: OkrObjective;
  index: number;
  members: Member[];
  cycle: OkrCycle;
  preferences: OkrDisplayPreferences;
  editable: boolean;
  dragging: boolean;
  alignmentLabel?: string;
  objectiveRecordCount: number;
  keyResultRecordCounts: Record<string, number>;
  objectiveTaskCount?: number;
  keyResultTaskCounts?: Record<string, number>;
  onAlign: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onProgress: (target: ProgressTarget) => void;
  onStatus: (target: ProgressTarget, anchor: HTMLElement) => void;
  onScore: (kind: "objective" | "key_result", id: string, score: number | null) => Promise<void>;
  statusTargetId?: string;
}) {
  const [noteExpanded, setNoteExpanded] = useState(false);
  const progress = okrObjectiveProgress(objective);
  const displayedStatus = objective.status_mode === "automatic"
    ? automaticOkrStatus(progress, cycle)
    : objective.progress_status;
  const progressTarget: ProgressTarget = {
    kind: "objective",
    id: objective.id,
    label: `O${index + 1}`,
    title: objective.title,
    startValue: 0,
    targetValue: 100,
    currentValue: progress,
    status: displayedStatus,
    score: objective.score,
    progressMode: "key_results",
    statusMode: objective.status_mode,
    metricUnit: objective.metric_unit,
    customUnit: objective.custom_unit,
  };
  return (
    <article
      className={clsx(
        "okr-objective-card",
        editable && "editable",
        dragging && "dragging",
        preferences.show_progress && "has-progress",
        preferences.show_score && "has-score",
        preferences.show_progress && progress !== null && "has-objective-progress",
      )}
      draggable={editable}
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest(".okr-objective-note, .okr-status-trigger, .okr-progress-cell, .okr-kr-progress")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(event) => { if (editable) event.preventDefault(); }}
      onDrop={(event) => { event.preventDefault(); onDrop(); }}
    >
      <div className="okr-objective-toolbar">
        <button type="button" className="okr-align-trigger" onClick={onAlign} disabled={!editable}>
          <Plus />{alignmentLabel ? `已对齐：${alignmentLabel}` : "添加对齐"}
        </button>
        <div className="okr-card-toolbar-meta" aria-hidden="true">
          {preferences.show_progress && <span>进度</span>}
          {preferences.show_score && <span>分数</span>}
          <span>记录</span>
          <span>待办</span>
        </div>
        {editable && <div className="okr-card-actions">
          <span className="okr-drag-handle" aria-label="拖拽排序"><GripVertical /></span>
          <button aria-label="编辑 Objective" onClick={onEdit}><Pencil /></button>
          <button aria-label="删除 Objective" onClick={onDelete}><Trash2 /></button>
        </div>}
      </div>
      <div className="okr-objective-row">
        <div className="okr-title-cell">
          <span className="okr-index objective">O{index + 1}</span>
          <button type="button" className="okr-title-button objective" onClick={() => onProgress(progressTarget)}>{objective.title}</button>
          {!!objective.note?.trim() && <NoteToggle id={objective.id} expanded={noteExpanded} onToggle={() => setNoteExpanded((open) => !open)} />}
          <OkrResponsibleAvatars ids={objective.responsible_ids} members={members} />
        </div>
        {preferences.show_progress && (
          <OkrProgressMeter
            className="okr-progress-cell"
            progress={progress}
            status={displayedStatus}
            onOpenDetail={() => onProgress(progressTarget)}
            onOpenStatus={(anchor) => onStatus(progressTarget, anchor)}
            statusOpen={statusTargetId === progressTarget.id}
          />
        )}
        {preferences.show_score && (
          <ScoreInput value={objective.score} editable={editable} onCommit={(score) => onScore("objective", objective.id, score)} />
        )}
        <button className="okr-record-count" type="button" aria-label={`查看 ${progressTarget.label} 进展记录`} onClick={() => onProgress({ ...progressTarget, initialTab: "records" })}>{objectiveRecordCount}</button>
        <button className="okr-task-count" type="button" aria-label={`查看 ${progressTarget.label} 待办清单`} title="查看关联待办" onClick={() => onProgress({ ...progressTarget, initialTab: "tasks" })}>{objectiveTaskCount ?? "—"}</button>
      </div>
      {noteExpanded && !!objective.note?.trim() && <div id={`okr-note-${objective.id}`} className="okr-inline-note"><OkrNoteContent value={objective.note} /></div>}
      <div className="okr-kr-list">
        {objective.key_results.map((kr, index) => (
          <KeyResultRow
            key={kr.id}
            keyResult={kr}
            index={index}
            members={members}
            cycle={cycle}
            preferences={preferences}
            recordCount={keyResultRecordCounts[kr.id] ?? 0}
            taskCount={keyResultTaskCounts ? keyResultTaskCounts[kr.id] ?? 0 : undefined}
            editable={editable}
            onProgress={onProgress}
            onStatus={onStatus}
            statusTargetId={statusTargetId}
            onScore={(score) => onScore("key_result", kr.id, score)}
          />
        ))}
      </div>
    </article>
  );
}

function KeyResultRow({ keyResult, index, members, cycle, preferences, editable, recordCount, taskCount, onProgress, onStatus, onScore, statusTargetId }: {
  keyResult: OkrKeyResult;
  index: number;
  members: Member[];
  cycle: OkrCycle;
  preferences: OkrDisplayPreferences;
  editable: boolean;
  recordCount: number;
  taskCount?: number;
  onProgress: (target: ProgressTarget) => void;
  onStatus: (target: ProgressTarget, anchor: HTMLElement) => void;
  onScore: (score: number | null) => Promise<void>;
  statusTargetId?: string;
}) {
  const [noteExpanded, setNoteExpanded] = useState(false);
  const progress = okrProgressPercent(keyResult);
  const displayedStatus = keyResult.status_mode === "automatic"
    ? automaticOkrStatus(progress, cycle)
    : keyResult.progress_status;
  const progressTarget: ProgressTarget = {
    kind: "key_result",
    id: keyResult.id,
    label: `KR${index + 1}`,
    title: keyResult.title,
    startValue: keyResult.start_value,
    targetValue: keyResult.target_value,
    currentValue: keyResult.current_value,
    status: displayedStatus,
    score: keyResult.score,
    statusMode: keyResult.status_mode,
    metricUnit: keyResult.metric_unit,
    customUnit: keyResult.custom_unit,
  };
  return (
    <div className="okr-kr-row">
      <div className="okr-title-cell">
        <span className="okr-index kr">KR{index + 1}</span>
        <button type="button" className="okr-title-button" onClick={() => onProgress(progressTarget)}>{keyResult.title}</button>
        {!!keyResult.note?.trim() && <NoteToggle id={keyResult.id} expanded={noteExpanded} onToggle={() => setNoteExpanded((open) => !open)} />}
        <OkrResponsibleAvatars ids={keyResult.responsible_ids} members={members} />
        {preferences.show_weight && <span className="okr-weight">{keyResult.weight}%</span>}
      </div>
      {preferences.show_progress && (
        <OkrProgressMeter
          className="okr-kr-progress"
          progress={progress}
          status={displayedStatus}
          onOpenDetail={() => onProgress(progressTarget)}
          onOpenStatus={(anchor) => onStatus(progressTarget, anchor)}
          statusOpen={statusTargetId === progressTarget.id}
        />
      )}
      {preferences.show_score && <ScoreInput value={keyResult.score} editable={editable} onCommit={onScore} />}
      <button className="okr-record-count" type="button" aria-label={`查看 ${progressTarget.label} 进展记录`} onClick={() => onProgress({ ...progressTarget, initialTab: "records" })}>{recordCount}</button>
      <button className="okr-task-count" type="button" aria-label={`查看 ${progressTarget.label} 待办清单`} title="查看关联待办" onClick={() => onProgress({ ...progressTarget, initialTab: "tasks" })}>{taskCount ?? "—"}</button>
      {noteExpanded && !!keyResult.note?.trim() && <div id={`okr-note-${keyResult.id}`} className="okr-inline-note"><OkrNoteContent value={keyResult.note} /></div>}
    </div>
  );
}

function ScoreInput({ value, editable, onCommit }: {
  value: number | null;
  editable: boolean;
  onCommit: (score: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value === null ? "" : value.toFixed(1));
  useEffect(() => setDraft(value === null ? "" : value.toFixed(1)), [value]);
  return <input
    className="okr-score"
    aria-label="评分"
    value={draft}
    placeholder="0.0"
    disabled={!editable}
    onChange={(event) => setDraft(event.target.value.replace(/[^0-9.]/g, ""))}
    onBlur={(event) => {
      const raw = event.currentTarget.value.trim();
      const parsed = raw ? Math.max(0, Math.min(1, Number(raw))) : null;
      const nextValue = parsed === null || Number.isFinite(parsed) ? parsed : value;
      setDraft(nextValue === null ? "" : nextValue.toFixed(1));
      void onCommit(nextValue);
    }}
  />;
}

function ObjectiveEditor({ objective, busy, index, currentUserId, members, groups, preferences, online, autosaveStatus, onChange, onSaveNote, onAddKeyResult, onRemoveKeyResult, onCancel, onSave, onPublish }: {
  objective: OkrObjective;
  index: number;
  members: Member[];
  groups: UserGroup[];
  preferences: OkrDisplayPreferences;
  online: boolean;
  autosaveStatus: "saved" | "saving" | "invalid" | "offline";
  onChange: (objective: OkrObjective) => void;
  onSaveNote: (note: string, ids?: string[]) => Promise<void>;
  onAddKeyResult: () => void;
  onRemoveKeyResult: (id: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onPublish: () => void;
  currentUserId: string;
  busy: boolean;
}) {
  const currentObjectiveRef = useRef(objective);
  currentObjectiveRef.current = objective;
  const noteEditorRef = useRef<TaskRichTextEditorHandle>(null);
  const flushNote = async (action: () => void) => {
    try { await noteEditorRef.current?.flush(); action(); } catch { /* The editor shows the save error. */ }
  };
  const [advancedKrId, setAdvancedKrId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draggingKrId, setDraggingKrId] = useState<string | null>(null);
  const patchKr = (id: string, patch: Partial<OkrKeyResult>) => onChange({
    ...objective,
    key_results: objective.key_results.map((kr) => kr.id === id ? { ...kr, ...patch } : kr),
  });
  const reorderKeyResults = (targetId: string) => {
    if (!draggingKrId || draggingKrId === targetId) return;
    const ordered = [...objective.key_results];
    const from = ordered.findIndex((keyResult) => keyResult.id === draggingKrId);
    const to = ordered.findIndex((keyResult) => keyResult.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    onChange({ ...objective, key_results: ordered.map((keyResult, position) => ({ ...keyResult, position })) });
    setDraggingKrId(null);
  };
  return (
    <article inert={busy} aria-busy={busy} className={clsx(
      "okr-objective-card editing",
      preferences.show_progress && "has-progress",
      preferences.show_score && "has-score",
      preferences.show_progress && okrObjectiveProgress(objective) !== null && "has-objective-progress",
    )}>
      <div className="okr-editor-body">
        <div className="okr-objective-toolbar">
          <button className="okr-align-trigger" type="button" aria-expanded={settingsOpen} aria-controls={`okr-objective-settings-${objective.id}`} onClick={() => setSettingsOpen((open) => !open)}>
            <Settings2 />目标设置
          </button>
        </div>
        <div className="okr-editor-objective-line">
          <span className="okr-index objective">O{index + 1}</span>
          <input value={objective.title} onChange={(event) => onChange({ ...objective, title: event.target.value })} aria-label="Objective 标题" />
          <MemberSelect currentUserId={currentUserId} online={online} members={members} selected={objective.responsible_ids} onChange={(ids) => onChange({ ...objective, responsible_ids: ids })} />
        </div>
        <div className="okr-editor-krs">
          {objective.key_results.map((kr, index) => (
            <div
              className={clsx("okr-editor-kr", draggingKrId === kr.id && "dragging")}
              key={kr.id}
              draggable
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggingKrId(kr.id); }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); reorderKeyResults(kr.id); }}
            >
              <div className="okr-editor-kr-line">
                <span className="okr-drag-handle"><GripVertical /></span>
                <span className="okr-index kr">KR{index + 1}</span>
                <input value={kr.title} onChange={(event) => patchKr(kr.id, { title: event.target.value })} aria-label={`KR${index + 1} 标题`} />
                <MemberSelect currentUserId={currentUserId} online={online} members={members} selected={kr.responsible_ids} onChange={(ids) => patchKr(kr.id, { responsible_ids: ids })} />
                {preferences.show_weight && <input className="okr-weight-input" type="number" min="0" max="100" placeholder="平均" value={Number(kr.weight) > 0 ? kr.weight : ""} onChange={(event) => patchKr(kr.id, { weight: event.target.value === "" ? 0 : Number(event.target.value) })} aria-label="权重" />}
                <button type="button" aria-label="高级设置" onClick={() => setAdvancedKrId((current) => current === kr.id ? null : kr.id)}><Settings2 /></button>
                <button type="button" aria-label="删除 Key Result" onClick={() => onRemoveKeyResult(kr.id)}><X /></button>
              </div>
              {advancedKrId === kr.id && <KeyResultAdvanced keyResult={kr} members={members} groups={groups} onChange={(patch) => patchKr(kr.id, patch)} />}
            </div>
          ))}
        </div>
        <button className="okr-add-kr" type="button" onClick={onAddKeyResult}><Plus />添加 Key Result</button>
        <OkrNoteEditor ref={noteEditorRef} value={objective.note ?? ""} mentions={objective.note_mentions}
          members={members} currentUserId={currentUserId} editable={online}
          loadCandidates={() => loadNoteCandidates("objective", objective.id)}
          onSave={async (note, ids) => {
            await onSaveNote(note, ids);
            flushSync(() => onChange({ ...currentObjectiveRef.current, note, note_mentions: noteMentions(ids ?? [], members) }));
          }} />
        <div id={`okr-objective-settings-${objective.id}`} hidden={!settingsOpen}>
          <div className="okr-editor-progress-settings">
            <span>进度方式：基于 KR 自动更新</span>
            <label>状态方式<select value={objective.status_mode} onChange={(event) => onChange({ ...objective, status_mode: event.target.value as OkrObjective["status_mode"] })}><option value="manual">手动更新</option><option value="automatic">按周期自动更新</option></select></label>
            <label>查看权限<select value={objective.visibility} onChange={(event) => onChange({ ...objective, visibility: event.target.value as OkrObjective["visibility"] })}><option value="inherit">继承周期权限</option><option value="workspace">团队内公开</option><option value="restricted">指定成员/用户组</option></select></label>
          </div>
          {objective.visibility === "restricted" && <PermissionSubjects
            members={members}
            groups={groups}
            userIds={objective.user_acl_ids}
            groupIds={objective.group_acl_ids}
            onChange={(userIds, groupIds) => onChange({ ...objective, user_acl_ids: userIds, group_acl_ids: groupIds })}
          />}
        </div>
      </div>
      <footer className="okr-editor-footer">
        <button className="button primary" disabled={!online} onClick={() => void flushNote(onPublish)}>发布</button>
        <button className="button secondary" onClick={() => void flushNote(onCancel)}>取消</button>
        <button className="button ghost" disabled={!online} onClick={() => void flushNote(onSave)}>保存草稿</button>
        <span aria-live="polite">{{ saved: "已自动保存", saving: "自动保存中…", invalid: "有未保存的无效设置", offline: "离线只读" }[autosaveStatus]}</span>
      </footer>
    </article>
  );
}

function MemberSelect({ members, selected, onChange, currentUserId, online }: {
  members: Member[]; selected: string[]; onChange: (ids: string[]) => void;
  currentUserId: string; online: boolean;
}) {
  return <AssigneePicker
    members={members} currentUserId={currentUserId} resetKey={currentUserId}
    target={selected[0] ? { kind: "user", userId: selected[0] } : { kind: "none" }}
    onAssign={async (target) => onChange(target.kind === "user" ? [target.userId] : [])}
    disabled={!online} className="okr-member-control" showName={false} placeholder="添加负责人" portal
  />;
}

function PermissionSubjects({ members, groups, userIds, groupIds, onChange }: {
  members: Member[];
  groups: UserGroup[];
  userIds: string[];
  groupIds: string[];
  onChange: (userIds: string[], groupIds: string[]) => void;
}) {
  return <div className="okr-inline-permissions">
    <strong>可查看成员</strong>
    <div>{members.map((member) => <label key={member.user_id}>
      <input type="checkbox" checked={userIds.includes(member.user_id)} onChange={(event) => onChange(
        event.target.checked ? [...userIds, member.user_id] : userIds.filter((id) => id !== member.user_id),
        groupIds,
      )} />
      {member.profile?.display_name ?? "团队成员"}
    </label>)}</div>
    {!!groups.length && <><strong>可查看用户组</strong><div>{groups.map((group) => <label key={group.id}>
      <input type="checkbox" checked={groupIds.includes(group.id)} onChange={(event) => onChange(
        userIds,
        event.target.checked ? [...groupIds, group.id] : groupIds.filter((id) => id !== group.id),
      )} />
      {group.name}
    </label>)}</div></>}
  </div>;
}

function KeyResultAdvanced({ keyResult, members, groups, onChange }: { keyResult: OkrKeyResult; members: Member[]; groups: UserGroup[]; onChange: (patch: Partial<OkrKeyResult>) => void }) {
  function patchBreakdown(index: number, patch: Partial<OkrBreakdown>) {
    onChange({ breakdowns: keyResult.breakdowns.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  }
  const assigned = keyResult.breakdowns.reduce((sum, item) => sum + Number(item.allocated_value), 0);
  return (
    <div className="okr-advanced-panel">
      <div className="okr-advanced-grid">
        <label>单位<select value={keyResult.metric_unit} onChange={(event) => onChange({ metric_unit: event.target.value as OkrMetricUnit })}>{UNITS.map((unit) => <option key={unit} value={unit}>{unit === "custom" ? "自定义" : okrMetricUnitLabel(unit)}</option>)}</select></label>
        {keyResult.metric_unit === "custom" && <label>自定义单位<input value={keyResult.custom_unit ?? ""} onChange={(event) => onChange({ custom_unit: event.target.value })} /></label>}
        <label>起始值<input type="number" value={keyResult.start_value} onChange={(event) => onChange({ start_value: Number(event.target.value) })} /></label>
        <label>目标值<input type="number" value={keyResult.target_value} onChange={(event) => onChange({ target_value: Number(event.target.value) })} /></label>
        <label>进度值<input type="number" value={keyResult.current_value ?? ""} onChange={(event) => onChange({ current_value: event.target.value ? Number(event.target.value) : null })} /></label>
        <label>状态方式<select value={keyResult.status_mode} onChange={(event) => onChange({ status_mode: event.target.value as OkrKeyResult["status_mode"] })}><option value="manual">手动更新</option><option value="automatic">按周期自动更新</option></select></label>
        <label>查看权限<select value={keyResult.visibility} onChange={(event) => onChange({ visibility: event.target.value as OkrKeyResult["visibility"] })}><option value="inherit">继承 Objective 权限</option><option value="workspace">团队内公开</option><option value="restricted">指定成员/用户组</option></select></label>
      </div>
      {keyResult.visibility === "restricted" && <PermissionSubjects
        members={members}
        groups={groups}
        userIds={keyResult.user_acl_ids}
        groupIds={keyResult.group_acl_ids}
        onChange={(user_acl_ids, group_acl_ids) => onChange({ user_acl_ids, group_acl_ids })}
      />}
      <div className="okr-breakdown-header"><strong>拆解设置</strong><span>目标值：{keyResult.target_value} · 已分配：{assigned}</span></div>
      {keyResult.breakdowns.map((breakdown, index) => (
        <div className="okr-breakdown-row" key={breakdown.id}>
          <select value={breakdown.user_id} onChange={(event) => patchBreakdown(index, { user_id: event.target.value })}>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.profile?.display_name ?? "团队成员"}</option>)}</select>
          <input type="number" min="0" value={breakdown.allocated_value} onChange={(event) => patchBreakdown(index, { allocated_value: Number(event.target.value) })} />
          <button type="button" onClick={() => onChange({ breakdowns: keyResult.breakdowns.filter((_, itemIndex) => itemIndex !== index) })}><X /></button>
        </div>
      ))}
      <button type="button" className="okr-add-breakdown" onClick={() => onChange({ breakdowns: [...keyResult.breakdowns, {
        id: crypto.randomUUID(),
        key_result_id: keyResult.id,
        workspace_id: keyResult.workspace_id,
        user_id: members[0]?.user_id ?? "",
        allocated_value: Math.max(0, keyResult.target_value - assigned),
        position: keyResult.breakdowns.length,
      }] })}><Plus />添加拆解</button>
    </div>
  );
}

function Modal({ open, onOpenChange, title, children, className }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; className?: string }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className={clsx("okr-dialog", className)}><header><Dialog.Title>{title}</Dialog.Title><Dialog.Close aria-label="关闭"><X /></Dialog.Close></header>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function CycleManagerDialog({ open, onOpenChange, cycles, workspaceId, userId, onChanged, runOnline }: {
  open: boolean; onOpenChange: (open: boolean) => void; cycles: OkrCycle[]; workspaceId: string; userId: string; onChanged: () => Promise<void>; runOnline: (action: () => Promise<void>, success?: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  return <Modal open={open} onOpenChange={onOpenChange} title="周期管理" className="okr-cycle-dialog"><div className="okr-cycle-create"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="周期名称，如 2026 年 Q3" /><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /><input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /><button className="button primary" onClick={() => void runOnline(async () => { await createOkrCycle(supabase!, workspaceId, userId, { name, starts_on: startsOn, ends_on: endsOn, status: "active" }); setName(""); await onChanged(); }, "周期已创建")}>创建</button></div><div className="okr-cycle-list">{cycles.map((cycle) => <div key={cycle.id}><span><strong>{cycle.name}</strong><small>{cycle.starts_on} 至 {cycle.ends_on}</small></span><select value={cycle.status} onChange={(event) => void runOnline(async () => { await updateOkrCycle(supabase!, cycle.id, { status: event.target.value as OkrCycle["status"] }); await onChanged(); }, "周期状态已更新")}><option value="draft">草稿</option><option value="active">进行中</option><option value="closed">已关闭</option></select><button aria-label="删除周期" onClick={() => { if (window.confirm("删除周期会删除其中全部 OKR，是否继续？")) void runOnline(async () => { await deleteOkrCycle(supabase!, cycle.id); await onChanged(); }, "周期已删除"); }}><Trash2 /></button></div>)}</div></Modal>;
}

function AlignmentDialog({ open, onOpenChange, objective, options, members, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objective: OkrObjective | null;
  options: Array<{ id: string; title: string; ownerId: string }>;
  members: Member[];
  onSave: (targetId: string | null) => Promise<void>;
}) {
  const [targetId, setTargetId] = useState("");
  useEffect(() => setTargetId(objective?.alignment_target_id ?? ""), [objective, open]);
  return <Modal open={open} onOpenChange={onOpenChange} title="目标对齐" className="okr-alignment-dialog">
    <p className="okr-dialog-description">将当前 Objective 对齐到本周期中你有权限查看的目标。</p>
    <label className="okr-dialog-field">对齐目标
      <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
        <option value="">不对齐任何目标</option>
        {options.map((option) => <option key={option.id} value={option.id}>
          {memberName(members, option.ownerId)} · {option.title}
        </option>)}
      </select>
    </label>
    {!options.length && <p className="okr-dialog-empty">暂无其他可对齐目标</p>}
    <footer>
      <button className="button secondary" onClick={() => onOpenChange(false)}>取消</button>
      <button className="button primary" onClick={() => void onSave(targetId || null)}>保存</button>
    </footer>
  </Modal>;
}

function PermissionDialog({ open, onOpenChange, set, members, groups, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; set: OkrSet | null; members: Member[]; groups: UserGroup[]; onSave: (visibility: "workspace" | "restricted", users: string[], groups: string[]) => Promise<void> }) {
  const [visibility, setVisibility] = useState<"workspace" | "restricted">(set?.visibility ?? "workspace");
  const [users, setUsers] = useState<string[]>(set?.user_acl_ids ?? []);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(set?.group_acl_ids ?? []);
  useEffect(() => { setVisibility(set?.visibility ?? "workspace"); setUsers(set?.user_acl_ids ?? []); setSelectedGroups(set?.group_acl_ids ?? []); }, [set, open]);
  return <Modal open={open} onOpenChange={onOpenChange} title="权限设置" className="okr-permission-dialog"><div className="okr-permission-scope"><label><input type="radio" checked={visibility === "workspace"} onChange={() => setVisibility("workspace")} />团队内公开</label><label><input type="radio" checked={visibility === "restricted"} onChange={() => setVisibility("restricted")} />指定成员或用户组</label></div>{visibility === "restricted" && <div className="okr-permission-subjects"><strong>成员</strong>{members.filter((member) => member.user_id !== set?.owner_id).map((member) => <label key={member.user_id}><input type="checkbox" checked={users.includes(member.user_id)} onChange={(event) => setUsers((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} />{member.profile?.display_name ?? "团队成员"}</label>)}{!!groups.length && <><strong>用户组</strong>{groups.map((group) => <label key={group.id}><input type="checkbox" checked={selectedGroups.includes(group.id)} onChange={(event) => setSelectedGroups((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))} />{group.name}</label>)}</>}</div>}<footer><button className="button secondary" onClick={() => onOpenChange(false)}>取消</button><button className="button primary" onClick={() => void onSave(visibility, users, selectedGroups)}>保存</button></footer></Modal>;
}

function DisplaySettingsDialog({ open, onOpenChange, preferences, cycleId, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; preferences: OkrDisplayPreferences; cycleId: string; onSave: (preferences: OkrDisplayPreferences) => Promise<void> }) {
  const [draft, setDraft] = useState(preferences);
  useEffect(() => setDraft(preferences), [preferences, open]);
  return <Modal open={open} onOpenChange={onOpenChange} title="显示设置"><p className="okr-dialog-description">只影响你本人查看 OKR 时的显示内容。</p><div className="okr-display-options">{([["show_progress", "进度"], ["show_score", "分数"], ["show_weight", "权重"]] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" role="switch" checked={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} /></label>)}<label><span>应用到所有周期</span><input type="checkbox" role="switch" checked={draft.apply_all_cycles} onChange={(event) => setDraft({ ...draft, apply_all_cycles: event.target.checked, cycle_id: event.target.checked ? null : cycleId })} /></label></div><footer><button className="button secondary" onClick={() => onOpenChange(false)}>取消</button><button className="button primary" onClick={() => void onSave(draft)}>保存</button></footer></Modal>;
}

function HistoryDialog({ open, onOpenChange, set }: { open: boolean; onOpenChange: (open: boolean) => void; set: OkrSet | null }) {
  const query = useQuery({ queryKey: ["okr-versions", set?.id], queryFn: () => loadOkrVersions(supabase!, set!.id), enabled: open && Boolean(set) });
  const [selected, setSelected] = useState(0);
  const version = query.data?.[selected];
  const previousVersion = query.data?.[selected + 1];
  const changes = okrSnapshotDiff(version?.snapshot, previousVersion?.snapshot);
  const objectives = (version?.snapshot?.objectives ?? []) as Array<Record<string, unknown>>;
  const changeLabel = (kind: "objective" | "key_result", id: string) => {
    const change = changes.find((item) => item.kind === kind && item.id === id)?.change;
    return change === "added" ? "新增" : change === "changed" ? "已修改" : null;
  };
  const removed = changes.filter((item) => item.change === "removed").length;
  return <Modal open={open} onOpenChange={onOpenChange} title="历史版本" className="okr-history-dialog"><div className="okr-history-controls"><select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{(query.data ?? []).map((item, index) => <option key={item.id} value={index}>版本 {item.version} · {new Date(item.published_at).toLocaleString()}</option>)}</select>{version && <span>与上一版本相比：{changes.length} 处变化{removed ? `，移除 ${removed} 项` : ""}</span>}</div>{!version ? <p className="okr-dialog-empty">暂无历史版本</p> : <div className="okr-history-content">{objectives.map((objective, index) => <div key={String(objective.id)}><strong>O{index + 1}　{String(objective.title ?? "")}{changeLabel("objective", String(objective.id)) && <em>{changeLabel("objective", String(objective.id))}</em>}</strong>{((objective.keyResults ?? objective.key_results ?? []) as Array<Record<string, unknown>>).map((kr, krIndex) => <span key={String(kr.id)}>KR{krIndex + 1}　{String(kr.title ?? "")}{changeLabel("key_result", String(kr.id)) && <em>{changeLabel("key_result", String(kr.id))}</em>}</span>)}</div>)}</div>}</Modal>;
}

function ImportDialog({ open, onOpenChange, cycles, currentSet, workspaceId, ownerId, onImported, runOnline }: { open: boolean; onOpenChange: (open: boolean) => void; cycles: OkrCycle[]; currentSet: OkrSet | null; workspaceId: string; ownerId: string; onImported: () => Promise<void>; runOnline: (action: () => Promise<void>, success?: string) => Promise<void> }) {
  const [sourceCycleId, setSourceCycleId] = useState("");
  const sourceQuery = useQuery({ queryKey: ["okr-import-source", workspaceId, sourceCycleId, ownerId], queryFn: () => loadOkrSet(supabase!, workspaceId, sourceCycleId, ownerId), enabled: open && Boolean(sourceCycleId) });
  return <Modal open={open} onOpenChange={onOpenChange} title="从其他周期导入">
    <select value={sourceCycleId} onChange={(event) => setSourceCycleId(event.target.value)}>
      <option value="">选择历史周期</option>
      {cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}
    </select>
    <div className="okr-import-preview">
      {sourceQuery.data?.objectives.map((objective, index) => <span key={objective.id}>O{index + 1}　{objective.title}</span>)}
    </div>
    <footer>
      <button className="button secondary" onClick={() => onOpenChange(false)}>取消</button>
      <button
        className="button primary"
        disabled={!sourceQuery.data || !currentSet}
        onClick={() => void runOnline(async () => {
          if (!sourceQuery.data || !currentSet) return;
          const imported = importedOkrObjectives(sourceQuery.data.objectives, workspaceId);
          for (const objective of imported) {
            const createdObjective = await createOkrObjective(supabase!, {
              set_id: currentSet.id,
              workspace_id: workspaceId,
              title: objective.title,
              note: objective.note,
              position: currentSet.objectives.length + objective.position,
            });
            await updateOkrObjective(supabase!, {
              ...createdObjective,
              ...objective,
              id: createdObjective.id,
              set_id: currentSet.id,
              workspace_id: workspaceId,
              position: currentSet.objectives.length + objective.position,
              alignment_target_id: null,
              user_acl_ids: [],
              group_acl_ids: [],
              key_results: [],
            });
            for (const keyResult of objective.key_results) {
              const createdKeyResult = await createOkrKeyResult(supabase!, {
                objective_id: createdObjective.id,
                workspace_id: workspaceId,
                title: keyResult.title,
                position: keyResult.position,
                weight: keyResult.weight,
              });
              await updateOkrKeyResult(supabase!, {
                ...createdKeyResult,
                ...keyResult,
                id: createdKeyResult.id,
                objective_id: createdObjective.id,
                workspace_id: workspaceId,
                visibility: "inherit",
                user_acl_ids: [],
                group_acl_ids: [],
              });
            }
          }
          await onImported();
          onOpenChange(false);
        }, "已导入历史 OKR")}
      >导入</button>
    </footer>
  </Modal>;
}

function progressPercentForValue(target: ProgressTarget, value: number | null) {
  if (value === null || target.targetValue === target.startValue) return null;
  return Math.max(0, Math.min(100, Math.round(
    ((value - target.startValue) / (target.targetValue - target.startValue)) * 100,
  )));
}

function formatProgressRecordDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value)).replace("/", "-");
}

export function ProgressDialog({ noteEntity, currentUserId, preferences, onSaveNote, objective, open, onOpenChange, target, editable, cycle, members, workspaceId, demoMode, onOpenTask, onSave, backendAvailable, taskCreation, online, onNotice }: {
  noteEntity?: OkrObjective | OkrKeyResult;
  currentUserId: string;
  preferences: OkrDisplayPreferences;
  onSaveNote: (note: string, ids?: string[]) => Promise<void>;
  taskCreation?: OkrTaskCreation;
  online: boolean;
  onNotice: OkrWorkspaceProps["onNotice"];
  objective?: OkrObjective;
  backendAvailable: boolean;
  demoMode: boolean;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ProgressTarget | null;
  editable: boolean;
  cycle: OkrCycle | null;
  members: Member[];
  onOpenTask: (taskId: string) => void;
  onSave: (value: number | null, status: OkrProgressStatus, detail: string) => Promise<boolean>;
}) {
  const noteEditorRef = useRef<TaskRichTextEditorHandle>(null);
  const flushNote = async (action: () => void) => {
    try { await noteEditorRef.current?.flush(); action(); } catch { /* Keep the editor open for retry. */ }
  };
  const [tab, setTab] = useState<"progress" | "tasks" | "records" | "notes">("progress");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<OkrProgressStatus>("none");
  const [detail, setDetail] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const openComposer = useCallback(() => setComposerOpen(true), []);
  useEffect(() => {
    setTab(target?.initialTab ?? (target?.kind === "key_result" ? "records" : "progress"));
    setValue(target?.currentValue === null || target?.currentValue === undefined ? "" : String(target.currentValue));
    setStatus(target?.status ?? "none");
    setDetail("");
    setComposerOpen(false);
  }, [target?.id, target?.kind, target?.initialTab, open]);
  useEffect(() => {
    setValue(target?.currentValue === null || target?.currentValue === undefined ? "" : String(target.currentValue));
    setStatus(target?.status ?? "none");
  }, [target?.currentValue, target?.status]);
  const records = useQuery({
    queryKey: ["okr-progress-records", target?.kind, target?.id],
    queryFn: () => loadOkrProgressRecords(supabase!, { kind: target!.kind, id: target!.id }),
    enabled: backendAvailable && open && Boolean(target),
  });
  const aggregateHistory = useQuery({
    queryKey: ["okr-objective-history", workspaceId, objective?.id, objective?.key_results.map((kr) => kr.id)],
    queryFn: () => loadOkrKeyResultHistory(supabase!, workspaceId, objective!.key_results.map((kr) => kr.id)),
    enabled: backendAvailable && open && Boolean(objective),
  });
  const linkedTasks = useQuery({
    queryKey: okrLinkedTasksKey(workspaceId, {
      kind: target?.kind ?? "objective",
      id: target?.id ?? "",
    }),
    queryFn: () => loadOkrLinkedTasks(supabase!, { kind: target!.kind, id: target!.id }),
    enabled: backendAvailable && open && Boolean(target),
  });
  const demoTasks = useMemo(() => {
    if (!demoMode || !target) return [];
    return createDemoOkrLinkedTasks(workspaceId).filter((task) => target.kind === "key_result"
      ? task.key_result_id === target.id
      : objective?.key_results.some((kr) => kr.id === task.key_result_id));
  }, [demoMode, target?.id, target?.kind, workspaceId, objective]);
  const tasks = demoMode ? demoTasks : linkedTasks.data ?? [];
  if (!target) return null;
  const progress = objective ? okrObjectiveProgress(objective) : progressPercentForValue(target, target.currentValue);
  const submitProgress = async () => {
    if (target.kind !== "key_result" || !editable) return;
    setSubmitting(true);
    const succeeded = await onSave(value.trim() === "" ? null : Number(value), status, detail.trim());
    setSubmitting(false);
    if (!succeeded) return;
    setDetail("");
    setComposerOpen(false);
    await records.refetch();
  };
  return <Dialog.Root open={open} onOpenChange={(next) => { if (next) onOpenChange(true); else void flushNote(() => onOpenChange(false)); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="okr-detail-overlay" />
      <Dialog.Content className="okr-detail-drawer" aria-describedby={undefined}
        onInteractOutside={(event) => {
          if ((event.target as HTMLElement)?.closest(".rich-editor-mention-menu, .mdxeditor-popup-container")) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (document.querySelector(".okr-detail-drawer .due-popover, .rich-editor-mention-menu, .mdxeditor-popup-container [role=dialog]")) event.preventDefault();
        }}>
        <header className="okr-detail-header">
          <Dialog.Title>OKR 详情</Dialog.Title>
          <Dialog.Close aria-label="关闭 OKR 详情"><X /></Dialog.Close>
        </header>
        <div className="okr-detail-scroll">
          <section className="okr-detail-summary">
            <div className="okr-detail-title-line">
              <span className={clsx("okr-index", target.kind === "objective" ? "objective" : "kr")}>{target.label}</span>
              <strong>{target.title}</strong>
            </div>
            {target.kind === "objective" ? <div className="okr-detail-objective-metrics">
              <div className="okr-detail-progress-summary">
                <span>{progress === null ? "暂无" : `${progress}%`}</span>
                <em className={statusClass(target.status)}>{OKR_STATUS_LABELS[target.status]}</em>
                <i><b style={{ width: `${progress ?? 0}%` }} /></i>
                <small><span>0%</span><span>100%</span></small>
              </div>
              {preferences.show_score && <div className="okr-detail-score"><span>分数</span><strong>{target.score?.toFixed(1) ?? "0.0"}</strong></div>}
            </div> : <div className="okr-detail-kr-metrics">
              <div><span>状态</span><em className={statusClass(target.status)}>{OKR_STATUS_LABELS[target.status]}</em></div>
              {preferences.show_score && <div><span>分数</span><strong>{target.score?.toFixed(1) ?? "0.0"}</strong></div>}
            </div>}
          </section>
          <nav className="okr-detail-tabs" role="tablist" aria-label="OKR 详情">
            {target.kind === "objective" && <button role="tab" aria-selected={tab === "progress"} onClick={() => void flushNote(() => setTab("progress"))}>进度</button>}
            <button role="tab" aria-selected={tab === "tasks"} onClick={() => void flushNote(() => setTab("tasks"))}>待办清单</button>
            <button role="tab" aria-selected={tab === "records"} onClick={() => void flushNote(() => setTab("records"))}>进展记录</button>
            <button role="tab" aria-selected={tab === "notes"} onClick={() => void flushNote(() => setTab("notes"))}>备注</button>
          </nav>
          {tab === "notes" ? <section role="tabpanel" aria-label="备注">
            <OkrNoteEditor key={`${target.kind}:${target.id}:${editable && online}`} ref={noteEditorRef}
              value={noteEntity?.note ?? ""} mentions={noteEntity?.note_mentions} members={members} currentUserId={currentUserId}
              editable={editable && online} loadCandidates={() => loadNoteCandidates(target.kind, target.id)} onSave={onSaveNote} />
          </section> : tab === "tasks"
            ? <>
                {taskCreation && <OkrTaskComposer key={`${target.kind}:${target.id}`} workspaceId={workspaceId} target={target} keyResults={objective?.key_results}
                  creation={taskCreation} online={online} editable={editable} onNotice={onNotice} onOpenTask={onOpenTask} />}
                <OkrTaskListPanel target={target} tasks={tasks} members={members} loading={linkedTasks.isLoading && !demoMode} onOpenTask={onOpenTask} />
              </>
            : tab === "progress" && target.kind === "objective"
            ? <ObjectiveProgressPanel target={target} cycle={cycle} records={objective ? okrObjectiveHistory(objective, aggregateHistory.data ?? []) : []} />
            : <ProgressRecordPanel
                target={target} records={records.data ?? []} members={members} editable={editable && target.kind === "key_result"}
                value={value} status={status} detail={detail} composerOpen={composerOpen} submitting={submitting}
                onValueChange={setValue} onStatusChange={setStatus} onDetailChange={setDetail}
                onComposerOpen={openComposer}
                onCancel={() => { setComposerOpen(false); setDetail(""); }}
                onSubmit={() => void submitProgress()}
              />}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function OkrTaskListPanel({ target, tasks, members, loading, onOpenTask }: {
  target: ProgressTarget;
  tasks: OkrLinkedTaskSummary[];
  members: Member[];
  loading: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const groups = useMemo(() => {
    if (target.kind === "key_result") return [{ id: target.id, title: target.title, tasks }];
    const grouped = new Map<string, { id: string; title: string; tasks: OkrLinkedTaskSummary[] }>();
    for (const task of tasks) {
      const group = grouped.get(task.key_result_id) ?? {
        id: task.key_result_id,
        title: task.key_result_title,
        tasks: [],
      };
      group.tasks.push(task);
      grouped.set(task.key_result_id, group);
    }
    return [...grouped.values()];
  }, [target.id, target.kind, target.title, tasks]);

  if (loading) return <div className="okr-task-list-empty">正在读取关联待办…</div>;
  if (!tasks.length) return <div className="okr-task-list-empty"><ListTodo /><strong>暂无关联待办</strong><span>可在待办菜单中选择“关联 OKR”添加。</span></div>;

  return <div className="okr-task-list">
    {groups.map((group) => <section key={group.id} className="okr-task-group">
      {target.kind === "objective" && <header><span>KR</span><strong>{group.title}</strong><small>{group.tasks.length}</small></header>}
      <div>
        {group.tasks.map((task) => {
          const assignee = task.assignee_id
            ? members.find((member) => member.user_id === task.assignee_id)
            : null;
          return <button type="button" className="okr-linked-task" key={task.task_id} onClick={() => onOpenTask(task.task_id)}>
            <span className="okr-linked-task-status"><TaskStatusIcon status={task.status} /></span>
            <span className="okr-linked-task-title">{task.title}</span>
            {task.due_at && <time dateTime={task.due_at}>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(task.due_at))}</time>}
            {assignee && <MemberAvatar member={assignee} className="okr-linked-task-avatar" title={assignee.profile?.display_name ?? "团队成员"} />}
          </button>;
        })}
      </div>
    </section>)}
  </div>;
}

function ObjectiveProgressPanel({ target, cycle, records }: {
  target: ProgressTarget;
  cycle: OkrCycle | null;
  records: OkrProgressRecord[];
}) {
  const width = 600;
  const height = 186;
  const plot = { left: 32, top: 18, right: 10, bottom: 28 };
  const start = cycle ? new Date(`${cycle.starts_on}T00:00:00`).getTime() : Date.now() - 30 * 864e5;
  const end = cycle ? new Date(`${cycle.ends_on}T23:59:59`).getTime() : Date.now();
  const duration = Math.max(1, end - start);
  const points = [...records].reverse().filter((record) => record.current_value !== null).map((record) => {
    const percent = progressPercentForValue(target, record.current_value);
    const x = plot.left + Math.max(0, Math.min(1, (new Date(record.created_at).getTime() - start) / duration))
      * (width - plot.left - plot.right);
    const y = plot.top + (1 - (percent ?? 0) / 100) * (height - plot.top - plot.bottom);
    return { x, y };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const dateLabels = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(start + duration * index / 7);
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  return <section className="okr-objective-progress-panel" role="tabpanel">
    <div className="okr-progress-chart-heading"><strong>Objective 进度</strong><span>状态：<em className={statusClass(target.status)}>{OKR_STATUS_LABELS[target.status]}</em></span></div>
    <span className="okr-progress-chart-axis">进度值 (%)</span>
    <svg className="okr-progress-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Objective 进度趋势">
      {[0, 25, 50, 75, 100].map((tick) => {
        const y = plot.top + (1 - tick / 100) * (height - plot.top - plot.bottom);
        return <g key={tick}><line x1={plot.left} x2={width - plot.right} y1={y} y2={y} className="grid" /><text x="2" y={y + 4}>{tick}</text></g>;
      })}
      <line x1={plot.left} y1={height - plot.bottom} x2={width - plot.right} y2={plot.top} className="expected" />
      {path && <path d={path} className="actual" />}
      {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="3" />)}
      {dateLabels.map((label, index) => <text key={label + index} x={plot.left + (width - plot.left - plot.right) * index / 7} y={height - 5} textAnchor={index === 0 ? "start" : index === 7 ? "end" : "middle"}>{label}</text>)}
    </svg>
    <div className="okr-progress-settings-card">
      <span>状态</span><strong>{target.statusMode === "automatic" ? "按周期自动更新" : "手动更新"}</strong>
      <span>进度值</span><strong>基于 KR 自动更新</strong>
    </div>
  </section>;
}

export function ProgressRecordPanel({ target, records, members, editable, value, status, detail, composerOpen, submitting, onValueChange, onStatusChange, onDetailChange, onComposerOpen, onCancel, onSubmit }: {
  target: ProgressTarget;
  records: OkrProgressRecord[];
  members: Member[];
  editable: boolean;
  value: string;
  status: OkrProgressStatus;
  detail: string;
  composerOpen: boolean;
  submitting: boolean;
  onValueChange: (value: string) => void;
  onStatusChange: (status: OkrProgressStatus) => void;
  onDetailChange: (detail: string) => void;
  onComposerOpen: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const unit = okrMetricUnitLabel(target.metricUnit, target.customUnit);
  const detailInputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editable && target.kind === "key_result") onComposerOpen();
  }, [editable, onComposerOpen, target.id, target.kind]);
  useEffect(() => {
    if (editable && composerOpen) detailInputRef.current?.focus();
  }, [composerOpen, editable]);
  return <section className="okr-detail-records" role="tabpanel">
    {editable && target.kind === "key_result" && <div className={clsx("okr-progress-composer", composerOpen && "expanded")}>
      <textarea ref={detailInputRef} aria-label="记录进展" value={detail} onFocus={onComposerOpen} onChange={(event) => onDetailChange(event.target.value)} placeholder="保持更新，让小伙伴看到你的进展" />
      {composerOpen && <div className="okr-progress-composer-fields">
        <label><span>进度值</span><span className="okr-composer-value"><input type="number" value={value} onChange={(event) => onValueChange(event.target.value)} />{unit}</span></label>
        <fieldset><legend>状态</legend>{STATUSES.map((item) => <label key={item} className={statusClass(item)}><input type="radio" checked={status === item} onChange={() => onStatusChange(item)} />{OKR_STATUS_LABELS[item]}</label>)}</fieldset>
        <div><button className="button secondary" type="button" onClick={onCancel}>取消</button><button className="button primary" type="button" disabled={submitting} onClick={onSubmit}>{submitting ? "提交中…" : "提交"}</button></div>
      </div>}
    </div>}
    <div className="okr-progress-records-list">
      {records.map((record) => {
        const actor = members.find((member) => member.user_id === record.actor_id);
        const actorName = actor?.profile?.display_name ?? "团队成员";
        const percent = progressPercentForValue(target, record.current_value);
        return <article className="okr-progress-record-card" key={record.id}>
          <header>
            {actor ? <MemberAvatar member={actor} className="okr-record-avatar" /> : <span className="okr-record-avatar fallback">{actorName.slice(0, 1)}</span>}
            <strong>{actorName}</strong><time>{formatProgressRecordDate(record.created_at)}</time>
          </header>
          {record.detail && <p>{record.detail}</p>}
          <div className="okr-record-progress-snapshot">
            <span>{target.kind === "objective" ? (percent === null ? "暂无" : `${percent}%`) : (record.current_value === null ? "—" : `${record.current_value}${unit}`)}</span>
            <em className={statusClass(record.current_status)}>{OKR_STATUS_LABELS[record.current_status]}</em>
            {target.kind === "objective" && <><i><b style={{ width: `${percent ?? 0}%` }} /></i><small><span>0%</span><span>100%</span></small></>}
          </div>
        </article>;
      })}
      {!records.length && <div className="okr-record-empty"><span><Clock3 /></span><strong>暂无进展</strong></div>}
    </div>
  </section>;
}

function noteMentions(ids: string[], members: Member[]): CommentMention[] {
  return ids.map((id) => ({ user_id: id, display_name_snapshot: memberName(members, id) }));
}
async function loadNoteCandidates(kind: "objective" | "key_result", id: string): Promise<string[]> {
  if (!supabase || !navigator.onLine) return [];
  const { data, error } = await supabase.rpc("load_okr_note_mention_candidates", { p_kind: kind, p_id: id });
  if (error) throw error;
  return data ?? [];
}
