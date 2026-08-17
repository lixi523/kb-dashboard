/**
 * 知识库看板插件
 * 定时扫描 Vault 生成数据，并在 Obsidian 内以自定义视图渲染看板
 */

import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";

const CORE_DIRS = ["Inbox", "Notes", "Ideas", "wiki", "Projects", "Logs", "Template"];
const DATA_FILENAME = ".obsidian/plugins/kb-dashboard/kb-dashboard-data.json";
const SCAN_INTERVAL_MS = 60 * 60 * 1000;
const VIEW_TYPE = "kb-dashboard-view";
const ECHARTS_CDN = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";

interface KBDashboardSettings {
  autoScan: boolean;
  scanIntervalHours: number;
  dataFileName: string;
}

const DEFAULT_SETTINGS: KBDashboardSettings = {
  autoScan: true,
  scanIntervalHours: 1,
  dataFileName: DATA_FILENAME,
};

function parseFrontmatter(text: string): Record<string, any> {
  const m = text.match(/^---\s*\r?\n(.*?)\r?\n---/s);
  if (!m) return {};
  const fm: Record<string, any> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)/);
    if (!kv) continue;
    let val: any = kv[2].trim().replace(/^["']|["']$/g, "");
    if (val.startsWith("[")) {
      val = val
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((v: string) => v.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    fm[kv[1]] = val;
  }
  return fm;
}

interface ScanResult {
  generated_at: string;
  summary: Record<string, any>;
  dirs: Record<string, any>;
  notes_breakdown: Record<string, any>;
  wiki_tags: Record<string, any>;
  wiki_files_list: string[];
  top_wikilinks: Array<{ name: string; count: number }>;
  top_tags: Array<{ name: string; count: number }>;
  inbox_backlog: Array<Record<string, string>>;
  recent_logs: Array<Record<string, string>>;
  recent_briefs: Array<Record<string, string>>;
  recent_reviews: Array<Record<string, string>>;
  ideas_summary: Array<Record<string, any>>;
  structural_issues: string[];
  archive_candidates: string[];
}

// ============ 排除列表解析 ============
// 注意：Obsidian 的 DataAdapter 只有异步 read()，没有 readSync()；
// 若误用 readSync 会导致每次扫描抛错、排除列表永远为空（曾踩坑）。
async function parseIgnoreFilters(vault: any): Promise<Array<
  | { type: "dir_prefix"; pattern: string }
  | { type: "regex"; pattern: RegExp }
  | { type: "filename_contains"; pattern: string }
>> {
  const filters: Array<
    | { type: "dir_prefix"; pattern: string }
    | { type: "regex"; pattern: RegExp }
    | { type: "filename_contains"; pattern: string }
  > = [];
  try {
    const appJsonStr = await vault.adapter.read(".obsidian/app.json");
    if (!appJsonStr) return filters;
    const appJson = JSON.parse(appJsonStr);
    const userIgnoreFilters: string[] = appJson.userIgnoreFilters || [];
    for (const rule of userIgnoreFilters) {
      if (typeof rule !== "string") continue;
      // 正则表达式：/^...*/ 格式（以 */ 结尾）
      if (rule.startsWith("/^") && rule.endsWith("*/")) {
        const regexStr = rule.slice(1, -2); // 去掉首尾的 / 和 *
        try { filters.push({ type: "regex", pattern: new RegExp(regexStr) }); } catch {}
      }
      // 目录前缀：以 / 结尾（但不是正则）
      else if (rule.endsWith("/") && !rule.startsWith("/")) {
        filters.push({ type: "dir_prefix", pattern: rule.slice(0, -1) });
      }
      // 文件名包含
      else {
        filters.push({ type: "filename_contains", pattern: rule });
      }
    }
  } catch (e) {
    console.warn("[kb-dashboard] 读取排除列表失败:", e);
  }
  return filters;
}

function isFileExcluded(path: string, filters: any[]): boolean {
  const parts = path.split("/");
  const filename = parts[parts.length - 1];
  for (const f of filters) {
    if (f.type === "dir_prefix") {
      // 检查路径中是否有匹配的目录前缀
      for (const part of parts) {
        if (part === f.pattern) return true;
      }
    } else if (f.type === "regex") {
      if (f.pattern.test(path) || f.pattern.test(filename)) return true;
    } else if (f.type === "filename_contains") {
      // 检查文件名或路径是否包含该字符串
      if (filename.includes(f.pattern) || path.includes(f.pattern)) return true;
    }
  }
  return false;
}

// ============ 看板视图 ============
export class KBDashboardView extends ItemView {
  plugin: KBDashboardPlugin;
  chartInstances: any[] = [];
  refreshTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: KBDashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "知识库看板"; }
  getIcon(): string { return "bar-chart"; }

  async onOpen() {
    await this.render();
    // 每 60 秒刷新一次（重新读数据）
    this.refreshTimer = window.setInterval(() => this.render(), 60000);
  }

  async onClose() {
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.disposeCharts();
  }

  disposeCharts() {
    for (const c of this.chartInstances) { try { c.dispose(); } catch {} }
    this.chartInstances = [];
  }

  async loadECharts(): Promise<void> {
    if ((window as any).echarts) return;
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ECHARTS_CDN;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("ECharts CDN 加载失败"));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error("ECharts 加载超时")), 10000);
    });
  }

  async loadDataJson(): Promise<ScanResult | null> {
    const path = this.plugin.settings.dataFileName;
    try {
      const text = await this.app.vault.adapter.read(path);
      return JSON.parse(text);
    } catch { return null; }
  }

  async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("kb-dashboard-root");

    // 注入样式（只注入一次）
    if (!document.getElementById("kb-dashboard-style")) {
      const style = document.createElement("style");
      style.id = "kb-dashboard-style";
      style.textContent = DASHBOARD_CSS;
      document.head.appendChild(style);
    }

    // 占位
    container.innerHTML = `<div class="kb-loading">加载中...</div>`;

    // 加载数据
    let data = await this.loadDataJson();
    if (!data) {
      // 触发一次扫描
      container.innerHTML = `<div class="kb-empty">未找到数据，正在扫描...</div>`;
      await this.plugin.scanVault();
      data = await this.loadDataJson();
    }
    if (!data) {
      container.innerHTML = `<div class="kb-empty">扫描后仍无数据，请检查插件设置。</div>`;
      return;
    }

    // 加载 ECharts
    try {
      await this.loadECharts();
    } catch (e: any) {
      container.innerHTML = `<div class="kb-empty">ECharts 加载失败: ${e.message}</div>`;
      return;
    }

    this.disposeCharts();
    this.buildDashboard(container, data);
  }

  buildDashboard(root: HTMLElement, data: ScanResult) {
    const s = data.summary;
    const dirCounts: Record<string, number> = s.dir_counts || {};
    const wikiCats: Record<string, number> = (data.wiki_tags as any)?.by_category || {};

    root.innerHTML = `
      <div class="kb-dashboard">
        <header class="kb-header">
          <h1>📚 知识库看板</h1>
          <span class="kb-update" id="kbUpdateTime">更新于 ${data.generated_at}</span>
        </header>
        <section class="kb-kpi">
          <div class="kb-kpi-card"><div class="kb-kpi-num">${s.total_md ?? 0}</div><div class="kb-kpi-label">笔记总数</div></div>
          <div class="kb-kpi-card"><div class="kb-kpi-num">${dirCounts.Notes ?? 0}</div><div class="kb-kpi-label">Notes</div></div>
          <div class="kb-kpi-card"><div class="kb-kpi-num">${s.wiki_count ?? 0}</div><div class="kb-kpi-label">Wiki 词条</div></div>
          <div class="kb-kpi-card"><div class="kb-kpi-num">${s.inbox_count ?? 0}</div><div class="kb-kpi-label">Inbox 待归档</div></div>
          <div class="kb-kpi-card"><div class="kb-kpi-num">${s.broken_link_estimate ?? 0}</div><div class="kb-kpi-label">死链风险</div></div>
        </section>
        <section class="kb-grid">
          <div class="kb-card"><h3>📊 笔记分布</h3><div id="kbChartNotes" style="width:100%;height:300px"></div></div>
          <div class="kb-card"><h3>🏷️ Wiki 分类</h3><div id="kbChartWiki" style="width:100%;height:300px"></div></div>
          <div class="kb-card"><h3>🔗 高频双链 Top 15</h3><div id="kbChartLinks" style="width:100%;height:320px"></div></div>
          <div class="kb-card"><h3>📝 近期认知简报</h3><div class="kb-list" id="kbBriefs"></div></div>
          <div class="kb-card"><h3>⚠️ 结构性问题</h3><div class="kb-issues" id="kbIssues"></div></div>
          <div class="kb-card"><h3>📋 Inbox 积压</h3><div class="kb-list" id="kbInbox"></div></div>
          <div class="kb-card"><h3>📜 近期操作日志</h3><div class="kb-list" id="kbLogs"></div></div>
          <div class="kb-card"><h3>🔄 周复盘</h3><div class="kb-list" id="kbReviews"></div></div>
        </section>
        <footer class="kb-footer" id="kbFooter">知识库看板 · ${s.total_md ?? 0} 篇笔记 · ${s.wiki_count ?? 0} 个词条 · 数据更新 ${data.generated_at}</footer>
      </div>
    `;

    const echarts = (window as any).echarts;

    // 笔记分布柱状图
    const notesEl = root.querySelector("#kbChartNotes") as HTMLElement;
    if (notesEl) {
      const chart = echarts.init(notesEl);
      this.chartInstances.push(chart);
      const dirs = CORE_DIRS.filter(d => (dirCounts[d] || 0) > 0);
      chart.setOption({
        tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: dirs, axisLabel: { color: "#94a3b8" } },
        yAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
        series: [{ type: "bar", data: dirs.map(d => dirCounts[d]), itemStyle: { color: "#6366f1" } }],
      });
    }

    // Wiki 分类饼图
    const wikiEl = root.querySelector("#kbChartWiki") as HTMLElement;
    if (wikiEl) {
      const chart = echarts.init(wikiEl);
      this.chartInstances.push(chart);
      const cats = Object.entries(wikiCats).slice(0, 12).map(([name, value]) => ({ name, value }));
      chart.setOption({
        tooltip: { trigger: "item" },
        series: [{ type: "pie", radius: ["40%", "70%"], data: cats, label: { color: "#94a3b8" } }],
      });
    }

    // 高频双链
    const linksEl = root.querySelector("#kbChartLinks") as HTMLElement;
    if (linksEl) {
      const chart = echarts.init(linksEl);
      this.chartInstances.push(chart);
      const links = (data.top_wikilinks || []).slice(0, 15);
      chart.setOption({
        tooltip: { trigger: "axis" },
        xAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
        yAxis: { type: "category", data: links.map(l => l.name).reverse(), axisLabel: { color: "#94a3b8" } },
        series: [{ type: "bar", data: links.map(l => l.count).reverse(), itemStyle: { color: "#0ea5e9" } }],
      });
    }

    // 认知简报列表
    const briefsEl = root.querySelector("#kbBriefs");
    if (briefsEl) {
      briefsEl.innerHTML = (data.recent_briefs || []).slice(0, 6).map((b: any) =>
        `<div class="kb-list-item"><div class="kb-list-title">${b.title || b.file}</div><div class="kb-list-date">${b.date || ""}</div></div>`
      ).join("") || "<div class='kb-empty-mini'>暂无</div>";
    }

    // 结构性问题
    const issuesEl = root.querySelector("#kbIssues");
    if (issuesEl) {
      const issues = data.structural_issues || [];
      issuesEl.innerHTML = issues.length
        ? issues.map(i => `<div class="kb-issue">⚠️ ${i}</div>`).join("")
        : "<div class='kb-ok'>✅ 无异常</div>";
    }

    // Inbox 积压
    const inboxEl = root.querySelector("#kbInbox");
    if (inboxEl) {
      inboxEl.innerHTML = (data.inbox_backlog || []).slice(0, 10).map((i: any) =>
        `<div class="kb-list-item"><div class="kb-list-title">${i.title}</div><div class="kb-list-date">${i.date || ""}</div></div>`
      ).join("") || "<div class='kb-ok'>✅ Inbox 已清</div>";
    }

    // 操作日志
    const logsEl = root.querySelector("#kbLogs");
    if (logsEl) {
      logsEl.innerHTML = (data.recent_logs || []).slice(0, 6).map((l: any) =>
        `<div class="kb-list-item"><div class="kb-list-title">${l.file}</div><div class="kb-list-preview">${(l.preview || "").slice(0, 100)}...</div></div>`
      ).join("") || "<div class='kb-empty-mini'>暂无</div>";
    }

    // 周复盘
    const reviewsEl = root.querySelector("#kbReviews");
    if (reviewsEl) {
      reviewsEl.innerHTML = (data.recent_reviews || []).map((r: any) =>
        `<div class="kb-list-item"><div class="kb-list-title">${r.file}</div><div class="kb-list-preview">${(r.preview || "").slice(0, 100)}...</div></div>`
      ).join("") || "<div class='kb-empty-mini'>暂无</div>";
    }
  }
}

