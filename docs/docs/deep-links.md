---
sidebar_position: 3
slug: /deep-links
title: macOS DeepLink
description: AntTodo macOS 客户端支持的 DeepLink 列表和调用方式。
---

# macOS DeepLink

AntTodo macOS 客户端使用 `anttodo://` 协议。安装客户端后，可以从 Raycast、自动化脚本、终端或其他支持 URL Scheme 的应用唤起 AntTodo，并打开指定页面或控制专注计时。

## 基本规则

- `workspace` 表示团队空间 ID，可省略。
- 省略 `workspace` 时，客户端按当前团队空间、上次使用的团队空间、首个可访问团队空间的顺序选择目标。
- URL 参数中的团队空间 ID、任务 ID 和自定义智能清单 ID 必须进行 URL 编码。
- 用户未登录时，DeepLink 会提示先登录并丢弃本次操作，不会在登录后自动执行。
- 目标团队空间或任务没有访问权限时，操作不会执行。
- 计时控制链接执行后会唤起主窗口并打开“番茄专注”页。

## 打开页面

### 智能清单

```text
anttodo://open/view?workspace=<workspace-id>&view=<view>
```

系统智能清单支持以下值：

| `view` | 页面 |
| --- | --- |
| `all` | 所有任务 |
| `today` | 今天 |
| `week` | 本周 |
| `assigned` | 指派给我 |
| `watching` | 我关注的 |
| `inbox` | 收集箱 |
| `trash` | 回收站 |

自定义智能清单使用 `custom:<view-id>`，例如：

```text
anttodo://open/view?workspace=workspace-1&view=custom%3A00000000-0000-4000-8000-000000000001
```

### 任务详情

```text
anttodo://open/task?workspace=<workspace-id>&task=<task-id>
```

任务详情会根据任务类型打开任务或笔记详情。任务不在当前任务列表缓存中时，客户端会按 ID 重新加载。

### 日历

```text
anttodo://open/calendar?workspace=<workspace-id>
```

### 番茄专注页

```text
anttodo://open/focus?workspace=<workspace-id>
```

## 控制番茄计时和正计时

### 启动或继续

```text
anttodo://focus/pomodoro/start?workspace=<workspace-id>&task=<task-id>
anttodo://focus/stopwatch/start?workspace=<workspace-id>&task=<task-id>
```

`task` 是可选参数。没有传入时，会保留当前关联任务；对已暂停的目标计时执行 `start` 会继续计时。

番茄计时和正计时不能互相覆盖。如果另一种计时正在运行，启动操作会提示用户并保持原状态不变。

### 暂停

```text
anttodo://focus/pomodoro/pause?workspace=<workspace-id>
anttodo://focus/stopwatch/pause?workspace=<workspace-id>
```

暂停链接只作用于 URL 中指定的计时模式。目标计时未运行、已经暂停或模式不匹配时，会提示用户且不修改状态。

### 停止

```text
anttodo://focus/pomodoro/stop?workspace=<workspace-id>
anttodo://focus/stopwatch/stop?workspace=<workspace-id>
```

停止会关闭目标计时，并按客户端现有规则保存专注记录。正在休息中的番茄计时也可以使用 `pomodoro/stop` 停止。

### 切换关联任务

```text
anttodo://focus/switch?workspace=<workspace-id>&task=<task-id>
```

`task` 是必填参数，且任务必须属于目标团队空间。关联任务必须是未删除的待办任务，不能是笔记。

正计时运行中切换任务时，客户端会先保存上一个任务的实际耗时，再从新任务开始新的正计时分段；番茄计时则直接更新关联任务。

## macOS 调用示例

在终端中使用 `open`：

```bash
open 'anttodo://open/view?view=today'
open 'anttodo://open/task?workspace=workspace-1&task=task-1'
open 'anttodo://focus/pomodoro/start?workspace=workspace-1&task=task-1'
open 'anttodo://focus/switch?workspace=workspace-1&task=task-2'
```

如果 AntTodo 尚未启动，macOS 会先启动客户端，再执行 DeepLink；如果客户端已经在运行，则会唤起已有实例，不会创建重复窗口。
