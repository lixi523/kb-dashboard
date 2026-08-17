# Dashboard Tech Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有知识库看板改造成已确认的深蓝中央图谱型科技大屏，同时保持全部内容、DOM `id`、数据和 JavaScript 逻辑不变。

**Architecture:** 单文件聚焦修改。替换 `index.html` 的视觉 token 与组件 CSS，并仅为现有 section 增加布局 class；不拆分文件、不引入依赖、不改渲染函数。

**Tech Stack:** HTML5、CSS Grid、ECharts 5.5、原生 JavaScript

---

### Task 1: 建立结构不变基线

**Files:**
- Inspect: `D:\Documents\Obsidian Vault\index.html`

- [ ] 记录 `<script>` 内容与所有 DOM `id`，作为修改后的比对基线。
- [ ] 确认现有页面包含 6 个 KPI、4 个图表和 6 个信息列表模块。

### Task 2: 替换科技大屏视觉系统

**Files:**
- Modify: `D:\Documents\Obsidian Vault\index.html:8-125`

- [ ] 将页面背景改为深海蓝渐变、点阵网格和局部辉光。
- [ ] 将 header 改为居中科技标题框，左右保留更新时间与插件状态。
- [ ] 将 KPI、chart-card、summary-card 统一为深蓝半透明面板、青蓝边框、角标与轻辉光。
- [ ] 统一文字、标签、滚动条及状态色，避免原绿色品牌主视觉。
- [ ] 将整体尺寸控制在 1920×1080 视口高度内。

### Task 3: 调整中央图谱型布局

**Files:**
- Modify: `D:\Documents\Obsidian Vault\index.html:129-189`

- [ ] 为两个图表 section 添加 `primary-zone` 与 `secondary-zone` class。
- [ ] 使用 CSS Grid 形成上部左宽右窄的核心趋势区，并保持 4 个图表现有顺序和 `id`。
- [ ] 下部两个三栏 section 保持全宽紧凑矩阵；窄屏回退为单列。

### Task 4: 静态与浏览器验证

**Files:**
- Test: `D:\Documents\Obsidian Vault\index.html`

- [ ] 使用脚本比对修改前后 `<script>` 内容完全一致。
- [ ] 检查所有 DOM `id` 存在且唯一。
- [ ] 打开页面，确认 KPI、4 个图表、6 个信息模块均渲染。
- [ ] 在 1920×1080 最大化窗口检查整页无纵向滚动。
- [ ] 检查窄屏响应式布局无横向溢出。
