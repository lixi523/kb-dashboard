# Dashboard A/B Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于同一份知识库数据生成极简专业工作台与极光智能中枢两个独立页面，并重构四个 ECharts 图表。

**Architecture:** 复制当前 `index.html` 为两个独立单文件页面，各自替换 CSS、标题和四个图表渲染函数。列表渲染、数据解析、DOM `id` 与 `KB_DATA` 保持一致，现有 `index.html` 不修改。

**Tech Stack:** HTML5、CSS Grid、ECharts 5.5、原生 JavaScript

---

### Task 1: 建立基线和双页面文件

**Files:**
- Read: `D:\Documents\Reasonix\kb-dashboard\index.html`
- Create: `D:\Documents\Reasonix\kb-dashboard\index-a.html`
- Create: `D:\Documents\Reasonix\kb-dashboard\index-b.html`

- [ ] 记录基线 `index.html` SHA-256、`KB_DATA` SHA-256 和全部 DOM `id`。
- [ ] 复制基线为 A/B 两个页面，不改基线文件。

### Task 2: 实现 A 极简专业工作台

**Files:**
- Modify: `D:\Documents\Reasonix\kb-dashboard\index-a.html`

- [ ] 替换为浅灰画布、白色圆角卡片、紫蓝主色的完整 CSS。
- [ ] 将标题改为“知识库工作台”。
- [ ] 重构 Notes 圆角渐变柱图、wiki 中心数字环图、高频双链排名横条图、简报渐变面积图。
- [ ] 保持 KPI、列表与 footer 的原始内容和渲染入口。

### Task 3: 实现 B 极光智能中枢

**Files:**
- Modify: `D:\Documents\Reasonix\kb-dashboard\index-b.html`

- [ ] 替换为深蓝极光背景、磨砂玻璃圆角卡片、青绿/靛蓝配色的完整 CSS。
- [ ] 将标题改为“知识智能中枢”。
- [ ] 重构 Notes 胶囊柱图、wiki 发光环图、高频双链荧光进度条、简报发光面积曲线。
- [ ] 保持 KPI、列表与 footer 的原始内容和渲染入口。

### Task 4: 验证

**Files:**
- Test: `D:\Documents\Reasonix\kb-dashboard\index-a.html`
- Test: `D:\Documents\Reasonix\kb-dashboard\index-b.html`
- Verify unchanged: `D:\Documents\Reasonix\kb-dashboard\index.html`

- [ ] 验证三个页面的 `KB_DATA` SHA-256 一致。
- [ ] 验证 A/B 必需 DOM `id` 均存在且唯一，内联 JavaScript 可解析。
- [ ] 验证 A/B 四个图表配置包含新的主题配色、渐变和图形样式。
- [ ] 验证基线 `index.html` SHA-256 未变化。
- [ ] 核算 1920×1080 下页面固定高度低于视口；窄屏媒体查询允许堆叠。
