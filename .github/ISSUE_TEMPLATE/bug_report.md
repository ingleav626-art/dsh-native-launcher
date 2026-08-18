---
name: Bug 报告
about: 报告插件问题（启动失败 / 托盘异常 / 通知异常 / 关窗退出异常等）
title: '[Bug] '
labels: bug
assignees: ''
---

提交前请先阅读 [README 常见问题](https://github.com/ingleav626-art/dsh-native-launcher#常见问题)——大部分常见问题（如快捷方式打不开、通知收不到）已有解答。若确认未覆盖，请填写以下内容。

## 问题描述

发生了什么？你期望发生什么？

## 启动方式

- [ ] 桌面快捷方式（双击 DSH WebUI）
- [ ] 命令行：npx @deepseek-ai/dsh web
- [ ] 命令行：dsh --profile web（全局安装）
- [ ] 其他

## 版本信息

- 插件版本（运行 `npm view dsh-native-launcher version`）：
- dsh 版本：

## 日志文件（强烈建议提供）

打开 `%USERPROFILE%\.dsh-webui-launcher\` 目录，把以下文件**拖进本框**（或粘贴内容）：
- `native-launcher.log`（插件主日志，含环境诊断）
- `launch.log`（快捷方式启动分支记录）
- `tray-exit.log`（托盘退出/互斥记录）
- `tray-notify.log`（通知通道记录，可选）

## 截图

（报错弹窗 / 命令行窗口 / 页面现象，可选）

## 复现步骤（可选）

如果方便复现，请简单描述操作步骤（每次必现或偶尔出现都行）：

1.
2.
3.

## 期望行为

你希望得到的结果是？
