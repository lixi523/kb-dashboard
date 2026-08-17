# 知识库看板项目 Handoff

> 生成时间：2026-07-31（北京时间）
> 最近更新：2026-08-17（排除列表 readSync 修复、放弃 index.html、侧边栏快捷方式）
> 用途：新窗口继续任务前的完整交接文档

---

## 1. 项目目标

在 Obsidian 知识库（Vault）内提供「知识库看板」：

1. 一个 **Obsidian 插件**（`kb-dashboard`），定时/手动扫描 Vault 内容（Inbox/Notes/Ideas/wiki/Projects/Logs/Template 七个核心目录），统计笔记数、双链、标签、结构问题等，生成 JSON 数据文件。
2. 插件注册自定义视图 `kb-dashboard-view`（ECharts 图表 + KPI 卡片），通过侧边栏快捷方式或命令「打开知识库看板」在 Obsidian 标签页内直接观看看板。
3. 可选配套：独立 `index.html` 静态页（浏览器查看，需手动同步数据，插件不再管理）。

## 2. 当前进度

| 项 | 状态 |
| --- | --- |
| 插件扫描/统计/生成 JSON | ✅ 完成 |
| 插件自定义视图（ItemView） | ✅ 完成 |
| 看板数据文件放插件目录 | ✅ 完成（用户已重载扫描成功，2026-08-17 14:42） |
| 侧边栏快捷方式打开内置看板视图 | ✅ 完成（2026-08-17） |
| 排除列表真正生效（readSync→read 修复） | ✅ 完成（2026-08-17，沙箱无 readSync 环境验证） |
| 被排除根目录不再报异常 | ✅ 完成（2026-08-17） |
| index.html 插件管理 | ❌ 已放弃（Obsidian 1.2.8+ 无法 iframe 渲染本地 HTML） |
| index.html 一屏排版压缩 | ✅ 完成（历史成果，独立静态页仍可用） |
| release 发布包与最新 main.js 同步 | ✅ 完成（2026-08-17，diff 为空） |

## 3. 已完成修改

### 3.1 数据文件路径
- `DATA_FILENAME` 常量从 `"kb-dashboard-data.json"`（vault 根目录相对路径）改为 `".obsidian/plugins/kb-dashboard/kb-dashboard-data.json"`（插件目录绝对路径）。
- 同步更新了 `main.ts` 与编译产物 `main.js` 两处常量，保持完全一致。
- 插件 `data.json` 的 `dataFileName` 字段改为 `.obsidian/plugins/kb-dashboard/kb-dashboard-data.json`。
- `onload()` 启动时强制 `this.settings.dataFileName = DATA_FILENAME` 并保存，防止 Obsidian 保存设置时重置该字段。

### 3.2 数据读写绕过 Vault 索引
- 根因：Obsidian `vault.getAbstractFileByPath()` / `vault.read()` / `vault.modify()` 不索引 `.obsidian/` 隐藏目录，文件放插件目录时这些 API 找不到文件。
- 修复：读改用 `this.app.vault.adapter.read(path)`，写改用 `this.app.vault.adapter.write(path, jsonStr)`。
- 已核对 `main.ts` 与 `main.js` 均使用 adapter API，无残留 `getAbstractFileByPath`/`modify`/`create`。

### 3.3 index.html 排版压缩（一屏展示）
- html 字号 12px→11px，body line-height 1.35→1.3。
- dashboard 外间距 `8px 16px`→`4px 8px`；header 内边距/下边距 `8px 4px`→`2px 4px`；icon 22→18px；标题 14→12px。
- KPI 卡片 padding `8px 12px`→`4px 8px`；数值 20→17px；标签/子标签字号降 1px。
- 图表容器高度 150→110px；ECharts grid 边距、tooltip/axis 字号、barWidth 全面缩减。
- 所有 grid gap `8px`→`4px`；section margin-bottom `12px`→`4px`；内联 `margin-bottom:8px`→`2px`。
- 滚动列表 max-height 150→110px；底部 summary/footer/wiki-tag/empty 全部收紧。

