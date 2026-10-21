import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Member } from "./types";
import { supabase } from "./lib/supabase";
import { memberDisplayName } from "./lib/taskTitleTokens";
import { OKR_STATUS_LABELS } from "./lib/okr";
import { createDemoOkrData } from "./lib/demoOkr";
import {
  generateWeeklyReportOkr, selectableWeeklyReportOkrObjectives, weeklyReportOkrRecords,
  type WeeklyReportOkrData,
} from "./lib/weeklyReportOkr";
import { loadWeeklyReportOkrData, weeklyReportOkrKey } from "./lib/weeklyReportOkrApi";

export function WeeklyReportOkrSection({ workspaceId, currentUserId, weekStart, members, readOnly, demoMode, value, onChange }: {
  workspaceId: string; currentUserId: string; weekStart: string; members: Member[];
  readOnly: boolean; demoMode: boolean; value: string; onChange: (value: string) => void;
}) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const query = useQuery({
    queryKey: weeklyReportOkrKey(workspaceId, currentUserId, weekStart),
    queryFn: () => loadWeeklyReportOkrData(supabase!, workspaceId, currentUserId),
    enabled: Boolean(supabase) && !demoMode,
  });
  const demoData = useMemo<WeeklyReportOkrData>(() => {
    if (!demoMode) return { objectives: [], records: [] };
    const { cycles, sets } = createDemoOkrData(workspaceId);
    return {
      objectives: selectableWeeklyReportOkrObjectives(sets.flatMap((set) => set.objectives.map((objective) => ({
        objective, ownerId: set.owner_id, cycle: cycles.find((cycle) => cycle.id === set.cycle_id)!,
      }))), currentUserId),
      records: [],
    };
  }, [demoMode, workspaceId, currentUserId]);
  const data = demoMode ? demoData : query.data ?? { objectives: [], records: [] };
  const available = weeklyReportOkrRecords(data, weekStart, all);
  const selectableIds = new Set(data.objectives.flatMap((entry) => entry.selectableKeyResultIds));
  const validSelected = new Set(data.records.filter((record) => selected.has(record.id)
    && record.key_result_id && selectableIds.has(record.key_result_id)).map((record) => record.id));
  useEffect(() => { setSelected(new Set()); setAll(false); setPickerOpen(false); }, [workspaceId, currentUserId, weekStart]);
  useEffect(() => {
    if (!query.data) return;
    const allowed = new Set(query.data.objectives.flatMap((entry) => entry.selectableKeyResultIds));
    const present = new Set(query.data.records.filter((record) => record.key_result_id && allowed.has(record.key_result_id)).map((record) => record.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => present.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [query.data]);
  useEffect(() => {
    if (!supabase || demoMode) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["weekly-report-okr", workspaceId] });
      }, 120);
    };
    const channel = supabase.channel(`weekly-report-okr:${workspaceId}:${currentUserId}`);
    for (const table of ["okr_cycles", "okr_sets", "okr_objectives", "okr_key_results", "okr_objective_responsibles",
      "okr_key_result_responsibles", "okr_progress_records", "okr_access_revisions", "user_group_members"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` }, invalidate);
    }
    channel.subscribe();
    return () => { clearTimeout(timer); void supabase!.removeChannel(channel); };
  }, [workspaceId, currentUserId, demoMode, queryClient]);

  const loading = !demoMode && Boolean(supabase) && query.isPending;
  const failed = !demoMode && query.isError;
  if (!loading && !failed && !data.objectives.length && !value.trim()) return null;
  const generate = () => {
    if (readOnly) return;
    const text = generateWeeklyReportOkr(data, validSelected, weekStart);
    if (!text || (value.trim() && !window.confirm("重新生成将替换已有 OKR 进展正文，是否继续？"))) return;
    onChange(text);
    setPickerOpen(false);
  };
  return <section className="weekly-report-editor-section weekly-report-okr">
    <Dialog.Root open={pickerOpen && !readOnly} onOpenChange={setPickerOpen}>
      <div className="weekly-report-editor-section-title"><h2>OKR 进展</h2><div>
        <Dialog.Trigger asChild><button type="button" disabled={readOnly}><Plus />从OKR选择</button></Dialog.Trigger>
      </div></div>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content weekly-report-okr-picker">
          <header className="weekly-report-okr-picker-header">
            <Dialog.Title>选择 OKR 进展</Dialog.Title>
            <Dialog.Close asChild><button type="button" className="dialog-close-button" aria-label="关闭"><X /></button></Dialog.Close>
          </header>
          <div className="weekly-report-okr-tools">
            <label>时间范围<select aria-label="OKR 进展时间范围" value={all ? "all" : "week"} disabled={readOnly}
              onChange={(event) => setAll(event.target.value === "all")}><option value="week">周报所属周</option><option value="all">全部</option></select></label>
          </div>
          <Dialog.Description className="weekly-report-okr-hint">进度按周报所属周计算；勾选 KR 进展记录后生成正文，可继续编辑。</Dialog.Description>
          {loading && <p role="status">正在读取 OKR 进展…</p>}
          {failed && <p role="alert">读取 OKR 进展失败 <button type="button" className="button secondary" disabled={readOnly || query.isFetching} onClick={() => void query.refetch()}>重试</button></p>}
          {!loading && !failed && !available.length && <p className="weekly-report-okr-empty">{all ? "暂无可选择的 KR 进展记录" : "本周暂无 KR 进展记录，可切换“全部”查看历史记录"}</p>}
          <div className="weekly-report-okr-records">
            {!failed && data.objectives.map((entry) => {
              const records = available.filter((record) => entry.selectableKeyResultIds.includes(record.key_result_id!));
              if (!records.length) return null;
              const owner = members.find((member) => member.user_id === entry.ownerId);
              return <section key={entry.objective.id} className="weekly-report-okr-objective">
                <header><small>{entry.cycle.name} · {owner ? memberDisplayName(owner) : "团队成员"}</small><h3>{entry.objective.title}</h3></header>
                {entry.objective.key_results.map((kr) => {
                  const krRecords = records.filter((record) => record.key_result_id === kr.id);
                  if (!krRecords.length) return null;
                  return <div key={kr.id} className="weekly-report-okr-kr"><h4>{kr.title}</h4>{krRecords.map((record) => <label key={record.id} className="weekly-report-okr-record">
                    <input type="checkbox" disabled={readOnly} checked={validSelected.has(record.id)} aria-label={`选择进展 ${record.detail || record.created_at}`} onChange={(event) => {
                      const checked = event.target.checked;
                      setSelected((current) => { const next = new Set(current); if (checked) next.add(record.id); else next.delete(record.id); return next; });
                    }} />
                    <span><small>{new Date(record.created_at).toLocaleString("zh-CN")} · {OKR_STATUS_LABELS[record.current_status]}</small><span>{record.detail || "更新进度"}</span></span>
                  </label>)}</div>;
                })}
              </section>;
            })}
          </div>
          <footer className="weekly-report-okr-picker-footer">
            <span>已选 {validSelected.size} 条</span>
            <Dialog.Close asChild><button type="button" className="button secondary">取消</button></Dialog.Close>
            <button type="button" className="button primary" disabled={readOnly || loading || failed || !validSelected.size} onClick={generate}>确定</button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <textarea aria-label="OKR 进展" placeholder="选择 KR 进展记录生成，或直接填写 OKR 进展" value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
  </section>;
}
