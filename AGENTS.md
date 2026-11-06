# Instruksi Proyek Sistem SLA

## Baca sebelum bekerja

1. Baca `PROJECT_STATUS.md` untuk mengetahui posisi proyek dan tugas berikutnya.
2. Baca bagian terkait di `prd.md` sebelum mengubah alur bisnis atau data.
3. Setelah menyelesaikan satu pekerjaan yang bisa diverifikasi, perbarui `PROJECT_STATUS.md`.

## Sumber keputusan

- `prd.md` adalah sumber utama kebutuhan dan aturan bisnis.
- `PROJECT_STATUS.md` adalah catatan progres, pekerjaan berikutnya, dan keputusan yang masih terbuka.
- Jika instruksi terbaru dari pemilik proyek mengubah PRD, perbarui PRD dan catatan progres agar tetap selaras.
- Jangan mengarang aturan bisnis yang belum diputuskan. Pilih asumsi teknis yang aman, catat, dan minta keputusan hanya jika asumsi itu mengubah alur kerja pengguna.

## Stack yang dipilih

- `backend/`: Node.js, Express, TypeScript, REST API.
- `frontend/`: SvelteKit, TypeScript, shadcn-svelte, Tailwind CSS.
- Database: MySQL, diakses dari backend melalui connection pool `mysql2`. ORM belum dipilih; migrasi memakai SQL bernomor di `backend/src/db/migrations/` dan dijalankan dengan `npm.cmd run db:migrate`.
- Login memakai API SSO perusahaan; detail kontrak berada di bagian Stack aplikasi pada `prd.md`.
- API memakai prefix `/api/v1`.
- Frontend berkomunikasi dengan API. Frontend tidak mengakses database secara langsung.

## Aturan integrasi SSO

- Frontend hanya memanggil REST API Sistem SLA. Express menjadi satu-satunya service yang boleh memanggil SSO.
- Jangan menyimpan password, bearer token, atau data pribadi contoh di repository, log, screenshot, atau pesan error.
- Frontend mengirim bearer token melalui header `Authorization` pada request API yang perlu autentikasi.
- Saat logout, hapus token dari state autentikasi dan pastikan request berikutnya tidak mengirim header Authorization.
- Header adalah cara mengirim token, bukan penyimpanan permanen. Ikuti keputusan penyimpanan token yang tercatat di `PROJECT_STATUS.md`.
- Identitas SSO tidak otomatis memberikan hak akses. Peran, cakupan organisasi, dan status aktif berasal dari akun lokal Sistem SLA.
- Simpan profil SSO di `users` tanpa password atau token. Sinkronisasi profil tidak boleh otomatis mengaktifkan akun atau memberi role.
- Admin menetapkan role dan status akun, tetapi tidak memilih cakupan untuk role organisasi. Cakupan Pengguna Cabang mengikuti `kode_kantor` aktif dari SSO; cakupan Petugas Korwil mengikuti mapping kantor atau profil organisasi SSO; cakupan Petugas Divisi Pusat mengikuti `unit_kerja` yang cocok dengan nama divisi atau alias unit SSO pada master divisi. Cakupan diselaraskan saat profil tersinkron. Jika profil belum dapat dipetakan, tolak akses sampai datanya cocok; jangan memberi scope manual sebagai jalan pintas.
- Admin boleh mengubah nama divisi dan alias `unit_kerja` SSO melalui master divisi. Alias harus unik lintas divisi; perubahan tidak memberi role atau mengaktifkan akun. Profil pengguna mengikuti pemetaan terbaru pada sinkronisasi profil SSO berikutnya.
- Admin dapat memberi izin `can_manage_forms` pada assignment Petugas Divisi Pusat. Hak tersebut hanya berlaku untuk divisi aktif yang cocok dengan scope SSO; Admin global dapat mengelola semua form. Backend harus memeriksa izin ini pada setiap akses dan penerbitan form.
- Riwayat Korwil hanya memuat tiket yang pernah dirutekan ke Korwil dalam scope petugas tersebut. Riwayat Divisi Pusat hanya memuat tiket yang benar-benar pernah masuk ke divisi pada scope petugas tersebut. Backend memeriksa scope ini untuk daftar dan detail; tiket yang hanya memilih suatu divisi tetapi belum pernah diteruskan kepadanya tidak boleh terlihat oleh petugas divisi.
- Pengajuan Cabang dibatasi berdasarkan kantor, bukan pembuat personal. `created_by_user_id` tetap dipertahankan untuk jejak pembuat; jangan memindahkan kepemilikan tiket saat pegawai Cabang rotasi.
- Sumber hak akses runtime adalah assignment MySQL. `SLA_INITIAL_ADMIN_EMPLOYEE_ID` hanya untuk perintah bootstrap admin satu kali, bukan pemeriksaan akses pada endpoint.
- Jangan mengubah file migrasi yang sudah diterapkan. Buat file SQL bernomor baru untuk perubahan schema berikutnya.
- Tolak akses jika pegawai belum aktif atau belum diberi peran dan cakupan yang sesuai.
- Tetapkan path login (`/api/auth/login`) dan `whoami` (`/api/auth/whoami`) di backend sesuai kontrak API.
- Simpan base URL SSO, app code, dan timeout di `.env` backend. Gunakan `.env.example` sebagai template dan jangan commit `.env`.
- Pakai app code `simpeg` sementara sesuai arahan pemilik proyek. Nilai `SSO_APP_CODE` harus mudah diganti setelah app code khusus Sistem SLA terdaftar; jangan menanam base URL atau app code di kode aplikasi.
- Jangan simpan password pegawai atau bearer token di `.env`, repository, log, maupun pesan error. Password diberikan saat login dan token hanya diproses saat runtime.

