# هوشبان (Hooshban)

پلتفرم خانه و صنعت هوشمند — اپ موبایل اندروید/iOS با React Native (Expo) و بک‌اند Go.

```
mobile/                  اپ React Native (Expo SDK 57، Expo Router، فارسی و راست‌چین)
backend/                 سرویس Go (REST + WebSocket + دریافت MQTT + احراز هویت بروکر)
  cmd/hooshban           سرور اصلی
  cmd/devsim             شبیه‌ساز دستگاه MQTT برای تست و تحویل نصب
  cmd/trackersim         شبیه‌ساز ردیاب خودرو (GT06/H02)
deploy/                  پیکربندی EMQX، Caddy و TLS
scripts/smoke.mjs        تست end-to-end روی استک در حال اجرا (۳۳ بررسی)
docker-compose.yml       استک کامل (توسعه و اجرا در محل)
docker-compose.prod.yml  لایه‌ی production: TLS، فقط پورت‌های 443 و 8883
```

## معماری

```
 ┌──────────────┐  HTTPS/WSS   ┌──────────────┐   Redis pub/sub   ┌──────────────┐
 │  اپ موبایل    │ ───Caddy───▶ │  API (Go) ×N  │ ◀───────────────▶ │    Redis     │
 └──────────────┘              └──────┬───────┘                   └──────────────┘
                                      │ MQTT ($share/core/hb/#)    ┌──────────────┐
                                      ├──────────────────────────▶ │ PostgreSQL + │
                                      ▼                            │ TimescaleDB  │
                               ┌──────────────┐                    └──────────────┘
 ESP32 / Tasmota / ───MQTTS───▶│     EMQX     │── authn/authz ──▶ API :9090 (داخلی)
 Zigbee2MQTT bridge   (8883)   └──────────────┘
```

- **هر دستگاه هویت جدا دارد**: نام کاربری `siteId.deviceId` و رمز تصادفی ۲۵۶ بیتی. هر دستگاه فقط به تاپیک‌های `hb/{site}/{device}/…` خودش دسترسی دارد.
- **پشتیبانی از همه‌ی دستگاه‌ها** با لایه‌ی آداپتور ([backend/internal/protocol](backend/internal/protocol)):
  - `native` (فرم‌ور ESP32)
  - `zigbee2mqtt` (بیش از ۴۰۰۰ دستگاه زیگبی، با شناسایی خودکار)
  - `tasmota`
- **مقیاس‌پذیری**: API بدون وضعیت است. EMQX با shared subscription پیام‌ها را بین نسخه‌ها پخش می‌کند، Redis رویدادها را به همه‌ی نسخه‌ها می‌رساند، و تله‌متری دسته‌ای با `COPY` نوشته می‌شود.
- **برای هر خانه یا هر ماشین**: همین استک در ابر یا روی یک مینی‌PC در محل اجرا می‌شود.

## ردیاب خودرو (سیم‌کارتی)

ردیاب‌های GPS سیم‌کارتی از MQTT استفاده نمی‌کنند. هر خانواده پروتکل TCP مخصوص خودش را دارد. سرور یک gateway داخلی برای آن‌ها دارد ([backend/internal/tracker](backend/internal/tracker)):

| پروتکل | مدل‌ها | پورت | قطع موتور از راه دور |
|---|---|---|---|
| `gt06` | Concox GT06/GT06N، TK100 و اکثر ردیاب‌های خودرویی بازار | 5023 | دارد (`Relay,1#`) |
| `h02` | Sinotrack ST-901/ST-906 و مشابه | 5013 | ندارد، چون دستور در مدل‌ها متفاوت است |

