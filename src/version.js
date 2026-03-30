// src/version.js

export const RELEASES = [
  {
  version: "v2.4.2",
  date: "2026-03-30",
  notes: [
    "🏢 Admin paneline toplu izin işleme sekmesi eklendi",
    "👥 Seçili çalışanlara toplu tam gün / yarım gün izin düşümü yapılabiliyor",
    "🔍 Toplu işlem öncesi ön izleme ekranı eklendi (çakışma, bakiye, pasif kullanıcı kontrolü)",
    "⚖️ Yetersiz bakiye durumunda admin artık düş veya atla kararı verebiliyor",
    "🧮 bulk-company-leave Edge Function eklendi ve calcLeaveDays ile uyumlu hale getirildi",
    "🔐 Toplu işlem akışında admin auth + service-role DB erişimi ayrıştırıldı",
    "↩️ Manager/Employee konsolunda reverse işlemini engelleyen callEdgeFunction hatası giderildi"
  ],
},
  
  {
  version: "v2.4.1",
  date: "2026-03-03",
  notes: [
    "🌓 Yarım gün izin düşüm hatası düzeltildi (half-am / half-pm artık 0.5 gün düşülür)",
    "📆 İzin düşümü artık duration_type bilgisiyle yeniden hesaplanıyor",
    "🏛️ Sonradan eklenen resmi tatiller yarım gün izinlerle doğru çakıştırılıyor",
    "🛠️ calcLeaveDays fonksiyonu half-am / half-pm desteği ile güncellendi"
  ],
},
  
  {
  version: "v2.4.0",
  date: "2026-01-30",
  notes: [
    "🗓️ Admin paneline 'Run Backup Now' (manuel bakiye yedeği) butonu eklendi",
    "⚙️ dispatch-backup-workflow Edge Function eklendi (GitHub Actions workflow_dispatch tetikleme)",
    "🔐 Manuel tetikleme Supabase JWT + admin yetkisi ile server-side doğrulanıyor",
    "♻️ Mevcut aylık scheduled backup akışı aynen korunuyor (cron değişmedi)",
  ],
},

  
  {
  version: "v2.3.0",
  date: "2026-01-05",
  notes: [
    "👤 Çalışan arşivleme özelliği eklendi (is_active, archived_at, archived_reason)",
    "🗂️ Arşivlenen kullanıcılar aktif listelerden otomatik gizleniyor",
    "🛡️ Arşivli kullanıcılar artık sistemde hiçbir işlem yapamaz (server-side koruma)",
    "🚫 create / approve / reject / cancel / deduct / reverse işlemleri için Edge Function guard’ları eklendi",
    "📜 Arşivleme işlemleri loglanıyor, geçmiş izin ve bakiye kayıtları korunuyor",
  ],
},
{
  version: "v2.2.7",
  date: "2025-12-30",
  notes: [
    "Resmi tatil / yarım gün güncellemeleri izin düşümlerinde doğru şekilde hesaplanıyor.",
    "İzin düşümü ve geri alma işlemlerinde bakiye artık doğru gün sayısı üzerinden güncelleniyor."
  ],
},
{
  version: "v2.2.6",
  date: "2025-12-18",
  notes: [
  "👥 Yönetici ekranında ekip listesi sorunu giderildi",
  "🛡️ Yetkilendirme kuralları iyileştirildi",
  "🐞 Küçük ama kritik hata düzeltmeleri"
],
},

  
  {
  version: "v2.2.5",
  date: "2025-09-08",
  notes: [
    "📊 AdminBackups artık Onaylanan (henüz düşülmemiş) izinleri de gösteriyor",
    "📥 leave_balance_backups tablosuna approvals ve balances kolonları eklendi",
    "📦 backup-leave-balances fonksiyonu snapshot sırasında onaylı günleri de yedekliyor",
    "🛠️ Yeni view: v_leave_backups_with_approvals (UI'nın kullandığı kaynak)",
    "📤 CSV/JSON dışa aktarma, her kullanıcı için bakiye + onaylı günleri içeriyor"
  ],
},

  {
  version: "v2.2.4",
  date: "2025-09-05",
  notes: [
    "📂 Sürüm geçmişi kutusu artık iç içe açılır kapanır (accordion) yapı destekliyor",
    "👁️‍🗨️ Yalnızca bir sürüm detayı açık kalır, varsayılan olarak son sürüm gösterilir",
    "🎞️ Yumuşak geçiş animasyonları eklendi (framer-motion)"
  ],
},

{
  version: "v2.2.3",
  date: "2025-09-05",
  notes: [
    "🗄️ Admin: Leave balance yedekleme sekmesi eklendi (AdminBackups)",
    "📆 Aylık snapshot listesi, kişi arama ve filtreleme desteği",
    "↕️ Tablo sıralama: kullanıcı adı ve tarih",
    "📤 CSV/JSON dışa aktarma (UTF-8, Türkçe karakter uyumlu)",
    "🔍 Satır detayı görüntüleme ve tekil dışa aktarma seçenekleri",
    "📋 Backup log'ları listeleniyor (başarı/hata ve satır sayısı)",
    "🛠️ Edge Function yedekleme script'i yeni tablo şemasına uyarlandı (snapshot_date + snapshot_ts)",
  ],
},


  {
    version: "v2.2.2",
    date: "2025-09-02",
    notes: [
      "🧠 OOO yeniden hesaplanıyor: tüm izinler taranarak birleşik pencere planlanıyor",
      "❌ cancel-leave: e-posta bildirimleri, takvim silme ve bakiye iadesi geri geldi",
      "↩️ reverse-leave: durum geri alınırken takvim ve bakiye güncelleniyor, OOO kontrolü yapılıyor",
      "🚫 reject-leave: e-posta ve log düzeltildi, OOO güncelleniyor",
      "📧 Tüm e-postalar Microsoft Graph ile gönderiliyor",
      "🧩 Yardımcı dosyalar (helpers) artık fonksiyonlarla birlikte deploy ediliyor",
    ],
  },


  {
  version: "v2.2.1",
  date: "2025-08-29",
  notes: [
    "✍️ Out-of-Office (OOO) mesajı artık özelleştirilebilir",
    "📧 Varsayılan TR+EN mesajı formda placeholder olarak görüntülenir; kullanıcı isterse tamamen değiştirebilir",
    "🔄 Boş bırakılırsa sistem güvenli TR+EN varsayılan mesajını uygular",
    "🗄️ create-leave ve approve-leave fonksiyonları ooo_custom_message alanını destekleyecek şekilde güncellendi"
  ],
},

  
  {
  version: "v2.2.0",
  date: "2025-08-28",
  notes: [
    "📧 İzin onayıyla otomatik Out-of-Office (OOO) yanıtları eklenmiştir (Türkçe + İngilizce standart mesaj)",
    "☑️ Kullanıcılar izin talebi formunda OOO yanıtını etkinleştirmeyi seçebilir (opt-in)",
    "🔄 Onaylanan izinlerde OOO otomatik başlatılır ve dönüş tarihinde kendiliğinden kapanır",
    "❌ Kullanıcı tarafından iptal edilen veya yönetici tarafından geri alınan izinlerde OOO otomatik devre dışı bırakılır",
    "👨‍💼 Reverse-leave mantığı güncellendi: Approved → Pending dönüşlerinde OOO kapatılır; Deducted → Approved dönüşlerinde OOO korunur",
    "🛡️ Microsoft Graph entegrasyonu için güvenli uygulama izinleri (MailboxSettings.ReadWrite) ve token yönetimi eklendi",
    "📜 Loglara enable_ooo bilgisi ve OOO aksiyonları kaydedilmektedir"
  ],
},

  
  {
  version: "v2.1.0",
  date: "2025-07-21",
  notes: [
    "🔔 Tüm uygulama genelinde anlık toast bildirimleri eklendi (başarı/hata durumları için)",
    "✅ İzin talebi, onay, reddetme, iptal, düşme ve geri alma işlemleri artık pop-up ile anında bildiriliyor",
    "👨‍💼 Admin ve yönetici işlemleri (bakiye güncelleme, yönetici/rol atama, tatil ekleme-silme vb.) için bildirim desteği",
    "🖥️ Kullanıcı deneyimi ve işlem geri bildirimi önemli ölçüde geliştirildi",
    "🐞 AdminPanel'de yanlışlıkla 'Yıllık izin tipi tanımlı değil' hatasının yüklenme sırasında görünmesi engellendi (doğru loading göstergesi gösteriliyor)"
  ],
},
  

  
  {
  version: "v2.0.4",
  date: "2025-07-18",
  notes: [
    "👥 Admin'ler Çalışan Takip Konsolu'nda tüm kullanıcıları görebiliyor; yöneticiler yalnızca kendi ekibini görebiliyor",
    "🔡 Çalışan listesi ad soyada göre alfabetik sıralanıyor (Türkçe uyumlu)",
    "🟠 Onay/Reddet işlemleri yalnızca ilgili yöneticiler tarafından yapılabilir; adminler sadece görüntüleyebilir",
    "🆕 İzin bakiyesi yedekleme Edge Function'ı eklendi (otomatik yedekleme, kurtarma ve denetim için)",
    "⚙️ Yetkilendirme/props ile daha güvenli ve okunabilir kod",
    "🐞 Küçük UI ve erişilebilirlik iyileştirmeleri"
  ],
},

{
    version: "v2.0.3",
    date: "2025-07-14",
    notes: [
      "🆕 AdminPanel'de 'Baş Harfler' (İlk.) sütunu eklendi ve satır içi düzenleme desteği (ilk iki harf büyük, üçüncü harf küçük/büyük, benzersizlik kontrolü, Türkçe karakter desteği)",
      "👤 Kullanıcı adı ve baş harfler aynı hücrede gösteriliyor; tablo daha kompakt ve kaydırmasız",
      "💾 İşlem butonları ikonlara dönüştürüldü (Kaydet ✔, Yenile 🔄)",
      "🛡️ Tüm Edge Function'larda local/prod CORS kontrolü güncellendi",
      "📅 Takvim etkinliklerinde baş harfler artık kullanıcı tablosundan alınıyor (e-posta çözümlemesi yerine)",
      "🔄 reverse-leave Edge Function'da CORS sorunu giderildi",
      "🐞 Diğer küçük hata düzeltmeleri ve arayüz iyileştirmeleri"
    ],
  },
  
  {
    version: "v2.0.2",
    date: "2025-07-11",
    notes: [
      "🌍 Edge Function'larda local/prod CORS desteği ve güvenli JWT doğrulama",
      "📅 Tüm tarih alanları Türkçe (gg/aa/yyyy) formatına güncellendi",
      "🟡🟢 Yönetici sekmesinde ayrı rozetlerle bekleyen/onaylanan gösterimi",
      "🎨 Daha temiz ve erişilebilir sürüm geçmişi kutusu (Güncel Sürüm + açılır geçmiş)",
      "🐞 Küçük hata düzeltmeleri ve kod iyileştirmeleri"
    ],
  },
  {
    version: "v2.0.1",
    date: "2025-07-10",
    notes: [
      "🔤 Kullanıcılar e-posta ile alfabetik sıralanıyor",
      "📅 Yönetici paneline Talep Tarihi eklendi",
      "⬇️ Tablo sıralama özelliği eklendi",
      "📌 Sürüm notları eklendi (bu kutu!)",
      "🛠️ Küçük iyileştirmeler ve hata düzeltmeleri"
    ],
  },
  {
    version: "v2.0.0",
    date: "2025-07-01",
    notes: [
      "🎉 İlk yayın (Leave App v2)",
      "Temel izin talep, onay, takip ve yönetim özellikleri"
    ],
  },
];