// ============ 插件主类 ============
export default class KBDashboardPlugin extends Plugin {
  settings!: KBDashboardSettings;
  timerId: number | null = null;

  async onload() {
    await this.loadSettings();
    this.settings.dataFileName = DATA_FILENAME;
    await this.saveSettings();

    // 注册视图
    this.registerView(VIEW_TYPE, (leaf) => new KBDashboardView(leaf, this));

    // 启动时立即扫描一次
    if (this.settings.autoScan) {
      this.scheduleScan(5000);
    }

    // 定时扫描
    this.registerInterval(
      window.setInterval(() => {
        if (this.settings.autoScan) this.safeScan();
      }, this.settings.scanIntervalHours * SCAN_INTERVAL_MS)
    );

    // 命令：打开看板
    this.addCommand({
      id: "kb-dashboard-open",
      name: "打开知识库看板",
      callback: () => this.activateView(),
    });

    // 命令：手动扫描
    this.addCommand({
      id: "kb-dashboard-scan",
      name: "扫描知识库生成看板数据",
      callback: () => this.safeScan(),
    });

    // 侧边栏快捷方式：在 Obsidian 标签页内打开内置知识库看板（数据为空时视图会自动触发扫描）
    this.addRibbonIcon("presentation", "打开知识库看板", () => this.activateView());

    this.addSettingTab(new KBDashboardSettingTab(this.app, this));
  }

