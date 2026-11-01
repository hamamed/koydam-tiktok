<p align="center"><img src="web/public/logo-sm.png" width="200" alt="تحدي المليون"></p>

<h1 align="center">تحدي المليون · koydam-tiktok</h1>
<p align="center">منافسة هدايا مباشرة على تيك توك: الدول، الأندية أو القبائل تتنافس للوصول إلى مليون نقطة.<br>
صفحة مباشرة للجمهور، واجهة OBS شفافة، ولوحة تحكم عربية كاملة.</p>

---

## ✨ المميزات
- **صفحة مباشرة للجمهور** `/`: الترتيب، هدف المليون، أحدث الهدايا وأكبر الداعمين. تتحدث لحظياً وتعمل على الهاتف.
- **واجهة OBS** `/overlay/`: بطاقات زجاجية تتحرك بسلاسة عند تغيّر الترتيب، تنبيهات الهدايا، شريط إخباري واحتفال عند تغيّر المتصدر.
- **لوحة تحكم عربية** `/admin/`:
  - نظرة عامة، الاتصال بالبث، الفرق والهدف، الهدايا والنقاط، المظهر (مع معاينة حية)، الأدوات.
  - الخادم والحساب، محرر الملفات، السجلات، والتحديث من GitHub بضغطة.
- **11 شكلاً جاهزاً** (الذهبي، نيون، الملعب، الصحراء، ليالي رمضان، الأبيض الزجاجي، اللهب، الزمرد، البنفسجي الملكي، المحيط، ريترو):
  - اختر شكلاً ثابتاً أو بدّل تلقائياً **كل يوم أو كل أسبوع**.
- **صور خاصة:**
  - ارفع صورة لكل دولة أو نادٍ أو قبيلة بدل الإيموجي (دائرة، مربع أو حواف دائرية).
  - صورة خلفية للصفحة المباشرة و/أو OBS مع التعتيم والضبابية.
- **17 خطاً عربياً مضمّناً:** القاهرة، تجوال، المراعي، شنقا، المسيري، ريم كوفي، لاله‌زار، أميري، عارف رقعة…
  - خط أساسي للنصوص وخط آخر للعناوين وأسماء الفرق، مع معاينة لكل خط.
- **صور هدايا تيك توك الحقيقية:**
  - تظهر في التنبيهات والشريط والصفحة المباشرة وعلى بطاقة كل فريق.
  - تُجلب القائمة من بثك أو من أي حساب يبث الآن، وتُحفظ الصور على الخادم.
  - اختيار هدايا كل فريق من شبكة صور.
- **هدية لكل دولة:**
  - من يرسل هدية الدولة تُحسب نقاطه لها تلقائياً.
  - دليل «العلم = الهدية» في OBS، وتوزيع تلقائي لهدايا مختلفة مع تنبيه عند التكرار.
  - وضع «هدية الدولة فقط».
- **الجولات والعداد:** جولة بعدّاد تنازلي، شاشة الفائز مع أكبر 3 داعمين، سجل الجولات، وتصفير وبدء تلقائي.
- **المتابعون والمشاركات:** تنبيه لكل متابع جديد، ونقاط لفريقه، وشريط هدف المتابعين، ونقاط المشاركة (بحد لكل مشاهد).
- **القراءة الصوتية بالعربية:** تُقرأ الهدايا الكبيرة والمتصدر والفائز بأصوات عصبية (سعودي، مغربي، جزائري، تونسي، مصري…).
  - تُسمع في OBS، ويمكن كتابة إعلان يُقرأ في البث.
- **تقارير البث:** نقاط، ماسات، هدايا، فرق، أكبر الداعمين، متابعون، أعلى مشاهدين، رسم بياني وجولات، مع تنزيل CSV للإكسل.
- **واجهة عمودية 1080×1920** لـ TikTok LIVE Studio: `/overlay-vertical/` مع ضبط المسافات بعيداً عن أزرار تيك توك.
- **حجم الأسماء:** للجميع، أو لكل فريق على حدة للأسماء الطويلة.
- **احتساب ذكي:**
  - هدية مخصصة لفريق، أو المشاهد ينضم لفريق بكتابة اسمه أو علمه في الشات (🇲🇦، maroc، المغرب…).
  - هدايا الكومبو تُحسب لحظة بلحظة.