### 3.4 加载 Obsidian 排除列表并过滤扫描结果
- 读取 `.obsidian/app.json` 的 `userIgnoreFilters` 字段。
- 解析三种规则类型：
  - 目录前缀（以 `/` 结尾但不是 `/^`）：`Logs/`, `Template/`, `.trash`, `.uploads` 等
  - 正则表达式（`/^...*/` 格式，以 `*/` 结尾）：`/^索引.*/` 匹配文件名以「索引」开头的文件
  - 文件名包含（普通字符串）：`.claudian`, `.workbuddy`, `.agents`, `.qoderian` 等
- 在 `collectData()` 中的多个循环（目录统计、Wiki 文件、文件内容、recent_logs/briefs/reviews、ideas_summary）都调用 `isFileExcluded()` 过滤。
- 已同步更新 `main.ts`（源码）与 `main.js`（编译产物）。
- 2026-08-17 补充：排除过滤同样应用到 `recent_logs`/`recent_briefs`/`recent_reviews`/`ideas_summary` 四个列表的筛选。
- **重要修复（2026-08-17）**：`parseIgnoreFilters()` 原来用 `vault.adapter.readSync()` 读 `.obsidian/app.json`，但 Obsidian 的 DataAdapter **没有 readSync**（全异步 API）→ 每次扫描都抛 `TypeError: vault.adapter.readSync is not a function`，排除列表永远为空，`.workbuddy` 等仍被报为异常目录。已改为 `await vault.adapter.read()`（parseIgnoreFilters 变 async，collectData 里 `await parseIgnoreFilters(vault)`）。模拟测试必须用无 readSync 的 mock 才能暴露此问题。

### 3.5 侧边栏快捷方式：直接打开内置看板视图；放弃 index.html 管理（2026-08-17 最终形态）
- **最终方案**：`onload()` 新增 `addRibbonIcon("presentation", ...)`，回调直接 `this.activateView()`——点击图标即在 Obsidian 标签页内打开内置 `KBDashboardView`（数据为空时视图会自动触发扫描）。
- **放弃 index.html（重要）**：此前尝试「index.html 移入插件目录 + 每次扫描更新 + 浏览器打开」的整条路线已废弃。原因：Obsidian 1.2.8 起移除了 `app://local`、并禁止 iframe 加载本地 HTML，插件无法在 Obsidian 内直接渲染 index.html；且用户要求改为在 Obsidian 内打开。
- 已删除的代码：`INDEX_FILENAME` 常量、`FALLBACK_INDEX_HTML`、`updateIndexHtml()`、`scanAndOpenIndex()`、`openIndexPage()`（Electron `shell.openPath`）、`kb-dashboard-open-index` 命令、release 包内 `index.html`。
- 工作区根目录的 `index.html` / `index-b.html` / `index-trae.html` 与 `update_kb_data.py` 保留为可选的独立静态页工具，插件不再读写它们。
- 已同步 main.ts / main.js / release/kb-dashboard/main.js 三处。

## 4. 关键文件

| 文件 | 作用 |
| --- | --- |
| `d:\Documents\Obsidian Vault\.obsidian\plugins\kb-dashboard\main.ts` | 插件源码（TypeScript） |
| `d:\Documents\Obsidian Vault\.obsidian\plugins\kb-dashboard\main.js` | 插件编译产物（Obsidian 实际加载此文件，28.0KB） |
| `d:\Documents\Obsidian Vault\.obsidian\plugins\kb-dashboard\manifest.json` | 插件清单（id: kb-dashboard, name: 知识库看板） |
| `d:\Documents\Obsidian Vault\.obsidian\plugins\kb-dashboard\data.json` | 插件设置（autoScan / scanIntervalHours / dataFileName） |
| `d:\Documents\Obsidian Vault\.obsidian\plugins\kb-dashboard\kb-dashboard-data.json` | 扫描生成的数据文件（当前已移入插件目录） |
| `d:\Documents\Obsidian Vault\index.html` | 看板页面（数据已内嵌，浏览器可直接打开） |
| `d:\Documents\Obsidian Vault\.design\kb-dashboard\scan_vault.py` | 独立备用 Python 扫描脚本 |
| `d:\Documents\Obsidian Vault\.design\kb-dashboard\inline_data.py` | 内嵌数据脚本（可复用，工作区另有 `update_kb_data.py`） |
| `d:\Documents\Obsidian Vault\handoff.md` | 本文档 |

> 注意：`scan_vault.py` 曾把数据输出到 vault 根目录 `kb-dashboard-data.json`，如果后续仍使用 Python 脚本，其输出路径需同步改为插件目录。

