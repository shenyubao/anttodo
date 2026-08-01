import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnNodeDrag,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import { format } from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Crosshair,
  LoaderCircle,
  Maximize2,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  buildMindMapTree,
  moveTaskToDate,
  type MindMapNodeKind,
  type MindMapTreeNode,
} from "./lib/mindMap";
import type { DateTimePreferences, Task, WorkspaceBundle } from "./types";

type CreateTaskInput = {
  title: string;
  labelIds: string[];
  description?: string;
  dueAt?: string | null;
  dueTimezone?: string | null;
};

type MindMapNodeData = {
  kind: MindMapNodeKind;
  label: string;
  dateKey?: string;
  contextKey?: string;
  labelId?: string;
  labelColor?: string;
  task?: Task;
  online: boolean;
  draft?: boolean;
  draftValue?: string;
  draftBusy?: boolean;
  onDraftChange?: (value: string) => void;
  onDraftSubmit?: () => void;
  onDraftCancel?: () => void;
  onToggleTask?: (task: Task) => void;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: (nodeId: string) => void;
};

type MindMapFlowNode = Node<MindMapNodeData, MindMapNodeKind>;
type MindMapFlowEdge = Edge<Record<string, never>, "mindmap">;

const NODE_SIZES: Record<MindMapNodeKind, { width: number; height: number }> = {
  root: { width: 150, height: 48 },
  month: { width: 132, height: 38 },
  week: { width: 212, height: 38 },
  day: { width: 154, height: 38 },
  inbox: { width: 132, height: 38 },
  unscheduled: { width: 132, height: 38 },
  label: { width: 178, height: 42 },
  task: { width: 224, height: 42 },
};

const DATE_NODE_KINDS = new Set<MindMapNodeKind>(["month", "week", "day"]);

/** Horizontal gap between parent/child ranks. Original dagre ranksep was 72. */
const MIND_MAP_RANK_GAP = Math.round(72 * 0.25);

function MindMapNodeView({ id, data, selected }: NodeProps<MindMapFlowNode>) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data.draft) inputRef.current?.focus();
  }, [data.draft]);

  const collapseIndicator = data.collapsible ? (
    <span
      className="mind-map-collapse-indicator"
      aria-hidden="true"
      title={data.collapsed ? "展开子节点" : "收起子节点"}
    >
      {data.collapsed ? <ChevronRight /> : <ChevronDown />}
    </span>
  ) : null;

  return (
    <div
      style={data.kind === "label" ? {
        "--mind-map-label-color": data.labelColor || "#4772fa",
      } as CSSProperties : undefined}
      className={clsx(
        "mind-map-node",
        `mind-map-node-${data.kind}`,
        data.task?.status === "completed" && "completed",
        data.draft && "draft",
        selected && "selected",
        data.collapsible && "mind-map-node-collapsible",
        data.kind === "task" && !data.draft && "mind-map-task-drag",
      )}
      role={data.collapsible ? "button" : undefined}
      tabIndex={data.collapsible ? 0 : undefined}
      aria-expanded={data.collapsible ? !data.collapsed : undefined}
      aria-label={data.collapsible
        ? `${data.label}，${data.collapsed ? "已收起" : "已展开"}`
        : undefined}
      onClick={() => {
        if (data.collapsible) data.onToggleCollapse?.(id);
      }}
      onKeyDown={(event) => {
        if (!data.collapsible || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        event.stopPropagation();
        data.onToggleCollapse?.(id);
      }}
    >
      {data.kind !== "root" && <Handle type="target" position={Position.Left} />}
      {data.kind === "task" ? (
        data.draft ? (
          <form
            className="mind-map-draft-form nodrag nopan"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              data.onDraftSubmit?.();
            }}
          >
            {data.draftBusy ? <LoaderCircle className="mind-map-node-spinner" /> : <Circle />}
            <input
              ref={inputRef}
              value={data.draftValue ?? ""}
              placeholder="输入待办标题"
              aria-label="新待办标题"
              disabled={data.draftBusy}
              onChange={(event) => data.onDraftChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  data.onDraftCancel?.();
                }
              }}
            />
          </form>
        ) : (
          <div className="mind-map-task-content">
            <button
              className="mind-map-task-toggle nodrag nopan"
              aria-label={data.task?.status === "completed" ? "标记未完成" : "完成任务"}
              disabled={!data.online}
              onClick={(event) => {
                event.stopPropagation();
                if (data.task) data.onToggleTask?.(data.task);
              }}
            >
              {data.task?.status === "completed" ? <Check /> : <Circle />}
            </button>
            <span title={data.label}>{data.label}</span>
          </div>
        )
      ) : data.kind === "label" ? (
        <>
          <span className="mind-map-label-content" title={data.label}>
            <Tag aria-hidden="true" />
            <span>{data.label}</span>
          </span>
          {collapseIndicator}
        </>
      ) : DATE_NODE_KINDS.has(data.kind) ? (
        <>
          <span className="mind-map-date-content" title={data.label}>
            <CalendarDays aria-hidden="true" />
            <span>{data.label}</span>
          </span>
          {collapseIndicator}
        </>
      ) : (
        <>
          <span className="mind-map-branch-label" title={data.label}>{data.label}</span>
          {collapseIndicator}
        </>
      )}
      {data.kind !== "task" && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

function MindMapEdgeView(props: EdgeProps<MindMapFlowEdge>) {
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 4,
    offset: Math.max(4, Math.round(MIND_MAP_RANK_GAP / 3)),
  });
  return <BaseEdge {...props} path={path} />;
}

