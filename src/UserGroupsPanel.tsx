import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Plus, Users, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Workspace, WorkspaceBundle } from "./types";
import { useAsyncSubmission } from "./lib/useAsyncSubmission";
import { UserGroupSubmissionError, userGroupPermissionsKey, userGroupSubmissionKey,
  type UserGroupAdapter, type UserGroupPermissionCheck, type UserGroupSubmission } from "./lib/userGroupMutations";

export function UserGroupsPanel({ workspace, bundle, userId, online, adapter }: {
  workspace: Workspace;
  bundle: WorkspaceBundle;
  userId: string;
  online: boolean;
  adapter: UserGroupAdapter;
}) {
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const [draft, setDraft] = useState<UserGroupSubmission | null>(null);
  const [error, setError] = useState("");
  const permissionCheck = useQuery<UserGroupPermissionCheck>({
    queryKey: userGroupPermissionsKey(userId, workspace.id),
    enabled: false,
    initialData: { verified: true },
    meta: { persist: false },
  });
  const submissions = useAsyncSubmission({
    mutationKey: userGroupSubmissionKey(userId, workspace.id),
    online: online && canManage,
    submit: adapter.submit,
    onSuccess: (snapshot, input) => adapter.settle(input, snapshot),
    onError: (cause, input) => adapter.settle(input, cause instanceof UserGroupSubmissionError ? cause.snapshot : undefined),
  });
  const byGroup = new Map(submissions.states.map((state) => [state.input.entityId, state]));
  const groups = [...bundle.userGroups];
  for (const { input } of submissions.states) {
    if (!groups.some((group) => group.id === input.entityId)) groups.push({
      id: input.entityId, workspace_id: workspace.id, name: input.name, created_by: userId,
      created_at: "", updated_at: "",
    });
  }

  function openEditor(groupId?: string) {
    const submission = groupId ? byGroup.get(groupId)?.input : undefined;
    const group = bundle.userGroups.find((item) => item.id === groupId);
    setDraft(submission ? { ...submission, memberIds: [...submission.memberIds],
      expected: group ? { name: group.name, memberIds: bundle.userGroupMembers.filter((member) => member.group_id === group.id).map((member) => member.user_id) } : undefined } : {
      operationId: crypto.randomUUID(), userId, workspaceId: workspace.id,
      entityId: groupId ?? crypto.randomUUID(), kind: groupId ? "update" : "create",
      expected: group ? { name: group.name, memberIds: bundle.userGroupMembers.filter((member) => member.group_id === group.id).map((member) => member.user_id) } : undefined,
      name: group?.name ?? "",
      memberIds: bundle.userGroupMembers.filter((member) => member.group_id === groupId).map((member) => member.user_id),
    });
    setError("");
  }
  function submit(input: UserGroupSubmission) {
    if (!canManage) return;
    try {
      if (submissions.submit(input)) { setDraft(null); setError(""); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，请重试"); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const name = draft.name.trim();
    if (!name || name.length > 80) { setError("请输入 1 至 80 个字符的用户组名称。"); return; }
    if (bundle.userGroups.some((group) => group.id !== draft.entityId && group.name.trim().toLowerCase() === name.toLowerCase())
      || submissions.states.some(({ input }) => input.entityId !== draft.entityId && input.kind !== "delete" && input.name.toLowerCase() === name.toLowerCase())) {
      setError("用户组名称已存在。"); return;
    }
    const memberIds = [...new Set(draft.memberIds)];
    if (memberIds.some((id) => !bundle.members.some((member) => member.user_id === id))) {
      setError("部分成员已离开团队空间，请重新选择。"); return;
    }
    if (draft.expected && name === draft.expected.name && [...memberIds].sort().join(",") === [...draft.expected.memberIds].sort().join(",")) {
      setDraft(null); setError(""); return;
    }
    submit({ ...draft, name, memberIds });
  }

  return <div className="user-groups-panel">
    <header className="team-settings-header user-groups-header">
      <div><h2>用户组</h2><p>将团队成员整理到用户组中，便于识别和后续权限配置。</p></div>
      {canManage && <button className="button primary" type="button" disabled={!online} onClick={() => openEditor()}><Plus aria-hidden="true" />新建用户组</button>}
    </header>
    {!permissionCheck.data?.verified && <div className="user-group-permission-status" role="status">
      <span>{permissionCheck.data?.error ? "权限刷新失败，相关写入暂不可用。" : "正在核对用户组权限…"}</span>
      {permissionCheck.data?.error && <button type="button" disabled={!online} onClick={() => adapter.verify(workspace.id)}>重新核对</button>}
    </div>}
    {error && !draft && <p className="form-error" role="alert">{error}</p>}
    <div className="user-group-list">
      {!groups.length && <div className="user-group-empty">暂无用户组{canManage ? "，点击右上角创建" : ""}</div>}
      {groups.map((group) => {
        const state = byGroup.get(group.id);
        const pending = state?.status === "pending";
        const failed = state?.status === "error";
        const input = state?.input;
        const name = input && input.kind !== "delete" ? input.name : group.name;
        const memberIds = input && input.kind !== "delete" ? input.memberIds
          : bundle.userGroupMembers.filter((member) => member.group_id === group.id).map((member) => member.user_id);
        const members = bundle.members.filter((member) => memberIds.includes(member.user_id));
        const cause = state?.error;
        const outcome = cause instanceof UserGroupSubmissionError ? cause.outcome : "failed";
        return <div className={`user-group-row${pending ? " pending" : ""}${failed ? " failed" : ""}`} key={group.id} data-group-id={group.id} aria-busy={pending || undefined}>
          <div className="user-group-icon">{pending ? <LoaderCircle className="user-group-spinner" aria-hidden="true" /> : <Users aria-hidden="true" />}</div>
          <div className="user-group-copy">
            <strong>{name}</strong><span>{members.length} 位成员</span>
            <div className="user-group-member-preview">{members.slice(0, 5).map((member) => <span key={member.user_id}>{member.profile?.display_name ?? "团队成员"}</span>)}{members.length > 5 && <span>等 {members.length} 人</span>}</div>
            {pending && <span className="user-group-submission-status" role="status">{input?.kind === "delete" ? "删除中…" : "提交中…"}</span>}
            {failed && <p className="user-group-submission-error" role="alert">
              {outcome === "partial" ? "部分已保存，仍有未保存内容" : outcome === "unknown" ? "结果待确认，请联网后重试核对" : input?.kind === "delete" ? "删除失败" : "提交失败，草稿未保存"}
              {cause && `：${cause.message}`}
            </p>}
          </div>
          {canManage && <div className="user-group-actions">
            {failed && input ? <>
              <button type="button" disabled={!online} onClick={() => submit(input)}>重试</button>
              {input.kind !== "delete" && <button type="button" disabled={!online} onClick={() => openEditor(group.id)}>编辑</button>}
              <button type="button" onClick={() => { submissions.dismiss(input.operationId); setError(""); }}>放弃</button>
            </> : <>
              <button type="button" disabled={!online || pending} onClick={() => openEditor(group.id)}>编辑</button>
              <button className="danger" type="button" disabled={!online || pending} onClick={() => {
                if (window.confirm(`确定删除用户组“${group.name}”吗？`)) submit({
                  operationId: crypto.randomUUID(), userId, workspaceId: workspace.id, entityId: group.id,
                  kind: "delete", name: group.name, memberIds,
                });
              }}>删除</button>
            </>}
          </div>}
        </div>;
      })}
    </div>
    {!canManage && <p className="team-mgmt-settings-readonly-note">仅所有者和管理员可以管理用户组。</p>}
    <Dialog.Root open={Boolean(draft)} onOpenChange={(open) => { if (!open) { setDraft(null); setError(""); } }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay user-group-dialog-overlay" />
        <Dialog.Content className="dialog-content user-group-dialog">
          <Dialog.Title>{draft?.kind === "create" ? "新建用户组" : "编辑用户组"}</Dialog.Title>
          <Dialog.Description>设置用户组名称并选择要加入的团队成员。</Dialog.Description>
          <form onSubmit={save}>
            <label className="user-group-name-field"><span>名称</span><input autoFocus maxLength={80} value={draft?.name ?? ""} onChange={(event) => setDraft((current) => current && { ...current, name: event.target.value })} placeholder="例如：产品组" /></label>
            <fieldset className="user-group-member-picker"><legend>成员</legend><div>{bundle.members.map((member) => <label key={member.user_id}>
              <input type="checkbox" checked={draft?.memberIds.includes(member.user_id) ?? false} onChange={() => setDraft((current) => current && { ...current,
                memberIds: current.memberIds.includes(member.user_id) ? current.memberIds.filter((id) => id !== member.user_id) : [...current.memberIds, member.user_id],
              })} />
              <span className="member-avatar">{(member.profile?.display_name ?? "成员").slice(0, 1)}</span>
              <strong>{member.profile?.display_name ?? "团队成员"}</strong><small>{member.role === "owner" ? "所有者" : member.role === "admin" ? "管理员" : "成员"}</small>
            </label>)}</div></fieldset>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="user-group-dialog-actions"><button className="button" type="button" onClick={() => { setDraft(null); setError(""); }}>取消</button><button className="button primary" disabled={!online || !canManage || !draft?.name.trim()}>保存</button></div>
          </form>
          <Dialog.Close className="dialog-close" aria-label="关闭"><X /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
