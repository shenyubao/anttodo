---
sidebar_position: 2
slug: /changelog
title: ChangeLog
description: AntTodo 的版本更新记录。
---

## 1.0.1.20260811

### ALL

- Feature: 支持创建自定义智能清单
- Feature: 支持控制智能清单的显隐、顺序
- Feature: 智能清单的用户筛选器，支持选择特定用户，支持多选
- Feature: 子任务支持配置优先级
- Feature: 登记时间时，单位支持番茄钟作为单位
- Enhance: 正计时中，如果切换任务，直接将上个任务保存实际耗时
- Enhance: 消息通知时增加 1min 的延迟逻辑，1min 内的多次操作会被合并起来通知
- Enhance: 增加了一批快捷键

### Mac

- Feature: Mac 丰富 DeepLink，便于 Raycast 等插件集成
- Feature: Mac 菜单栏入口新增番茄闹钟 Tab
- Feature: Mac 菜单栏在番茄闹钟、正计时时直接显示时间
- Bugfix: 修复 Mac 端红绿灯失效的问题
- Bugfix: 修复 Mac 端滑动失效的问题

### CLI

- Feature: CLI 支持番茄闹钟和正计时（仅记录，不计时）