const nodeTypes = {
  root: MindMapNodeView,
  month: MindMapNodeView,
  week: MindMapNodeView,
  day: MindMapNodeView,
  inbox: MindMapNodeView,
  unscheduled: MindMapNodeView,
  label: MindMapNodeView,
  task: MindMapNodeView,
};
const edgeTypes = { mindmap: MindMapEdgeView };

function layoutTree(
  tree: MindMapTreeNode,
  nodeData: Omit<
    MindMapNodeData,
    "kind" | "label" | "dateKey" | "contextKey" | "labelId" | "labelColor" | "task"
      | "collapsible" | "collapsed"
  >,
  draft: { parentId: string; dateKey: string | null; labelId: string | null } | null,
  collapsedNodeIds: ReadonlySet<string>,
) {
  const nodes: MindMapFlowNode[] = [];
  const edges: MindMapFlowEdge[] = [];

  const visit = (item: MindMapTreeNode, parentId?: string) => {
    const size = NODE_SIZES[item.kind];
    const collapsible = (item.kind === "month"
      || item.kind === "week"
      || item.kind === "day"
      || item.kind === "label")
      && item.children.length > 0;
    const collapsed = collapsible && collapsedNodeIds.has(item.id);
    nodes.push({
      id: item.id,
      type: item.kind,
      position: { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      draggable: item.kind === "task" && nodeData.online,
      dragHandle: item.kind === "task" ? ".mind-map-task-drag" : undefined,
      deletable: false,
      connectable: false,
      data: {
        ...nodeData,
        kind: item.kind,
        label: item.label,
        dateKey: item.dateKey,
        contextKey: item.contextKey,
        labelId: item.labelId,
        labelColor: item.labelColor,
        task: item.task,
        collapsible,
        collapsed,
      },
      ariaLabel: item.kind === "task" ? `任务：${item.label}` : item.label,
    });
    if (parentId) {
      edges.push({
        id: `edge:${parentId}:${item.id}`,
        source: parentId,
        target: item.id,
        type: "mindmap",
        selectable: false,
        deletable: false,
      });
    }
    if (!collapsed) {
      item.children.forEach((child) => visit(child, item.id));
    }
  };
  visit(tree);

  if (draft && nodes.some((node) => node.id === draft.parentId)) {
    const size = NODE_SIZES.task;
    nodes.push({
      id: "draft-task",
      type: "task",
      position: { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      draggable: false,
      deletable: false,
      connectable: false,
      data: {
        ...nodeData,
        kind: "task",
        label: "",
        dateKey: draft.dateKey ?? undefined,
        labelId: draft.labelId ?? undefined,
        draft: true,
      },
      ariaLabel: "新待办",
    });
    edges.push({
      id: `edge:${draft.parentId}:draft-task`,
      source: draft.parentId,
      target: "draft-task",
      type: "mindmap",
      selectable: false,
      deletable: false,
    });
  }

  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: MIND_MAP_RANK_GAP,
    nodesep: 18,
    edgesep: 8,
    marginx: 32,
    marginy: 32,
  });
  nodes.forEach((node) => {
    // Dagre mutates the node label with its calculated coordinates. Each node
    // must therefore receive its own dimensions object instead of sharing the
    // object stored in NODE_SIZES with every node of the same kind.
    graph.setNode(node.id, { ...NODE_SIZES[node.type ?? "task"] });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  // Dagre can insert dummy ranks for edge routing; pack real ranks so the
  // visible parent→child connector length matches MIND_MAP_RANK_GAP.
  const sizeById = new Map(nodes.map((node) => [node.id, NODE_SIZES[node.type ?? "task"]]));
  const rankGroups = new Map<number, string[]>();
  nodes.forEach((node) => {
    const rank = graph.node(node.id).rank ?? 0;
    const group = rankGroups.get(rank) ?? [];
    group.push(node.id);
    rankGroups.set(rank, group);
  });
  const packedCenterX = new Map<number, number>();
  let cursorX = 32;
  [...rankGroups.keys()].sort((a, b) => a - b).forEach((rank, index) => {
    const ids = rankGroups.get(rank) ?? [];
    const rankWidth = ids.reduce(
      (max, id) => Math.max(max, sizeById.get(id)?.width ?? 0),
      0,
    );
    if (index > 0) cursorX += MIND_MAP_RANK_GAP;
    packedCenterX.set(rank, cursorX + rankWidth / 2);
    cursorX += rankWidth;
  });

  return {
    nodes: nodes.map((node) => {
      const position = graph.node(node.id);
      const size = sizeById.get(node.id) ?? NODE_SIZES.task;
      const rank = position.rank ?? 0;
      return {
        ...node,
        position: {
          x: (packedCenterX.get(rank) ?? position.x) - size.width / 2,
          y: position.y - size.height / 2,
        },
      };
    }),
    edges,
  };
}

function storedViewport(workspaceId: string): Viewport | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(`anttodo:mind-map-viewport:${workspaceId}`) ?? "null",
    );
    return value
      && Number.isFinite(value.x)
      && Number.isFinite(value.y)
      && Number.isFinite(value.zoom)
      ? value as Viewport
      : null;
  } catch {
    return null;
  }
}