- **آمن:**
  - تسجيل دخول بالبريد وكلمة مرور مشفرة، وحماية من المواقع الأخرى.
  - المنفذ الداخلي على localhost فقط، ولا يلمس مواقعك الأخرى.

## 🚀 التثبيت على VPS (أمر واحد)
1. أضف سجل DNS من نوع **A**: `tiktok` ← عنوان IP للخادم.
2. على الخادم (Ubuntu/Debian أو Alma/Rocky) نفّذ:
```bash
curl -fsSL https://raw.githubusercontent.com/hamamed/koydam-tiktok/main/deploy/install.sh | sudo DOMAIN=tiktok.koydam.com EMAIL=admin@koydam.com ADMIN_EMAIL=admin@koydam.com bash
```

يقوم المثبّت بما يلي:
- يثبت Node.js وgit،
- ينزل المشروع إلى `/opt/koydam-tiktok` ويبني الموقع،
- ينشئ خدمة systemd،
- يختار منفذاً داخلياً حراً،
- يضيف موقعاً واحداً جديداً في nginx/Apache مع شهادة HTTPS.

في النهاية يطبع **البريد وكلمة المرور** للدخول.

> عند وجود لوحة استضافة (Plesk، cPanel، aaPanel…) يطبع المثبّت إعدادات «Reverse Proxy» لتضيفها بنفسك.

## 🔄 التحديث
- **من اللوحة:** صفحة **التحديثات** ← «تحديث الآن». تنزّل آخر نسخة وتبني الموقع ثم تعيد تشغيل الخادم.
- **من الطرفية:**
```bash
sudo bash /opt/koydam-tiktok/deploy/update.sh
```

الإعدادات والنتائج وكلمة المرور محفوظة في `data/` ولا يمسّها التحديث.

## 🎥 OBS
أضف **Browser Source** بالإعدادات التالية:
- الرابط: `https://tiktok.koydam.com/overlay/`
- المقاس: **1920×1080**
- اترك Custom CSS فارغاً.

## 🛠️ أوامر مفيدة
| المهمة | الأمر |
|---|---|
| السجلات المباشرة | `journalctl -u koydam-tiktok -f` |
| إعادة التشغيل | `systemctl restart koydam-tiktok` |
| نسيت كلمة المرور | `sudo bash /opt/koydam-tiktok/deploy/reset-password.sh` |
| المنفذ الداخلي | `grep PORT= /etc/systemd/system/koydam-tiktok.service` |

---

## English

**Million Challenge** is a real-time TikTok LIVE gift battle. Teams (countries, clubs, tribes) race to 1,000,000 points.

| Path | What |
|---|---|
| `/` | Public live page (mobile friendly) |
| `/overlay/` | Transparent OBS browser source, 1920×1080 |
| `/overlay-vertical/` | Vertical overlay for TikTok LIVE Studio, 1080×1920 |
| `/admin/` | Arabic admin dashboard (email + password login) |

**Install:** run the one-liner above on the VPS. It is safe to re-run.
- **Ports:** the app binds to `127.0.0.1` on a free port (3077–3199). The installer only *adds* a site for the domain, and existing sites are untouched.
- **Update:** use the panel's *Updates* page, or `sudo bash /opt/koydam-tiktok/deploy/update.sh` (git pull, npm ci, build, restart). `data/` is never touched.

### Develop locally
```bash
npm ci
```
```bash
npm run build && npm run demo
```
Then open http://localhost:8080/admin/. The first-run password is printed in the terminal and saved to `data/initial-admin-password.txt`.

### Stack
- **Backend:** `server/index.js`, Node.js ≥ 20.
  - TikTok connection via `tiktok-live-connector`, live updates via `ws`.
  - Scoring engine and REST API, which also serves the built site.
- **Frontend:** `web/`, Next.js 16 + React 19 (static export to `web/out`).
  - RTL Arabic, Cairo font bundled.
  - A shared WebSocket store, used by the live page, the overlay and the admin dashboard.

### Project layout
```
server/index.js          backend (scoring, TikTok, REST, WebSocket, static files)
web/app/                 pages: / (live), /overlay, /admin
web/components/          Board, Effects (toasts/ticker/banner), Overlay, admin/*
web/lib/                 store (WebSocket), api, format, presets, confetti
web/styles/              base, board, overlay, live, admin
deploy/                  install.sh, update.sh, reset-password.sh
data/                    runtime data: config, scores, login (git-ignored)
```
