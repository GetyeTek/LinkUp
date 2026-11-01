#!/usr/bin/env python3
"""
=============================================================================
EXHAUSTIVE SECTION BOUNDARY & SPILLOVER AUDITOR
Target Directory: /storage/emulated/0/Download/OmniDownloads/books_split
=============================================================================
Audits all 19 courses to detect:
  1. Clean cuts (next section starts at top of page)
  2. Mid-page spillovers (preceding section has tail blocks on next page)
  3. Same-page section sharing
  4. Global block type catalog of all orphan tail blocks
Exports:
  - global_spillover_manifest.json
=============================================================================
"""

import os
import sys
import json
import re
from glob import glob
from collections import Counter
import difflib
from typing import Dict, List, Any, Optional, Tuple

DEFAULT_DIR = "/storage/emulated/0/Download/OmniDownloads/books_split"
OUTPUT_MANIFEST = os.path.join(DEFAULT_DIR, "global_spillover_manifest.json")

# ANSI Colors for Pydroid 3
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def clean(s: Any) -> str:
    if s is None:
        return ""
    text = re.sub(r"<[^>]+>", "", str(s))
    text = (
        text.replace("‘", "'")
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("–", "-")
        .replace("—", "-")
    )
    return re.sub(r"\s+", " ", text).strip()


def strip_prefix(title: str) -> str:
    clean_t = clean(title)
    pattern = r"^(?:(?:chapter|unit|CHAPTER|UNIT)[\s\-]+[0-9a-zivxlcdm]+|(?:\d+(?:\.\s*\d+)*))[:\.\s\-]*"
    return re.sub(pattern, "", clean_t, flags=re.I).strip().lower()


def get_block_text(b: Dict[str, Any]) -> str:
    if not isinstance(b, dict):
        return ""
    txt = clean(b.get("body") or b.get("title") or b.get("label") or "")
    if isinstance(b.get("items"), list):
        txt += " " + " ".join(clean(x) for x in b["items"])
    if isinstance(b.get("questions"), list):
        txt += " " + " ".join(clean(x) for x in b["questions"])
    return txt.strip()


def is_benign_block(block: Dict[str, Any]) -> bool:
    if not isinstance(block, dict):
        return True
    b_type = str(block.get("type", "")).lower()
    if any(k in b_type for k in ["spacer", "footer", "blank-line"]):
        return True
    if "running" in b_type:
        return True
    return False


def is_boundary_header(block: Dict[str, Any], boundary_title: str) -> bool:
    if not isinstance(block, dict) or not boundary_title:
        return False
    b_type = str(block.get("type", "")).lower()

    is_head_type = any(
        h in b_type
        for h in [
            "header",
            "title",
            "unit",
            "chap",
            "sub",
            "review",
            "activity",
            "box",
            "def-box",
            "summary",
            "exercise",
            "case",
        ]
    )
    if not is_head_type:
        return False

    b_text = clean(block.get("body") or block.get("title") or "").lower()
    t_text = clean(boundary_title).lower()

    if b_text == t_text:
        return True

    norm_b = strip_prefix(b_text)
    norm_t = strip_prefix(t_text)

    if norm_b and norm_t:
        if norm_b == norm_t or norm_b in norm_t or norm_t in norm_b:
            return True
        if difflib.SequenceMatcher(None, norm_b, norm_t).ratio() >= 0.70:
            return True

    return False


def index_pages_safe(pages: List[Dict[str, Any]], offset: int = 0) -> Tuple[Dict[str, int], Dict[str, int], Dict[str, int]]:
    by_canvas = {}
    by_footer = {}
    by_calc = {}

    for idx, p in enumerate(pages):
        p_num = str(p.get("page_number", "")).strip()
        if p_num:
            by_canvas[p_num] = idx
            try:
                calc_val = str(int(p_num) - offset)
                by_calc[calc_val] = idx
            except ValueError:
                pass

        for item in p.get("content_json") or []:
            if isinstance(item, dict) and "footer" in str(item.get("type", "")).lower():
                val = str(item.get("val", "")).strip()
                if val and val not in by_footer:
                    by_footer[val] = idx
                break

    return by_canvas, by_footer, by_calc


