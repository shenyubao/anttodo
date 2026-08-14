---
sidebar_position: 2
slug: /changelog
title: ChangeLog
description: AntTodo 的版本更新记录。
---

## 1.0.3.20260814

### ALL

- Feature: 任务负责人选择支持搜索联系人
- Feature: 设置-外观支持展示联系人名称
- Feature: 番茄专注支持选择子任务，记录与工时累计到对应子任务
- Feature: 子任务时间框复用父任务日程（时间段与提醒，不含重复）；更多菜单可改优先级并登记工时
- Bugfix: 修复专注页计时模式切换与侧栏概览在黑色主题下的样式兼容问题
- Bugfix: 修复设置-团队管理列表在黑色主题下的样式兼容问题
- Bugfix: 修复任务时间线工具栏与日历网格在黑色主题下的样式兼容问题
- Bugfix: 修复任务详情子任务删除按钮在黑色主题下不可见的问题

### Mac

- Feature: Mac 由直接查询后端接口改为使用本地数据库 + 定时同步的机制，大幅提升流畅度

## 1.0.2.20260812

### ALL

- Bugfix: 修复收集箱时，指派人没有权限修改待办的缺陷

### Mac

- Bugfix: 修复 Mac 升级时可能无法原地下载的缺陷

### CLI

- Enhance: 增加部分本地缓存，提升 CLI 执行速度

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
