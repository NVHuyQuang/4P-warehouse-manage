import re
import os
import sys

def get_graph_edges(filepath):
    if not os.path.exists(filepath):
        print(f"Error: {filepath} not found")
        sys.exit(1)
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    edges = set()
    node_re = r'([A-Za-z0-9_]+)(?:\(\([^)]+\)\)|\[[^\]]+\]|\{[^}]+\})?'
    arrow_re = r'(?:--\s*"([^"]+)"\s*-->|-->|-\.\s*"([^"]+)"\s*\.->|-\.->)'
    edge_re = re.compile(rf'{node_re}\s*{arrow_re}\s*{node_re}')
    for line in lines:
        line = re.sub(r':::[A-Za-z0-9_]+', '', line.strip())
        for em in edge_re.finditer(line):
            src, dst = em.group(1), em.group(4)
            edges.add((src, dst))
    return edges

CASES = [
    # Flow C-2 cases
    ("Flow C-2 (Normal)", "flows/flow_c2_issue_confirm.mmd", ["C21", "C22", "C23", "C25", "C27", "C31", "C32", "C33"]),
    ("Flow C-2 (Decline + Re-pick)", "flows/flow_c2_issue_confirm.mmd", ["C21", "C22", "C23", "C25", "C27", "C28", "C29", "C35", "C22"]),
    ("Flow C-2 (Decline + Cancel)", "flows/flow_c2_issue_confirm.mmd", ["C21", "C22", "C23", "C25", "C27", "C28", "C29", "C35", "C33"]),
    ("Flow C-2 (Never Confirmed)", "flows/flow_c2_issue_confirm.mmd", ["C21", "C22", "C23", "C25", "C27", "C28", "C30", "C33"]),
    ("Flow C-2 (Partial - Keep Open)", "flows/flow_c2_issue_confirm.mmd", ["C21", "C22", "C23", "C25", "C27", "C31", "C32", "C22"]),
    
    # Flow G cases
    ("Flow G (Transfer Match)", "flows/flow_g_other_movements.mmd", ["G1", "G2", "G3", "G4", "G5", "G6", "G14"]),
    ("Flow G (Transfer Variance Approved)", "flows/flow_g_other_movements.mmd", ["G1", "G2", "G3", "G4", "G5", "G7", "G6", "G14"]),
    ("Flow G (Transfer Variance Rejected - Held Shrinkage)", "flows/flow_g_other_movements.mmd", ["G1", "G2", "G3", "G4", "G5", "G7", "G8", "G14"]),
    ("Flow G (Waste Approved)", "flows/flow_g_other_movements.mmd", ["G1", "G2", "G9", "G11", "G12", "G13", "G14"]),
    ("Flow G (Waste Rejected)", "flows/flow_g_other_movements.mmd", ["G1", "G2", "G9", "G11", "G12", "G14"]),
    ("Flow G (Supplier Return Approved)", "flows/flow_g_other_movements.mmd", ["G1", "G2", "G9", "G10", "G12", "G13", "G14"]),
    ("Flow G (Supplier Return Rejected)", "flows/flow_g_other_movements.mmd", ["G1", "G2", "G9", "G10", "G12", "G14"]),

    # Flow A-2 cases
    ("Flow A-2 (New Line Ingested)", "flows/flow_a2_sap_import.mmd", ["A21", "A22", "A23", "A24", "A26", "A27", "A31", "A33", "A34"]),
    ("Flow A-2 (Duplicate Line Refresh)", "flows/flow_a2_sap_import.mmd", ["A21", "A22", "A23", "A24", "A26", "A27", "A28", "A29", "A34"]),
    ("Flow A-2 (Corrected Revision Reversal)", "flows/flow_a2_sap_import.mmd", ["A21", "A22", "A23", "A24", "A26", "A27", "A28", "A30", "A31", "A33", "A34"]),
    ("Flow A-2 (Bad Line Quarantined)", "flows/flow_a2_sap_import.mmd", ["A21", "A22", "A23", "A24", "A26", "A27", "A31", "A32", "A34"]),

    # Flow 0 cases
    ("Flow 0 (Invite & Set Password)", "flows/flow_0_access_control.mmd", ["U1", "U2", "U3", "U4", "U9", "U10", "U11", "U14"]),
    ("Flow 0 (Self-Service Reset)", "flows/flow_0_access_control.mmd", ["U1", "U2", "U8", "U9", "U10", "U11", "U14"]),
    ("Flow 0 (Wrong Password Then Lockout)", "flows/flow_0_access_control.mmd", ["U1", "U2", "U8", "U9", "U10", "U12", "U13", "U14"]),
    ("Flow 0 (Deactivate Leaver)", "flows/flow_0_access_control.mmd", ["U1", "U2", "U3", "U5", "U6", "U14"]),
    ("Flow 0 (Unlock Account)", "flows/flow_0_access_control.mmd", ["U1", "U2", "U3", "U5", "U7", "U14"])
]

def main():
    print("==================================================")
    print("MACHINE-CHECKED FLOW PATH TRACE (scripts/trace_paths.py)")
    print("==================================================")
    all_ok = True
    for name, fpath, path in CASES:
        edges = get_graph_edges(fpath)
        valid = True
        for i in range(len(path) - 1):
            src, dst = path[i], path[i+1]
            if (src, dst) not in edges:
                print(f"[FAIL] {name}: Missing edge {src} -> {dst} in {fpath}")
                valid = False
                all_ok = False
                break
        if valid:
            path_str = " -> ".join(path)
            print(f"[PASS] {name}:\n       {path_str}")

    print("==================================================")
    print("TRACE RESULT:", "ALL 21 CASES VERIFIED VALID" if all_ok else "ERRORS DETECTED")
    print("==================================================")
    return all_ok

if __name__ == '__main__':
    main()