def find_next_boundary_node(target_node: Dict[str, Any], toc_tree: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    parent_map = {}
    siblings_map = {}

    def _build(nodes, parent=None):
        for i, n in enumerate(nodes):
            parent_map[id(n)] = parent
            siblings_map[id(n)] = {
                "next_sibling": nodes[i + 1] if i + 1 < len(nodes) else None
            }
            if isinstance(n.get("children"), list):
                _build(n["children"], n)

    _build(toc_tree)

    curr = target_node
    while curr:
        curr_info = siblings_map.get(id(curr))
        if curr_info and curr_info["next_sibling"]:
            return curr_info["next_sibling"]
        curr = parent_map.get(id(curr))

    return None


def flatten_toc_with_trail(toc_nodes: List[Dict[str, Any]], trail: str = "") -> List[Tuple[Dict[str, Any], str]]:
    flat = []
    for node in toc_nodes:
        title = clean(node.get("title", ""))
        current_trail = f"{trail} > {title}" if trail else title
        flat.append((node, current_trail))
        if isinstance(node.get("children"), list):
            flat.extend(flatten_toc_with_trail(node["children"], current_trail))
    return flat


def audit_book_transitions(file_path: str) -> Optional[Dict[str, Any]]:
    fname = os.path.basename(file_path)
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    book = data.get("book") or {}
    toc = book.get("toc")
    if not toc or not isinstance(toc, list) or len(toc) == 0:
        return None

    pages = data.get("pages") or []
    raw_offset = book.get("page_offset")
    offset = raw_offset if isinstance(raw_offset, int) else 0

    by_canvas, by_footer, by_calc = index_pages_safe(pages, offset)
    dialect = "CANVAS" if fname == "LOCT_1011.txt" else "FOOTER"
    primary = by_canvas if dialect == "CANVAS" else by_footer

    flat_entries = flatten_toc_with_trail(toc)

    def _resolve(page_val):
        p_str = str(page_val).strip()
        return primary.get(p_str) if p_str in primary else by_calc.get(p_str, by_canvas.get(p_str, -1))

    sections_report = []
    stats = Counter()
    orphan_block_types = Counter()

    for node, trail in flat_entries:
        title = node.get("title", "")
        start_p_val = node.get("page")
        start_idx = _resolve(start_p_val)

        boundary_node = find_next_boundary_node(node, toc)

        if not boundary_node:
            stats["END_OF_BOOK"] += 1
            sections_report.append({
                "title": title,
                "start_page": start_p_val,
                "start_idx": start_idx,
                "boundary_title": "END_OF_BOOK",
                "boundary_page": None,
                "transition": "END_OF_BOOK",
                "spillover": False,
                "tail_blocks_count": 0,
                "tail_block_types": [],
                "recommended_page_span": len(pages) - start_idx if start_idx != -1 else 1,
            })
            continue

        boundary_title = boundary_node.get("title", "")
        boundary_p_val = boundary_node.get("page")
        boundary_idx = _resolve(boundary_p_val)

        if start_idx == -1 or boundary_idx == -1:
            stats["UNRESOLVED"] += 1
            sections_report.append({
                "title": title,
                "start_page": start_p_val,
                "start_idx": start_idx,
                "boundary_title": boundary_title,
                "boundary_page": boundary_p_val,
                "transition": "UNRESOLVED_PAGE",
                "spillover": False,
                "tail_blocks_count": 0,
                "tail_block_types": [],
                "recommended_page_span": 1,
            })
            continue

        if boundary_idx == start_idx:
            stats["SAME_PAGE_SHARING"] += 1
            sections_report.append({
                "title": title,
                "start_page": start_p_val,
                "start_idx": start_idx,
                "boundary_title": boundary_title,
                "boundary_page": boundary_p_val,
                "transition": "SAME_PAGE_SHARING",
                "spillover": False,
                "tail_blocks_count": 0,
                "tail_block_types": [],
                "recommended_page_span": 1,
            })
            continue

        # Inspect boundary page
        boundary_page = pages[boundary_idx]
        blocks = boundary_page.get("content_json") or []

        boundary_header_idx = -1
        for i, b in enumerate(blocks):
            if is_boundary_header(b, boundary_title):
                boundary_header_idx = i
                break

        # Fallback to first header on boundary page
        if boundary_header_idx == -1:
            for i, b in enumerate(blocks):
                b_type = str(b.get("type", "")).lower()
                if "header" in b_type or "title" in b_type or "sub" in b_type:
                    boundary_header_idx = i
                    break

        tail_blocks = []
        stop_limit = boundary_header_idx if boundary_header_idx != -1 else len(blocks)
        for i in range(stop_limit):
            b = blocks[i]
            if not is_benign_block(b):
                txt = get_block_text(b)
                b_type = str(b.get("type", "unknown"))
                if len(txt) > 5 or any(k in b_type for k in ["table", "equation", "matrix", "image", "figure", "list"]):
                    tail_blocks.append(b_type)
                    orphan_block_types[b_type] += 1

        has_spillover = len(tail_blocks) > 0
        if has_spillover:
            stats["MID_PAGE_SPILLOVER"] += 1
            trans_type = "MID_PAGE_SPILLOVER"
        else:
            stats["CLEAN_CUT"] += 1
            trans_type = "CLEAN_CUT"

        span = (boundary_idx - start_idx) + (1 if has_spillover else 0)

        sections_report.append({
            "title": title,
            "start_page": start_p_val,
            "start_idx": start_idx,
            "boundary_title": boundary_title,
            "boundary_page": boundary_p_val,
            "boundary_page_idx": boundary_idx,
            "boundary_header_block_idx": boundary_header_idx,
            "transition": trans_type,
            "spillover": has_spillover,
            "tail_blocks_count": len(tail_blocks),
            "tail_block_types": tail_blocks,
            "recommended_page_span": span,
        })

    return {
        "file": fname,
        "course": book.get("title", fname),
        "total_sections": len(sections_report),
        "stats": dict(stats),
        "orphan_block_types": dict(orphan_block_types),
        "sections": sections_report,
    }


def main():
    target_dir = DEFAULT_DIR
    if len(sys.argv) > 1:
        target_dir = sys.argv[1]

    print(f"\n{BOLD}{'='*80}{RESET}")
    print(f"{BOLD} 🔍 GLOBAL SECTION BOUNDARY & SPILLOVER AUDITOR{RESET}")
    print(f" Target Path: {CYAN}{target_dir}{RESET}")
    print(f"{BOLD}{'='*80}{RESET}\n")

    files = sorted(glob(os.path.join(target_dir, "*.txt")))
    results = []
    global_orphan_types = Counter()

    print(f"{'Course':<32} {'Total':>6} {'Clean':>7} {'Spill':>7} {'Same':>6} {'End':>5} {'Spill %':>9}")
    print("-" * 80)

    for fpath in files:
        if fpath.endswith(".bak"):
            continue
        report = audit_book_transitions(fpath)
        if not report:
            continue

        results.append(report)
        s = report["stats"]
        tot = report["total_sections"]
        clean_cnt = s.get("CLEAN_CUT", 0)
        spill_cnt = s.get("MID_PAGE_SPILLOVER", 0)
        same_cnt = s.get("SAME_PAGE_SHARING", 0)
        end_cnt = s.get("END_OF_BOOK", 0)
        spill_pct = (spill_cnt / tot * 100) if tot > 0 else 0.0

        for btype, cnt in report["orphan_block_types"].items():
            global_orphan_types[btype] += cnt

        color = YELLOW if spill_cnt > 0 else GREEN
        c_name = report["course"][:30]
        print(f"{c_name:<32} {tot:>6} {clean_cnt:>7} {color}{spill_cnt:>7}{RESET} {same_cnt:>6} {end_cnt:>5} {color}{spill_pct:>8.1f}%{RESET}")

    # Write Master Manifest
    with open(OUTPUT_MANIFEST, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print("-" * 80)
    total_sections = sum(r["total_sections"] for r in results)
    total_spills = sum(r["stats"].get("MID_PAGE_SPILLOVER", 0) for r in results)
    total_clean = sum(r["stats"].get("CLEAN_CUT", 0) for r in results)
    total_same = sum(r["stats"].get("SAME_PAGE_SHARING", 0) for r in results)
    overall_spill_rate = (total_spills / total_sections * 100) if total_sections > 0 else 0.0

    print(f"{'TOTALS':<32} {total_sections:>6} {total_clean:>7} {RED}{total_spills:>7}{RESET} {total_same:>6} {sum(r['stats'].get('END_OF_BOOK', 0) for r in results):>5} {RED}{overall_spill_rate:>8.1f}%{RESET}")
    print(f"{BOLD}{'='*80}{RESET}")

    print(f"\n{BOLD}📊 GLOBAL CATALOG OF ORPHAN TAIL BLOCKS DETECTED BEFORE HEADERS:{RESET}")
    for btype, count in global_orphan_types.most_common(12):
        print(f"  • {btype:<30} : {count:>4} occurrences")

    print(f"\n{GREEN}{BOLD}✓ Master spillover manifest saved to:{RESET}\n  {OUTPUT_MANIFEST}\n")


if __name__ == "__main__":
    main()