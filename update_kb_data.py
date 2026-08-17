#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
读取 kb-dashboard-data.json，把 index.html 内嵌的旧 KB_DATA 替换为最新扫描数据。

用法:
    python update_kb_data.py [数据文件] [HTML文件]

默认:
    python update_kb_data.py kb-dashboard-data.json index.html

原理: 页面中数据以 JS 字符串字面量内嵌在单行里:
    const KB_DATA = "{\"generated_at\": ...}";
脚本用 json.dumps 做两层转义（JSON 文本 -> JS 字符串字面量），
并保持原文件的行尾符（CRLF/LF）与缩进前缀不变。
"""

import json
import re
import sys

# Windows 控制台默认 GBK，显式切到 UTF-8 避免中文乱码
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


def main() -> int:
    data_path = sys.argv[1] if len(sys.argv) > 1 else "kb-dashboard-data.json"
    html_path = sys.argv[2] if len(sys.argv) > 2 else "index.html"

    # 读取并校验数据文件
    with open(data_path, "r", encoding="utf-8", newline="") as f:
        raw = f.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[错误] 数据文件不是合法 JSON: {e}", file=sys.stderr)
        return 1
    if not isinstance(data, dict) or "generated_at" not in data:
        print("[错误] 数据文件缺少 generated_at 字段，不是 kb-dashboard 扫描结果", file=sys.stderr)
        return 1

    # 读取 HTML 页面
    with open(html_path, "r", encoding="utf-8", newline="") as f:
        html = f.read()

    # 匹配内嵌的 KB_DATA 字面量：贪婪匹配取该行最后一个 "; 作为结束符
    # （字面量内部的引号都已转义为 \"，不会与真正的结束符 "; 混淆）
    # group(1)=const KB_DATA = ，group(2)=转义后的 JSON 内容（不含两侧引号），group(3)=行尾
    pattern = re.compile(r'(const KB_DATA = )"(.*)";(\r?\n)')
    m = pattern.search(html)
    if not m:
        print(f"[错误] {html_path} 中未找到 `const KB_DATA = \"...\";` 内嵌数据", file=sys.stderr)
        return 1

    # 记录旧数据时间，用于对比输出（先解字符串字面量，再解 JSON）
    try:
        old_json_text = json.loads('"' + m.group(2) + '"')
        old_at = json.loads(old_json_text).get("generated_at", "")
    except Exception:
        old_at = ""

    # 生成新的内嵌字面量：
    #   1) JSON 文本（保留中文、空格分隔，与页面原格式一致）
    #   2) 再转义为 JS 双引号字符串字面量（json.dumps 自带两侧引号）
    json_text = json.dumps(data, ensure_ascii=False)
    literal = json.dumps(json_text, ensure_ascii=False)

    # 拼接回原位置（保留前缀缩进、结束符 ; 与原行尾）
    new_html = html[:m.start()] + m.group(1) + literal + ";" + m.group(3) + html[m.end():]

    with open(html_path, "w", encoding="utf-8", newline="") as f:
        f.write(new_html)

    new_at = data["generated_at"]
    print(f"[完成] {html_path} 内嵌 KB_DATA 已更新")
    print(f"  旧数据: {old_at or '(未知)'}")
    print(f"  新数据: {new_at}")
    print(f"  内嵌体积: {len(m.group(2))} -> {len(literal) - 2} 字节")
    return 0


if __name__ == "__main__":
    sys.exit(main())
