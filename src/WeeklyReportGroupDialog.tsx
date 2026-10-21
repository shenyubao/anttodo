import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { MemberAvatar } from "./MemberAvatar";
import { WeeklyReportNotificationGroupDialog } from "./WeeklyReportNotificationGroupDialog";
import { saveWeeklyReportGroup, weeklyReportGroupsKey, type SaveWeeklyReportGroupInput } from "./lib/weeklyReportGroupsApi";
import { createWeeklyReportNotificationGroup, loadWeeklyReportNotificationGroups, weeklyReportNotificationGroupsKey } from "./lib/weeklyReportNotificationsApi";
import { supabase } from "./lib/supabase";
import { memberDisplayName } from "./lib/taskTitleTokens";
import type { Member, NoticeHandler, UserGroup, WeeklyReportGroup, WeeklyReportNotificationGroup } from "./types";

export function WeeklyReportGroupDialog({ workspaceId, group, members, userGroups, disabled, online = true, demoMode = false, onClose, onSaved, onNotice }: {
  workspaceId: string; group: WeeklyReportGroup | null; members: Member[]; userGroups: UserGroup[];
  disabled: boolean; online?: boolean; demoMode?: boolean; onClose: () => void; onSaved: (group: WeeklyReportGroup) => void; onNotice: NoticeHandler;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<SaveWeeklyReportGroupInput>(() => group ? { ...group } : {
    name: "", participant_ids: [], visibility: "workspace", viewer_user_ids: [], viewer_group_ids: [],
    enabled: false, schedules: [], notification_group_ids: [],
  });
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const notifications = useQuery({ queryKey: weeklyReportNotificationGroupsKey(workspaceId),
    queryFn: () => loadWeeklyReportNotificationGroups(supabase!, workspaceId), enabled: Boolean(supabase) && online && !demoMode });
  const readOnly = disabled || busy || !supabase;
  const validReminder = !draft.enabled || Boolean(draft.participant_ids.length && draft.schedules.length
    && draft.notification_group_ids.length && draft.schedules.every((item) => /^[1-7]$/.test(String(item.day)) && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)));
  const valid = draft.name.trim().length > 0 && draft.name.trim().length <= 100
    && (Boolean(group) || draft.participant_ids.length > 0) && validReminder;
  const toggle = (field: "participant_ids" | "viewer_user_ids" | "viewer_group_ids" | "notification_group_ids", id: string, checked: boolean) =>
    setDraft((value) => ({ ...value, [field]: checked ? [...value[field], id] : value[field].filter((item) => item !== id),
      ...(field === "participant_ids" && !checked && value.participant_ids.length === 1 ? { enabled: false } : {}) }));
  const save = async () => {
    if (readOnly || !valid) return;
    const key = weeklyReportGroupsKey(workspaceId);
    setBusy(true); setError("");
    await client.cancelQueries({ queryKey: key });
    const previous = client.getQueryData<WeeklyReportGroup[]>(key);
    if (group) client.setQueryData<WeeklyReportGroup[]>(key, (items) => items?.map((item) => item.id === group.id
      ? { ...item, ...draft, name: draft.name.trim() } : item));
    try {
      const saved = await saveWeeklyReportGroup(supabase!, workspaceId, draft);
      client.setQueryData<WeeklyReportGroup[]>(key, (items = []) => group
        ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]);
      // Audience changes also affect cached reports belonging to this group.
      client.removeQueries({ queryKey: ["weekly-reports", workspaceId], type: "inactive" });
      client.removeQueries({ queryKey: ["weekly-report", workspaceId], type: "inactive" });
      void client.invalidateQueries({ queryKey: ["weekly-reports", workspaceId] });
      void client.invalidateQueries({ queryKey: ["weekly-report", workspaceId] });
      onNotice(group ? "周报组配置已保存" : "周报组已创建");
      onSaved(saved);
    } catch (cause) {
      client.setQueryData(key, previous);
      setError(cause instanceof Error ? cause.message : "保存失败，请重试");
    } finally { setBusy(false); }
  };
  return <>
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content weekly-report-config-dialog weekly-report-group-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
          <header><Dialog.Title>{group ? "编辑周报组" : "新建周报组"}</Dialog.Title><Dialog.Close asChild><button type="button" className="dialog-close-button" aria-label="关闭" disabled={busy}><X /></button></Dialog.Close></header>
          <Dialog.Description className="weekly-report-config-description">按组收集周报，独立配置填写人员、可见范围和每周提醒。</Dialog.Description>
          <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <div className="weekly-report-config-body">
              {disabled && <p className="weekly-report-config-hint">当前配置只读，修改需要在线且拥有团队空间管理权限。</p>}
              <h3><label htmlFor="weekly-report-group-name">组名</label></h3>
              <input id="weekly-report-group-name" autoFocus maxLength={100} placeholder="例如：研发周报" disabled={readOnly} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              <h3>人员配置 <small>应填人员自动可查看组内已发布周报</small></h3>
              <input aria-label="搜索应填人员" placeholder="搜索成员" disabled={readOnly} value={search} onChange={(event) => setSearch(event.target.value)} />
              <div className="weekly-report-config-selection"><span>已选 {draft.participant_ids.length} 人</span>
                <button type="button" disabled={readOnly} onClick={() => setDraft({ ...draft, participant_ids: members.map((item) => item.user_id) })}>全选</button>
                <button type="button" disabled={readOnly} onClick={() => setDraft({ ...draft, participant_ids: [], enabled: false })}>清空</button></div>
              <div className="weekly-report-config-members">{members.filter((member) => memberDisplayName(member).toLowerCase().includes(search.toLowerCase())).map((member) => <label key={member.user_id}>
                <input type="checkbox" disabled={readOnly} checked={draft.participant_ids.includes(member.user_id)} onChange={(event) => toggle("participant_ids", member.user_id, event.target.checked)} />
                <MemberAvatar member={member} className="weekly-report-filter-avatar" /><span>{memberDisplayName(member)}</span></label>)}</div>
              {!draft.participant_ids.length && <p className="weekly-report-config-hint">{group ? "无人可填写周报，保存后将关闭提醒并保留历史周报。" : "请选择至少一名应填人员。"}</p>}
              <h3>可见范围</h3>
              <label className="weekly-report-config-toggle"><input type="radio" name="group-visibility" disabled={readOnly} checked={draft.visibility === "workspace"} onChange={() => setDraft({ ...draft, visibility: "workspace" })} />团队空间全员可见</label>
              <label className="weekly-report-config-toggle"><input type="radio" name="group-visibility" disabled={readOnly} checked={draft.visibility === "selected"} onChange={() => setDraft({ ...draft, visibility: "selected" })} />指定用户和用户组</label>
              {draft.visibility === "selected" && <div className="weekly-report-group-audience"><p className="weekly-report-config-hint">应填人员和团队空间管理员自动可见。以下人员和用户组可查看，无需填写。</p>
                <h4>用户</h4>{members.map((member) => <label className="weekly-report-config-toggle" key={member.user_id}><input type="checkbox" disabled={readOnly} checked={draft.viewer_user_ids.includes(member.user_id)} onChange={(event) => toggle("viewer_user_ids", member.user_id, event.target.checked)} /><MemberAvatar member={member} className="weekly-report-filter-avatar" />{memberDisplayName(member)}</label>)}
                <h4>用户组</h4>{userGroups.length ? userGroups.map((item) => <label className="weekly-report-config-toggle" key={item.id}><input type="checkbox" disabled={readOnly} checked={draft.viewer_group_ids.includes(item.id)} onChange={(event) => toggle("viewer_group_ids", item.id, event.target.checked)} />{item.name}</label>) : <p className="weekly-report-config-hint">暂无用户组</p>}
              </div>}
              <h3>提醒配置</h3>
              <label className="weekly-report-config-toggle"><input type="checkbox" disabled={readOnly || !draft.participant_ids.length} checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />开启每周提醒</label>
              <p className="weekly-report-config-hint">按北京时间重复，汇总本组当周周报。各通知群收到本组全员完成汇总后，本周停止提醒。</p>
              {draft.schedules.map((item, index) => <div className="weekly-report-config-time" key={index}>
                <select aria-label={`提醒星期${index + 1}`} disabled={readOnly} value={item.day} onChange={(event) => setDraft({ ...draft, schedules: draft.schedules.map((entry, i) => i === index ? { ...entry, day: Number(event.target.value) } : entry) })}>{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((day, i) => <option key={day} value={i + 1}>{day}</option>)}</select>
                <input type="time" aria-label={`提醒时间${index + 1}`} disabled={readOnly} value={item.time} onChange={(event) => setDraft({ ...draft, schedules: draft.schedules.map((entry, i) => i === index ? { ...entry, time: event.target.value } : entry) })} />
                <button type="button" aria-label={`删除提醒时间${index + 1}`} disabled={readOnly} onClick={() => setDraft({ ...draft, schedules: draft.schedules.filter((_, i) => i !== index) })}><Trash2 /></button></div>)}
              <button type="button" className="button secondary" disabled={readOnly || draft.schedules.length >= 50} onClick={() => setDraft({ ...draft, schedules: [...draft.schedules, { day: 5, time: "18:00" }] })}><Plus />添加时间</button>
              <h3>推送通知群 <small>所有提醒时间共用，可多选</small></h3>
              {notifications.isError ? <p role="alert">通知群加载失败<button type="button" className="button secondary" disabled={readOnly} onClick={() => void notifications.refetch()}>重新加载</button></p>
                : notifications.isLoading ? <p>正在加载通知群…</p> : (notifications.data ?? []).map((item) => <label className="weekly-report-config-toggle" key={item.id}><input type="checkbox" disabled={readOnly} checked={draft.notification_group_ids.includes(item.id)} onChange={(event) => toggle("notification_group_ids", item.id, event.target.checked)} />{item.name}</label>)}
              <button type="button" className="button secondary" disabled={readOnly} onClick={() => setNotificationOpen(true)}><Plus />创建通知群</button>
              {!validReminder && <p className="weekly-report-config-hint">开启提醒需要应填人员、有效时间和推送通知群。</p>}
              {error && <p role="alert">{error}</p>}
            </div>
            <footer className="dialog-actions"><Dialog.Close asChild><button type="button" className="button secondary" disabled={busy}>取消</button></Dialog.Close><button type="submit" className="button primary" disabled={readOnly || !valid}>{busy ? "保存中…" : "保存"}</button></footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <WeeklyReportNotificationGroupDialog open={notificationOpen} disabled={readOnly} onOpenChange={setNotificationOpen} onCreate={async (input) => {
      if (readOnly) throw new Error("当前无法修改提醒配置");
      const created = await createWeeklyReportNotificationGroup({ workspaceId, ...input });
      client.setQueryData<WeeklyReportNotificationGroup[]>(weeklyReportNotificationGroupsKey(workspaceId), (items = []) => [...items, created]);
      toggle("notification_group_ids", created.id, true);
    }} />
  </>;
}
