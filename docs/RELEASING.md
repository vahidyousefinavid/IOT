# نسخه‌بندی، CI/CD و انتشار

## نسخه‌بندی

- فایل [`VERSION`](../VERSION) تنها منبع شماره‌ی نسخه برای **کل محصول** است: اپ اندروید، اپ iOS و بک‌اند. این‌ها همیشه با هم منتشر می‌شوند.
- قالب نسخه `MAJOR.MINOR.PATCH` است:
  - MAJOR: تغییر ناسازگار با نسخه‌های قبلی
  - MINOR: قابلیت جدید
  - PATCH: رفع اشکال
- شماره‌ی بیلد اندروید (`versionCode`) و iOS (`buildNumber`) خودکار از نسخه ساخته می‌شود. مثلاً نسخه‌ی `1.2.3` شماره‌ی بیلد `1002003` می‌گیرد، پس هر نسخه‌ی جدید همیشه شماره‌ی بزرگ‌تری دارد.
- API نسخه‌ی خودش را در `GET /version` برمی‌گرداند، و اپ نسخه‌اش را در صفحه‌ی پروفایل نشان می‌دهد.

### سه نوع بیلد اپ

| نوع | شناسه‌ی بسته | کاربرد |
|---|---|---|
| development | `ir.hooshban.app.dev` | توسعه با `expo start` |
| preview | `ir.hooshban.app.preview` | تست روی گوشی. به سرور HTTP داخل شبکه‌ی خانه هم وصل می‌شود |
| production | `ir.hooshban.app` | نسخه‌ی مشتری. فقط HTTPS و فقط با کلید امضای اصلی |

این سه نوع کنار هم روی یک گوشی نصب می‌شوند.

## Workflowها

| Workflow | چه زمانی اجرا می‌شود | چه می‌کند |
|---|---|---|
| **CI** | هر push و pull request | بک‌اند (فرمت، vet، تست با race، بررسی آسیب‌پذیری)؛ اپ (TypeScript، سازگاری پکیج‌ها با SDK، bundle)؛ **کل استک با هم** در Docker با ۳۳ تست end-to-end |
| **Preview APK** | دستی یا هر push به main | APK تستی با آدرس سروری که شما می‌دهید |
| **Release** | push تگ `vX.Y.Z` | ایمیج API (amd64 و arm64)، APK و AAB امضاشده، و ساخت GitHub Release |
| **Deploy** | بعد از Release موفق، یا دستی | پشتیبان‌گیری از دیتابیس، استقرار روی سرور، health check، و rollback خودکار |

## راه‌اندازی یک‌باره

### ۱. مخزن GitHub

```bash
git add -A && git commit -m "Initial commit"
git remote add origin git@github.com:<you>/hooshban.git
git push -u origin main
```

### ۲. Secrets

مسیر: Settings ← Secrets and variables ← Actions ← **Secrets**

| نام | مقدار |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | محتوای `secrets/android/upload.jks.base64` |
| `ANDROID_KEYSTORE_PASSWORD` | از `secrets/android/github-secrets.txt` |
| `ANDROID_KEY_ALIAS` | همان فایل |
| `ANDROID_KEY_PASSWORD` | همان فایل |
| `DEPLOY_HOST` | IP یا دامنه‌ی سرور |
| `DEPLOY_USER` | کاربر SSH سرور (عضو گروه docker) |
| `DEPLOY_PORT` | پورت SSH. اختیاری است و پیش‌فرض آن 22 است |
| `DEPLOY_SSH_KEY` | کلید خصوصی SSH مخصوص استقرار (`ssh-keygen -t ed25519 -f deploy_key`) |
| `DEPLOY_KNOWN_HOSTS` | خروجی `ssh-keyscan -p <port> <host>` |

> **پوشه‌ی `secrets/android/` را جداگانه و آفلاین پشتیبان‌گیری کنید.** اگر این کلید گم شود، دیگر هرگز نمی‌توانید برای همین اپ آپدیت منتشر کنید. این پوشه عمداً در git نیست.

