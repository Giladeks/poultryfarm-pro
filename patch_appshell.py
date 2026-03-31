// PATCH INSTRUCTIONS for components/layout/AppShell.js
// Run this Python script from your project root:
//
//   python3 patch_appshell.py
//
// What it does:
//   1. Adds 'Scale' to the ICON_MAP (reused for Rearing)
//   2. Inserts the /rearing nav item after the /brooding entry in NAV_ITEMS

// ─────────────────────────────────────────────────────────────────────────────
// patch_appshell.py
// ─────────────────────────────────────────────────────────────────────────────

import sys

path = 'components/layout/AppShell.js'

with open(path, 'r') as f:
    src = f.read()

# ── 1. Add Scale to ICON_MAP if not already there ─────────────────────────────
OLD_ICON_MAP = """const ICON_MAP = {
  LayoutDashboard, Building2, Egg, ClipboardList, ClipboardCheck, Bird,
  TrendingUp, Scale, Factory, Syringe, Wheat, Cog,
  CheckSquare, DollarSign, Search, Drumstick,
};"""

# Scale is already in the import list and ICON_MAP — nothing to change there.
# Just verify it's present.
if 'Scale' not in src:
    print('ERROR: Scale not found in AppShell.js imports. Check manually.')
    sys.exit(1)

# ── 2. Insert /rearing nav item after /brooding entry ────────────────────────
OLD_BROODING_ENTRY = """  {
    href: '/brooding', icon: 'Egg', label: 'Brooding', section: 'top',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'],
  },"""

NEW_BROODING_PLUS_REARING = """  {
    href: '/brooding', icon: 'Egg', label: 'Brooding', section: 'top',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'],
  },
  {
    href: '/rearing', icon: 'Scale', label: 'Rearing', section: 'top',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'],
    opModes: ['LAYER_ONLY', 'BOTH'],
  },"""

if OLD_BROODING_ENTRY not in src:
    print('ERROR: Could not find brooding nav entry to patch. Check AppShell.js manually.')
    sys.exit(1)

patched = src.replace(OLD_BROODING_ENTRY, NEW_BROODING_PLUS_REARING, 1)

if patched == src:
    print('ERROR: Replacement had no effect.')
    sys.exit(1)

with open(path, 'w') as f:
    f.write(patched)

print('AppShell patched successfully.')
print('  Added: /rearing nav item (Layer + Both modes, manager roles)')
