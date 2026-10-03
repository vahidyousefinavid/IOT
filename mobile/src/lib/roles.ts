import type { Role } from '@/api/types';

export const roleMeta: Record<Role, { label: string; hint: string }> = {
  owner: { label: 'مالک', hint: 'دسترسی کامل، از جمله حذف محل' },
  admin: { label: 'مدیر / نصاب', hint: 'پیکربندی دستگاه‌ها، اتاق‌ها و اعضا' },
  member: { label: 'عضو', hint: 'کنترل دستگاه‌ها' },
  guest: { label: 'مهمان', hint: 'فقط مشاهده' },
};

export const roles: Role[] = ['owner', 'admin', 'member', 'guest'];

/** Roles the actor may hand out (mirrors backend canManage). */
export function assignableRoles(actor: Role | undefined): Role[] {
  if (actor === 'owner') return roles;
  if (actor === 'admin') return ['admin', 'member', 'guest'];
  return [];
}
