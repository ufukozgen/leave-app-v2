// src/version.js

export const RELEASES = [
  
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
