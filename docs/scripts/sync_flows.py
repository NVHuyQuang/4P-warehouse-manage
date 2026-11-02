import os
import re
import subprocess

FLOW_MAPPING = {
    "flow_0_access_control": "FLOW 0: USERS, ROLES, ACCESS & LIFECYCLE",
    "flow_a1_physical_receiving": "FLOW A-1: PHYSICAL RECEIVING & QC",
    "flow_a2_sap_import": "FLOW A-2: SAP GRPO ENTRY, FILE EXPORT & IMPORT",
    "flow_b_keep": "FLOW B: KEEP (CUSTODIAN & ADMIN-CONFIGURED ISSUE WINDOWS)",
    "flow_c1_request": "FLOW C-1: SECTION STOCK REQUEST",
    "flow_c2_issue_confirm": "FLOW C-2: STOCK ISSUE AND CONFIRMATION",
    "flow_d_balance": "FLOW D: BALANCE (DAILY CLOSE RECONCILIATION)",
    "flow_e_handover": "FLOW E: HANDOVER (CUSTODIAN SHIFT HANDOVER)",
    "flow_f_count": "FLOW F: COUNT & RECONCILIATION",
    "flow_g_other_movements": "FLOW G: OTHER MOVEMENTS (WASTE, RETURNS, TRANSFERS)",
    "flow_h_add_store_warehouse": "FLOW H: ADD A NEW STORE OR WAREHOUSE (APPROVAL)"
}

def sync_all():
    # 1. Read INVENTORY-TOOL-FLOW.md
    with open("INVENTORY-TOOL-FLOW.md", "r", encoding="utf-8") as f:
        md = f.read()

    # 2. Inject each .mmd into the exact matching block
    for base, header in FLOW_MAPPING.items():
        mmd_path = f"flows/{base}.mmd"
        with open(mmd_path, "r", encoding="utf-8") as f:
            mmd_text = f.read().strip()

        header_esc = re.escape(header)
        pattern = rf'(### {header_esc}\n\*.*?\*\n\n```mermaid\n)(.*?)(\n```)'
        match = re.search(pattern, md, flags=re.DOTALL)
        if match:
            md = md[:match.start(2)] + mmd_text + md[match.end(2):]
            print(f"[SYNC] Injected {mmd_path} into INVENTORY-TOOL-FLOW.md")
        else:
            print(f"[WARN] Header {header} not found in INVENTORY-TOOL-FLOW.md")

    with open("INVENTORY-TOOL-FLOW.md", "w", encoding="utf-8") as f:
        f.write(md)

    # 3. Render all SVGs and PNGs
    print("Re-rendering all SVG and PNG files via @mermaid-js/mermaid-cli...")
    for base in FLOW_MAPPING.keys():
        mmd_path = f"flows/{base}.mmd"
        svg_path = f"flows/{base}.svg"
        png_path = f"flows/{base}.png"
        cmd_svg = f'npx -y @mermaid-js/mermaid-cli -i "{mmd_path}" -o "{svg_path}"'
        cmd_png = f'npx -y @mermaid-js/mermaid-cli -i "{mmd_path}" -o "{png_path}" -b white -s 2'
        subprocess.run(cmd_svg, shell=True, check=True)
        subprocess.run(cmd_png, shell=True, check=True)

    print("All flowcharts synchronized and re-rendered successfully.")

if __name__ == '__main__':
    sync_all()