  onunload() {
    if (this.timerId !== null) window.clearTimeout(this.timerId);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  scheduleScan(delayMs: number) {
    if (this.timerId !== null) window.clearTimeout(this.timerId);
    this.timerId = window.setTimeout(() => {
      this.safeScan();
      this.timerId = null;
    }, delayMs);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  safeScan() {
    this.scanVault().catch((err) => {
      console.error("[kb-dashboard] 扫描失败:", err);
    });
  }

  async scanVault() {
    const vault = this.app.vault;
    const vaultRoot = vault.getRoot().path;
    const data = await this.collectData(vault, vaultRoot);

    const jsonStr = JSON.stringify(data, null, 2);
    const dataPath = this.settings.dataFileName;
    await this.app.vault.adapter.write(dataPath, jsonStr);

    console.log(`[kb-dashboard] data.json 已生成 (${jsonStr.length} bytes) @ ${data.generated_at}`);
    new Notice(`知识库看板数据已更新 @ ${data.generated_at}`);

    // 刷新已打开的视图
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof KBDashboardView) {
        (leaf.view as KBDashboardView).render();
      }
    }
  }

  async collectData(vault: any, _vaultRoot: string): Promise<ScanResult> {
    const allFiles = vault.getMarkdownFiles();
    const ignoreFilters = await parseIgnoreFilters(vault);
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const result: ScanResult = {
      generated_at: generatedAt,
      summary: {}, dirs: {}, notes_breakdown: {}, wiki_tags: {},
      wiki_files_list: [], top_wikilinks: [], top_tags: [],
      inbox_backlog: [], recent_logs: [], recent_briefs: [],
      recent_reviews: [], ideas_summary: [],
      structural_issues: [], archive_candidates: [],
    };

    const dirCounts: Record<string, number> = {};
    const dirSubdirs: Record<string, Record<string, number>> = {};
    let totalMd = 0;
    const linkCounter: Record<string, number> = {};
    const tagCounter: Record<string, number> = {};
    const inboxBacklog: Array<Record<string, string>> = [];
    const wikiFilesList: string[] = [];
    const wikiCatCount: Record<string, number> = {};

    for (const dir of CORE_DIRS) { dirCounts[dir] = 0; dirSubdirs[dir] = {}; }

    for (const f of allFiles) {
      const path: string = f.path;
      if (isFileExcluded(path, ignoreFilters)) continue;
      const parts = path.split("/");
      if (parts.length === 0) continue;
      if (parts.length === 1) { totalMd++; continue; }
      const topDir = parts[0];
      if (!CORE_DIRS.includes(topDir)) continue;
      totalMd++;
      dirCounts[topDir] = (dirCounts[topDir] || 0) + 1;
      if (parts.length > 1) {
        const subdir = parts[1];
        if (!dirSubdirs[topDir]) dirSubdirs[topDir] = {};
        dirSubdirs[topDir][subdir] = (dirSubdirs[topDir][subdir] || 0) + 1;
      }
    }

    result.summary.total_md = totalMd;
    result.summary.dir_counts = dirCounts;
    for (const dir of CORE_DIRS) {
      const sorted = Object.entries(dirSubdirs[dir] || {}).sort((a, b) => b[1] - a[1]);
      result.dirs[dir] = { count: dirCounts[dir] || 0, subdirs: Object.fromEntries(sorted) };
      result.notes_breakdown[dir] = Object.fromEntries(sorted);
    }

    const readCache: Record<string, string> = {};
    const safeRead = async (path: string): Promise<string> => {
      if (path in readCache) return readCache[path];
      try { const text = await vault.adapter.read(path); readCache[path] = text; return text; }
      catch { readCache[path] = ""; return ""; }
    };

    for (const f of allFiles) {
      const parts = f.path.split("/");
      if (parts[0] !== "wiki" || parts.length === 1) continue;
      if (isFileExcluded(f.path, ignoreFilters)) continue;
      const stem = f.basename || parts[parts.length - 1].replace(/\.md$/, "");
      wikiFilesList.push(stem);
      const text = await safeRead(f.path);
      const fm = parseFrontmatter(text);
      if (fm.category) wikiCatCount[fm.category] = (wikiCatCount[fm.category] || 0) + 1;
      if (fm.tags) {
        const tags = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
        for (const t of tags) { const tag = String(t).trim(); if (tag) tagCounter[tag] = (tagCounter[tag] || 0) + 1; }
      }
    }

    result.summary.wiki_count = wikiFilesList.length;
    result.wiki_tags = { by_category: Object.fromEntries(Object.entries(wikiCatCount).sort((a, b) => b[1] - a[1])), tag_freq: {} };

    for (const f of allFiles) {
      const text = await safeRead(f.path);
      if (!text) continue;
      if (isFileExcluded(f.path, ignoreFilters)) continue;
      const linkMatches = text.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g);
      for (const lm of linkMatches) { const name = lm[1].trim(); if (name && !name.startsWith("http")) linkCounter[name] = (linkCounter[name] || 0) + 1; }
      const fm = parseFrontmatter(text);
      if (fm.tags) {
        const tags = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
        for (const t of tags) { const tag = String(t).trim(); if (tag) tagCounter[tag] = (tagCounter[tag] || 0) + 1; }
      }
      const inlineTagMatches = text.matchAll(/(?<!\w)#([\u4e00-\u9fff\w-]+)/g);
      for (const tm of inlineTagMatches) { const tag = tm[1]; if (tag) tagCounter[tag] = (tagCounter[tag] || 0) + 1; }
      const parts = f.path.split("/");
      if (parts[0] === "Inbox") {
        const fmDate = fm.date ? String(fm.date) : "";
        const fmTitle = fm.title ? String(fm.title) : f.basename;
        inboxBacklog.push({ file: f.path, date: fmDate, title: fmTitle });
      }
    }

    result.top_wikilinks = Object.entries(linkCounter).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => ({ name, count }));
    result.top_tags = Object.entries(tagCounter).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => ({ name, count }));
    result.wiki_tags.tag_freq = Object.fromEntries(Object.entries(tagCounter).sort((a, b) => b[1] - a[1]).slice(0, 30));
    inboxBacklog.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    result.inbox_backlog = inboxBacklog.slice(0, 30);
    result.summary.inbox_count = inboxBacklog.length;

    const logFiles = allFiles.filter((f: TFile) => f.path.startsWith("Logs/") && f.name.startsWith("操作日志_") && !isFileExcluded(f.path, ignoreFilters)).sort((a: TFile, b: TFile) => b.name.localeCompare(a.name)).slice(0, 14);
    for (const lf of logFiles) {
      const text = await safeRead(lf.path);
      const lines = text.split(/\r?\n/).filter((l: string) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
      result.recent_logs.push({ file: lf.name, preview: lines.slice(0, 8).join("\n").slice(0, 300) });
    }

    const briefFiles = allFiles.filter((f: TFile) => f.path.startsWith("Ideas/") && f.name.includes("认知简报") && !isFileExcluded(f.path, ignoreFilters)).sort((a: TFile, b: TFile) => b.name.localeCompare(a.name)).slice(0, 7);
    for (const bf of briefFiles) {
      const text = await safeRead(bf.path);
      const fm = parseFrontmatter(text);
      result.recent_briefs.push({ file: bf.name, title: fm.title ? String(fm.title) : bf.basename, date: fm.date ? String(fm.date) : "", preview: text.slice(0, 400) });
    }

    const reviewFiles = allFiles.filter((f: TFile) => f.path.startsWith("Ideas/") && f.name.includes("周复盘") && !isFileExcluded(f.path, ignoreFilters)).sort((a: TFile, b: TFile) => b.name.localeCompare(a.name)).slice(0, 4);
    for (const rf of reviewFiles) {
      const text = await safeRead(rf.path);
      result.recent_reviews.push({ file: rf.name, preview: text.slice(0, 300) });
    }

    const ideasFiles = allFiles.filter((f: TFile) => f.path.startsWith("Ideas/") && f.path.split("/").length === 2 && !isFileExcluded(f.path, ignoreFilters)).sort((a: TFile, b: TFile) => b.name.localeCompare(a.name)).slice(0, 10);
    for (const ideaF of ideasFiles) { const text = await safeRead(ideaF.path); result.ideas_summary.push({ file: ideaF.name, size: text.length }); }

    const issues: string[] = [];
    const rootItems = await vault.adapter.list("");
    const allowedRoot = [...CORE_DIRS, ".obsidian", ".trash", ".uploads", ".claudian", ".design", "knowledge-hub.html", "index.html", "AGENTS.md", this.settings.dataFileName || ""];
    for (const entry of rootItems.folders) {
      const name = entry.replace(/^\/|\/$/g, "");
      if (allowedRoot.includes(name)) continue;
      // 命中排除列表（userIgnoreFilters）的根目录不再报为异常，如 .agents / .qoderian / .workbuddy
      if (isFileExcluded(name + "/", ignoreFilters)) continue;
      issues.push(`根目录异常目录: ${name}`);
      result.archive_candidates.push(name);
    }
    const logNames = logFiles.map((f: TFile) => f.name);
    const hyphenLogs = logNames.filter((n: string) => n.includes("-") && n.includes("操作日志_"));
    if (hyphenLogs.length > 0) issues.push(`操作日志命名冲突（连字符）: ${hyphenLogs.slice(0, 3).join(", ")}`);

    let brokenCount = 0;
    const topLinks = Object.entries(linkCounter).sort((a, b) => b[1] - a[1]).slice(0, 200);
    for (const [name, count] of topLinks) {
      if (count <= 1) continue;
      const found = wikiFilesList.includes(name) || allFiles.some((f: TFile) => f.basename === name || f.name === `${name}.md`);
      if (!found && !name.startsWith("http") && !name.includes("/")) brokenCount++;
    }
    if (brokenCount > 5) issues.push(`死链风险: 高频双链中约 ${brokenCount} 条找不到对应 .md 文件`);
    result.structural_issues = issues;
    result.summary.broken_link_estimate = brokenCount;
    return result;
  }
}

