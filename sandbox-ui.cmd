@echo off
rem 沙箱 UI：启动隔离版 dsh（alpha.2），数据/会话/托盘产物全部在沙箱目录，不碰 E:\dsh。
rem 关闭浏览器标签后 close-to-exit 会在防抖后自动退出 dsh；托盘图标需右键退出（或重启自然消失）。
rem 永久沙箱（转正后）：D:\web\demo\test\dsh-sandbox；勿再放临时目录（缓存会清，且 robocopy
rem 会跟着 profile 里的 link 依赖把真实插件目录搬空——务必 /XJ 或纯复制）。
set "SBX=D:\web\demo\test\dsh-sandbox"
set "DSH_HOME=%SBX%\home"
set "USERPROFILE=%SBX%\user"
"%SBX%\node_modules\.bin\dsh.cmd" --profile web %*
