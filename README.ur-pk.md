<p align="center">
  <img src="assets/aino-banner.svg" alt="Aino" width="100%">
</p>

# Aino

Aino گفتگو، مقامی منصوبوں اور متعدد ایجنٹس کے تعاون کے لیے ایک AI ورک اسپیس ہے۔ اس کا ڈیسک ٹاپ انٹرفیس ماڈلز، ٹولز، اسکلز اور کام کی تفویض کے لیے موجودہ Hermes Agent رن ٹائم استعمال کرتا ہے۔

[ویب سائٹ](https://petoi.cn/) · [Aino ڈاؤن لوڈ کریں](https://petoi.cn/download.html) · [ابتدائی رہنمائی](https://petoi.cn/guide.html) · [ریلیزز](https://github.com/OneWhitepaper/Aino/releases) · [مسئلہ رپورٹ کریں](https://github.com/OneWhitepaper/Aino/issues)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md)

## انسٹالیشن

1. [Aino کے ڈاؤن لوڈ صفحے](https://petoi.cn/download.html) پر جائیں۔
2. اپنے آپریٹنگ سسٹم اور پروسیسر کے مطابق دستیاب پیکیج منتخب کریں، پھر اسی ریلیز کی ہدایات پڑھیں۔
3. Aino کھولیں، اپنے ورژن میں موجود لاگ ان یا ماڈل کی ترتیب مکمل کریں اور گفتگو شروع کریں۔

دستیاب پیکیجز کے لیے ڈاؤن لوڈ صفحہ مستند ذریعہ ہے۔ اصل Hermes منصوبے کا انسٹالر Aino کی تقسیم انسٹال نہیں کرتا۔

## استعمال

براہ راست گفتگو کریں یا مقامی منصوبے کا فولڈر کھولیں یا بنائیں؛ خالی فولڈر بھی درست منصوبہ ہے۔ ماڈلز کی دستیابی، سیاق کی حد اور قیمت آپ کے اکاؤنٹ یا منتخب فراہم کنندہ پر منحصر ہیں۔ ٹولز، اسکلز، پلگ انز، شیڈول کردہ کام، ریموٹ کنکشن اور ذیلی ایجنٹس موجودہ رن ٹائم کے ذریعے کام کرتے ہیں۔

[ابتدائی رہنمائی](https://petoi.cn/guide.html) اور [اکاؤنٹ، ماڈلز اور والیٹ کی رہنمائی](docs/aino-platform-user-guide.md) (چینی زبان میں) دیکھیں۔

## اپ ڈیٹس اور مدد

Settings → About میں نصب شدہ ورژن اور اپ ڈیٹس دیکھیں۔ [شائع شدہ ریلیزز](https://github.com/OneWhitepaper/Aino/releases) اور [main برانچ](https://github.com/OneWhitepaper/Aino/tree/main) مختلف ہو سکتے ہیں؛ ہر کوڈ تبدیلی فوری نیا انسٹالر نہیں ہوتی۔

پروڈکٹ کے مسائل [Aino Issues](https://github.com/OneWhitepaper/Aino/issues) میں ورژن، سسٹم اور مسئلہ دہرانے کے مراحل کے ساتھ رپورٹ کریں۔ Nous کو تشخیصی معلومات بھیجنے کا موجودہ اختیار ایک الگ بیرونی سروس ہے اور واضح اجازت طلب کرتا ہے۔ Nous کے نجی بنڈل کا لنک Aino کے منتظمین کو خود بخود رسائی نہیں دیتا۔

## ترقی اور شراکت

[یہ ریپوزٹری](https://github.com/OneWhitepaper/Aino) کلون کریں اور [CONTRIBUTING.md](CONTRIBUTING.md) اور [ڈیسک ٹاپ بلڈ گائیڈ](apps/desktop/BUILDING.md) کی ہدایات استعمال کریں۔ ترقیاتی ماحول فعال کرنے سے پہلے الگ `HERMES_HOME` اور `HERMES_RUNTIME_DIR` منتخب کریں۔

مطابقت کے لیے `hermes` کمانڈ، اندرونی API اور ڈیٹا فارمیٹس برقرار ہیں۔ [برانڈ اور مطابقت کی حدود](docs/aino-brand-boundary.md) اور [رن ٹائم کی تکنیکی دستاویزات](website/docs/user-guide/configuration.md) دیکھیں۔

دوسرے ایجنٹس سے درآمد کے لیے پہلے `hermes plugins install agent-importers` چلائیں، پھر `hermes import-agent <source> --dry-run` سے پیش نظارہ دیکھیں۔ [درآمد کی رہنمائی](website/docs/user-guide/import-from-other-agents.md) ملاحظہ کریں۔

## اوپن سورس اور اعتراف

یہ GitHub ریپوزٹری عوامی رہے گی۔ Aino، Nous Research کے [Hermes Agent](https://github.com/NousResearch/hermes-agent) پر مبنی ہے۔ اصل حقوق اور لائسنس کے نوٹس [LICENSE](LICENSE) اور [NOTICE.md](NOTICE.md) میں محفوظ ہیں۔ بیرونی فراہم کنندگان اور اجزا کے حقیقی نام اور لائسنس برقرار ہیں۔
