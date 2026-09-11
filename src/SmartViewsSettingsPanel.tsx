import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  resolveSystemSmartViewOrder,
  type SystemSmartViewKey,
} from "./lib/taskList";
import type { CustomTaskView, TaskSystemViewPreference } from "./types";

export type { SystemSmartViewKey };

const SYSTEM_VIEW_LABELS: Record<SystemSmartViewKey, string> = {
  all: "所有",
  today: "今天",
  week: "本周",
  watching: "我关注的",
  inbox: "收集箱",
  trash: "回收站",
};

function visibleSystemView(
  preferences: TaskSystemViewPreference[],
  id: string,
) {
  return preferences.find((item) => item.view_key === id)?.visible ?? true;
}

export function SmartViewsSettingsPanel({
  customViews,
  systemPreferences,
  online,
  onToggleSystem,
  onToggleCustom,
  onDeleteCustom,
  onReorderSystem,
  onReorderCustom,
}: {
  customViews: CustomTaskView[];
  systemPreferences: TaskSystemViewPreference[];
  online: boolean;
  onToggleSystem: (viewKey: SystemSmartViewKey, visible: boolean) => Promise<void>;
  onToggleCustom: (viewId: string, visible: boolean) => Promise<void>;
  onDeleteCustom: (view: CustomTaskView) => Promise<void>;
  onReorderSystem: (orderedKeys: SystemSmartViewKey[]) => Promise<void>;
  onReorderCustom: (orderedIds: string[]) => Promise<void>;
}) {
  const systemOrder = resolveSystemSmartViewOrder(systemPreferences);
  const customOrder = [...customViews]
    .sort((left, right) => left.position - right.position || left.created_at.localeCompare(right.created_at));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleSystemDragEnd(event: DragEndEvent) {
    if (!online || !event.over || event.active.id === event.over.id) return;
    const from = systemOrder.indexOf(String(event.active.id) as SystemSmartViewKey);
    const to = systemOrder.indexOf(String(event.over.id) as SystemSmartViewKey);
    if (from < 0 || to < 0) return;
    void onReorderSystem(arrayMove(systemOrder, from, to));
  }

  function handleCustomDragEnd(event: DragEndEvent) {
    if (!online || !event.over || event.active.id === event.over.id) return;
    const orderedIds = customOrder.map((view) => view.id);
    const from = orderedIds.indexOf(String(event.active.id));
    const to = orderedIds.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    void onReorderCustom(arrayMove(orderedIds, from, to));
  }

  return (
    <section className="smart-views-settings" aria-labelledby="smart-views-settings-title">
      <h1 id="smart-views-settings-title">智能视图</h1>
      <p className="smart-views-settings-description">
        控制智能视图在侧边栏中的显示状态与排序。系统视图与自定义视图分别排序。
      </p>

      <div className="smart-views-settings-group">
        <h2>系统视图</h2>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSystemDragEnd}>
          <SortableContext items={systemOrder} strategy={verticalListSortingStrategy}>
            <div className="smart-views-settings-list" role="list" aria-label="系统视图列表">
              {systemOrder.map((viewKey) => {
                const label = SYSTEM_VIEW_LABELS[viewKey] ?? viewKey;
                const checked = visibleSystemView(systemPreferences, viewKey);
                return (
                  <SortableSmartViewRow
                    key={viewKey}
                    id={viewKey}
                    label={label}
                    online={online}
                    dragDisabled={!online}
                  >
                    <label className="smart-view-setting-control">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`显示${label}`}
                        checked={checked}
                        disabled={!online}
                        onChange={(event) => {
                          void onToggleSystem(viewKey, event.target.checked);
                        }}
                      />
                      <i aria-hidden="true">{checked ? <Eye /> : <EyeOff />}</i>
                    </label>
                  </SortableSmartViewRow>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="smart-views-settings-group">
        <h2>自定义视图</h2>
        {customOrder.length === 0 ? (
          <p className="smart-views-settings-empty">还没有自定义视图。</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCustomDragEnd}>
            <SortableContext
              items={customOrder.map((view) => view.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="smart-views-settings-list" role="list" aria-label="自定义视图列表">
                {customOrder.map((view) => (
                  <SortableSmartViewRow
                    key={view.id}
                    id={view.id}
                    label={view.name}
                    online={online}
                    dragDisabled={!online}
                  >
                    <span className="smart-view-setting-actions">
                      <button
                        type="button"
                        className="smart-view-visibility-button"
                        aria-label={`${view.visible ? "隐藏" : "显示"}${view.name}`}
                        disabled={!online}
                        onClick={() => void onToggleCustom(view.id, !view.visible)}
                      >
                        {view.visible ? <Eye /> : <EyeOff />}
                      </button>
                      <button
                        type="button"
                        className="smart-view-delete-button"
                        aria-label={`删除${view.name}`}
                        disabled={!online}
                        onClick={() => {
                          if (window.confirm(`确定删除自定义视图“${view.name}”吗？`)) {
                            void onDeleteCustom(view);
                          }
                        }}
                      >
                        <Trash2 />
                      </button>
                    </span>
                  </SortableSmartViewRow>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </section>
  );
}

function SortableSmartViewRow({
  id,
  label,
  online,
  dragDisabled,
  children,
}: {
  id: string;
  label: string;
  online: boolean;
  dragDisabled: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: dragDisabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx("smart-view-setting-row", isDragging && "is-dragging")}
      role="listitem"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="smart-view-drag-handle"
        aria-label={`拖动排序${label}`}
        disabled={!online || dragDisabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" />
      </button>
      <span title={label}>{label}</span>
      {children}
    </div>
  );
}
