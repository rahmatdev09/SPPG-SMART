# Landing page dan panel kontrol SPPG Smart

## Arsitektur

- Folder ini berisi landing page dan panel kontrol. Firebase-nya menyimpan akun pelanggan, status paket, serta informasi website dan Firebase milik setiap pelanggan.
- Aplikasi di luar folder ini adalah kode website yang digunakan pelanggan. Setiap pelanggan Premium memiliki Firebase project sendiri yang dibuat dan dikonfigurasi oleh administrator. Data operasional tersimpan di project milik pelanggan tersebut.
- Pelanggan masuk ke panel kontrol menggunakan Google. Setelah website disiapkan, aplikasi utama menggunakan konfigurasi Firebase pelanggan untuk autentikasi dan penyimpanan datanya.

## Pemisahan Firebase

Panel kontrol menggunakan project `sppg-smart` yang dikonfigurasi di `firebase.js`. Firestore project ini menyimpan akun pelanggan dan informasi koneksi tenant. Aplikasi utama di luar folder ini masih menggunakan konfigurasi pada `app.js` di root. Jangan gunakan koleksi `app_users` milik panel kontrol untuk menyimpan data operasional pelanggan.

Administrator membuat Firebase project terpisah untuk setiap pelanggan Premium, lalu mencatat project ID tenant dan URL website di akun panel kontrol. Saat ini aplikasi utama belum memilih konfigurasi Firebase berdasarkan pelanggan yang masuk. Integrasi tersebut masih diperlukan agar data setiap pelanggan benar-benar terpisah.

## Fitur yang sudah tersedia

- Pendaftaran pelanggan dengan Google dan pembuatan akun Gratis.
- Form pendaftaran meminta nama website dan subdomain berakhiran `.online`.
- Pengecekan dan penguncian nama domain agar pelanggan lain di layanan ini tidak memilih nama yang sama.
- Pengaturan paket pelanggan oleh Super Admin.
- Status website: belum Premium, sedang disiapkan, sedang dikonfigurasi, atau siap.
- Panel admin untuk mencatat Firebase project ID dan URL website pelanggan.
- Tombol **Konfigurasi Firebase** untuk menyimpan field Web App Firebase pelanggan.
- Bagian landing page yang menampilkan website pelanggan yang disetujui Super Admin.

Panel admin tidak membuat Firebase project secara otomatis. Aplikasi utama masih menggunakan satu konfigurasi Firebase dan belum memakai konfigurasi tenant pelanggan. Jangan tandai website sebagai siap sebelum integrasi tenant tersambung.

Pengecekan domain meminta status langsung dari RDAP registry `.online`, lalu memeriksa reservasi lokal di koleksi `domains` agar pelanggan SPPG Smart tidak memilih nama yang sama. Jika registry tidak merespons atau statusnya tidak jelas, formulir tidak menyatakan domain tersedia. Hasil cek bukan pembelian: domain tetap harus didaftarkan melalui registrar.

Bagian “SPPG yang sudah menggunakan website” hanya menampilkan akun Premium berstatus siap yang dipilih melalui kotak **Tampilkan di landing page** di panel admin. Data publik disimpan terpisah di `public_websites` dan hanya berisi nama website, domain, serta URL; koleksi akun dan email pelanggan tidak dibuka ke publik.

## Langkah setup yang diperlukan

1. Di project `sppg-smart`, aktifkan Google sebagai penyedia Authentication, buat Firestore, lalu tambahkan domain lokal dan produksi di **Authorized domains**.
2. Publikasikan file [`firestore.rules`](./firestore.rules) ke project `sppg-smart`.
3. Login dengan Google menggunakan `rahmatdev09@gmail.com`. Pada login pertama, akun tersebut otomatis dibuat sebagai Super Admin.
4. Untuk setiap pelanggan Premium, administrator membuat Firebase project, lalu mencatat project ID dan URL website yang sudah dipasang di akun pelanggan pada panel kontrol.
5. Ubah aplikasi utama agar dapat mengenali pelanggan yang masuk, memakai Firebase project tenant yang sesuai, serta menerapkan konfigurasi Authentication dan Firestore Rules khusus tenant tersebut.

Alamat `rahmatdev09@gmail.com` ditetapkan sebagai satu-satunya Super Admin di landing page. Pembatasan ada di Firestore Rules sekaligus pemeriksaan panel admin; pelanggan lain hanya dapat mendaftarkan role `customer`. Jangan mengubah email admin di frontend saja—jika alamatnya perlu diganti, ubah allowlist di `firebase.js` dan `firestore.rules` bersama-sama, lalu publikasikan rules kembali.

Konfigurasi Firebase untuk web memang dapat dilihat di browser. Jangan menyimpan kredensial service account di file browser. Pembuatan dan administrasi Firebase project memerlukan akses administrator tepercaya dan belum dilakukan otomatis oleh panel statis ini.
