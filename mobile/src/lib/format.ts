const faDigits = '۰۱۲۳۴۵۶۷۸۹';

/** Converts Latin digits (and the decimal point) to Persian. */
export function fa(value: string | number): string {
  return String(value)
    .replace(/[0-9]/g, (d) => faDigits[Number(d)])
    .replace(/\./g, '٫');
}

export function faNumber(n: number, digits = 0): string {
  const fixed = n.toFixed(digits);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fa(dec ? `${grouped}.${dec}` : grouped).replace(/,/g, '٬');
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'شب بخیر';
  if (h < 12) return 'صبح بخیر';
  if (h < 17) return 'روز بخیر';
  if (h < 21) return 'عصر بخیر';
  return 'شب بخیر';
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'هرگز';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'همین الان';
  if (s < 3600) return `${fa(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.floor(s / 3600))} ساعت پیش`;
  return `${fa(Math.floor(s / 86400))} روز پیش`;
}
