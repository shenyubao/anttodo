import dagre from "@dagrejs/dagre";
import * as Dialog from "@radix-ui/react-dialog";
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
  FolderClosed,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Maximize2,
  NotebookPen,
  Plus,
  Settings2,
  Tag,
  Trash2,
  ChevronsUpDown,
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
import { compareSiblingLabels, hasExplicitLabelColor, userLabelOrderMap } from "./lib/labels";
import {
  buildMindMapTree,
  classifyTaskSchedule,
  DEFAULT_MIND_MAP_LABEL_DISPLAY_MODE,
  defaultCollapsedMindMapNodeIds,
  isCollapsibleMindMapNode,
  MIND_MAP_LABEL_DISPLAY_OPTIONS,
  moveTaskToSchedule,
  resolveMindMapDropAssignment,
  scheduleTargetFromNode,
  scheduleTargetKey,
  type MindMapLabelDisplayMode,
  type MindMapNodeKind,
  type MindMapScheduleLevel,
  type MindMapTreeNode,
} from "./lib/mindMap";
import { applyTaskListFilters, resolveTaskListPreference } from "./lib/taskList";
import type {
  DateTimePreferences,
  Label,
  LabelPermissionLevel,
  Member,
  Task,
  TaskListPreference,
  UserLabelOrder,
  WorkspaceBundle,
} from "./types";
import { mergeLabelIds } from "./lib/taskTitleTokens";
import { useShortcutHandler } from "./ShortcutProvider";
import { TaskFilterMenu } from "./TaskFilterMenu";
import { TaskTitleTokenChips, TaskTitleTokenMenu } from "./TaskTitleTokenMenu";
import { useTaskTitleTokens, type TaskTitleTokenSubmit } from "./useTaskTitleTokens";

const MIND_MAP_FILTER_LIST_KEY = "all";

function useMinuteNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_050 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);
  return now;
}

type CreateTaskInput = {
  title: string;
  labelIds: string[];
  description?: string;
  dueAt?: string | null;
  dueTimezone?: string | null;
  assigneeId?: string | null;
};

type MindMapNodeData = {
  kind: MindMapNodeKind;
  label: string;
  dateKey?: string;
  dateEndKey?: string;
  scheduleLevel?: MindMapScheduleLevel;
  contextKey?: string;
  labelId?: string;
  labelColor?: string;
  task?: Task;
  online: boolean;
  draft?: boolean;
  draftBusy?: boolean;
  members?: Member[];
  labels?: Label[];
  labelPermissionLevels?: Record<string, LabelPermissionLevel | undefined>;
  userLabelOrder?: UserLabelOrder[];
  currentUserId?: string;
  onDraftSubmit?: (payload: TaskTitleTokenSubmit) => void;
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
  month: { width: 96, height: 38 },
  week: { width: 148, height: 38 },
  day: { width: 112, height: 38 },
  inbox: { width: 112, height: 38 },
  unscheduled: { width: 112, height: 38 },
  label: { width: 120, height: 42 },
  task: { width: 224, height: 42 },
};

const DATE_NODE_KINDS = new Set<MindMapNodeKind>(["month", "week", "day"]);
const LABEL_NODE_MAX_WIDTH = 280;
const MIND_MAP_UI_FONT =
  '"Color Emoji", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Horizontal gap between parent/child ranks. Original dagre ranksep was 72. */
const MIND_MAP_RANK_GAP = Math.round(72 * 0.45);
/** Distance from parent handle to the shared vertical fork stem. */
const MIND_MAP_EDGE_STEM = Math.round(MIND_MAP_RANK_GAP / 2);
/** Vertical gap between sibling nodes in the packed tree layout. */
const MIND_MAP_NODE_GAP = 18;

let textMeasureCanvas: HTMLCanvasElement | null = null;

function measureMindMapTextWidth(text: string, font: string) {
  if (typeof document === "undefined") {
    return Math.ceil([...text].reduce((width, char) => (
      width + (/[\u0020-\u007e]/.test(char) ? 7.2 : 13)
    ), 0));
  }
  textMeasureCanvas ??= document.createElement("canvas");
  const context = textMeasureCanvas.getContext("2d");
  if (!context) {
    return Math.ceil([...text].reduce((width, char) => (
      width + (/[\u0020-\u007e]/.test(char) ? 7.2 : 13)
    ), 0));
  }
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}

function mindMapNodeFont(kind: MindMapNodeKind) {
  const size = kind === "root" ? 15 : 13;
  const weight = kind === "root" || kind === "month" || kind === "label"
    ? 600
    : kind === "day" || kind === "inbox" || kind === "unscheduled"
      ? 500
      : 400;
  return `${weight} ${size}px ${MIND_MAP_UI_FONT}`;
}

function mindMapNodeChromeWidth(kind: MindMapNodeKind, collapsible: boolean) {
  const compactPad = DATE_NODE_KINDS.has(kind) || kind === "task";
  const padding = compactPad ? 20 : 26;
  const icon = DATE_NODE_KINDS.has(kind)
    ? 21
    : kind === "label"
      ? 23
      : kind === "task"
        ? 30
        : 0;
  const collapse = collapsible ? 22 : 0;
  return padding + icon + collapse;
}