function collapsedStorageKey(workspaceId: string) {
  return `anttodo:mind-map-collapsed:${workspaceId}`;
}

function storedCollapsedNodes(workspaceId: string) {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(collapsedStorageKey(workspaceId)) ?? "[]",
    );
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function storeCollapsedNodes(workspaceId: string, collapsedNodeIds: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(collapsedStorageKey(workspaceId), JSON.stringify([...collapsedNodeIds]));
  } catch {
    // A disabled or full local storage should not block the mind map interaction.
  }
}

function createdTaskId(result: unknown) {
  if (typeof result === "string") return result;
  if (typeof result === "object" && result && "id" in result) return String(result.id);
  return null;
}

type MindMapCanvasProps = {
  workspaceId: string;
  bundle: WorkspaceBundle;
  dateTimePreferences: DateTimePreferences;
  online: boolean;
  onSelectTask: (taskId: string) => void;
  onCreateTask: (input: CreateTaskInput) => Promise<unknown>;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onToggleTaskLabel: (taskId: string, labelId: string, selected: boolean) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
  onRequestCreateLabel: (parentId: string | null) => void;
};

function MindMapCanvas({
  workspaceId,
  bundle,
  dateTimePreferences,
  online,
  onSelectTask,
  onCreateTask,
  onUpdateTask,
  onToggleTaskLabel,
  onDeleteLabel,
  onRequestCreateLabel,
}: MindMapCanvasProps) {
  const flow = useReactFlow<MindMapFlowNode, MindMapFlowEdge>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const workspaceRef = useRef(workspaceId);
  const [focusDateKey, setFocusDateKey] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    parentId: string;
    dateKey: string | null;
    labelId: string | null;
  } | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: MindMapFlowNode;
  } | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(
    () => storedCollapsedNodes(workspaceId),
  );

  const toggleNodeCollapse = useCallback((nodeId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      storeCollapsedNodes(workspaceId, next);
      return next;
    });
  }, [workspaceId]);

  const tree = useMemo(() => buildMindMapTree({
    tasks: bundle.tasks,
    labels: bundle.labels,
    preferences: dateTimePreferences,
    focusDateKey,
  }), [bundle.labels, bundle.tasks, dateTimePreferences, focusDateKey]);

  const toggleTask = useCallback(async (task: Task) => {
    if (!online) return;
    setError("");
    try {
      await onUpdateTask(task.id, {
        status: task.status === "completed" ? "open" : "completed",
        completed_at: task.status === "completed" ? null : new Date().toISOString(),
      });
    } catch {
      setError("任务状态更新失败，请重试");
    }
  }, [onUpdateTask, online]);

  const submitDraft = useCallback(async () => {
    const title = draftValue.trim();
    if (!title || !online || draftBusy || !draft) return;
    setDraftBusy(true);
    setError("");
    try {
      const duePatch = draft.dateKey
        ? moveTaskToDate({
          due_at: null,
          due_start_at: null,
          due_is_all_day: false,
          due_timezone: null,
        } as Task, draft.dateKey)
        : null;
      const result = await onCreateTask({
        title,
        labelIds: draft.labelId ? [draft.labelId] : [],
        dueAt: duePatch?.due_at ?? null,
        dueTimezone: duePatch?.due_timezone ?? null,
      });
      const taskId = createdTaskId(result);
      if (taskId && duePatch) await onUpdateTask(taskId, duePatch);
      setDraft(null);
      setDraftValue("");
    } catch {
      setError("待办创建失败，请重试");
    } finally {
      setDraftBusy(false);
    }
  }, [draft, draftBusy, draftValue, onCreateTask, onUpdateTask, online]);

  const graph = useMemo(() => layoutTree(tree, {
    online,
    draftValue,
    draftBusy,
    onDraftChange: setDraftValue,
    onDraftSubmit: () => void submitDraft(),
    onDraftCancel: () => {
      if (draftBusy) return;
      setDraft(null);
      setDraftValue("");
    },
    onToggleTask: (task) => void toggleTask(task),
    onToggleCollapse: toggleNodeCollapse,
  }, draft, collapsedNodeIds), [
    collapsedNodeIds,
    draft,
    draftBusy,
    draftValue,
    online,
    submitDraft,
    toggleNodeCollapse,
    toggleTask,
    tree,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState<MindMapFlowNode>(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<MindMapFlowEdge>(graph.edges);

  const startTaskDraft = useCallback(() => {
    if (!online || draftBusy) return;
    const selected = nodes.find((node) => node.id === selectedNodeId);
    const dateKey = selected?.data.kind === "day"
      || selected?.data.kind === "label"
      || selected?.data.kind === "task"
      ? selected.data.dateKey ?? null
      : null;
    const labelId = selected?.data.kind === "label" || selected?.data.kind === "task"
      ? selected.data.labelId ?? null
      : null;
    const contextKey = dateKey ?? (labelId ? "unscheduled" : "inbox");
    const parentId = selected?.data.kind === "label"
      ? selected.id
      : selected?.data.kind === "task"
        ? labelId
          ? `label:${contextKey}:${labelId}`
          : dateKey
            ? `day:${dateKey}`
            : "inbox"
        : selected?.data.kind === "day"
          ? selected.id
          : selected?.data.kind === "inbox"
            ? "inbox"
            : "inbox";
    setContextMenu(null);
    setDraft({ parentId, dateKey, labelId });
    setDraftValue("");
  }, [draftBusy, nodes, online, selectedNodeId]);

  useEffect(() => {
    setNodes(graph.nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId })));
    setEdges(graph.edges);
  }, [graph.edges, graph.nodes, selectedNodeId, setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) => current.map((node) => {
      const className = node.id === dropTargetId ? "mind-map-drop-target" : undefined;
      return node.className === className ? node : { ...node, className };
    }));
  }, [dropTargetId, setNodes]);

  const focusNode = useCallback((dateKey: string, duration = 260) => {
    const node = flow.getNode(`day:${dateKey}`);
    if (!node) return;
    const width = node.measured?.width ?? NODE_SIZES.day.width;
    const height = node.measured?.height ?? NODE_SIZES.day.height;
    void flow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: Math.max(flow.getZoom(), 0.9),
      duration,
    });
  }, [flow]);

  useEffect(() => {
    if (workspaceRef.current === workspaceId) return;
    workspaceRef.current = workspaceId;
    const nextKey = format(new Date(), "yyyy-MM-dd");
    setFocusDateKey(nextKey);
    setSelectedNodeId(null);
    setDraft(null);
    setDraftValue("");
    setCollapsedNodeIds(storedCollapsedNodes(workspaceId));
    if (!initializedRef.current) return;
    const saved = storedViewport(workspaceId);
    if (saved) void flow.setViewport(saved, { duration: 0 });
    else window.requestAnimationFrame(() => focusNode(nextKey, 0));
  }, [flow, focusNode, workspaceId]);

  useEffect(() => {
    const onEnter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable='true']")) return;
      event.preventDefault();
      startTaskDraft();
    };
    window.addEventListener("keydown", onEnter, true);
    return () => window.removeEventListener("keydown", onEnter, true);
  }, [startTaskDraft]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [contextMenu]);

  const deleteContextTarget = useCallback(async () => {
    if (!contextMenu || !online || contextBusy) return;
    const { node } = contextMenu;
    const isTask = node.data.kind === "task" && node.data.task;
    const isLabel = node.data.kind === "label" && node.data.labelId;
    if (!isTask && !isLabel) return;
    const confirmed = isTask
      ? window.confirm(`删除任务“${node.data.label}”？此操作会将任务移入已删除。`)
      : window.confirm(`确定删除标签“${node.data.label}”吗？其子标签也会被删除。`);
    if (!confirmed) return;
    setContextBusy(true);
    setError("");
    try {
      if (isTask && node.data.task) {
        await onUpdateTask(node.data.task.id, { deleted_at: new Date().toISOString() });
      } else if (node.data.labelId) {
        await onDeleteLabel(node.data.labelId);
      }
      setContextMenu(null);
      setSelectedNodeId(null);
    } catch {
      setError(isTask ? "任务删除失败，请重试" : "标签删除失败，请重试");
    } finally {
      setContextBusy(false);
    }
  }, [contextBusy, contextMenu, onDeleteLabel, onUpdateTask, online]);

  const findDropTarget = useCallback((node: MindMapFlowNode) => {
    const targets = flow.getIntersectingNodes(node, true).filter((candidate) =>
      candidate.id !== node.id
      && (candidate.data.kind === "day"
        || candidate.data.kind === "inbox"
        || candidate.data.kind === "unscheduled"
        || candidate.data.kind === "label"
        || (candidate.data.kind === "task" && !candidate.data.draft)),
    );
    return targets.find((candidate) => candidate.data.kind === "task")
      ?? targets.find((candidate) => candidate.data.kind === "label")
      ?? targets.find((candidate) => candidate.data.kind === "day")
      ?? targets.find((candidate) => candidate.data.kind === "inbox")
      ?? targets.find((candidate) => candidate.data.kind === "unscheduled")
      ?? null;
  }, [flow]);

  const handleNodeDrag: OnNodeDrag<MindMapFlowNode> = useCallback((_, node) => {
    setDropTargetId(findDropTarget(node)?.id ?? null);
  }, [findDropTarget]);

  const handleNodeDragStop: OnNodeDrag<MindMapFlowNode> = useCallback((_, node) => {
    const target = findDropTarget(node);
    setDropTargetId(null);
    setNodes(graph.nodes.map((candidate) => ({
      ...candidate,
      selected: candidate.id === selectedNodeId,
    })));
    const task = node.data.task;
    if (!target || !task || !online) return;

    const targetDateKey = target.data.kind === "inbox" || target.data.kind === "unscheduled"
      ? null
      : target.data.dateKey ?? null;
    const targetLabelId = target.data.kind === "label" || target.data.kind === "task"
      ? target.data.labelId ?? null
      : null;
    const movingToInbox = target.data.kind === "inbox" || target.data.contextKey === "inbox";
    const currentDateKey = node.data.dateKey ?? null;
    const dateChanged = targetDateKey !== currentDateKey;
    const labelsToRemove = movingToInbox ? [...task.label_ids] : [];
    const labelToAdd = !movingToInbox && targetLabelId && !task.label_ids.includes(targetLabelId)
      ? targetLabelId
      : null;
    if (!dateChanged && !labelsToRemove.length && !labelToAdd) return;

    setError("");
    void (async () => {
      const removedLabels: string[] = [];
      let addedLabel = false;
      try {
        if (dateChanged) await onUpdateTask(task.id, moveTaskToDate(task, targetDateKey));
        for (const labelId of labelsToRemove) {
          await onToggleTaskLabel(task.id, labelId, false);
          removedLabels.push(labelId);
        }
        if (labelToAdd) {
          await onToggleTaskLabel(task.id, labelToAdd, true);
          addedLabel = true;
        }
      } catch {
        if (addedLabel && labelToAdd) {
          await onToggleTaskLabel(task.id, labelToAdd, false).catch(() => undefined);
        }
        for (const labelId of removedLabels) {
          await onToggleTaskLabel(task.id, labelId, true).catch(() => undefined);
        }
        if (dateChanged) {
          await onUpdateTask(task.id, {
            due_at: task.due_at,
            due_start_at: task.due_start_at,
            due_is_all_day: task.due_is_all_day,
            due_timezone: task.due_timezone,
          }).catch(() => undefined);
        }
        setError("任务日期或标签更新失败，请重试");
        setNodes(graph.nodes);
      }
    })();
  }, [
    findDropTarget,
    graph.nodes,
    onToggleTaskLabel,
    onUpdateTask,
    online,
    selectedNodeId,
    setNodes,
  ]);

  const today = useCallback(() => {
    const key = format(new Date(), "yyyy-MM-dd");
    setFocusDateKey(key);
    window.requestAnimationFrame(() => focusNode(key));
  }, [focusNode]);

  const createLabel = useCallback(() => {
    if (!online) return;
    const selected = nodes.find((node) => node.id === selectedNodeId);
    const parentId = selected?.data.kind === "label" || selected?.data.kind === "task"
      ? selected.data.labelId ?? null
      : null;
    setContextMenu(null);
    onRequestCreateLabel(parentId);
  }, [nodes, onRequestCreateLabel, online, selectedNodeId]);

  return (
    <div className="mind-map-workspace">
      <header className="mind-map-toolbar">
        <div className="mind-map-toolbar-title">
          <h1>思维导图</h1>
          {!online && <span className="mind-map-readonly">离线只读</span>}
          {error && <span className="mind-map-error" role="status">{error}</span>}
        </div>
        <div className="mind-map-toolbar-actions">
          <button onClick={today}><Crosshair /><span>今天</span></button>
          <button onClick={() => void flow.fitView({ padding: 0.16, duration: 260 })}>
            <Maximize2 /><span>一览全部</span>
          </button>
        </div>
      </header>
      <div className="mind-map-canvas" ref={canvasRef} tabIndex={-1}>
        <ReactFlow<MindMapFlowNode, MindMapFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={(event, node) => {
            setContextMenu(null);
            setSelectedNodeId(node.id);
            (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node")?.focus();
            if (node.data.task && !(event.target as HTMLElement).closest("button, input")) {
              onSelectTask(node.data.task.id);
            }
          }}
          onNodeContextMenu={(event, node) => {
            const deletableTask = node.data.kind === "task" && !!node.data.task;
            const deletableLabel = node.data.kind === "label" && !!node.data.labelId;
            if (!deletableTask && !deletableLabel) return;
            event.preventDefault();
            event.stopPropagation();
            setSelectedNodeId(node.id);
            setContextMenu({
              x: Math.max(12, Math.min(event.clientX, window.innerWidth - 176)),
              y: Math.max(12, Math.min(event.clientY, window.innerHeight - 58)),
              node,
            });
          }}
          onPaneClick={() => {
            setContextMenu(null);
            setSelectedNodeId(null);
            canvasRef.current?.focus();
          }}
          onInit={(instance) => {
            if (initializedRef.current) return;
            initializedRef.current = true;
            const saved = storedViewport(workspaceId);
            if (saved) void instance.setViewport(saved);
            else window.requestAnimationFrame(() => focusNode(focusDateKey, 0));
          }}
          onMoveEnd={(_, viewport) => {
            if (!initializedRef.current) return;
            window.localStorage.setItem(
              `anttodo:mind-map-viewport:${workspaceId}`,
              JSON.stringify(viewport),
            );
          }}
          minZoom={0.2}
          maxZoom={1.8}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          onlyRenderVisibleElements
          panOnScroll
          selectionOnDrag={false}
          autoPanOnNodeFocus
          proOptions={{ hideAttribution: false }}
          aria-label="任务思维导图"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1}
            color="rgba(25,25,25,.09)"
          />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
        <div className="mind-map-bottom-bar" aria-label="思维导图操作栏">
          <button type="button" disabled={!online} onClick={createLabel}>
            <Tag /><span>新增标签</span>
          </button>
          <span className="mind-map-bottom-divider" aria-hidden="true" />
          <button type="button" disabled={!online} onClick={startTaskDraft}>
            <Plus /><span>新增任务</span>
          </button>
        </div>
        {contextMenu && (
          <>
            <button
              type="button"
              className="mind-map-menu-scrim"
              aria-label="关闭菜单"
              onClick={() => setContextMenu(null)}
            />
            <div
              className="mind-map-context-menu"
              role="menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={!online || contextBusy}
                onClick={() => void deleteContextTarget()}
              >
                <Trash2 />
                {contextMenu.node.data.kind === "task" ? "删除任务" : "删除标签"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MindMapWorkspace(props: MindMapCanvasProps) {
  return (
    <ReactFlowProvider>
      <MindMapCanvas {...props} />
    </ReactFlowProvider>
  );
}