class KBDashboardSettingTab extends PluginSettingTab {
  plugin: KBDashboardPlugin;
  constructor(app: App, plugin: KBDashboardPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "知识库看板设置" });

    new Setting(containerEl).setName("自动扫描").setDesc("定时扫描知识库并生成数据").addToggle((t) => t.setValue(this.plugin.settings.autoScan).onChange(async (v) => { this.plugin.settings.autoScan = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("扫描间隔（小时）").setDesc("每隔多少小时自动扫描一次").addSlider((s) => s.setLimits(1, 24, 1).setValue(this.plugin.settings.scanIntervalHours).setDynamicTooltip().onChange(async (v) => { this.plugin.settings.scanIntervalHours = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("数据文件名").setDesc("生成的 JSON 数据文件名").addText((t) => t.setValue(this.plugin.settings.dataFileName).onChange(async (v) => { this.plugin.settings.dataFileName = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("立即扫描").setDesc("手动触发一次知识库扫描").addButton((b) => b.setButtonText("扫描").onClick(() => this.plugin.safeScan()));
    new Setting(containerEl).setName("打开看板").setDesc("在 Obsidian 内打开知识库看板视图").addButton((b) => b.setButtonText("打开").onClick(() => this.plugin.activateView()));
  }
}

const DASHBOARD_CSS = `
.kb-dashboard-root { background: #0b0f17; color: #e2e8f0; min-height: 100%; padding: 20px; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
.kb-dashboard { max-width: 1200px; margin: 0 auto; }
.kb-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #1e293b; }
.kb-header h1 { font-size: 24px; margin: 0; color: #f1f5f9; }
.kb-update { font-size: 13px; color: #64748b; }
.kb-kpi { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
.kb-kpi-card { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; text-align: center; }
.kb-kpi-num { font-size: 28px; font-weight: 700; color: #818cf8; }
.kb-kpi-label { font-size: 12px; color: #64748b; margin-top: 4px; }
.kb-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.kb-card { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; }
.kb-card h3 { font-size: 14px; margin: 0 0 12px 0; color: #94a3b8; font-weight: 600; }
.kb-list { max-height: 320px; overflow-y: auto; }
.kb-list-item { padding: 8px 0; border-bottom: 1px solid #1e293b; }
.kb-list-title { font-size: 13px; color: #e2e8f0; }
.kb-list-date { font-size: 11px; color: #64748b; }
.kb-list-preview { font-size: 12px; color: #94a3b8; margin-top: 2px; white-space: pre-wrap; }
.kb-issue { font-size: 13px; color: #fbbf24; padding: 6px 0; border-bottom: 1px solid #1e293b; }
.kb-ok { font-size: 13px; color: #34d399; padding: 8px 0; }
.kb-empty-mini { font-size: 13px; color: #64748b; padding: 8px 0; }
.kb-empty { font-size: 16px; color: #64748b; padding: 60px; text-align: center; }
.kb-loading { font-size: 16px; color: #64748b; padding: 60px; text-align: center; }
.kb-footer { text-align: center; font-size: 12px; color: #475569; margin-top: 20px; padding-top: 12px; border-top: 1px solid #1e293b; }
@media (max-width: 768px) {
  .kb-kpi { grid-template-columns: repeat(2, 1fr); }
  .kb-grid { grid-template-columns: 1fr; }
}
`;