## 5. 不能动的边界

- **`Projects/` 与 `Template/` 目录只读**（AGENTS.md 权限分级），禁止修改、新建、删除。
- **Vault 根目录仅允许 7 个核心目录**（Inbox/Notes/Ideas/wiki/Projects/Logs/Template）+ `.obsidian` `.trash` `.uploads` + AGENTS.md、index.html 等白名单文件；扫描器会把未知根目录项报为「根目录异常目录」。命中 `userIgnoreFilters` 排除列表的根目录（如 `.agents` `.qoderian` `.workbuddy`）不会被报异常。
- **`main.ts` 与 `main.js` 必须保持一致**：直接改 `main.js`（编译产物）是当前唯一生效途径，但后续任何逻辑改动都要同步两个文件，否则会出现「源码新、产物旧」的隐性 bug。
- **frontmatter 规范**：title/date/tags 属性禁止双链 `[[xxx]]`；`---` 结束符必须独立成行。
- **数据文件名路径**：必须保持 `.obsidian/plugins/kb-dashboard/kb-dashboard-data.json`，不要改回根目录相对路径（Obsidian 的 vault API 读不到 `.obsidian/` 下文件）。
- **不再管理 index.html**：插件只读写 `kb-dashboard-data.json`；侧边栏打开的是内置看板视图。根目录 `index.html` 等只是可选的独立静态页，改后需手动跑 `update_kb_data.py` 同步数据。
- **排除列表**：扫描器会自动读取 `.obsidian/app.json` 的 `userIgnoreFilters`，无需手动配置插件设置。

## 6. 已经否掉的方案

| 方案 | 否定原因 |
| --- | --- |
| 用 Obsidian 空格预览打开 index.html | Obsidian 预览模式不执行内联 `<script>`，页面会空白；用户改用浏览器打开或插件视图 |
| 数据文件放 vault 根目录 | 用户明确要求放插件目录，且根目录有白名单管控 |
| 用 `vault.getAbstractFileByPath` 读写插件目录文件 | Obsidian 不索引 `.obsidian/` 目录，API 永远找不到文件 → 改为 `vault.adapter` 直接读写 |
| 用相对路径 `kb-dashboard-data.json` 作为 `DATA_FILENAME` 常量 | 与 main.js 不一致导致扫描仍写根目录 → 统一为插件目录绝对路径 |
| 仅靠设置面板手动改 `dataFileName` | Obsidian 保存插件设置时会重置 data.json 字段 → 增加 onload 强制锁定 |

## 7. 当前风险点

1. **已验证**：数据文件在插件目录 + adapter API 改动，用户已重载并扫描成功（2026-08-17 14:42，39321 bytes）。待用户用 v1.3.0 重扫后确认 `.workbuddy` 异常提示消失。
2. **`main.js` 是手工同步的编译产物**：`main.ts` 的改动必须手工镜像到 `main.js`，若忘记同步，Obsidian 加载的是旧逻辑。
3. **ECharts 走 CDN**：`main.ts` 中 `ECHARTS_CDN` 指向 jsdelivr，离线环境图表会加载失败（已带 10s 超时提示）。
4. **`data.json` 可能被 Obsidian 重置**：虽然 onload 已强制锁定 `dataFileName`，但设置面板仍暴露「数据文件名」输入框，用户手动改坏会导致读写路径错乱（adapter.write 会静默创建错误路径文件）。
5. **根目录异常目录扫描**：`allowedRoot` 白名单不含临时目录，若根目录出现新目录（非白名单且不在 `userIgnoreFilters` 排除列表）会被报为结构问题，属预期行为；排除列表中的目录（`.agents` `.qoderian` `.workbuddy` 等）不再报异常（2026-08-17 修复，main.ts / main.js / release/main.js 三处同步）。

## 7.5 文档与发布

### README.md
- 编写了完整的 README.md 文档，包含：
  - 功能特性说明
  - 安装方法（Release 包安装 + 手动复制）
  - 使用方法（命令面板命令、设置配置）
  - 排除列表配置说明（三种规则类型）
  - 数据结构说明
  - 配套页面说明
  - 技术说明和许可证

