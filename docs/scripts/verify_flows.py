import os
import re
import glob
from collections import defaultdict, deque

FLOW_MAPPING = {
    "flow_0_access_control": ("FLOW 0: USERS, ROLES, ACCESS & LIFECYCLE", "U", "flow-0"),
    "flow_a1_physical_receiving": ("FLOW A-1: PHYSICAL RECEIVING & QC", "A", "flow-a1"),
    "flow_a2_sap_import": ("FLOW A-2: SAP GRPO ENTRY, FILE EXPORT & IMPORT", "A", "flow-a2"),
    "flow_b_keep": ("FLOW B: KEEP (CUSTODIAN & ADMIN-CONFIGURED ISSUE WINDOWS)", "B", "flow-b"),
    "flow_c1_request": ("FLOW C-1: SECTION STOCK REQUEST", "C", "flow-c1"),
    "flow_c2_issue_confirm": ("FLOW C-2: STOCK ISSUE AND CONFIRMATION", "C", "flow-c2"),
    "flow_d_balance": ("FLOW D: BALANCE (DAILY CLOSE RECONCILIATION)", "D", "flow-d"),
    "flow_e_handover": ("FLOW E: HANDOVER (CUSTODIAN SHIFT HANDOVER)", "E", "flow-e"),
    "flow_f_count": ("FLOW F: COUNT & RECONCILIATION", "F", "flow-f"),
    "flow_g_other_movements": ("FLOW G: OTHER MOVEMENTS (WASTE, RETURNS, TRANSFERS)", "G", "flow-g"),
    "flow_h_add_store_warehouse": ("FLOW H: ADD A NEW STORE OR WAREHOUSE (APPROVAL)", "H", "flow-h")
}