function contentWidthForNode(
  kind: MindMapNodeKind,
  label: string,
  collapsible: boolean,
) {
  const textWidth = measureMindMapTextWidth(label, mindMapNodeFont(kind));
  // +2px absorbs sub-pixel/font metric differences against canvas measureText.
  const width = textWidth + mindMapNodeChromeWidth(kind, collapsible) + 2;
  const minWidth = NODE_SIZES[kind].width;
  if (kind === "label") {
    return Math.min(LABEL_NODE_MAX_WIDTH, Math.max(minWidth, width));
  }
  if (kind === "task") {
    return Math.min(LABEL_NODE_MAX_WIDTH, Math.max(minWidth, width));
  }
  return Math.max(minWidth, width);
}

function nodeDepthById(nodes: MindMapFlowNode[], edges: MindMapFlowEdge[]) {
  const depthById = new Map<string, number>();
  const childrenByParent = new Map<string, string[]>();
  const childIds = new Set<string>();
  edges.forEach((edge) => {
    childIds.add(edge.target);
    const children = childrenByParent.get(edge.source) ?? [];
    children.push(edge.target);
    childrenByParent.set(edge.source, children);
  });
  const roots = nodes.filter((node) => !childIds.has(node.id));
  const queue = roots.map((node) => node.id);
  roots.forEach((node) => depthById.set(node.id, 0));
  while (queue.length) {
    const id = queue.shift()!;
    const depth = depthById.get(id) ?? 0;
    for (const childId of childrenByParent.get(id) ?? []) {
      if (depthById.has(childId)) continue;
      depthById.set(childId, depth + 1);
      queue.push(childId);
    }
  }
  return depthById;
}

function resolveNodeSizes(nodes: MindMapFlowNode[], edges: MindMapFlowEdge[]) {
  const sizeById = new Map<string, { width: number; height: number }>();
  const depthById = nodeDepthById(nodes, edges);
  const sharedWidthByDepth = new Map<number, number>();

  nodes.forEach((node) => {
    const kind = node.type ?? "task";
    const depth = depthById.get(node.id) ?? 0;
    const width = contentWidthForNode(kind, node.data.label, !!node.data.collapsible);
    sharedWidthByDepth.set(depth, Math.max(sharedWidthByDepth.get(depth) ?? 0, width));
  });

  nodes.forEach((node) => {
    const kind = node.type ?? "task";
    const depth = depthById.get(node.id) ?? 0;
    sizeById.set(node.id, {
      width: sharedWidthByDepth.get(depth) ?? NODE_SIZES[kind].width,
      height: NODE_SIZES[kind].height,
    });
  });

  return sizeById;
}