### Release 文件夹
- 创建了 `release/kb-dashboard/` 发布包，包含：
  - `manifest.json`（插件清单）
  - `main.js`（编译产物）
  - `data.json`（默认设置）

## 8. 已经跑过的测试

| 测试 | 结果 |
| --- | --- |
| 浏览器直接打开 index.html | ✅ 正常渲染（数据内嵌，无需 fetch） |
| Obsidian 空格预览 index.html | ❌ 空白（预览不执行内联 script）——已由插件视图方案替代 |
| 插件命令「打开知识库看板」 | ✅ 标签页内显示看板（ItemView） |
| 插件命令「扫描知识库生成看板数据」 | ✅ 生成 JSON 并弹 Notice（用户实扫 2026-08-17 14:42 成功） |
| 手动扫描输出位置 | ✅ 已写入插件目录（用户控制台确认 39321 bytes） |
| 排除列表读取（readSync 修复） | ✅ 沙箱 mock（无 readSync，与真实 Obsidian 一致）验证过滤生效、无告警 |
| 被排除根目录不再报异常 | ✅ 沙箱全量扫描验证 .workbuddy/.agents/.qoderian/.claudian 不报，TempDir 仍报 |
| 侧边栏 activateView | ✅ 沙箱验证首次打开创建视图、已打开时复用 |
| index.html 一屏展示 | ✅ CSS 压缩后 1920×1080 最大化窗口无需滚动（历史成果） |
| 文件移动/删除校验 | ✅ kb-dashboard-data.json 已从根目录移走，根目录无残留 JSON |

## 9. 下一步计划

1. ✅ 用户已重载插件并扫描成功（2026-08-17 14:42）；下一步确认用 v1.3.0（readSync 修复版）重扫后 `.workbuddy` 等异常提示消失。
2. 若异常提示仍存在：检查 Obsidian 控制台是否还有 `读取排除列表失败`（旧版 main.js 残留）或核对 `.obsidian/app.json` 的 `userIgnoreFilters` 内容。
3. 长期：把 `main.ts` 用 esbuild/obsidian 模板构建，替代手工同步 `main.js`，消除双文件不一致风险。
4. ✅ 已同步 `release/kb-dashboard/main.js`（2026-08-17，diff 为空）。

## 10. 新窗口启动提示词

> 复制以下内容到新会话：

```
继续「知识库看板」项目（Obsidian 插件 kb-dashboard）。

当前状态：数据文件在插件目录 .obsidian/plugins/kb-dashboard/kb-dashboard-data.json，
读改用 vault.adapter.read，写改用 vault.adapter.write（vault.getAbstractFileByPath 不索引 .obsidian/ 目录），
DATA_FILENAME 常量在 main.ts 与 main.js 已统一为插件目录绝对路径，onload 会强制锁定 dataFileName。

最新改动（2026-08-17）：已放弃 index.html 管理（Obsidian 1.2.8 起无法 iframe 渲染本地 HTML）；
侧边栏演示文稿图标直接 activateView() 打开内置 KBDashboardView，不再跳外部浏览器。
排除列表：parseIgnoreFilters 用 await vault.adapter.read() 读 .obsidian/app.json（重要：
DataAdapter 没有 readSync，误用会导致排除列表永远为空，此坑已修复），
扫描时对每个文件/根目录调用 isFileExcluded() 过滤 userIgnoreFilters。

关键文件：
- d:\Documents\Obsidian Vault\.obsidian\plugins\kb-dashboard\main.ts（源码）
- d:\Documents\Obsidian Vault\.obsidian\plugins\kb-dashboard\main.js（编译产物，Obsidian 实际加载）
- d:\Documents\Obsidian Vault\.obsidian\plugins\kb-dashboard\data.json（设置）
- d:\Documents\Obsidian Vault\handoff.md（完整交接文档，先读它）

边界：main.ts 和 main.js 必须同步修改；Projects/ 与 Template/ 只读；
数据路径必须保持 .obsidian/plugins/kb-dashboard/kb-dashboard-data.json；插件不再读写 index.html。
排除列表自动从 .obsidian/app.json 的 userIgnoreFilters 读取。

任务：验证重载插件后侧边栏图标能打开看板视图、手动扫描生成数据到插件目录。
若失败，打开 Obsidian 控制台（Ctrl+Shift+I）检查 [kb-dashboard] 日志。
```
