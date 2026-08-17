# 知识库看板插件 (kb-dashboard)

Obsidian 插件，定时扫描知识库内容并生成统计看板数据。

## 功能特性

- **自动扫描**：定时扫描 Vault 中的笔记内容
- **统计指标**：笔记数量、目录分布、双链统计、标签频率
- **结构检测**：检测死链风险、根目录异常、命名冲突等
- **看板视图**：在 Obsidian 内以自定义视图展示数据可视化
- **排除列表**：自动读取 Obsidian 的 `userIgnoreFilters` 配置，过滤被排除的文件
- **侧边栏快捷方式**：左侧边栏一键在 Obsidian 内打开看板视图

## 安装

### 方法一：从 Release 安装

1. 下载本仓库的 `release/` 文件夹
2. 将 `release/kb-dashboard` 文件夹复制到 Obsidian Vault 的 `.obsidian/plugins/` 目录下
3. 重启 Obsidian
4. 在「设置 → 第三方插件」中启用 kb-dashboard

### 方法二：手动复制

```bash
# 复制插件文件到 Obsidian vault
cp -r release/kb-dashboard ~/.obsidian/plugins/
```

## 使用方法

### 命令

在 Obsidian 中使用命令面板（`Ctrl/Cmd + P`）执行：

- **打开知识库看板**：在标签页中展示数据可视化看板
- **扫描知识库生成看板数据**：手动触发一次扫描

### 侧边栏快捷方式

插件启用后，左侧边栏会出现 📊/演示文稿图标，点击直接在 Obsidian 标签页内打开内置看板视图（首次打开若尚无数据会自动触发扫描）。

### 设置

进入「设置 → 知识库看板」可配置：

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 自动扫描 | 是否定时自动扫描 | 开启 |
| 扫描间隔（小时） | 自动扫描的时间间隔 | 24 |
| 数据文件名 | JSON 数据文件的保存路径 | `.obsidian/plugins/kb-dashboard/kb-dashboard-data.json` |

## 配置说明

### 数据文件

插件扫描后生成的 JSON 数据文件默认保存在：
```
.obsidian/plugins/kb-dashboard/kb-dashboard-data.json
```

该文件可通过 Obsidian 内看板视图（侧边栏快捷方式）展示；也可以配合项目根目录的独立 `index.html` 页面（需手动同步数据）在浏览器中查看。

### 排除列表

插件会自动读取 Obsidian 主配置文件 `.obsidian/app.json` 中的 `userIgnoreFilters` 字段，用于过滤不需要扫描的文件和目录。

支持的过滤规则类型：

| 规则格式 | 说明 | 示例 |
|----------|------|------|
| 目录前缀（以 `/` 结尾） | 排除指定目录下的所有文件 | `Logs/`, `Template/`, `.trash/` |
| 正则表达式（`/^...*/` 格式） | 匹配符合正则的文件或路径 | `/^索引.*/` |
| 文件名包含（普通字符串） | 排除文件名或路径包含指定字符串的文件 | `.claudian`, `.workbuddy` |

> **注意**：正则表达式以 `*/` 结尾，目录前缀以 `/` 结尾但不以 `/^` 开头。

示例配置（`.obsidian/app.json`）：
```json
{
  "userIgnoreFilters": [
    "Logs/",
    "Template/",
    "/^索引.*/",
    ".claudian",
    ".workbuddy",
    ".agents",
    ".qoderian",
    ".trash",
    ".uploads"
  ]
}
```

> 被排除的根目录（如 `.agents`、`.qoderian`、`.workbuddy`）也不会被「根目录异常目录」结构检查标记。

## 数据结构

生成的 JSON 数据文件包含以下字段：

```json
{
  "generated_at": "2026-08-16 23:00",
  "summary": {
    "total_md": 150,
    "dir_counts": {
      "Inbox": 20,
      "Notes": 80,
      "Ideas": 15,
      "wiki": 25,
      "Projects": 5,
      "Logs": 0,
      "Template": 0
    },
    "wiki_count": 25,
    "inbox_count": 20,
    "broken_link_estimate": 3
  },
  "dirs": { ... },
  "notes_breakdown": { ... },
  "wiki_tags": { ... },
  "top_wikilinks": [...],
  "top_tags": [...],
  "inbox_backlog": [...],
  "recent_logs": [...],
  "recent_briefs": [...],
  "recent_reviews": [...],
  "ideas_summary": [...],
  "structural_issues": [...],
  "archive_candidates": [...]
}
```

## 配套页面

### index.html 看板

项目根目录的 `index.html` 是一个独立的 HTML 看板页面，可以：

1. **浏览器直接打开**：嵌入数据后直接在浏览器中查看
2. **独立静态页**：插件不再自动管理该文件，需手动同步数据（见下一条）；日常查看请用插件的侧边栏快捷方式在 Obsidian 内打开看板视图
3. **手动刷新数据**：修改 `index.html` 模板后，运行 `python update_kb_data.py` 即可把页面内嵌数据替换为最新扫描数据（支持自定义路径：`python update_kb_data.py [数据文件] [HTML文件]`）

## 技术说明

- **开发语言**：TypeScript → JavaScript
- **图表库**：ECharts 5.5.0（CDN）
- **最低版本要求**：Obsidian 1.0.0+
- **平台支持**：桌面端（macOS, Windows, Linux）

## 更新日志

### v1.3.0
- **修复排除列表不生效**：`vault.adapter.readSync` 在 Obsidian 中不存在（DataAdapter 为全异步 API），已改为异步 `read()`，`userIgnoreFilters` 过滤真正生效
- 被排除的根目录（如 `.agents`、`.qoderian`、`.workbuddy`）不再被「根目录异常目录」检查报出

### v1.2.0
- 侧边栏新增快捷方式，点击直接在 Obsidian 标签页内打开内置看板视图（数据为空时自动触发扫描）

### v1.1.0
- 添加排除列表过滤功能（规则解析 + 扫描过滤；读取逻辑在 v1.3.0 修复）
- 自动读取 Obsidian 的 `userIgnoreFilters` 配置
- 支持三种过滤规则：目录前缀、正则表达式、文件名包含

### v1.0.0
- 初始版本发布
- 支持自动/手动扫描
- 提供看板视图和数据文件

## 许可证

MIT License

## 联系方式

作者：李晓林
