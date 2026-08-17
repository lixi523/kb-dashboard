var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  KBDashboardView: () => KBDashboardView,
  default: () => KBDashboardPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var CORE_DIRS = ["Inbox", "Notes", "Ideas", "wiki", "Projects", "Logs", "Template"];
var DATA_FILENAME = ".obsidian/plugins/kb-dashboard/kb-dashboard-data.json";
var SCAN_INTERVAL_MS = 60 * 60 * 1e3;
var VIEW_TYPE = "kb-dashboard-view";
var ECHARTS_CDN = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";
var DEFAULT_SETTINGS = {
  autoScan: true,
  scanIntervalHours: 1,
  dataFileName: DATA_FILENAME
};
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\r?\n(.*?)\r?\n---/s);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)/);
    if (!kv) continue;
    let val = kv[2].trim().replace(/^["']|["']$/g, "");
    if (val.startsWith("[")) {
      val = val.replace(/^\[|\]$/g, "").split(",").map((v) => v.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    fm[kv[1]] = val;
  }
  return fm;
}
// ============ 排除列表解析 ============
async function parseIgnoreFilters(vault) {
  const filters = [];
  try {
    const appJsonStr = await vault.adapter.read(".obsidian/app.json");
    if (!appJsonStr) return filters;
    const appJson = JSON.parse(appJsonStr);
    const userIgnoreFilters = appJson.userIgnoreFilters || [];
    for (const rule of userIgnoreFilters) {
      if (typeof rule !== "string") continue;
      if (rule.startsWith("/^") && rule.endsWith("*/")) {
        const regexStr = rule.slice(1, -2);
        try {
          filters.push({ type: "regex", pattern: new RegExp(regexStr) });
        } catch {
        }
      } else if (rule.endsWith("/") && !rule.startsWith("/")) {
        filters.push({ type: "dir_prefix", pattern: rule.slice(0, -1) });
      } else {
        filters.push({ type: "filename_contains", pattern: rule });
      }
    }
  } catch (e) {
    console.warn("[kb-dashboard] 读取排除列表失败:", e);
  }
  return filters;
}

function isFileExcluded(path, filters) {
  const parts = path.split("/");
  const filename = parts[parts.length - 1];
  for (const f of filters) {
    if (f.type === "dir_prefix") {
      for (const part of parts) {
        if (part === f.pattern) return true;
      }
    } else if (f.type === "regex") {
      if (f.pattern.test(path) || f.pattern.test(filename)) return true;
    } else if (f.type === "filename_contains") {
      if (filename.includes(f.pattern) || path.includes(f.pattern)) return true;
    }
  }
  return false;
}
var KBDashboardView = class extends import_obsidian.ItemView {
  plugin;
  chartInstances = [];
  refreshTimer = null;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "\u77E5\u8BC6\u5E93\u770B\u677F";
  }
  getIcon() {
    return "bar-chart";
  }
  async onOpen() {
    await this.render();
    this.refreshTimer = window.setInterval(() => this.render(), 6e4);
  }
  async onClose() {
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.disposeCharts();
  }
  disposeCharts() {
    for (const c of this.chartInstances) {
      try {
        c.dispose();
      } catch {
      }
    }
    this.chartInstances = [];
  }
  async loadECharts() {
    if (window.echarts) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ECHARTS_CDN;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("ECharts CDN \u52A0\u8F7D\u5931\u8D25"));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error("ECharts \u52A0\u8F7D\u8D85\u65F6")), 1e4);
    });
  }
  async loadDataJson() {
    const path = this.plugin.settings.dataFileName;
    try {
      const text = await this.app.vault.adapter.read(path);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  async render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("kb-dashboard-root");
    if (!document.getElementById("kb-dashboard-style")) {
      const style = document.createElement("style");
      style.id = "kb-dashboard-style";
      style.textContent = DASHBOARD_CSS;
      document.head.appendChild(style);
    }
    container.innerHTML = `<div class="kb-loading">\u52A0\u8F7D\u4E2D...</div>`;
    let data = await this.loadDataJson();
    if (!data) {
      container.innerHTML = `<div class="kb-empty">\u672A\u627E\u5230\u6570\u636E\uFF0C\u6B63\u5728\u626B\u63CF...</div>`;
      await this.plugin.scanVault();
      data = await this.loadDataJson();
    }
    if (!data) {
      container.innerHTML = `<div class="kb-empty">\u626B\u63CF\u540E\u4ECD\u65E0\u6570\u636E\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u8BBE\u7F6E\u3002</div>`;
      return;
    }
    try {
      await this.loadECharts();
    } catch (e) {
      container.innerHTML = `<div class="kb-empty">ECharts \u52A0\u8F7D\u5931\u8D25: ${e.message}</div>`;
      return;
    }
    this.disposeCharts();
    this.buildDashboard(container, data);
  }
  buildDashboard(root, data) {
    const s = data.summary;
    const dirCounts = s.dir_counts || {};
    const wikiCats = data.wiki_tags?.by_category || {};
    root.innerHTML = `
      <div class="kb-dashboard">
        <header class="kb-header">
          <h1>\u{1F4DA} \u77E5\u8BC6\u5E93\u770B\u677F</h1>
          <span class="kb-update" id="kbUpdateTime">\u66F4\u65B0\u4E8E ${data.generated_at}</span>
        </header>
        <section class="kb-kpi">
          <div class="kb-kpi-card"><div class="kb-kpi-num">${s.total_md ?? 0}</div><div class="kb-kpi-label">\u7B14\u8BB0\u603B\u6570</div></div>
          <div class="kb-kpi-card"><div class="kb-kpi-num">${dirCounts.Notes ?? 0}</div><div class="kb-kpi-label">Notes</div></div>
          <div class="kb-kpi-card"><div class="kb-kpi-num">${s.wiki_count ?? 0}</div><div class="kb-kpi-label">Wiki \u8BCD\u6761</div></div>
          <div class="kb-kpi-card"><div class="kb-kpi-num">${s.inbox_count ?? 0}</div><div class="kb-kpi-label">Inbox \u5F85\u5F52\u6863</div></div>
          <div class="kb-kpi-card"><div class="kb-kpi-num">${s.broken_link_estimate ?? 0}</div><div class="kb-kpi-label">\u6B7B\u94FE\u98CE\u9669</div></div>
        </section>
        <section class="kb-grid">
          <div class="kb-card"><h3>\u{1F4CA} \u7B14\u8BB0\u5206\u5E03</h3><div id="kbChartNotes" style="width:100%;height:300px"></div></div>
          <div class="kb-card"><h3>\u{1F3F7}\uFE0F Wiki \u5206\u7C7B</h3><div id="kbChartWiki" style="width:100%;height:300px"></div></div>
          <div class="kb-card"><h3>\u{1F517} \u9AD8\u9891\u53CC\u94FE Top 15</h3><div id="kbChartLinks" style="width:100%;height:320px"></div></div>
          <div class="kb-card"><h3>\u{1F4DD} \u8FD1\u671F\u8BA4\u77E5\u7B80\u62A5</h3><div class="kb-list" id="kbBriefs"></div></div>
          <div class="kb-card"><h3>\u26A0\uFE0F \u7ED3\u6784\u6027\u95EE\u9898</h3><div class="kb-issues" id="kbIssues"></div></div>
          <div class="kb-card"><h3>\u{1F4CB} Inbox \u79EF\u538B</h3><div class="kb-list" id="kbInbox"></div></div>
          <div class="kb-card"><h3>\u{1F4DC} \u8FD1\u671F\u64CD\u4F5C\u65E5\u5FD7</h3><div class="kb-list" id="kbLogs"></div></div>
          <div class="kb-card"><h3>\u{1F504} \u5468\u590D\u76D8</h3><div class="kb-list" id="kbReviews"></div></div>
        </section>
        <footer class="kb-footer" id="kbFooter">\u77E5\u8BC6\u5E93\u770B\u677F \xB7 ${s.total_md ?? 0} \u7BC7\u7B14\u8BB0 \xB7 ${s.wiki_count ?? 0} \u4E2A\u8BCD\u6761 \xB7 \u6570\u636E\u66F4\u65B0 ${data.generated_at}</footer>
      </div>
    `;
    const echarts = window.echarts;
    const notesEl = root.querySelector("#kbChartNotes");
    if (notesEl) {
      const chart = echarts.init(notesEl);
      this.chartInstances.push(chart);
      const dirs = CORE_DIRS.filter((d) => (dirCounts[d] || 0) > 0);
      chart.setOption({
        tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: dirs, axisLabel: { color: "#94a3b8" } },
        yAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
        series: [{ type: "bar", data: dirs.map((d) => dirCounts[d]), itemStyle: { color: "#6366f1" } }]
      });
    }
    const wikiEl = root.querySelector("#kbChartWiki");
    if (wikiEl) {
      const chart = echarts.init(wikiEl);
      this.chartInstances.push(chart);
      const cats = Object.entries(wikiCats).slice(0, 12).map(([name, value]) => ({ name, value }));
      chart.setOption({
        tooltip: { trigger: "item" },
        series: [{ type: "pie", radius: ["40%", "70%"], data: cats, label: { color: "#94a3b8" } }]
      });
    }
    const linksEl = root.querySelector("#kbChartLinks");
    if (linksEl) {
      const chart = echarts.init(linksEl);
      this.chartInstances.push(chart);
      const links = (data.top_wikilinks || []).slice(0, 15);
      chart.setOption({
        tooltip: { trigger: "axis" },
        xAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
        yAxis: { type: "category", data: links.map((l) => l.name).reverse(), axisLabel: { color: "#94a3b8" } },
        series: [{ type: "bar", data: links.map((l) => l.count).reverse(), itemStyle: { color: "#0ea5e9" } }]
      });
    }
    const briefsEl = root.querySelector("#kbBriefs");
    if (briefsEl) {
      briefsEl.innerHTML = (data.recent_briefs || []).slice(0, 6).map(
        (b) => `<div class="kb-list-item"><div class="kb-list-title">${b.title || b.file}</div><div class="kb-list-date">${b.date || ""}</div></div>`
      ).join("") || "<div class='kb-empty-mini'>\u6682\u65E0</div>";
    }
    const issuesEl = root.querySelector("#kbIssues");
    if (issuesEl) {
      const issues = data.structural_issues || [];
      issuesEl.innerHTML = issues.length ? issues.map((i) => `<div class="kb-issue">\u26A0\uFE0F ${i}</div>`).join("") : "<div class='kb-ok'>\u2705 \u65E0\u5F02\u5E38</div>";
    }
    const inboxEl = root.querySelector("#kbInbox");
    if (inboxEl) {
      inboxEl.innerHTML = (data.inbox_backlog || []).slice(0, 10).map(
        (i) => `<div class="kb-list-item"><div class="kb-list-title">${i.title}</div><div class="kb-list-date">${i.date || ""}</div></div>`
      ).join("") || "<div class='kb-ok'>\u2705 Inbox \u5DF2\u6E05</div>";
    }
    const logsEl = root.querySelector("#kbLogs");
    if (logsEl) {
      logsEl.innerHTML = (data.recent_logs || []).slice(0, 6).map(
        (l) => `<div class="kb-list-item"><div class="kb-list-title">${l.file}</div><div class="kb-list-preview">${(l.preview || "").slice(0, 100)}...</div></div>`
      ).join("") || "<div class='kb-empty-mini'>\u6682\u65E0</div>";
    }
    const reviewsEl = root.querySelector("#kbReviews");
    if (reviewsEl) {
      reviewsEl.innerHTML = (data.recent_reviews || []).map(
        (r) => `<div class="kb-list-item"><div class="kb-list-title">${r.file}</div><div class="kb-list-preview">${(r.preview || "").slice(0, 100)}...</div></div>`
      ).join("") || "<div class='kb-empty-mini'>\u6682\u65E0</div>";
    }
  }
};
var KBDashboardPlugin = class extends import_obsidian.Plugin {
  settings;
  timerId = null;
  async onload() {
    await this.loadSettings();
    this.settings.dataFileName = DATA_FILENAME;
    await this.saveSettings();
    this.registerView(VIEW_TYPE, (leaf) => new KBDashboardView(leaf, this));
    if (this.settings.autoScan) {
      this.scheduleScan(5e3);
    }
    this.registerInterval(
      window.setInterval(() => {
        if (this.settings.autoScan) this.safeScan();
      }, this.settings.scanIntervalHours * SCAN_INTERVAL_MS)
    );
    this.addCommand({
      id: "kb-dashboard-open",
      name: "\u6253\u5F00\u77E5\u8BC6\u5E93\u770B\u677F",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "kb-dashboard-scan",
      name: "\u626B\u63CF\u77E5\u8BC6\u5E93\u751F\u6210\u770B\u677F\u6570\u636E",
      callback: () => this.safeScan()
    });
    this.addRibbonIcon("presentation", "\u6253\u5F00\u77E5\u8BC6\u5E93\u770B\u677F", () => this.activateView());
    this.addSettingTab(new KBDashboardSettingTab(this.app, this));
  }
  onunload() {
    if (this.timerId !== null) window.clearTimeout(this.timerId);
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }
  scheduleScan(delayMs) {
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
      console.error("[kb-dashboard] \u626B\u63CF\u5931\u8D25:", err);
    });
  }
  async scanVault() {
    const vault = this.app.vault;
    const vaultRoot = vault.getRoot().path;
    const data = await this.collectData(vault, vaultRoot);
    const jsonStr = JSON.stringify(data, null, 2);
    const dataPath = this.settings.dataFileName;
    await this.app.vault.adapter.write(dataPath, jsonStr);
    console.log(`[kb-dashboard] data.json \u5DF2\u751F\u6210 (${jsonStr.length} bytes) @ ${data.generated_at}`);
    new import_obsidian.Notice(`\u77E5\u8BC6\u5E93\u770B\u677F\u6570\u636E\u5DF2\u66F4\u65B0 @ ${data.generated_at}`);
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof KBDashboardView) {
        leaf.view.render();
      }
    }
  }
  async collectData(vault, _vaultRoot) {
    const ignoreFilters = await parseIgnoreFilters(vault);
    const allFiles = vault.getMarkdownFiles();
    const now = /* @__PURE__ */ new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const result = {
      generated_at: generatedAt,
      summary: {},
      dirs: {},
      notes_breakdown: {},
      wiki_tags: {},
      wiki_files_list: [],
      top_wikilinks: [],
      top_tags: [],
      inbox_backlog: [],
      recent_logs: [],
      recent_briefs: [],
      recent_reviews: [],
      ideas_summary: [],
      structural_issues: [],
      archive_candidates: []
    };
    const dirCounts = {};
    const dirSubdirs = {};
    let totalMd = 0;
    const linkCounter = {};
    const tagCounter = {};
    const inboxBacklog = [];
    const wikiFilesList = [];
    const wikiCatCount = {};
    for (const dir of CORE_DIRS) {
      dirCounts[dir] = 0;
      dirSubdirs[dir] = {};
    }
    for (const f of allFiles) {
      const path = f.path;
      if (isFileExcluded(path, ignoreFilters)) continue;
      const parts = path.split("/");
      if (parts.length === 0) continue;
      if (parts.length === 1) {
        totalMd++;
        continue;
      }
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
    const readCache = {};
    const safeRead = async (path) => {
      if (path in readCache) return readCache[path];
      try {
        const text = await vault.adapter.read(path);
        readCache[path] = text;
        return text;
      } catch {
        readCache[path] = "";
        return "";
      }
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
        for (const t of tags) {
          const tag = String(t).trim();
          if (tag) tagCounter[tag] = (tagCounter[tag] || 0) + 1;
        }
      }
    }
    result.summary.wiki_count = wikiFilesList.length;
    result.wiki_tags = { by_category: Object.fromEntries(Object.entries(wikiCatCount).sort((a, b) => b[1] - a[1])), tag_freq: {} };
    for (const f of allFiles) {
      const text = await safeRead(f.path);
      if (!text) continue;
      if (isFileExcluded(f.path, ignoreFilters)) continue;
      const linkMatches = text.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g);
      for (const lm of linkMatches) {
        const name = lm[1].trim();
        if (name && !name.startsWith("http")) linkCounter[name] = (linkCounter[name] || 0) + 1;
      }
      const fm = parseFrontmatter(text);
      if (fm.tags) {
        const tags = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
        for (const t of tags) {
          const tag = String(t).trim();
          if (tag) tagCounter[tag] = (tagCounter[tag] || 0) + 1;
        }
      }
      const inlineTagMatches = text.matchAll(/(?<!\w)#([\u4e00-\u9fff\w-]+)/g);
      for (const tm of inlineTagMatches) {
        const tag = tm[1];
        if (tag) tagCounter[tag] = (tagCounter[tag] || 0) + 1;
      }
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
    const logFiles = allFiles.filter((f) => f.path.startsWith("Logs/") && f.name.startsWith("\u64CD\u4F5C\u65E5\u5FD7_") && !isFileExcluded(f.path, ignoreFilters)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 14);
    for (const lf of logFiles) {
      const text = await safeRead(lf.path);
      const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
      result.recent_logs.push({ file: lf.name, preview: lines.slice(0, 8).join("\n").slice(0, 300) });
    }
    const briefFiles = allFiles.filter((f) => f.path.startsWith("Ideas/") && f.name.includes("\u8BA4\u77E5\u7B80\u62A5") && !isFileExcluded(f.path, ignoreFilters)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 7);
    for (const bf of briefFiles) {
      const text = await safeRead(bf.path);
      const fm = parseFrontmatter(text);
      result.recent_briefs.push({ file: bf.name, title: fm.title ? String(fm.title) : bf.basename, date: fm.date ? String(fm.date) : "", preview: text.slice(0, 400) });
    }
    const reviewFiles = allFiles.filter((f) => f.path.startsWith("Ideas/") && f.name.includes("\u5468\u590D\u76D8") && !isFileExcluded(f.path, ignoreFilters)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 4);
    for (const rf of reviewFiles) {
      const text = await safeRead(rf.path);
      result.recent_reviews.push({ file: rf.name, preview: text.slice(0, 300) });
    }
    const ideasFiles = allFiles.filter((f) => f.path.startsWith("Ideas/") && f.path.split("/").length === 2 && !isFileExcluded(f.path, ignoreFilters)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 10);
    for (const ideaF of ideasFiles) {
      const text = await safeRead(ideaF.path);
      result.ideas_summary.push({ file: ideaF.name, size: text.length });
    }
    const issues = [];
    const rootItems = await vault.adapter.list("");
    const allowedRoot = [...CORE_DIRS, ".obsidian", ".trash", ".uploads", ".claudian", ".design", "knowledge-hub.html", "index.html", "AGENTS.md", this.settings.dataFileName || ""];
    for (const entry of rootItems.folders) {
      const name = entry.replace(/^\/|\/$/g, "");
      if (allowedRoot.includes(name)) continue;
      if (isFileExcluded(name + "/", ignoreFilters)) continue;
      issues.push(`\u6839\u76EE\u5F55\u5F02\u5E38\u76EE\u5F55: ${name}`);
      result.archive_candidates.push(name);
    }
    const logNames = logFiles.map((f) => f.name);
    const hyphenLogs = logNames.filter((n) => n.includes("-") && n.includes("\u64CD\u4F5C\u65E5\u5FD7_"));
    if (hyphenLogs.length > 0) issues.push(`\u64CD\u4F5C\u65E5\u5FD7\u547D\u540D\u51B2\u7A81\uFF08\u8FDE\u5B57\u7B26\uFF09: ${hyphenLogs.slice(0, 3).join(", ")}`);
    let brokenCount = 0;
    const topLinks = Object.entries(linkCounter).sort((a, b) => b[1] - a[1]).slice(0, 200);
    for (const [name, count] of topLinks) {
      if (count <= 1) continue;
      const found = wikiFilesList.includes(name) || allFiles.some((f) => f.basename === name || f.name === `${name}.md`);
      if (!found && !name.startsWith("http") && !name.includes("/")) brokenCount++;
    }
    if (brokenCount > 5) issues.push(`\u6B7B\u94FE\u98CE\u9669: \u9AD8\u9891\u53CC\u94FE\u4E2D\u7EA6 ${brokenCount} \u6761\u627E\u4E0D\u5230\u5BF9\u5E94 .md \u6587\u4EF6`);
    result.structural_issues = issues;
    result.summary.broken_link_estimate = brokenCount;
    return result;
  }
};
var KBDashboardSettingTab = class extends import_obsidian.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "\u77E5\u8BC6\u5E93\u770B\u677F\u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("\u81EA\u52A8\u626B\u63CF").setDesc("\u5B9A\u65F6\u626B\u63CF\u77E5\u8BC6\u5E93\u5E76\u751F\u6210\u6570\u636E").addToggle((t) => t.setValue(this.plugin.settings.autoScan).onChange(async (v) => {
      this.plugin.settings.autoScan = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u626B\u63CF\u95F4\u9694\uFF08\u5C0F\u65F6\uFF09").setDesc("\u6BCF\u9694\u591A\u5C11\u5C0F\u65F6\u81EA\u52A8\u626B\u63CF\u4E00\u6B21").addSlider((s) => s.setLimits(1, 24, 1).setValue(this.plugin.settings.scanIntervalHours).setDynamicTooltip().onChange(async (v) => {
      this.plugin.settings.scanIntervalHours = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u6570\u636E\u6587\u4EF6\u540D").setDesc("\u751F\u6210\u7684 JSON \u6570\u636E\u6587\u4EF6\u540D").addText((t) => t.setValue(this.plugin.settings.dataFileName).onChange(async (v) => {
      this.plugin.settings.dataFileName = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u7ACB\u5373\u626B\u63CF").setDesc("\u624B\u52A8\u89E6\u53D1\u4E00\u6B21\u77E5\u8BC6\u5E93\u626B\u63CF").addButton((b) => b.setButtonText("\u626B\u63CF").onClick(() => this.plugin.safeScan()));
    new import_obsidian.Setting(containerEl).setName("\u6253\u5F00\u770B\u677F").setDesc("\u5728 Obsidian \u5185\u6253\u5F00\u77E5\u8BC6\u5E93\u770B\u677F\u89C6\u56FE").addButton((b) => b.setButtonText("\u6253\u5F00").onClick(() => this.plugin.activateView()));
  }
};
var DASHBOARD_CSS = `
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KBDashboardView
});
