---
sidebar_position: 2
slug: /changelog
title: ChangeLog
description: AntTodo 的版本更新记录。
---

## 1.0.8.20260826

### ALL

- Feature: [日历] 增加筛选器：我关注的、指派我的、自定义筛选器
- Feature: [设置] 增加功能开关，可自由开关各模块
- Bugfix: [待办] 修复含云效等外部任务的列表中新增任务失败

### 外部集成

- Feature: [整体] 新增内嵌模式布局，便于钉钉工作台访问
- Feature: [快速创建] 钉钉群中可拉机器人，并@机器人直接创建任务
- Feature: [快速创建] 接入云效创建，粘贴云效链接即可生成外部待办
- Enhance: [钉钉] 优化系统通知的 URL，可跳转到任务详情

### CLI

- Feature: [登录] CLI 改用 Auth 登录，可以有更长的登录有效期及权限控制

## 1.0.7.20260824

### ALL

- Feature: [日历] 新增创建任务入口
- Feature: [组织管理] 新增快捷切换面板及快捷键（Command+Alt+K）
- Enhance: [待办] 分组菜单旁新增「新增」按钮，并调整其他按钮位置
- Enhance: [待办] 编辑标题时回车直接进入待办
- Enhance: [待办] 「未分组」组也支持移动分组
- Enhance: [连接器] 展示云效连接器关闭任务时的错误信息
- Bugfix: [待办] 修复编辑待办描述时浏览器焦点丢失问题

## 1.0.6.20260820

### ALL

- Feature: 上线批量操作模式，可多选任务，批量完成 / 删除 / 迁移等
- Feature: 上线快速创建：钉钉群机器人快速创建
- Feature: [beta] 上线云效连接器，可将云效工作项同步到蚂蚁清单，并联动修改云效工作项状态
- Feature: 钉钉群工具支持蚂蚁清单
- Enhance: 优化日历展示的任务数量，可根据布局动态调整
- Bugfix: 修复日历最后一天格子不占用的问题
- Bugfix: 移除智能清单中的添加分组功能，避免歧义

## 1.0.5.20260818

### ALL

- Enhance: Web、Mac 与 iOS 统一为服务端直连与本地乐观更新模式
- Enhance: 离线时可阅读最近缓存，写操作统一为只读禁用

### Mac

- Enhance: 停用本地 SQLite、出站队列和定时同步，保留旧数据文件但不再访问

## 1.0.4.20260814

### ALL

- Feature: 子任务支持配置时间段
- Feature: 子任务支持登记工时
- Feature: 子任务支持番茄计时
- Feature: 子任务支持增加子任务，最多五级
- Feature: 拓展子任务详情区域，详情部分可展示时间段及工时信息
- Feature: 联系人选择面板支持搜索，已选中人员默认提前
- Feature: 支持展示联系人名称（默认不开启，需手动在设置中开启）
- Feature: 智能日期识别支持时间段
- Feature: 日期选择控件升级，避免失效 bug
- Enhance: 优化部分暗夜主题的兼容
- Enhance: 优化日历视图
- Enhance: 面板打开时点击任意位置即可关闭

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
