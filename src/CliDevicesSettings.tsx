import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Terminal, X } from "lucide-react";
import { useState } from "react";
import { listCliDevices, revokeCliDevice, type CliAuthorizedDevice } from "./lib/cliDeviceAuth";
import { supabase } from "./lib/supabase";

function formatTime(value: string | null) {
  if (!value) return "从未";
  return new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

export function CliDevicesSettings({ userId, online }: { userId: string; online: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = ["cli-authorized-devices", userId] as const;
  const [selected, setSelected] = useState<CliAuthorizedDevice | null>(null);
  const devices = useQuery({
    queryKey,
    queryFn: () => {
      if (!supabase) throw new Error("Supabase 尚未配置");
      return listCliDevices(supabase);
    },
    enabled: Boolean(supabase),
    networkMode: "offlineFirst",
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error("Supabase 尚未配置");
      return revokeCliDevice(supabase, id);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CliAuthorizedDevice[]>(queryKey);
      queryClient.setQueryData<CliAuthorizedDevice[]>(queryKey, (current = []) => current.filter((item) => item.id !== id));
      return { previous };
    },
    onError: (_error, _id, context) => queryClient.setQueryData(queryKey, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  return <section className="cli-devices-settings" aria-labelledby="cli-devices-title">
    <header><div><h3 id="cli-devices-title">CLI 授权设备</h3><p>每台设备使用独立凭据；撤销后将无法再次换取短期 JWT。</p></div><Terminal aria-hidden="true" /></header>
    {!online ? <p className="cli-devices-offline">当前离线，显示上次缓存的设备列表，撤销暂不可用。</p> : null}
    {devices.isLoading && !devices.data ? <p className="cli-devices-empty">正在加载设备…</p>
      : devices.isError && !devices.data ? <p className="cli-devices-empty">暂时无法加载设备列表。</p>
      : !devices.data?.length ? <p className="cli-devices-empty">尚未授权 CLI 设备。</p>
      : <div className="cli-device-list">{devices.data.map((device) => <article key={device.id} className="cli-device-card">
        <Monitor aria-hidden="true" />
        <div><strong>{device.client.hostname || device.client.name || "CLI 设备"}</strong>
          <span>CLI {device.client.version || "未知版本"}</span>
          <small>创建于 {formatTime(device.createdAt)} · 最近使用 {formatTime(device.lastUsedAt)} · {device.expiresAt ? `到期 ${formatTime(device.expiresAt)}` : "无固定到期日"}</small>
        </div>
        <button type="button" disabled={!online || revoke.isPending} onClick={() => setSelected(device)}>撤销</button>
      </article>)}</div>}
    <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => { if (!open && !revoke.isPending) setSelected(null); }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay account-action-overlay" /><Dialog.Content className="dialog-content account-action-dialog">
        <Dialog.Title>撤销 CLI 设备</Dialog.Title>
        <Dialog.Description className="account-action-description">撤销“{selected?.client.hostname || selected?.client.name || "CLI 设备"}”后，该设备不能再次换票；已签发 JWT 最多仍可使用 15 分钟。</Dialog.Description>
        {revoke.isError ? <p className="account-action-error">撤销失败，设备列表已恢复，请稍后重试。</p> : null}
        <div className="account-action-buttons"><button className="button secondary" disabled={revoke.isPending} onClick={() => setSelected(null)}>取消</button><button className="button danger" disabled={!online || revoke.isPending} onClick={() => selected && revoke.mutate(selected.id, { onSuccess: () => setSelected(null) })}>{revoke.isPending ? "正在撤销…" : "确认撤销"}</button></div>
        <Dialog.Close className="settings-dialog-close" aria-label="关闭"><X /></Dialog.Close>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>;
}
