# Sistem SLA Pengajuan

Aplikasi internal untuk mencatat, meneruskan, dan memantau pengajuan Cabang melalui jalur kerja yang ditetapkan per pekerjaan.

## Status saat ini

Workflow Cabang -> Korwil -> Divisi Pusat atau Cabang -> Divisi Pusat langsung dapat dipilih per pekerjaan; autentikasi SSO, pembatasan akses berdasarkan assignment lokal, notifikasi, dashboard operasional, SLA default 7 hari, serta pemantauan Manajemen untuk semua status tiket sudah tersedia.

| Area | Kondisi |
|---|---|
| Backend | Express 5 + TypeScript, REST API, validasi akses server-side, dan health check tersedia |
| Frontend | SvelteKit + Svelte 5, dashboard, login, inbox, detail tiket, master data, tema, dan layout responsif tersedia |
| Database | MySQL dengan migrasi bernomor dan seed master kantor |
| Login | Express meneruskan login dan whoami ke API SSO; profil disimpan tanpa password atau token. Akun dummy tersedia hanya untuk pengembangan lokal |
| Workflow | Submit, claim, minta kelengkapan, jawab revisi, forward ke Pusat, selesai, tolak, timeline, dan riwayat tersedia |
| SLA | Umur total tiket, sesi Cabang/Korwil/Divisi, waktu tunggu, badge SLA, dan akumulasi waktu unit tersedia |
| Manajemen | Detail tiket baca-saja, filter Korwil/Divisi pada dashboard, serta daftar semua tiket dengan filter status dan organisasi tersedia |
| Form dinamis | Form kredit berbasis nominal dan form per katalog dapat diterbitkan sebagai versi baru; kelompok data opsional dapat diulang; jawaban tampil pada detail tiket |
| Tersedia | Nomor/tanggal surat InOffice dan upload PDF privat opsional (maksimal 10 MB) pada form pengajuan |

Catatan progres dan keputusan terbuka ada di PROJECT_STATUS.md. Kebutuhan bisnis lengkap ada di prd.md.

## Fitur utama

- Pengajuan Cabang terikat pada kantor, bukan pada pembuat personal.
- Setiap katalog pekerjaan Pusat dapat diatur Admin ke jalur Cabang → Korwil → Pusat atau Cabang → Pusat langsung.
- Korwil dan Divisi Pusat memiliki antrean aktif, claim, riwayat, detail, dan timeline sesuai scope.
- Revisi dikirim pada nomor tiket yang sama. Jika petugas peminta masih aktif dan scope-nya cocok, tiket kembali langsung kepadanya.
- Perubahan substansi yang memengaruhi kewenangan, tujuan, nilai, jenis pekerjaan, atau keputusan bisnis harus diperiksa Korwil lagi.
- Role Manajemen, Supervisor, dan Admin dapat membuka detail tiket global secara baca-saja tanpa tombol tindakan workflow.
- Dashboard global dapat difilter berdasarkan tanggal, Korwil, dan Divisi Pusat.
- Halaman /management/branch-follow-up menampilkan semua status tiket, lokasi penanganan terbaru, umur, SLA, filter status/Cabang/Korwil/Divisi, dan pagination.
- Notifikasi aplikasi mencatat event workflow, unread count, dan tindakan tandai sudah dibaca.
- Pengajuan kredit di bawah Rp250 juta ditolak. Untuk nilai yang memenuhi batas, Cabang dapat memakai form Pemasaran dengan tujuan Korwil atau Pusat; pilihan tujuan menentukan penanganan dan ambang form (default Rp500 juta) hanya menjadi panduan nilai.
- Admin global dapat menerbitkan semua form. Petugas Divisi hanya dapat menerbitkan form divisinya jika Admin mengaktifkan izin kelola form pada assignment.
- Setiap penerbitan membuat versi form baru; tiket mempertahankan jawaban dari versi saat diajukan.
- Pengelola form dapat membuat semua kolom tambahan menjadi satu kelompok berulang, dengan batas 2–20 kelompok per pengajuan.
- Admin memilih alur pada menu **Master pekerjaan**. Katalog lama memakai jalur melalui Korwil sampai Admin mengubah pengaturannya.

## Role dan cakupan akses

