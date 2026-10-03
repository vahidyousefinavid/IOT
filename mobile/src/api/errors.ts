import { ApiError } from './http';

const messages: Record<string, string> = {
  network: 'ارتباط با سرور برقرار نشد. اینترنت را بررسی کنید.',
  invalid_credentials: 'ایمیل یا رمز عبور اشتباه است.',
  account_locked: 'به دلیل تلاش‌های ناموفق، حساب موقتاً قفل شد. ۱۵ دقیقه دیگر تلاش کنید.',
  email_taken: 'این ایمیل قبلاً ثبت شده است.',
  invalid_email: 'ایمیل معتبر نیست.',
  invalid_name: 'نام وارد شده معتبر نیست.',
  weak_password: 'رمز عبور باید حداقل ۱۰ کاراکتر و شامل حروف بزرگ، کوچک و عدد باشد.',
  rate_limited: 'درخواست‌ها زیاد است. کمی صبر کنید.',
  invalid_refresh: 'نشست شما منقضی شد. دوباره وارد شوید.',
  forbidden: 'شما دسترسی لازم برای این کار را ندارید.',
  not_found: 'مورد درخواستی پیدا نشد.',
  broker_unavailable: 'ارتباط با دستگاه‌ها موقتاً قطع است.',
  invalid_command: 'این دستور برای دستگاه معتبر نیست.',
  unsupported_command: 'دستگاه از این دستور پشتیبانی نمی‌کند.',
  last_owner: 'هر محل باید حداقل یک مالک داشته باشد. ابتدا فرد دیگری را مالک کنید.',
  invalid_invite: 'کد دعوت نامعتبر است یا منقضی شده.',
  already_member: 'شما از قبل عضو این محل هستید.',
  invalid_role: 'نقش انتخاب‌شده معتبر نیست.',
  invalid_kind: 'نوع انتخاب‌شده معتبر نیست.',
  invalid_room: 'اتاق انتخاب‌شده متعلق به این محل نیست.',
  invalid_protocol: 'روش اتصال پشتیبانی نمی‌شود.',
  no_credentials: 'این دستگاه از طریق بریج متصل است و کلید جداگانه ندارد.',
  vehicle_moving: 'خودرو در حال حرکت است. برای ایمنی، قطع موتور فقط در حالت توقف ممکن است.',
  device_offline: 'ردیاب به سرور متصل نیست. آنتن‌دهی و شارژ سیم‌کارت را بررسی کنید.',
  imei_taken: 'این ردیاب قبلاً ثبت شده است.',
  invalid_imei: 'شناسه (IMEI) باید ۶ تا ۲۰ رقم باشد.',
  invalid_timezone: 'منطقه زمانی معتبر نیست.',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return messages[err.code] ?? 'خطایی رخ داد. دوباره تلاش کنید.';
  return 'خطایی رخ داد. دوباره تلاش کنید.';
}
