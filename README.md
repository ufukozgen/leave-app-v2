# Leave App v2

Terralab çalışanları için izin yönetim sistemi. Çalışanlar izin talebinde bulunabilir; yöneticiler onaylayabilir, reddedebilir veya bakiye düşümü yapabilir; adminler tüm sistemi yönetebilir.

## Teknoloji

- **Frontend:** React 19 + Vite → Vercel
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Kimlik doğrulama:** Azure OAuth (Microsoft SSO)
- **E-posta / OOO:** Microsoft Graph API

## Geliştirme

```bash
npm run dev        # Geliştirme sunucusu (localhost:5173)
npm run build      # Production build
npm run lint       # ESLint kontrolü
npm run preview    # Production build önizleme
```

Edge function deploy:
```bash
supabase functions deploy <function-name>
```

Test altyapısı yoktur; doğrulama canlı Supabase projesi üzerinde elle yapılır.

## Roller

| Rol | Yetkiler |
|---|---|
| `user` | Kendi izin talebini oluşturabilir ve iptal edebilir |
| `manager` | Ekibinin taleplerini onaylayabilir, reddedebilir, bakiye düşümü yapabilir |
| `admin` | Tüm işlemler + rol/yönetici atama, bakiye yedekleme, toplu izin işleme |

## İzin Durumları

`Pending` → `Approved` → `Deducted` (veya `Rejected` / `Cancelled`)

## Öne Çıkan Özellikler

- Yarım gün izin desteği (sabah / öğleden sonra)
- Resmi tatil farkındalıklı gün hesaplama
- Out-of-Office otomatik aktivasyonu (onay ile)
- Aylık bakiye yedekleme (GitHub Actions + manuel tetikleme)
- Aylık kullanım raporu (per-diem mutabakatı için)
- Toplu şirket izni işleme
- Çalışan arşivleme

## Ortam Değişkenleri

Gerekli secretlar Supabase Dashboard → Settings → Edge Functions bölümünde tanımlanır. Supabase auth ayarları için Azure AD uygulama kaydı, e-posta ve OOO işlevleri için Microsoft Graph uygulama izinleri gerekmektedir.

## Sürüm Geçmişi

Uygulama içi sürüm notları `src/version.js` dosyasında tutulmaktadır. Her sürüm için otomatik olarak GitHub etiketi (tag) oluşturulur.