def parse_and_verify_mmd(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    nodes = set()
    node_types = {}
    node_labels = {}
    edges = defaultdict(list)
    rev_edges = defaultdict(list)
    edge_labels = defaultdict(dict)
    seen_declarations = defaultdict(list)

    start_nodes = []
    end_nodes = []

    clean_lines = []
    for line_idx, line in enumerate(lines, 1):
        line = line.strip()
        if not line or line.startswith('classDef') or line.startswith('subgraph') or line.startswith('end') or line.startswith('flowchart'):
            continue
        line = re.sub(r':::[A-Za-z0-9_]+', '', line)
        clean_lines.append((line_idx, line))

    for line_idx, line in clean_lines:
        matches = re.finditer(r'([A-Za-z0-9_]+)\s*(\(\([^)]+\)\)|\[[^\]]+\]|\{[^}]+\})', line)
        for m in matches:
            nid = m.group(1)
            shape = m.group(2)
            label = shape[1:-1].strip()
            if label.startswith('"') and label.endswith('"'): label = label[1:-1].strip()
            nodes.add(nid)
            seen_declarations[nid].append(line_idx)
            if '((' in shape and 'Start' in shape:
                node_types[nid] = 'start'
                if nid not in start_nodes: start_nodes.append(nid)
            elif '((' in shape and 'End' in shape:
                node_types[nid] = 'end'
                if nid not in end_nodes: end_nodes.append(nid)
            elif '{' in shape:
                node_types[nid] = 'diamond'
                node_labels[nid] = label
            elif '[' in shape:
                node_types[nid] = 'box'
                node_labels[nid] = label

    node_re = r'([A-Za-z0-9_]+)(?:\(\([^)]+\)\)|\[[^\]]+\]|\{[^}]+\})?'
    arrow_re = r'(?:--\s*"([^"]+)"\s*-->|-->|-\.\s*"([^"]+)"\s*\.->|-\.->)'
    edge_re = re.compile(rf'{node_re}\s*{arrow_re}\s*{node_re}')

    for line_idx, line in clean_lines:
        for em in edge_re.finditer(line):
            src = em.group(1)
            label = em.group(2) or em.group(3) or ""
            dst = em.group(4)
            nodes.add(src)
            nodes.add(dst)
            edges[src].append(dst)
            rev_edges[dst].append(src)
            edge_labels[src][dst] = label.strip()

    duplicate_ids = [nid for nid, idxs in seen_declarations.items() if len(idxs) > 1]

    reachable = set()
    q = deque(start_nodes)
    while q:
        curr = q.popleft()
        if curr not in reachable:
            reachable.add(curr)
            for nxt in edges[curr]:
                if nxt not in reachable:
                    q.append(nxt)

    can_terminate = set()
    q = deque(end_nodes)
    while q:
        curr = q.popleft()
        if curr not in can_terminate:
            can_terminate.add(curr)
            for prev in rev_edges[curr]:
                if prev not in can_terminate:
                    q.append(prev)

    unreachable = nodes - reachable
    dead_ends = nodes - can_terminate

    diamond_status = {}
    diamond_failures = []
    diamond_targets = {}
    for nid, ntype in node_types.items():
        if ntype == 'diamond':
            outgoing = edges[nid]
            labels = [edge_labels[nid][dst] for dst in outgoing]
            labels_norm = [l.lower() for l in labels]
            diamond_status[nid] = labels
            
            yes_target = ""
            no_target = ""
            for dst in outgoing:
                elbl = edge_labels[nid][dst].lower()
                if "yes" in elbl: yes_target = dst
                elif "no" in elbl: no_target = dst

            diamond_targets[nid] = {"yes": yes_target, "no": no_target}

            if len(outgoing) == 2:
                has_yes = any('yes' in l for l in labels_norm)
                has_no = any('no' in l for l in labels_norm)
                if not (has_yes and has_no):
                    diamond_failures.append((nid, labels, "Binary diamond missing exact YES/NO pair"))
            else:
                diamond_failures.append((nid, labels, f"Expected 2 branches (YES/NO), got {len(outgoing)}"))

    counted_boxes = [nid for nid, ntype in node_types.items() if ntype in ('box', 'diamond')]
    box_count = len(counted_boxes)

    passed = (
        len(start_nodes) == 1 and
        len(end_nodes) >= 1 and
        len(unreachable) == 0 and
        len(dead_ends) == 0 and
        len(duplicate_ids) == 0 and
        box_count <= 12 and
        len(diamond_failures) == 0
    )

    return {
        "file": filepath,
        "passed": passed,
        "box_count": box_count,
        "nodes": nodes,
        "node_labels": node_labels,
        "diamond_targets": diamond_targets,
        "start_nodes": start_nodes,
        "end_nodes": end_nodes,
        "duplicate_ids": duplicate_ids,
        "unreachable": list(unreachable),
        "dead_ends": list(dead_ends),
        "diamond_status": diamond_status,
        "diamond_failures": diamond_failures
    }

def verify_markdown_sync_and_step_ids(chart_results):
    print("\nVERIFYING INVENTORY-TOOL-FLOW.md SYNCHRONIZATION & STEP TEXT:")
    if not os.path.exists("INVENTORY-TOOL-FLOW.md"):
        print("[FAIL] INVENTORY-TOOL-FLOW.md not found!")
        return False

    with open("INVENTORY-TOOL-FLOW.md", "r", encoding="utf-8") as f:
        md_text = f.read()

    sync_passed = True

    # 1. LaTeX corruption check
    corrupt_neq = re.findall(r'\\neq', md_text)
    corrupt_eq0 = re.findall(r'eq\s*0\$', md_text)
    corrupt_bsnl = re.findall(r'\\[\r\n]', md_text)
    if corrupt_neq or corrupt_eq0 or corrupt_bsnl:
        print(f"[FAIL] LaTeX corruption detected in INVENTORY-TOOL-FLOW.md! neq={len(corrupt_neq)}, eq0={len(corrupt_eq0)}, bsnl={len(corrupt_bsnl)}")
        sync_passed = False
    else:
        print("[PASS] LaTeX corruption check: 0 broken symbols or backslash-newline artifacts")

    for base, (header, prefix, html_tab_id) in FLOW_MAPPING.items():
        mmd_path = f"flows/{base}.mmd"
        with open(mmd_path, "r", encoding="utf-8") as f:
            mmd_raw = f.read().strip()
        
        mmd_norm = "".join(mmd_raw.split())

        header_esc = re.escape(header)
        pattern = rf'### {header_esc}\n\*.*?\*\n\n```mermaid\n(.*?)\n```'
        match = re.search(pattern, md_text, flags=re.DOTALL)
        if not match:
            print(f"[FAIL] {header}: Embedded mermaid block not found in INVENTORY-TOOL-FLOW.md")
            sync_passed = False
            continue
        
        embedded_raw = match.group(1).strip()
        embedded_norm = "".join(embedded_raw.split())

        if mmd_norm != embedded_norm:
            print(f"[FAIL] {header}: Embedded mermaid block DIFFERS from {mmd_path}!")
            sync_passed = False
        else:
            print(f"[PASS] {header}: Embedded mermaid block matches {mmd_path}")

        start_pos = match.end()
        next_section = re.search(r'\n---\n\n###|\Z', md_text[start_pos:])
        flow_section_text = md_text[start_pos:start_pos + next_section.start()] if next_section else md_text[start_pos:]

        chart_data = chart_results[f"flows/{base}.mmd"]
        chart_node_labels = chart_data["node_labels"]
        chart_diamond_targets = chart_data["diamond_targets"]

        missing_ids = []
        diamond_target_failures = []

        for nid, expected_label in chart_node_labels.items():
            if nid not in flow_section_text:
                missing_ids.append(nid)

            if nid in chart_diamond_targets:
                targets = chart_diamond_targets[nid]
                yes_target = targets["yes"]
                no_target = targets["no"]

                has_yes_target = bool(re.search(rf'Yes\s*&?r?a?r?r?;?\s*->?\s*`?{yes_target}`?', flow_section_text))
                has_no_target = bool(re.search(rf'No\s*&?r?a?r?r?;?\s*->?\s*`?{no_target}`?', flow_section_text))

                if not (has_yes_target and has_no_target):
                    diamond_target_failures.append((nid, f"Expected Yes -> {yes_target}, No -> {no_target}"))

        if missing_ids:
            print(f"[FAIL] {header}: Missing required step IDs: {missing_ids}")
            sync_passed = False
        elif diamond_target_failures:
            print(f"[FAIL] {header}: Diamond targets missing in text: {diamond_target_failures}")
            sync_passed = False
        else:
            print(f"[PASS] {header}: All {len(chart_node_labels)} step boxes & diamonds verified with matching targets")

    return sync_passed

def verify_flows_html_sync(chart_results):
    print("\nVERIFYING flows/flows.html SYNCHRONIZATION & TABS:")
    if not os.path.exists("flows/flows.html"):
        print("[FAIL] flows/flows.html not found!")
        return False

    with open("flows/flows.html", "r", encoding="utf-8") as f:
        html_text = f.read()

    with open("INVENTORY-TOOL-FLOW.md", "r", encoding="utf-8") as f:
        md_text = f.read()

    html_passed = True

    # 1. Version check: Header version must match MD version
    md_version_match = re.search(r'\*\*Document Version:\*\*\s*(1\.\d)', md_text)
    html_version_match = re.search(r'Version\s*(1\.\d)', html_text)
    
    if md_version_match and html_version_match:
        md_ver = md_version_match.group(1)
        html_ver = html_version_match.group(1)
        if md_ver != html_ver:
            print(f"[FAIL] flows.html version ({html_ver}) does not match INVENTORY-TOOL-FLOW.md ({md_ver})!")
            html_passed = False
        else:
            print(f"[PASS] flows.html header version matches INVENTORY-TOOL-FLOW.md: v{html_ver}")
    else:
        print("[FAIL] Could not extract version from md or html!")
        html_passed = False

    # 2. Per-flow tab check in flows.html
    for base, (header, prefix, html_tab_id) in FLOW_MAPPING.items():
        chart_data = chart_results[f"flows/{base}.mmd"]
        chart_nodes = chart_data["nodes"]
        chart_node_labels = chart_data["node_labels"]
        chart_diamond_targets = chart_data["diamond_targets"]

        # Find section in html
        sec_pattern = rf'<section class="flow-section" id="{html_tab_id}">.*?</section>'
        sec_match = re.search(sec_pattern, html_text, flags=re.DOTALL)
        if not sec_match:
            print(f"[FAIL] flows.html tab #{html_tab_id} for {base} not found!")
            html_passed = False
            continue

        sec_text = sec_match.group(0)

        # Check all step IDs exist in this tab
        missing_ids = []
        diamond_target_failures = []
        for nid, expected_label in chart_node_labels.items():
            if nid not in sec_text:
                missing_ids.append(nid)
            
            if nid in chart_diamond_targets:
                targets = chart_diamond_targets[nid]
                yes_target = targets["yes"]
                no_target = targets["no"]

                has_yes_target = bool(re.search(rf'Yes\s*(?:&rarr;|->)\s*<code>{yes_target}</code>', sec_text))
                has_no_target = bool(re.search(rf'No\s*(?:&rarr;|->)\s*<code>{no_target}</code>', sec_text))

                if not (has_yes_target and has_no_target):
                    diamond_target_failures.append((nid, f"Expected Yes -> {yes_target}, No -> {no_target}"))

        # Check no extraneous IDs exist in this tab
        found_ids = set(re.findall(rf'<td class="step-id">({prefix}\d+)</td>', sec_text))
        found_ids.update(re.findall(rf'<code>({prefix}\d+)</code>', sec_text))
        extraneous_ids = found_ids - chart_nodes
        if extraneous_ids:
            print(f"[FAIL] flows.html tab #{html_tab_id} contains extraneous IDs not in chart: {extraneous_ids}")
            html_passed = False

        if missing_ids:
            print(f"[FAIL] flows.html tab #{html_tab_id} missing IDs: {missing_ids}")
            html_passed = False
        elif diamond_target_failures:
            print(f"[FAIL] flows.html tab #{html_tab_id} diamond targets missing: {diamond_target_failures}")
            html_passed = False
        else:
            print(f"[PASS] flows.html tab #{html_tab_id}: All {len(chart_node_labels)} step boxes & diamonds verified with matching targets")

    return html_passed

def main():
    all_passed = True
    files = sorted(glob.glob("flows/*.mmd"))
    files = [f for f in files if "_old" not in f]
    print(f"VERIFYING {len(files)} MERMAID FLOWCHARTS (STRICT STAGE 1 RULES):\n")
    chart_results = {}
    for f in files:
        f_norm = f.replace("\\", "/")
        res = parse_and_verify_mmd(f_norm)
        chart_results[f_norm] = res
        status_str = "PASS" if res["passed"] else "FAIL"
        print(f"[{status_str}] {res['file']}")
        print(f"  - Box count: {res['box_count']} / 12 max -> {'OK' if res['box_count'] <= 12 else 'EXCEEDED'}")
        print(f"  - Start: {res['start_nodes']}, End: {res['end_nodes']}")
        print(f"  - Duplicates: {res['duplicate_ids']}")
        print(f"  - Unreachable from Start: {res['unreachable']}")
        print(f"  - Cannot reach End: {res['dead_ends']}")
        print(f"  - Diamonds (YES/NO check): {res['diamond_status']}")
        if res['diamond_failures']:
            print(f"  - Diamond Failures: {res['diamond_failures']}")
        print()
        if not res["passed"]:
            all_passed = False

    md_passed = verify_markdown_sync_and_step_ids(chart_results)
    if not md_passed:
        all_passed = False

    html_passed = verify_flows_html_sync(chart_results)
    if not html_passed:
        all_passed = False

    print("\n==================================================")
    print(f"OVERALL FLOW, MD & HTML VALIDATION: {'ALL PASSED' if all_passed else 'FAILED'}")
    print("==================================================")
    return all_passed

if __name__ == '__main__':
    main()