- **ثبت ردیاب**: در اپ «افزودن دستگاه ← ردیاب خودرو» را بزنید و IMEI را وارد کنید. اپ پیامک‌های پیکربندی را نشان می‌دهد (APN همراه اول، ایرانسل و رایتل، آدرس سرور و فعال‌سازی GPRS). آن‌ها را به شماره‌ی سیم‌کارت ردیاب بفرستید.
- **امکانات**:
  - نقشه‌ی زنده (Leaflet؛ سرور tile با `EXPO_PUBLIC_MAP_TILES` قابل تغییر است، مثلاً نشان یا map.ir)
  - مسیر ۲۴ ساعت، ۷ روز و ۳۰ روز با محاسبه‌ی مسافت
  - سرعت، سوئیچ، باتری، آنتن و ماهواره
  - هشدارها: SOS، قطع برق، لرزش و سرعت غیرمجاز
- **قطع موتور**: فقط اعضای دارای نقش member و بالاتر می‌توانند قطع کنند. سرور وقتی سرعت بالای ۱۰ کیلومتر بر ساعت است آن را **رد می‌کند**، و همه‌ی دستورها با برچسب `tracker.immobilize` در audit log ثبت می‌شوند.
- **امنیت**:
  - IMEI ثبت‌نشده در همان اولین بسته قطع می‌شود.
  - برای هر IP و کل سرور سقف اتصال وجود دارد، اندازه‌ی بسته محدود است و اتصال بی‌کار timeout می‌شود.
  - این پروتکل‌ها ذاتاً رمزنگاری ندارند و هویتشان فقط IMEI است. برای ناوگان حساس از سیم‌کارت با **APN خصوصی** استفاده کنید تا فقط شبکه‌ی اپراتور به پورت‌های ردیاب دسترسی داشته باشد. رمز پیامکی پیش‌فرض ردیاب را هم عوض کنید.
- **تست بدون سخت‌افزار**:
  ```bash
  backend/bin/trackersim -addr HOST:5023 -imei <IMEI> [-park]
  ```
  شبیه‌ساز در خیابان ولیعصر رانندگی می‌کند و دستور قطع موتور را اجرا می‌کند.

## نقش‌ها

| نقش | دسترسی |
|---|---|
| مالک (owner) | همه چیز، از جمله حذف محل و تعیین مالک دیگر |
| مدیر / نصاب (admin) | افزودن و پیکربندی دستگاه، اتاق‌ها، اعضا و کد دعوت (به‌جز مالک‌ها) |
| عضو (member) | کنترل دستگاه‌ها |
| مهمان (guest) | فقط مشاهده |

هر محل همیشه دست‌کم یک مالک دارد و سرور از حذف یا تنزل آخرین مالک جلوگیری می‌کند.

## روال کار نصاب (اپراتور)

۱. در اپ ثبت‌نام کنید و محل را بسازید (خانه، ساختمان یا ماشین). اتاق‌های پیش‌فرض خودکار ساخته می‌شوند.

۲. در **مدیریت محل** اتاق‌ها را اضافه، ویرایش یا حذف کنید.

۳. با دکمه‌ی **+** دستگاه اضافه کنید. کلید MQTT و خط پیکربندی مخصوص همان پروتکل **فقط یک بار** نمایش داده می‌شود (قابل کپی است):
   - **ESP32 (native)**
     - وضعیت را به‌صورت JSON روی `{root}/state` بفرستید.
     - دستورها را از `{root}/cmd` دریافت کنید.
     - پیام last will را `offline` روی `{root}/status` بگذارید.
   - **Zigbee2MQTT**: مقدار `mqtt.base_topic: {root}/z2m` را تنظیم کنید. دستگاه‌های زیگبی خودکار ظاهر می‌شوند. بعد در **تنظیمات دستگاه** نام، نوع و اتاق هرکدام را اصلاح کنید.
   - **Tasmota**: `FullTopic {root}/%prefix%/`

۴. قبل از نصب سخت‌افزار واقعی، اتصال را با شبیه‌ساز تست کنید:
   ```bash
   backend/bin/devsim -broker tcp://HOST:1883 -user <username> -pass <password> -kind light
   ```