| Role | Cakupan utama | Akses utama |
|---|---|---|
| branch_user | Kantor Cabang dari profil SSO | Membuat, melihat, dan menjawab revisi pengajuan kantornya |
| korwil_staff | Korwil hasil pemetaan kantor/profil SSO | Melihat antrean/riwayat, claim, meminta kelengkapan, meneruskan, menyelesaikan, atau menolak sesuai tahap |
| korwil_approver | Korwil hasil pemetaan kantor/profil SSO | Persetujuan atau tindakan Korwil sesuai assignment dan tahap workflow |
| division_staff | Divisi Pusat hasil pemetaan unit_kerja SSO | Melihat antrean/riwayat divisinya; mengelola form jika diberi izin Admin |
| supervisor | Global | Dashboard dan detail baca-saja |
| management | Global | Dashboard, filter, pemantauan Cabang, dan detail baca-saja |
| admin | Global | Pengelolaan akun, role/status, master Divisi, katalog dan seluruh form pekerjaan, dashboard, dan detail baca-saja |

Identitas SSO saja tidak memberi akses. Akun harus aktif dan memiliki assignment role serta scope yang cocok di database lokal. Scope organisasi diselaraskan dari profil SSO; Admin tidak mengisi scope organisasi secara manual sebagai pengganti pemetaan.

## Alur bisnis

    Cabang membuat pengajuan
            |
            +-- katalog: Korwil lalu Pusat --> Antrean Korwil --> Antrean Divisi Pusat
            |
            +-- katalog: Pusat langsung ----> Antrean Divisi Pusat

    Kedua jalur berakhir pada Divisi Pusat; permintaan kelengkapan kembali ke Cabang
    dan jawaban Cabang dikirim ke unit yang meminta.

- Pengajuan kredit di bawah Rp250 juta ditolak tanpa membuat tiket.
- Dengan form Pengajuan Kredit, nilai minimal Rp250 juta dapat dikirim ke Korwil untuk ditangani sampai selesai.
- Jika Cabang memilih tujuan Pusat, tiket menuju Pemasaran langsung atau melalui Korwil sesuai routing katalog, terlepas dari ambang panduan form.
- Penolakan dan penyelesaian memerlukan alasan atau ringkasan hasil.
- Seluruh handoff, revisi, claim, dan keputusan tercatat dalam timeline.

## Aturan SLA

Semua durasi memakai waktu kalender 24 jam.

| Komponen | Awal perhitungan | Akhir perhitungan |
|---|---|---|
| Umur total tiket | Cabang mengirim pengajuan pertama | Selesai/ditolak; jika masih terbuka dihitung sampai sekarang |
| Sesi Cabang | Korwil atau Divisi meminta kelengkapan | Cabang mengirim jawaban |
| Sesi Korwil awal | Petugas Korwil menekan Ambil | Handoff, revisi, selesai, atau ditolak |
| Sesi Korwil setelah revisi | Cabang mengirim pelengkapan | Handoff atau keputusan Korwil |
| Sesi Divisi awal | Petugas Divisi menekan Ambil | Handoff, revisi, selesai, atau ditolak |
| Sesi Divisi setelah revisi | Cabang mengirim pelengkapan langsung ke Divisi | Keputusan Divisi atau handoff berikutnya |

Waktu antre sebelum claim dicatat terpisah dan tidak dihitung sebagai waktu proses Korwil atau Divisi pada sesi awal. Claim tidak mengulang timer yang sudah dimulai saat Cabang mengirim pelengkapan. Total waktu unit adalah jumlah semua sesi unit tersebut.

Target sementara seluruh katalog dan sesi adalah 7 hari kalender (10.080 menit). Badge SLA pada dashboard:

- Hijau: umur tiket kurang dari 3 hari.
- Kuning: umur tiket 3 sampai dengan 7 hari.
- Merah: umur tiket lebih dari 7 hari.

Badge ini adalah indikator pemantauan. Peringatan otomatis berdasarkan ambang SLA belum diaktifkan.

## Teknologi

- Backend: Node.js, Express 5, TypeScript, REST API.
- Frontend: SvelteKit 3, Svelte 5, TypeScript, Tailwind CSS 4, shadcn-svelte.
- Database: MySQL melalui connection pool mysql2.
- API: prefix /api/v1.
- ORM belum digunakan; schema dikelola dengan SQL migration bernomor.
- Node.js minimum: 22.17 atau lebih baru. Pengembangan lokal telah diuji pada Node.js 24.22.1.

## Menjalankan di Windows PowerShell

### Prasyarat