function MindMapNodeView({ id, data, selected }: NodeProps<MindMapFlowNode>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tokens = useTaskTitleTokens({
    members: data.members ?? [],
    labels: data.labels ?? [],
    labelPermissionLevels: data.labelPermissionLevels ?? {},
    userLabelOrder: data.userLabelOrder,
    currentUserId: data.currentUserId ?? "",
    features: { assignee: true, labels: true },
    inputRef,
  });

  useEffect(() => {
    if (!data.draft) return;
    inputRef.current?.focus();
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
        data.task?.kind !== "note" && data.task?.status === "completed" && "completed",
        data.task?.kind === "note" && "note",
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
        if (event.defaultPrevented) return;
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
              if (tokens.token) return;
              data.onDraftSubmit?.(tokens.toSubmitPayload());
            }}
          >
            {data.draftBusy ? <LoaderCircle className="mind-map-node-spinner" /> : <Circle />}
            <div className="mind-map-draft-fields">
              <div className="task-title-token-field">
                <input
                  ref={inputRef}
                  value={tokens.title}
                  placeholder="输入待办标题"
                  aria-label="新待办标题"
                  disabled={data.draftBusy}
                  onChange={tokens.handleChange}
                  onKeyDown={(event) => {
                    if (tokens.handleKeyDown(event)) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      data.onDraftCancel?.();
                    }
                  }}
                />
                {tokens.token && (
                  <TaskTitleTokenMenu
                    kind={tokens.token.kind}
                    assigneeCandidates={tokens.assigneeCandidates}
                    labelCandidates={tokens.labelCandidates}
                    activeIndex={tokens.activeIndex}
                    onSelectAssignee={tokens.selectAssignee}
                    onSelectLabel={tokens.selectLabel}
                  />
                )}
              </div>
              <TaskTitleTokenChips
                assignee={tokens.assignee}
                labels={tokens.selectedLabels}
                disabled={data.draftBusy}
                onRemoveAssignee={tokens.removeAssignee}
                onRemoveLabel={tokens.removeLabel}
              />
            </div>
          </form>
        ) : (
          <div className="mind-map-task-content">
            {data.task?.kind === "note" ? (
              <span className="mind-map-note-icon" aria-label="笔记"><NotebookPen /></span>
            ) : (
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
            )}
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
  // Bend at a fixed offset from the parent so siblings share one vertical stem.
  // The default midpoint uses each target's X, which drifts when same-rank nodes
  // differ in width.
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 4,
    offset: MIND_MAP_EDGE_STEM,
    centerX: props.sourceX + MIND_MAP_EDGE_STEM,
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
    "kind" | "label" | "dateKey" | "dateEndKey" | "scheduleLevel" | "contextKey"
      | "labelId" | "labelColor" | "task" | "collapsible" | "collapsed"
  >,
  draft: {
    parentId: string;
    dateKey: string | null;
    dateEndKey?: string | null;
    scheduleLevel?: MindMapScheduleLevel | null;
    labelId: string | null;
  } | null,
  collapsedNodeIds: ReadonlySet<string>,
) {
  const nodes: MindMapFlowNode[] = [];
  const edges: MindMapFlowEdge[] = [];

  const visit = (item: MindMapTreeNode, parentId?: string) => {
    const size = NODE_SIZES[item.kind];
    const collapsible = isCollapsibleMindMapNode(item);
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
        dateEndKey: item.dateEndKey,
        scheduleLevel: item.scheduleLevel,
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

  const sizeById = resolveNodeSizes(nodes, edges);
  nodes.forEach((node) => {
    const size = sizeById.get(node.id) ?? NODE_SIZES[node.type ?? "task"];
    node.width = size.width;
    node.height = size.height;
  });

  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: MIND_MAP_RANK_GAP,
    nodesep: MIND_MAP_NODE_GAP,
    edgesep: 8,
    marginx: 32,
    marginy: 32,
  });
  nodes.forEach((node) => {
    // Dagre mutates the node label with its calculated coordinates. Each node
    // must therefore receive its own dimensions object instead of sharing a
    // cached size object across nodes.
    const size = sizeById.get(node.id) ?? NODE_SIZES[node.type ?? "task"];
    graph.setNode(node.id, { ...size });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  // Dagre can insert dummy ranks for edge routing; pack real ranks so the
  // visible parent→child connector length matches MIND_MAP_RANK_GAP.
  const rankGroups = new Map<number, string[]>();
  nodes.forEach((node) => {
    const rank = graph.node(node.id).rank ?? 0;
    const group = rankGroups.get(rank) ?? [];
    group.push(node.id);
    rankGroups.set(rank, group);
  });
  // Same visual column (rank) shares one width so day/task/label siblings align.
  rankGroups.forEach((ids) => {
    const rankWidth = ids.reduce(
      (max, id) => Math.max(max, sizeById.get(id)?.width ?? 0),
      0,
    );
    ids.forEach((id) => {
      const current = sizeById.get(id);
      if (!current) return;
      sizeById.set(id, { ...current, width: rankWidth });
    });
  });
  nodes.forEach((node) => {
    const size = sizeById.get(node.id);
    if (size) node.width = size.width;
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

  // Dagre reorders siblings for edge crossing; re-pack Y from the tree's
  // insertion order so chronological children (weeks/days/…) stay top→bottom.
  const childrenByParent = new Map<string, string[]>();
  edges.forEach((edge) => {
    const children = childrenByParent.get(edge.source) ?? [];
    children.push(edge.target);
    childrenByParent.set(edge.source, children);
  });
  const topById = new Map<string, number>();
  const subtreeHeightById = new Map<string, number>();
  const measureSubtreeHeight = (id: string): number => {
    const cached = subtreeHeightById.get(id);
    if (cached !== undefined) return cached;
    const size = sizeById.get(id) ?? NODE_SIZES.task;
    const children = childrenByParent.get(id) ?? [];
    const height = children.length === 0
      ? size.height
      : Math.max(
        size.height,
        children.reduce((total, childId, index) => (
          total + measureSubtreeHeight(childId) + (index > 0 ? MIND_MAP_NODE_GAP : 0)
        ), 0),
      );
    subtreeHeightById.set(id, height);
    return height;
  };
  const placeSubtree = (id: string, top: number) => {
    const size = sizeById.get(id) ?? NODE_SIZES.task;
    const children = childrenByParent.get(id) ?? [];
    if (!children.length) {
      topById.set(id, top);
      return;
    }
    let childTop = top;
    children.forEach((childId, index) => {
      if (index > 0) childTop += MIND_MAP_NODE_GAP;
      placeSubtree(childId, childTop);
      childTop += measureSubtreeHeight(childId);
    });
    const firstTop = topById.get(children[0]) ?? top;
    const lastChild = children[children.length - 1];
    const lastSize = sizeById.get(lastChild) ?? NODE_SIZES.task;
    const lastTop = topById.get(lastChild) ?? top;
    const childrenMid = (firstTop + lastTop + lastSize.height) / 2;
    topById.set(id, childrenMid - size.height / 2);
  };
  placeSubtree(tree.id, 32);

  return {
    nodes: nodes.map((node) => {
      const position = graph.node(node.id);
      const size = sizeById.get(node.id) ?? NODE_SIZES.task;
      const rank = position.rank ?? 0;
      return {
        ...node,
        position: {
          x: (packedCenterX.get(rank) ?? position.x) - size.width / 2,
          y: topById.get(node.id) ?? position.y - size.height / 2,
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

function storeCollapsedNodes(workspaceId: string, collapsedNodeIds: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(collapsedStorageKey(workspaceId), JSON.stringify([...collapsedNodeIds]));
  } catch {
    // A disabled or full local storage should not block the mind map interaction.
  }
}

function hiddenLabelsStorageKey(workspaceId: string) {
  return `anttodo:mind-map-hidden-labels:${workspaceId}`;
}

function storedHiddenLabelIds(workspaceId: string) {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(hiddenLabelsStorageKey(workspaceId)) ?? "[]",
    );
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set<string>();
  }
}

function storeHiddenLabelIds(workspaceId: string, hiddenLabelIds: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(
      hiddenLabelsStorageKey(workspaceId),
      JSON.stringify([...hiddenLabelIds]),
    );
  } catch {
    // A disabled or full local storage should not block the mind map interaction.
  }
}

function labelDisplayStorageKey(workspaceId: string) {
  return `anttodo:mind-map-label-display:${workspaceId}`;
}

function storedLabelDisplayMode(workspaceId: string): MindMapLabelDisplayMode {
  try {
    const value = window.localStorage.getItem(labelDisplayStorageKey(workspaceId));
    if (MIND_MAP_LABEL_DISPLAY_OPTIONS.some((option) => option.value === value)) {
      return value as MindMapLabelDisplayMode;
    }
  } catch {
    // Ignore unavailable local storage.
  }
  return DEFAULT_MIND_MAP_LABEL_DISPLAY_MODE;
}

function storeLabelDisplayMode(workspaceId: string, mode: MindMapLabelDisplayMode) {
  try {
    window.localStorage.setItem(labelDisplayStorageKey(workspaceId), mode);
  } catch {
    // A disabled or full local storage should not block the mind map interaction.
  }
}

function MindMapDisplayLabelTree({
  labels,
  userLabelOrder,
  hiddenLabelIds,
  collapsed,
  onToggleCollapsed,
  onToggleVisible,
  parentId = null,
  depth = 0,
}: {
  labels: Label[];
  userLabelOrder: WorkspaceBundle["userLabelOrder"];
  hiddenLabelIds: ReadonlySet<string>;
  collapsed: Record<string, boolean>;
  onToggleCollapsed: (labelId: string) => void;
  onToggleVisible: (labelId: string) => void;
  parentId?: string | null;
  depth?: number;
}) {
  const labelIds = new Set(labels.map((label) => label.id));
  const orderMap = userLabelOrderMap(userLabelOrder);
  const children = labels
    .filter((label) => label.parent_id === parentId
      || (parentId === null && label.parent_id !== null && !labelIds.has(label.parent_id)))
    .sort((a, b) => compareSiblingLabels(a, b, parentId, orderMap));

  return children.map((label) => {
    const hasChildren = labels.some((candidate) => candidate.parent_id === label.id);
    const isCollapsed = collapsed[label.id] ?? false;
    const visible = !hiddenLabelIds.has(label.id);

    return (
      <div
        key={label.id}
        className="mind-map-display-label-node"
        role="treeitem"
        aria-expanded={hasChildren ? !isCollapsed : undefined}
      >
        <div
          className={clsx("mind-map-display-label-row", visible && "visible")}
          style={{ paddingLeft: 12 + depth * 16 }}
        >
          <button
            type="button"
            className="mind-map-display-label-main"
            aria-pressed={visible}
            onClick={() => onToggleVisible(label.id)}
          >
            <span
              className={clsx("label-type-icon", hasChildren && "label-group-icon")}
              onClick={hasChildren
                ? (event) => {
                    event.stopPropagation();
                    onToggleCollapsed(label.id);
                  }
                : undefined}
            >
              {hasChildren
                ? (isCollapsed ? <FolderClosed /> : <FolderOpen />)
                : <Tag />}
            </span>
            <span className="label-name">{label.name}</span>
            {label.kind === "private" && <LockKeyhole size={12} aria-hidden="true" />}
            {hasExplicitLabelColor(label.color) && (
              <i
                className="label-color-dot"
                style={{ backgroundColor: label.color }}
                aria-hidden="true"
              />
            )}
          </button>
          <label className="mind-map-display-label-check">
            <span className="sr-only">显示{label.name}</span>
            <input
              type="checkbox"
              checked={visible}
              onChange={() => onToggleVisible(label.id)}
            />
          </label>
        </div>
        {hasChildren && !isCollapsed && (
          <div role="group">
            <MindMapDisplayLabelTree
              labels={labels}
              userLabelOrder={userLabelOrder}
              hiddenLabelIds={hiddenLabelIds}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onToggleVisible={onToggleVisible}
              parentId={label.id}
              depth={depth + 1}
            />
          </div>
        )}
      </div>
    );
  });
}

function MindMapDisplaySettingsDialog({
  labels,
  userLabelOrder,
  hiddenLabelIds,
  labelDisplayMode,
  onToggleVisible,
  onShowAll,
  onHideAll,
  onLabelDisplayModeChange,
  onClose,
}: {
  labels: Label[];
  userLabelOrder: WorkspaceBundle["userLabelOrder"];
  hiddenLabelIds: ReadonlySet<string>;
  labelDisplayMode: MindMapLabelDisplayMode;
  onToggleVisible: (labelId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onLabelDisplayModeChange: (mode: MindMapLabelDisplayMode) => void;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const hiddenCount = labels.reduce(
    (count, label) => count + (hiddenLabelIds.has(label.id) ? 1 : 0),
    0,
  );
  const selectedCount = labels.length - hiddenCount;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content mind-map-display-dialog">
          <Dialog.Title>显示设置</Dialog.Title>
          <Dialog.Description className="sr-only">
            调整思维导图标签展示与可见标签。
          </Dialog.Description>
          <section
            className="mind-map-display-section mind-map-display-mode-section"
            aria-labelledby="mind-map-display-mode"
          >
            <label className="mind-map-display-mode-row" htmlFor="mind-map-label-display">
              <span id="mind-map-display-mode">标签展示</span>
              <span className="mind-map-display-select-wrap">
                <select
                  id="mind-map-label-display"
                  aria-label="标签展示"
                  value={labelDisplayMode}
                  onChange={(event) => {
                    onLabelDisplayModeChange(event.target.value as MindMapLabelDisplayMode);
                  }}
                >
                  {MIND_MAP_LABEL_DISPLAY_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronsUpDown aria-hidden="true" />
              </span>
            </label>
          </section>
          <section
            className="mind-map-display-section"
            aria-labelledby="mind-map-display-labels"
          >
            <div className="mind-map-display-section-header">
              <button
                type="button"
                id="mind-map-display-labels"
                className="mind-map-display-section-toggle"
                aria-expanded={labelPickerOpen}
                aria-controls="mind-map-display-label-picker"
                onClick={() => setLabelPickerOpen((open) => !open)}
              >
                {labelPickerOpen ? <ChevronDown /> : <ChevronRight />}
                <span>标签选择</span>
                <em>
                  {labels.length === 0
                    ? "暂无标签"
                    : `已选 ${selectedCount}/${labels.length}`}
                </em>
              </button>
              {labelPickerOpen && (
                <div className="mind-map-display-section-actions">
                  <button
                    type="button"
                    className="mind-map-display-link"
                    disabled={labels.length === 0 || hiddenCount === 0}
                    onClick={onShowAll}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="mind-map-display-link"
                    disabled={labels.length === 0 || hiddenCount === labels.length}
                    onClick={onHideAll}
                  >
                    全不选
                  </button>
                </div>
              )}
            </div>
            {labelPickerOpen && (
              <div
                id="mind-map-display-label-picker"
                className="mind-map-display-label-tree"
                role="tree"
                aria-label="标签树"
              >
                {labels.length === 0 ? (
                  <p className="mind-map-display-empty">暂无标签</p>
                ) : (
                  <MindMapDisplayLabelTree
                    labels={labels}
                    userLabelOrder={userLabelOrder}
                    hiddenLabelIds={hiddenLabelIds}
                    collapsed={collapsed}
                    onToggleCollapsed={(labelId) => setCollapsed((current) => ({
                      ...current,
                      [labelId]: !current[labelId],
                    }))}
                    onToggleVisible={onToggleVisible}
                  />
                )}
              </div>
            )}
          </section>
          <div className="mind-map-display-actions">
            <button type="button" className="button primary" onClick={onClose}>完成</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function createdTaskId(result: unknown) {
  if (typeof result === "string") return result;
  if (typeof result === "object" && result && "id" in result) return String(result.id);
  return null;
}

type MindMapCanvasProps = {
  workspaceId: string;
  bundle: WorkspaceBundle;
  currentUserId: string;
  dateTimePreferences: DateTimePreferences;
  online: boolean;
  onMenu: () => void;
  onSelectTask: (taskId: string) => void;
  onCreateTask: (input: CreateTaskInput) => Promise<unknown>;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onToggleTaskLabel: (taskId: string, labelId: string, selected: boolean) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
  onRequestCreateLabel: (parentId: string | null) => void;
  onSaveTaskListPreference: (preference: TaskListPreference) => Promise<void>;
};

function MindMapCanvas({
  workspaceId,
  bundle,
  currentUserId,
  dateTimePreferences,
  online,
  onMenu,
  onSelectTask,
  onCreateTask,
  onUpdateTask,
  onToggleTaskLabel,
  onDeleteLabel,
  onRequestCreateLabel,
  onSaveTaskListPreference,
}: MindMapCanvasProps) {
  const flow = useReactFlow<MindMapFlowNode, MindMapFlowEdge>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const workspaceRef = useRef(workspaceId);
  const now = useMinuteNow();
  const [focusDateKey, setFocusDateKey] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    parentId: string;
    dateKey: string | null;
    dateEndKey?: string | null;
    scheduleLevel?: MindMapScheduleLevel | null;
    labelId: string | null;
  } | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: MindMapFlowNode;
  } | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const [hiddenLabelIds, setHiddenLabelIds] = useState<Set<string>>(
    () => storedHiddenLabelIds(workspaceId),
  );
  const [labelDisplayMode, setLabelDisplayMode] = useState<MindMapLabelDisplayMode>(
    () => storedLabelDisplayMode(workspaceId),
  );

  const preference = resolveTaskListPreference(
    bundle.taskListPreferences,
    MIND_MAP_FILTER_LIST_KEY,
    bundle.labels,
  );

  const toggleLabelVisible = useCallback((labelId: string) => {
    setHiddenLabelIds((current) => {
      const next = new Set(current);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      storeHiddenLabelIds(workspaceId, next);
      return next;
    });
  }, [workspaceId]);

  const showAllLabels = useCallback(() => {
    setHiddenLabelIds(() => {
      const next = new Set<string>();
      storeHiddenLabelIds(workspaceId, next);
      return next;
    });
  }, [workspaceId]);

  const hideAllLabels = useCallback(() => {
    setHiddenLabelIds(() => {
      const next = new Set(bundle.labels.map((label) => label.id));
      storeHiddenLabelIds(workspaceId, next);
      return next;
    });
  }, [bundle.labels, workspaceId]);

  const changeLabelDisplayMode = useCallback((mode: MindMapLabelDisplayMode) => {
    setLabelDisplayMode(mode);
    storeLabelDisplayMode(workspaceId, mode);
  }, [workspaceId]);

  async function savePreference(
    patch: Partial<Pick<
      TaskListPreference,
      "filter_assignee" | "filter_creator" | "filter_due" | "filter_watching"
    >>,
  ) {
    if (!online) return;
    await onSaveTaskListPreference({
      user_id: currentUserId,
      workspace_id: workspaceId,
      list_key: MIND_MAP_FILTER_LIST_KEY,
      grouping: preference.grouping,
      sort: preference.sort,
      direction: preference.direction,
      filter_assignee: preference.filter_assignee,
      filter_watching: preference.filter_watching,
      filter_creator: preference.filter_creator,
      filter_due: preference.filter_due,
      show_labels: preference.show_labels,
      show_completed: preference.show_completed,
      show_hours: preference.show_hours,
      view_mode: preference.view_mode,
      ...patch,
    });
  }

  const visibleLabels = useMemo(
    () => bundle.labels.filter((label) => !hiddenLabelIds.has(label.id)),
    [bundle.labels, hiddenLabelIds],
  );

  const filteredTasks = useMemo(
    () => applyTaskListFilters({
      tasks: bundle.tasks,
      filterAssignee: preference.filter_assignee,
      filterWatching: preference.filter_watching,
      filterCreator: preference.filter_creator,
      filterDue: preference.filter_due,
      currentUserId,
      now,
    }),
    [
      bundle.tasks,
      currentUserId,
      now,
      preference.filter_assignee,
      preference.filter_creator,
      preference.filter_due,
      preference.filter_watching,
    ],
  );

  const tree = useMemo(() => buildMindMapTree({
    tasks: filteredTasks,
    labels: visibleLabels,
    preferences: dateTimePreferences,
    focusDateKey,
    labelDisplayMode,
    userLabelOrder: bundle.userLabelOrder,
  }), [
    bundle.userLabelOrder,
    dateTimePreferences,
    filteredTasks,
    focusDateKey,
    labelDisplayMode,
    visibleLabels,
  ]);

  const collapseOpenKey = `${workspaceId}:${focusDateKey}`;
  const defaultCollapsedRef = useRef<{ openKey: string; ids: Set<string> } | null>(null);
  if (!defaultCollapsedRef.current || defaultCollapsedRef.current.openKey !== collapseOpenKey) {
    defaultCollapsedRef.current = {
      openKey: collapseOpenKey,
      ids: defaultCollapsedMindMapNodeIds(
        tree,
        focusDateKey,
        dateTimePreferences.weekStartsOn,
      ),
    };
  }
  const [collapsedOverride, setCollapsedOverride] = useState<{
    openKey: string;
    ids: Set<string>;
  } | null>(null);
  const collapsedNodeIds = collapsedOverride?.openKey === collapseOpenKey
    ? collapsedOverride.ids
    : defaultCollapsedRef.current.ids;

  const toggleNodeCollapse = useCallback((nodeId: string) => {
    setCollapsedOverride((current) => {
      const base = current?.openKey === collapseOpenKey
        ? current.ids
        : defaultCollapsedRef.current?.ids ?? new Set<string>();
      const next = new Set(base);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      storeCollapsedNodes(workspaceId, next);
      return { openKey: collapseOpenKey, ids: next };
    });
  }, [collapseOpenKey, workspaceId]);

  const toggleTask = useCallback(async (task: Task) => {
    if (!online || task.kind === "note") return;
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

  const submitDraft = useCallback(async (payload: TaskTitleTokenSubmit) => {
    const title = payload.title.trim();
    if (!title || !online || draftBusy || !draft) return;
    setDraftBusy(true);
    setError("");
    try {
      const duePatch = moveTaskToSchedule({
        due_at: null,
        due_start_at: null,
        due_is_all_day: false,
        due_timezone: null,
      } as Task, scheduleTargetFromNode({
        kind: draft.scheduleLevel ?? "day",
        dateKey: draft.dateKey ?? undefined,
        dateEndKey: draft.dateEndKey ?? undefined,
        scheduleLevel: draft.scheduleLevel ?? undefined,
      }));
      const hasDue = duePatch.due_at !== null;
      const result = await onCreateTask({
        title,
        labelIds: mergeLabelIds(
          draft.labelId ? [draft.labelId] : [],
          payload.labelIds,
        ),
        assigneeId: payload.assigneeId,
        dueAt: duePatch.due_at,
        dueTimezone: duePatch.due_timezone,
      });
      const taskId = createdTaskId(result);
      if (taskId && hasDue) await onUpdateTask(taskId, duePatch);
      setDraft(null);
    } catch {
      setError("待办创建失败，请重试");
    } finally {
      setDraftBusy(false);
    }
  }, [draft, draftBusy, onCreateTask, onUpdateTask, online]);

  const cancelDraft = useCallback(() => {
    if (draftBusy) return;
    setDraft(null);
  }, [draftBusy]);

  const graph = useMemo(() => layoutTree(tree, {
    online,
    draftBusy: false,
    members: bundle.members,
    labels: bundle.labels,
    labelPermissionLevels: bundle.labelPermissionLevels,
    userLabelOrder: bundle.userLabelOrder,
    currentUserId,
    onDraftSubmit: (payload) => void submitDraft(payload),
    onDraftCancel: cancelDraft,
    onToggleTask: (task) => void toggleTask(task),
    onToggleCollapse: toggleNodeCollapse,
  }, draft, collapsedNodeIds), [
    bundle.labelPermissionLevels,
    bundle.labels,
    bundle.members,
    bundle.userLabelOrder,
    cancelDraft,
    collapsedNodeIds,
    currentUserId,
    draft,
    online,
    submitDraft,
    toggleNodeCollapse,
    toggleTask,
    tree,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState<MindMapFlowNode>(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<MindMapFlowEdge>(graph.edges);
  const draftBusyRef = useRef(draftBusy);
  draftBusyRef.current = draftBusy;
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;

  const startTaskDraft = useCallback(() => {
    if (!online || draftBusy) return;
    const selected = nodes.find((node) => node.id === selectedNodeId);
    const schedule = selected
      ? scheduleTargetFromNode(selected.data)
      : { level: "none" as const };
    const dateKey = schedule.level === "day"
      ? schedule.dateKey
      : schedule.level === "week" || schedule.level === "month"
        ? schedule.startKey
        : null;
    const dateEndKey = schedule.level === "week" || schedule.level === "month"
      ? schedule.endKey
      : null;
    const scheduleLevel = schedule.level === "none" ? null : schedule.level;
    const labelId = selected?.data.kind === "label" || selected?.data.kind === "task"
      ? selected.data.labelId ?? null
      : null;
    const contextKey = selected?.data.contextKey
      ?? dateKey
      ?? (labelId ? "unscheduled" : "inbox");
    const parentId = selected?.data.kind === "label"
      ? selected.id
      : selected?.data.kind === "task"
        ? labelId
          ? `label:${contextKey}:${labelId}`
          : selected.data.contextKey
            ?? (dateKey ? `day:${dateKey}` : "inbox")
        : selected?.data.kind === "day"
          || selected?.data.kind === "week"
          || selected?.data.kind === "month"
          || selected?.data.kind === "inbox"
            ? selected.id
            : "inbox";
    setContextMenu(null);
    setDraft({ parentId, dateKey, dateEndKey, scheduleLevel, labelId });
  }, [draftBusy, nodes, online, selectedNodeId]);

  useEffect(() => {
    setNodes(graph.nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeIdRef.current,
      data: node.id === "draft-task"
        ? { ...node.data, draftBusy: draftBusyRef.current }
        : node.data,
    })));
    setEdges(graph.edges);
  }, [graph.edges, graph.nodes, setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const selected = node.id === selectedNodeId;
        if (node.selected === selected) return node;
        changed = true;
        return { ...node, selected };
      });
      return changed ? next : current;
    });
  }, [selectedNodeId, setNodes]);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (node.id !== "draft-task" || node.data.draftBusy === draftBusy) return node;
        changed = true;
        return { ...node, data: { ...node.data, draftBusy } };
      });
      return changed ? next : current;
    });
  }, [draftBusy, setNodes]);

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
    setCollapsedOverride(null);
    setHiddenLabelIds(storedHiddenLabelIds(workspaceId));
    setLabelDisplayMode(storedLabelDisplayMode(workspaceId));
    setDisplaySettingsOpen(false);
    if (!initializedRef.current) return;
    const saved = storedViewport(workspaceId);
    if (saved) void flow.setViewport(saved, { duration: 0 });
    else window.requestAnimationFrame(() => focusNode(nextKey, 0));
  }, [flow, focusNode, workspaceId]);

  useShortcutHandler("mindmap.newTask", () => {
    startTaskDraft();
  });

  useShortcutHandler("mindmap.fitView", () => {
    void flow.fitView({ padding: 0.16, duration: 260 });
  });

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
    const itemName = node.data.task?.kind === "note" ? "笔记" : "任务";
    const confirmed = isTask
      ? window.confirm(`删除${itemName}“${node.data.label}”？此操作会将${itemName}移入回收站。`)
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
      setError(isTask ? `${itemName}删除失败，请重试` : "标签删除失败，请重试");
    } finally {
      setContextBusy(false);
    }
  }, [contextBusy, contextMenu, onDeleteLabel, onUpdateTask, online]);

  const findDropTarget = useCallback((node: MindMapFlowNode) => {
    const targets = flow.getIntersectingNodes(node, true).filter((candidate) =>
      candidate.id !== node.id
      && (candidate.data.kind === "month"
        || candidate.data.kind === "week"
        || candidate.data.kind === "day"
        || candidate.data.kind === "inbox"
        || candidate.data.kind === "unscheduled"
        || candidate.data.kind === "label"
        || (candidate.data.kind === "task" && !candidate.data.draft)),
    ) as MindMapFlowNode[];
    if (!targets.length) return null;

    const parentById = new Map<string, string>();
    graph.edges.forEach((edge) => parentById.set(edge.target, edge.source));
    const depthOf = (id: string) => {
      let depth = 0;
      let current: string | undefined = id;
      const visiting = new Set<string>();
      while (current && !visiting.has(current)) {
        visiting.add(current);
        const parentId = parentById.get(current);
        if (!parentId) break;
        depth += 1;
        current = parentId;
      }
      return depth;
    };
    const scheduleScore = (candidate: MindMapFlowNode) => {
      const schedule = scheduleTargetFromNode(candidate.data);
      if (schedule.level === "day") return 3;
      if (schedule.level === "week") return 2;
      if (schedule.level === "month") return 1;
      return 0;
    };
    const kindScore = (kind: MindMapNodeKind) => {
      if (kind === "day") return 4;
      if (kind === "label") return 3;
      if (kind === "task") return 2;
      if (kind === "week") return 1;
      return 0;
    };

    return [...targets].sort((a, b) => {
      const depthDiff = depthOf(b.id) - depthOf(a.id);
      if (depthDiff) return depthDiff;
      const scheduleDiff = scheduleScore(b) - scheduleScore(a);
      if (scheduleDiff) return scheduleDiff;
      return kindScore(b.data.kind) - kindScore(a.data.kind);
    })[0] ?? null;
  }, [flow, graph.edges]);

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

    const parentById = new Map<string, string>();
    graph.edges.forEach((edge) => parentById.set(edge.target, edge.source));
    const nodesById = new Map(graph.nodes.map((item) => [item.id, item]));
    const path: MindMapFlowNode[] = [];
    let current: MindMapFlowNode | undefined = target;
    const visiting = new Set<string>();
    while (current && !visiting.has(current.id)) {
      visiting.add(current.id);
      path.push(current);
      const parentId = parentById.get(current.id);
      current = parentId ? nodesById.get(parentId) : undefined;
    }

    const assignment = resolveMindMapDropAssignment(path.map((item) => item.data));
    const currentSchedule = classifyTaskSchedule(task, dateTimePreferences);
    const dateChanged = assignment.applySchedule
      && scheduleTargetKey(assignment.schedule) !== scheduleTargetKey(currentSchedule);
    const labelsToRemove = assignment.clearLabels ? [...task.label_ids] : [];
    const labelToAdd = !assignment.clearLabels
      && assignment.labelId
      && !task.label_ids.includes(assignment.labelId)
      ? assignment.labelId
      : null;
    if (!dateChanged && !labelsToRemove.length && !labelToAdd) return;

    setError("");
    void (async () => {
      const removedLabels: string[] = [];
      let addedLabel = false;
      try {
        if (dateChanged) {
          await onUpdateTask(task.id, moveTaskToSchedule(task, assignment.schedule));
        }
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
    dateTimePreferences,
    findDropTarget,
    graph.edges,
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
          <button className="mobile-menu" aria-label="打开导航" onClick={onMenu}><Menu /></button>
          <h1>思维导图</h1>
          {!online && <span className="mind-map-readonly">离线只读</span>}
          {error && <span className="mind-map-error" role="status">{error}</span>}
        </div>
        <div className="mind-map-toolbar-actions">
          <TaskFilterMenu
            preference={preference}
            online={online}
            onChange={savePreference}
          />
          <button
            type="button"
            aria-label="显示设置"
            aria-haspopup="dialog"
            aria-expanded={displaySettingsOpen}
            onClick={() => setDisplaySettingsOpen(true)}
          >
            <Settings2 /><span>显示设置</span>
          </button>
          <button onClick={today}><Crosshair /><span>今天</span></button>
          <button onClick={() => void flow.fitView({ padding: 0.16, duration: 260 })}>
            <Maximize2 /><span>一览全部</span>
          </button>
        </div>
      </header>
      {displaySettingsOpen && (
        <MindMapDisplaySettingsDialog
          labels={bundle.labels}
          userLabelOrder={bundle.userLabelOrder}
          hiddenLabelIds={hiddenLabelIds}
          labelDisplayMode={labelDisplayMode}
          onToggleVisible={toggleLabelVisible}
          onShowAll={showAllLabels}
          onHideAll={hideAllLabels}
          onLabelDisplayModeChange={changeLabelDisplayMode}
          onClose={() => setDisplaySettingsOpen(false)}
        />
      )}
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
            const target = event.target as HTMLElement;
            if (target.closest("input, textarea, select, button, [contenteditable='true']")) return;
            target.closest<HTMLElement>(".react-flow__node")?.focus();
          }}
          onNodeDoubleClick={(event, node) => {
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
                {contextMenu.node.data.kind === "task"
                  ? `删除${contextMenu.node.data.task?.kind === "note" ? "笔记" : "任务"}`
                  : "删除标签"}
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