۵. در **اعضا و دعوت**، یک کد دعوت با نقش **مالک** بسازید و برای صاحب خانه بفرستید. صاحب خانه ثبت‌نام می‌کند و «عضویت با کد دعوت» را می‌زند. بعد از آن، مالک می‌تواند نقش نصاب را کم کند یا او را حذف کند.

۶. اگر کلید دستگاهی لو رفت یا گم شد: **تنظیمات دستگاه ← ساخت کلید جدید**. کلید قبلی بلافاصله باطل می‌شود.

## نسخه‌بندی و CI/CD

نسخه‌ی کل محصول در فایل `VERSION` است. تست خودکار، ساخت APK، انتشار و استقرار سرور همه با GitHub Actions انجام می‌شوند. راهنمای کامل: [docs/RELEASING.md](docs/RELEASING.md).

## اجرا در توسعه

```bash
cp .env.example .env && sh scripts/gen-secrets.sh >> .env
docker compose up -d --build           # API روی :8080، MQTT روی :1883
cd mobile && npm install && npx expo start
```

- اپ در حالت توسعه خودش به `http://<IP کامپیوتر>:8080` وصل می‌شود. گوشی باید روی همان وای‌فای باشد.
- برای پیش‌نمایش وب: `npx expo start --web` (در `.env` تنظیم `CORS_ORIGINS=http://localhost:8081` لازم است).
- تست‌ها:
  ```bash
  cd backend && go test ./...
  go build -o bin/devsim ./cmd/devsim && cd .. && node scripts/smoke.mjs
  ```

> در ایران `proxy.golang.org` و `gcr.io` مسدودند. `GOPROXY=https://goproxy.cn` از قبل تنظیم شده است و ایمیج نهایی روی `scratch` ساخته می‌شود.

## استقرار روی سرور کوچک (یک خانه، یک ماشین، یا VPS مشترک)

فایل [deploy/small/docker-compose.yml](deploy/small/docker-compose.yml) نسخه‌ی سبک استک است:

- فقط PostgreSQL، Redis و API دارد.
- **بروکر MQTT داخل خود API اجرا می‌شود** (با `MQTT_EMBEDDED_ADDR`)، و احراز هویت و جداسازی دستگاه‌ها دقیقاً مثل EMQX است.
- در مجموع حدود ۱۱۵ مگابایت RAM مصرف می‌کند (در مقابل حدود ۴۴۰ مگابایت با EMQX).
- برای هر سرویس سقف حافظه تعیین شده تا به سرویس‌های دیگر سرور فشار نیاورد.
- پورت‌ها با `API_PORT`، `MQTT_PORT`، `GT06_PORT` و `H02_PORT` در `.env` قابل تغییرند.

برای تعداد زیاد دستگاه، از استک کامل با EMQX استفاده کنید.

## استقرار production

۱. DNS دو دامنه را به سرور بدهید: `api.example.com` و `mqtt.example.com`.

۲. گواهی TLS برای MQTT بگیرید، مثلاً:
   ```bash
   certbot certonly --standalone -d mqtt.example.com
   ```
   فایل‌های `fullchain.pem` و `privkey.pem` را در `deploy/certs/` بگذارید.

۳. در `.env` این مقادیر را تنظیم کنید: `API_DOMAIN=api.example.com` و `CORS_ORIGINS=` (خالی).

۴. استک را بالا بیاورید:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
   - Caddy گواهی API را خودکار از Let's Encrypt می‌گیرد.
   - فقط پورت‌های 80، 443، 8883 (MQTT/TLS) و 5023/5013 (ردیاب‌ها) باز هستند.
   - پورت 1883، پورت 9090، دیتابیس و Redis فقط داخل شبکه‌ی Docker در دسترس‌اند.

۵. اپ را بیلد کنید. اول در `mobile/eas.json` آدرس‌ها را جایگزین کنید، بعد:
   ```bash
   npx eas-cli@latest build -p android --profile production
   npx eas-cli@latest build -p ios --profile production
   ```