- Node.js 22.17 atau lebih baru.
- MySQL atau MariaDB aktif, misalnya melalui XAMPP.
- Akses jaringan ke SSO jika login SSO hendak diuji.

PowerShell pada komputer ini dapat memblokir npm karena execution policy. Gunakan npm.cmd.

### 1. Buat database

    CREATE DATABASE IF NOT EXISTS sla_pengajuan
      CHARACTER SET utf8mb4
      COLLATE utf8mb4_unicode_ci;

Sesuaikan kredensial MySQL pada backend/.env.

### 2. Konfigurasi backend

Dari folder project:

    if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }

Edit backend/.env. Konfigurasi penting:

    DB_HOST=127.0.0.1
    DB_PORT=3306
    DB_NAME=sla_pengajuan
    DB_USER=sla_app
    DB_PASSWORD=

    SSO_BASE_URL=https://apisso.bkkjateng.co.id
    SSO_APP_CODE=simpeg
    SSO_TIMEOUT_MS=10000
    SSO_CONNECT_IP=
    SLA_INITIAL_ADMIN_EMPLOYEE_ID=
DUMMY_AUTH_ENABLED=false

Untuk jaringan lokal yang memerlukan pin koneksi, isi SSO_CONNECT_IP=10.0.2.2. Hostname pada SSO_BASE_URL tetap dipakai untuk SNI dan validasi sertifikat TLS.

### 3. Migrasi, seed, dan bootstrap admin

    Set-Location backend
    npm.cmd install
    npm.cmd run db:upgrade

Perintah `db:upgrade` menerapkan migrasi yang belum berjalan lalu memasukkan seed kantor dasar (29 kantor: kode 001 sampai 028 untuk Cabang dan kode 000 untuk Pusat). Aman diulang pada database aplikasi yang sudah dibuat; tidak menghapus atau menyalin tiket, pengguna, assignment, maupun lampiran.

Untuk menyamakan database staging dengan data dummy lokal, jalankan `npm.cmd run db:export:dev-seed`, commit file fixture, lalu di aaPanel gunakan `npm run db:sync:dev` sesuai [panduan sinkronisasi staging](docs/DATABASE_STAGING.md). Jangan jalankan seed development di production.

Untuk mencoba seluruh role tanpa akun SSO, aktifkan `DUMMY_AUTH_ENABLED=true` di `backend/.env` dengan `NODE_ENV=development`, lalu jalankan:

    npm.cmd run db:seed-dummy-users

Restart backend. Halaman login akan menampilkan pilihan akun uji untuk role Admin, Pengguna Cabang, Petugas Korwil, Penyetuju Korwil, Petugas Divisi Pusat, Supervisor, dan Manajemen. Sembilan akun Petugas Divisi tersedia, satu per divisi; semuanya diberi izin kelola form pada divisinya untuk mencoba menu tersebut. Akun ini memakai data sintetis tanpa password; aksesnya tetap diperiksa melalui assignment lokal. Seed ditolak selain pada mode development, dan backend menolak konfigurasi dummy auth di production. Matikan kembali dengan `DUMMY_AUTH_ENABLED=false` jika pengujian selesai.

Isi SLA_INITIAL_ADMIN_EMPLOYEE_ID di backend/.env, kemudian jalankan sekali per database:

    npm.cmd run db:bootstrap-admin

Variabel tersebut hanya dipakai untuk bootstrap admin. Endpoint runtime membaca assignment dari database lokal.

### 4. Jalankan backend

    npm.cmd run dev

API berjalan di http://127.0.0.1:3000.

### 5. Jalankan frontend

Buka terminal PowerShell kedua dari folder project:

    Set-Location frontend
    if (-not (Test-Path .env)) { Copy-Item frontend/.env.example frontend/.env }
    npm.cmd install
    npm.cmd run dev

Buka http://localhost:5173 atau alamat yang ditampilkan Vite. frontend/.env memakai:

    VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1

### Pemeriksaan health

    Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
    Invoke-RestMethod http://127.0.0.1:3000/api/v1/health/database

Endpoint database health mengembalikan HTTP 503 jika MySQL belum tersedia atau konfigurasi database salah.

## Endpoint utama

Semua endpoint berikut berada di bawah http://127.0.0.1:3000/api/v1 dan endpoint terproteksi memerlukan header Authorization: Bearer <token>.