Jangan mengganti stack ini ke Laravel, PHP, atau framework lain tanpa arahan pemilik proyek.

## Aturan bisnis yang harus dijaga

- Ada 28 Cabang dan 4 Korwil. Simpan kode kantor sebagai teks agar nol di depan tidak hilang.
- Mapping awal: 001-007 Semarang Raya, 008-014 Solo Raya, 015-021 Banyumas Raya, 022-028 Pekalongan Raya.
- Data sumber juga memuat kode kantor `000` bernama `Pusat`; ini kantor pusat, bukan Cabang ke-29. Master lokal awal bernama `master_kantor` dengan kolom `id`, `kode_kantor`, `nama_kantor`, `korwil`, dan `is_active`.
- Total Divisi Pusat ada 9: Penyelesaian Kredit, Pemasaran, Sekretaris Perusahaan, Operasional, Litbang, SKK, SKMR, SKAI, dan SDM. Katalog pekerjaan dapat ditambah Admin melalui master data.
- Pengajuan kredit di bawah Rp250 juta ditolak tanpa membuat tiket. Nilai Rp250 juta sampai di bawah Rp500 juta ditangani Korwil. Nilai mulai Rp500 juta diperiksa Korwil lalu diteruskan ke Pemasaran. Backend menentukan jalur dari nilai yang tersimpan dan form kredit wajib memakai field nilai sistem.
- Perubahan definisi form harus menerbitkan versi baru. Simpan ID versi dan snapshot jawaban pada tiket; jangan mengubah versi yang sudah dipakai tiket lama.
- Cabang memilih kewenangan. Jika memilih Pusat, Cabang juga memilih Divisi Pusat dan jenis pekerjaan yang tersedia untuk divisi tersebut.
- Pengajuan dengan tujuan Pusat selalu melewati Korwil terlebih dahulu.
- Kekurangan dokumen atau data dikirim langsung ke Cabang. Setelah dilengkapi, Cabang mengirim tiket yang sama kembali ke unit Pusat yang meminta.
- Jika petugas yang meminta masih aktif dan scope-nya masih cocok, pengiriman pelengkapan otomatis mengembalikan tiket kepadanya tanpa klaim ulang. Jika tidak, tiket kembali ke antrean unit; timer unit tetap mulai saat Cabang mengirim.
- Perubahan substansi yang memengaruhi kewenangan, tujuan, nilai, jenis pekerjaan, atau keputusan bisnis harus diperiksa Korwil lagi.
- Umur total tiket dimulai saat Cabang mengirim pengajuan pertama kali dan berakhir saat tiket selesai atau ditolak; selama tiket terbuka, hitung sampai waktu sekarang. Umur ini mencakup waktu antre dan revisi.
- Sesi Korwil pertama dimulai saat petugas mengambil tiket; waktu antre sebelum diambil dicatat terpisah dan tidak masuk waktu proses Korwil. Jika Korwil meminta kelengkapan, sesi Korwil berhenti. Saat Cabang mengirim pelengkapan, sesi Korwil baru dimulai saat itu dan akumulasinya berlanjut.
- Sesi Cabang untuk pelengkapan dimulai saat permintaan dokumen dikirim ke Cabang dan berhenti saat Cabang mengirim jawaban. Sesi Divisi Pusat awal masuk antrean saat Korwil meneruskan tiket, tetapi timer baru dimulai saat petugas Divisi mengambil; waktu antre sebelum diambil dicatat terpisah dan tidak masuk SLA Divisi. Jika Cabang mengirim pelengkapan kembali ke Divisi, sesi baru mengikuti handoff langsung dan dimulai saat pengiriman.
- Semua durasi memakai waktu kalender 24 jam. Setiap handoff menutup sesi aktif dan membuat sesi baru. Jangan menimpa sesi lama. Total waktu per unit adalah jumlah seluruh sesinya.
- `claimed_at` selalu mencatat waktu pengambilan. Awal timer dibedakan per jalur dan disimpan dalam `start_reason`; pengambilan tidak mengulang sesi yang sudah berjalan sejak tiket dikirim kembali.

## Cara mengerjakan

- Kerjakan satu milestone yang tercatat di `PROJECT_STATUS.md` pada satu waktu.
- Jaga perubahan tetap sesuai lingkup MVP dan PRD.
- Terapkan validasi, otorisasi, dan aturan workflow di backend. Menyembunyikan tombol di frontend bukan kontrol akses.
- Jangan menyimpan lampiran sebagai file publik. Terapkan pemeriksaan hak akses saat pengguna mengunduhnya.
- Jangan menandai pekerjaan selesai sebelum hasilnya ada dan bisa diperiksa.
- Catat keputusan baru dan perubahan progres di dokumen proyek, bukan hanya di percakapan.