### ۳. Variables

مسیر: همان صفحه، تب **Variables**

| نام | مثال |
|---|---|
| `API_URL` | `https://api.example.com` |
| `MQTT_HOST` | `mqtt.example.com` |
| `TRACKER_HOST` | `trk.example.com` |
| `MAP_TILES` | `https://tiles.example.com/{z}/{x}/{y}.png` (اختیاری) |
| `PREVIEW_API_URL` | اگر تنظیم شود، با هر push به main یک APK تستی ساخته می‌شود (اختیاری) |
| `IOS_ENABLED` | مقدار `true` فقط اگر حساب Apple Developer و `EXPO_TOKEN` دارید |

### ۴. Environment «production»

مسیر: Settings ← Environments ← `production`

اگر در قسمت **Required reviewers** خودتان را اضافه کنید، هیچ استقراری بدون تأیید شما انجام نمی‌شود.

### ۵. آماده‌سازی سرور (یک بار)

```bash
sudo mkdir -p /opt/hooshban/deploy/certs && sudo chown $USER /opt/hooshban
# فایل .env را با secrets تولیدی از scripts/gen-secrets.sh به‌اضافه‌ی API_DOMAIN در /opt/hooshban/.env بگذارید
# گواهی MQTT را در /opt/hooshban/deploy/certs/{fullchain,privkey}.pem بگذارید
```

## کارهای روزمره

### گرفتن APK برای نصب روی گوشی

مسیر: Actions ← **Preview APK** ← Run workflow.

- آدرس سرور را وارد کنید. مثلاً `http://192.168.240.152:8080` برای سروری که روی همین کامپیوتر و داخل شبکه‌ی خانه اجرا می‌شود.
- بعد از حدود ۱۰ دقیقه، فایل APK را از بخش **Artifacts** همان اجرا دانلود کنید و روی گوشی نصب کنید.
- در گوشی باید «نصب از منابع ناشناس» را برای این فایل مجاز کنید.

### انتشار نسخه‌ی جدید

1. تغییرات را زیر `## Unreleased` در [CHANGELOG.md](../CHANGELOG.md) بنویسید.
2. دستورهای زیر را اجرا کنید:
   ```bash
   node scripts/release.mjs patch      # یا minor / major / 1.4.0
   git push origin main --follow-tags
   ```
3. نتیجه‌ی خودکار:
   - Release، ایمیج API و فایل‌های APK و AAB نسخه را می‌سازد و GitHub Release با یادداشت‌های CHANGELOG منتشر می‌شود.
   - Deploy بعد از تأیید شما، API همان نسخه را روی سرور مستقر می‌کند.
4. فایل APK یا AAB را از صفحه‌ی Release برای مشتری‌ها یا فروشگاه‌ها (مایکت، بازار، Google Play) بردارید.

### برگشت به نسخه‌ی قبلی (rollback)

مسیر: Actions ← **Deploy** ← Run workflow ← نسخه‌ی قبلی، مثلاً `0.3.1`.

اگر health check یک استقرار جدید رد شود، اسکریپت خودش به نسخه‌ی قبلی برمی‌گردد.

**نکته‌ی مهم:** migrationهای دیتابیس فقط رو به جلو اجرا می‌شوند. قبل از هر استقرار یک پشتیبان در `/opt/hooshban/backups/` گرفته می‌شود. تغییرات schema را طوری بنویسید که نسخه‌ی قبلی API هم با آن کار کند: اول ستون جدید اضافه شود، و حذف ستون قدیمی در نسخه‌ی بعدی انجام شود.

## محدودیت‌های شناخته‌شده

- **iOS**: نیاز به حساب Apple Developer دارد (۹۹ دلار در سال) که برای حساب‌های ایرانی دشوار است. تا آن زمان workflow مربوط به iOS غیرفعال می‌ماند.
- **بیلد محلی اندروید**: سرورهای Android SDK گوگل از ایران مسدودند. به همین دلیل بیلد روی GitHub Actions انجام می‌شود.