- POST /auth/login - login melalui SSO.
- GET /auth/whoami - membaca profil SSO dan akses lokal aktif.
- GET /dashboard - dashboard sesuai role, termasuk filter global Korwil dan Divisi.
- GET /dashboard/management-requests - daftar semua tiket untuk assignment global Manajemen, Supervisor, dan Admin; mendukung filter organisasi/status dan pagination.
- GET /dashboard/branch-follow-up - tiket yang menunggu tindak lanjut Cabang.
- GET /requests dan GET /requests/:id - daftar dan detail pengajuan sesuai scope.
- POST /requests/:id/revision - mengirim jawaban revisi pada tiket yang sama.
- GET /inbox/korwil dan GET /inbox/korwil/history - antrean/riwayat Korwil.
- GET /inbox/central dan GET /inbox/central/history - antrean/riwayat Divisi Pusat.
- POST /inbox/korwil/:id/claim dan POST /inbox/central/:id/claim - mengambil tiket.
- Endpoint tindakan inbox - minta kelengkapan, forward, complete, dan reject sesuai tahap.
- Endpoint Admin - pengelolaan akun, role/status, Divisi, alias unit SSO, dan katalog pekerjaan.

Route selalu memvalidasi identitas, status aktif, role, dan scope di backend. Menyembunyikan tombol di frontend bukan mekanisme keamanan.

## Pemeriksaan lokal

Backend:

    Set-Location backend
    npm.cmd run check
    npm.cmd run build
    npm.cmd run test:e2e:workflow
    npm.cmd run test:e2e:notifications
    npm.cmd run test:e2e:management

Frontend:

    Set-Location frontend
    npm.cmd run check
    npm.cmd run build

E2E memakai database lokal dan fixture sementara. Jalankan hanya pada database pengembangan yang dapat menerima data uji.

## Deployment aaPanel

Frontend production memakai `@sveltejs/adapter-node` dan dapat dijalankan sebagai project Node/PM2 di aaPanel. Panduan lengkap untuk setup server, database, environment, reverse proxy, SSL, backup, dan release tersedia di [docs/DEPLOY_AAPANEL.md](docs/DEPLOY_AAPANEL.md).

## Konfigurasi dan keamanan

- Jangan commit backend/.env, frontend/.env, password, bearer token, password pegawai, atau data pribadi.
- Express adalah satu-satunya service yang memanggil SSO. Frontend hanya memanggil REST API Sistem SLA.
- Token hanya dikirim melalui header Authorization dan disimpan sementara per-tab di sessionStorage; logout menghapus sesi lokal.
- Profil SSO disimpan di tabel users tanpa password atau token.
- Role dan scope runtime berasal dari assignment MySQL. Profil SSO yang belum dapat dipetakan ditolak aksesnya.
- kode_kantor disimpan sebagai teks agar nol di depan tetap terjaga.
- Lampiran surat InOffice berformat PDF, maksimal 10 MB, disimpan pada `PRIVATE_UPLOAD_DIR` di backend dan hanya dapat diunduh setelah pemeriksaan akses tiket.
- SSO_APP_CODE=simpeg adalah konfigurasi sementara dan harus mudah diganti setelah app code Sistem SLA resmi tersedia.

## Struktur folder

    backend/
      src/
        config/
        db/
          migrations/
          seeders/
        modules/
        routes/
        scripts/
    frontend/
      src/
        lib/
          api/
          components/
          features/
        routes/
    prd.md
    PROJECT_STATUS.md
    AGENTS.md

## Batasan MVP dan pekerjaan berikutnya

1. Pengelola Divisi menetapkan field wajib untuk form Keringanan bunga dan katalog pekerjaan lainnya.
2. Sahkan target SLA per jenis pekerjaan dan kebijakan notifikasi peringatan.
3. Tetapkan retensi, backup, dan pemulihan untuk storage privat surat InOffice sebelum produksi.
4. Selesaikan verifikasi visual/click-through lintas role, viewport, tema, dan browser.
5. Tinjau kontrak SSO, lifetime token, logging, backup, monitoring, dan kesiapan pilot.

## Dokumentasi proyek

- PRD dan aturan bisnis: prd.md
- Status, keputusan, dan milestone: PROJECT_STATUS.md
- Laporan QA visual/responsif: QA_VISUAL_RESPONSIVE_2026-11-04.md

Dokumen dan source code ini ditujukan untuk penggunaan internal Sistem SLA Pengajuan.
