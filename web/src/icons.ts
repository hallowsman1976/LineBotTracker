// Phosphor icon per category (https://phosphoricons.com). Unknown categories get the "other" icon.
const CATEGORY_ICONS: Record<string, string> = {
  อาหาร: 'ph-fork-knife',
  เดินทาง: 'ph-car-simple',
  ของใช้: 'ph-shopping-bag',
  'บิล/สาธารณูปโภค': 'ph-lightning', // ph-receipt is reserved for the "from a slip" badge
  บันเทิง: 'ph-film-slate',
  สุขภาพ: 'ph-heartbeat',
  เงินเดือน: 'ph-briefcase',
  รายได้เสริม: 'ph-coins',
  อื่นๆ: 'ph-dots-three-outline',
};

export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? CATEGORY_ICONS['อื่นๆ'];
}