۶. **پشتیبان‌گیری**: از volume `pgdata` به‌طور منظم پشتیبان بگیرید. مثلاً روزانه:
   ```bash
   docker compose exec postgres pg_dump -U hooshban hooshban | gzip > backup.sql.gz
   ```
   فایل `.env` را هم جداگانه و امن نگه دارید. بدون `DEVICE_PEPPER` هیچ دستگاهی نمی‌تواند وصل شود.

## امنیت

| لایه | پیاده‌سازی |
|---|---|
| رمز عبور | Argon2id (پارامترهای OWASP)، زمان پاسخ یکسان برای ایمیل ناموجود، قفل حساب بعد از ۱۰ تلاش ناموفق |
| نشست | JWT با EdDSA و عمر ۱۰ دقیقه. refresh token با هر استفاده عوض می‌شود و استفاده‌ی دوباره از توکن قدیمی، کل خانواده‌ی نشست را باطل می‌کند |
| حساب | تغییر رمز همه‌ی نشست‌ها را می‌بندد. «خروج از همه‌ی دستگاه‌ها» هم وجود دارد |
| دعوت | کد یک‌بارمصرف با اعتبار ۷ روز. فقط hash آن ذخیره می‌شود. برای هر کاربر ۱۰ تلاش در ساعت |
| دسترسی | نقش‌ها روی سرور اعمال می‌شوند. غیرعضو پاسخ 404 می‌گیرد |
| دستگاه | رمز با HMAC و pepper ذخیره می‌شود. Client ID به نام کاربری گره خورده است. دستورها whitelist می‌شوند |
| انتقال | TLS برای API (Caddy با HSTS) و MQTT (8883، نسخه‌ی TLS 1.2 به بالا). توکن WebSocket در subprotocol می‌رود و در URL نیست |
| زیرساخت | ایمیج scratch، کاربر non-root، کانتینر read-only، `cap_drop: ALL`، و audit log برای همه‌ی عملیات حساس |
| اپ | توکن در Keychain/Keystore ذخیره می‌شود |

## API

| متد | مسیر | نقش لازم |
|---|---|---|
| POST | `/v1/auth/register` · `login` · `refresh` · `logout` | — |
| GET | `/v1/me` | کاربر |
| POST | `/v1/me/password` · `/v1/me/logout-all` | کاربر |
| GET/POST | `/v1/sites` | کاربر |
| POST | `/v1/invites/redeem` | کاربر |
| PATCH | `/v1/sites/{id}` | admin |
| DELETE | `/v1/sites/{id}` | owner |
| GET/POST | `/v1/sites/{id}/rooms` | guest / admin |
| PATCH/DELETE | `/v1/sites/{id}/rooms/{roomId}` | admin |
| GET | `/v1/sites/{id}/members` | guest |
| PATCH | `/v1/sites/{id}/members/{userId}` | admin |
| DELETE | `/v1/sites/{id}/members/{userId}` | admin، یا خود عضو |
| GET/POST/DELETE | `/v1/sites/{id}/invites[/{inviteId}]` | admin |
| GET/POST | `/v1/sites/{id}/devices` | guest / admin |
| PATCH/DELETE | `/v1/sites/{id}/devices/{deviceId}` | admin |
| POST | `…/devices/{deviceId}/commands` | member |
| POST | `…/devices/{deviceId}/credentials` | admin |
| GET | `…/devices/{deviceId}/track?range=24h` | guest |
| GET | `…/devices/{deviceId}/history?key=power&range=24h` | guest |
| GET | `/v1/ws` (WebSocket) | کاربر |

## قدم‌های بعدی

- فرم‌ور مرجع ESP32 با TLS و provisioning از طریق BLE
- اتوماسیون سمت سرور (قوانین «اگر… آنگاه…» و زمان‌بندی)
- Push notification (FCM/APNs)
- آداپتورهای Matter، Z-Wave و Modbus
- ورود دومرحله‌ای و Passkey
- مانیتورینگ (Prometheus/Grafana) و CI
