# 任务提醒发布配置

提醒规则随数据库迁移发布；Chrome Web Push 还需要在目标 Supabase 项目中配置
VAPID 和派发密钥。私钥及派发密钥不得提交到仓库。

## Edge Function Secrets

使用固定版本生成 VAPID 密钥：

```bash
pnpm dlx web-push@3.6.7 generate-vapid-keys
```

为 `reminder-subscription`、`reminder-dispatch` 和 `reminder-ack` 配置：

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY='<public key>' \
  VAPID_PRIVATE_KEY='<private key>' \
  VAPID_SUBJECT='mailto:notifications@example.com' \
  PUBLIC_APP_URL='https://app.example.com' \
  REMINDER_DISPATCH_SECRET='<random secret>' \
  REMINDER_ACK_SECRET='<different random secret>'
```

发布函数：

```bash
supabase functions deploy reminder-subscription
supabase functions deploy reminder-dispatch --no-verify-jwt
supabase functions deploy reminder-ack --no-verify-jwt
```

## Cron Vault Secrets

数据库中的每分钟 cron 任务读取以下 Vault 名称。`anttodo_reminder_dispatch_secret`
必须与 Edge Function 的 `REMINDER_DISPATCH_SECRET` 完全一致。

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co',
  'anttodo_project_url',
  'AntTodo reminder Edge Function base URL'
);
select vault.create_secret(
  '<same random dispatch secret>',
  'anttodo_reminder_dispatch_secret',
  'Authenticates reminder cron dispatch'
);
```

迁移在 Secrets 尚未配置时安全地跳过网络请求；完成配置后，下一个整分钟自动开始派发。

## macOS 发布

Electron 原生通知已接入，但仓库当前明确使用 `identity: null`。正式分发前仍需配置
Developer ID 签名及公证，随后在签名产物上完成系统通知权限和休眠恢复验收。
