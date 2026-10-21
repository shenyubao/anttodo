import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Trash2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { MemberAvatar } from "./MemberAvatar";
import { WeeklyReportNotificationGroupDialog } from "./WeeklyReportNotificationGroupDialog";
import {
  saveWeeklyReportParticipants, saveWeeklyReportReminders,
  useWeeklyReportConfiguration, weeklyReportConfigurationKey,
} from "./lib/weeklyReportConfigurationApi";
import {
  createWeeklyReportNotificationGroup, loadWeeklyReportNotificationGroups,
  weeklyReportNotificationGroupsKey,
} from "./lib/weeklyReportNotificationsApi";
import { supabase } from "./lib/supabase";
import { memberDisplayName } from "./lib/taskTitleTokens";
import type { Member, NoticeHandler, WeeklyReportConfiguration, WeeklyReportNotificationGroup } from "./types";

export function WeeklyReportConfigurationControls({ workspaceId, currentUserId, members, online, demoMode, onNotice }: {
  workspaceId: string; currentUserId: string; members: Member[];
  online: boolean; demoMode: boolean; onNotice: NoticeHandler;
}) {
  const queryClient = useQueryClient();
  const query = useWeeklyReportConfiguration(workspaceId, demoMode);
  const groupsQuery = useQuery({
    queryKey: weeklyReportNotificationGroupsKey(workspaceId),
    queryFn: () => loadWeeklyReportNotificationGroups(supabase!, workspaceId),
    enabled: Boolean(supabase) && !demoMode,
  });
  const [panel, setPanel] = useState<"people" | "reminders" | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<WeeklyReportConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    if (panel && !draft && query.data) setDraft(query.data);
  }, [panel, draft, query.data]);
  const role = members.find((member) => member.user_id === currentUserId)?.role;
  const canManage = role === "owner" || role === "admin";
  const readOnly = !canManage || !online || demoMode || !supabase || !query.data || query.isError || busy;
  const groups = groupsQuery.data ?? [];
  const open = (next: "people" | "reminders") => {
    setDraft(query.data ?? (demoMode ? {
      participant_ids: members.map((member) => member.user_id), enabled: false,
      schedules: [], notification_group_ids: [],
    } : null));
    setSearch(""); setError(""); setPanel(next);
  };
  const save = async () => {
    if (readOnly || !draft) return;
    const key = weeklyReportConfigurationKey(workspaceId);
    const previous = queryClient.getQueryData<WeeklyReportConfiguration>(key);
    setBusy(true); setError("");
    await queryClient.cancelQueries({ queryKey: key });
    const optimistic = panel === "people"
      ? { ...previous!, participant_ids: draft.participant_ids, enabled: draft.participant_ids.length > 0 && previous!.enabled }
      : { ...previous!, enabled: draft.enabled, schedules: draft.schedules, notification_group_ids: draft.notification_group_ids };
    queryClient.setQueryData(key, optimistic);
    try {
      const saved = panel === "people"
        ? await saveWeeklyReportParticipants(supabase!, workspaceId, draft.participant_ids)
        : await saveWeeklyReportReminders(supabase!, workspaceId, draft);
      queryClient.setQueryData(key, saved);
      setPanel(null);
      onNotice(panel === "people" ? "人员配置已保存" : "提醒配置已保存");
    } catch (cause) {
      queryClient.setQueryData(key, previous);
      setError(cause instanceof Error ? cause.message : "保存失败，请重试");
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
  const validReminder = !draft?.enabled || Boolean(draft.schedules.length && draft.participant_ids.length
    && draft.notification_group_ids.length && draft.schedules.every((item) => /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)));
  const togglePerson = (id: string, checked: boolean) => setDraft((value) => value && ({
    ...value, participant_ids: checked ? [...value.participant_ids, id] : value.participant_ids.filter((item) => item !== id),
  }));
  return <>
    <div className="weekly-report-config-controls"><button type="button" className="weekly-report-config-button" onClick={() => open("people")}><Users />人员配置</button>
    <button type="button" className="weekly-report-config-button" onClick={() => open("reminders")}><Bell />提醒配置</button></div>
    <Dialog.Root open={panel !== null} onOpenChange={(value) => { if (!value && !busy) setPanel(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content weekly-report-config-dialog">
          <header><Dialog.Title>{panel === "people" ? "人员配置" : "提醒配置"}</Dialog.Title>
            <Dialog.Close asChild><button type="button" className="dialog-close-button" aria-label="关闭" disabled={busy}><X /></button></Dialog.Close>
          </header>
          <Dialog.Description className="weekly-report-config-description">
            {panel === "people" ? "配置需要填写周报的人员，名单外成员仅可查看周报。" : "按北京时间每周重复，汇总当周周报。各群收到全员完成汇总后，当周停止提醒。"}
          </Dialog.Description>
          <div className="weekly-report-config-body">
            {!canManage && <p className="weekly-report-config-hint">仅所有者和管理员可以修改配置</p>}
            {!online && <p className="weekly-report-config-hint">离线时仅可查看已缓存的配置</p>}
            {!draft ? <div role="status"><p>{query.isError ? "配置加载失败，请重试" : "正在加载配置…"}</p>{query.isError && online && <button type="button" className="button secondary" onClick={() => void query.refetch()}>重新加载</button>}</div> : panel === "people" ? <>
              <input aria-label="搜索成员" placeholder="搜索成员" value={search} onChange={(event) => setSearch(event.target.value)} />
              <div className="weekly-report-config-selection"><span>已选 {draft.participant_ids.length} 人</span>
                <button type="button" disabled={readOnly} onClick={() => setDraft({ ...draft, participant_ids: members.map((member) => member.user_id) })}>全选</button>
                <button type="button" disabled={readOnly} onClick={() => setDraft({ ...draft, participant_ids: [] })}>清空</button>
              </div>
              <div className="weekly-report-config-members">{members.filter((member) => memberDisplayName(member).toLowerCase().includes(search.toLowerCase())).map((member) =>
                <label key={member.user_id}><input type="checkbox" disabled={readOnly} checked={draft.participant_ids.includes(member.user_id)} onChange={(event) => togglePerson(member.user_id, event.target.checked)} />
                  <MemberAvatar member={member} className="weekly-report-filter-avatar" /><span>{memberDisplayName(member)}</span>
                </label>)}</div>
              {draft.participant_ids.length === 0 && <p className="weekly-report-config-hint">无人可填写周报，保存后将同时关闭提醒。</p>}
            </> : <>
              <label className="weekly-report-config-toggle"><input type="checkbox" disabled={readOnly} checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />开启每周提醒</label>
              <h3>提醒时间 <small>北京时间</small></h3>
              {draft.schedules.map((item, index) => <div className="weekly-report-config-time" key={index}>
                <select aria-label={`提醒星期${index + 1}`} disabled={readOnly} value={item.day} onChange={(event) => setDraft({ ...draft, schedules: draft.schedules.map((entry, i) => i === index ? { ...entry, day: Number(event.target.value) } : entry) })}>
                  {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((day, i) => <option key={day} value={i + 1}>{day}</option>)}
                </select>
                <input type="time" aria-label={`提醒时间${index + 1}`} disabled={readOnly} value={item.time} onChange={(event) => setDraft({ ...draft, schedules: draft.schedules.map((entry, i) => i === index ? { ...entry, time: event.target.value } : entry) })} />
                <button type="button" aria-label={`删除提醒时间${index + 1}`} disabled={readOnly} onClick={() => setDraft({ ...draft, schedules: draft.schedules.filter((_, i) => i !== index) })}><Trash2 /></button>
              </div>)}
              <button type="button" className="button secondary" disabled={readOnly || draft.schedules.length >= 50} onClick={() => setDraft({ ...draft, schedules: [...draft.schedules, { day: 5, time: "18:00" }] })}><Plus />添加时间</button>
              <h3>推送群 <small>所有提醒时间共用，可多选</small></h3>
              {groupsQuery.isError ? <p role="alert">通知群加载失败，请重试</p> : groupsQuery.isLoading ? <p>正在加载通知群…</p> : groups.length === 0 ? <p className="weekly-report-config-hint">暂无通知群，请先创建</p> : groups.map((group) =>
                <label className="weekly-report-config-toggle" key={group.id}><input type="checkbox" disabled={readOnly} checked={draft.notification_group_ids.includes(group.id)} onChange={(event) => setDraft({ ...draft, notification_group_ids: event.target.checked ? [...draft.notification_group_ids, group.id] : draft.notification_group_ids.filter((id) => id !== group.id) })} />{group.name}</label>)}
              <button type="button" className="button secondary" disabled={readOnly} onClick={() => setCreateOpen(true)}><Plus />创建通知群</button>
              {!validReminder && <p className="weekly-report-config-hint">开启提醒需要应填人员、有效时间和推送群。</p>}
            </>}
            {error && <p role="alert">{error}</p>}
          </div>
          <footer className="dialog-actions"><Dialog.Close asChild><button type="button" className="button secondary" disabled={busy}>取消</button></Dialog.Close>
            <button type="button" className="button primary" disabled={readOnly || !draft || (panel === "reminders" && (!validReminder || draft.schedules.some((item) => !item.time)))} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <WeeklyReportNotificationGroupDialog disabled={readOnly} open={createOpen} onOpenChange={setCreateOpen} onCreate={async (input) => {
      if (readOnly) throw new Error("当前无法修改提醒配置");
      const group = await createWeeklyReportNotificationGroup({ workspaceId, ...input });
      queryClient.setQueryData<WeeklyReportNotificationGroup[]>(weeklyReportNotificationGroupsKey(workspaceId), (current = []) => [...current.filter((item) => item.id !== group.id), group]);
      setDraft((value) => value && ({ ...value, notification_group_ids: [...value.notification_group_ids, group.id] }));
    }} />
  </>;
}
