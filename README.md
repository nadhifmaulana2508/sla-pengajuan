# Sistem SLA Pengajuan

Aplikasi internal untuk mencatat dan melacak pengajuan dari Cabang melalui Korwil hingga Divisi Pusat. Satu pengajuan memakai satu nomor, menyimpan histori perpindahan, dan menghitung waktu proses per unit.

## Status project

**Tahap saat ini: siklus dasar tiket Cabang → Korwil → Divisi Pusat dan notifikasi aplikasi untuk event workflow utama tersedia.** Halaman Akses Pegawai memakai satu request workspace saat reload. Detail tiket menyediakan tindakan minta kelengkapan, teruskan, selesai, dan tolak sesuai tahap. Cabang dapat mengirim jawaban pada tiket yang sama. Detail menampilkan umur total tiket dan akumulasi waktu per Cabang/Korwil/Divisi. Migrasi workflow `005`–`009` sudah diterapkan ke MySQL lokal. Verifikasi visual responsif dan click-through notifikasi lintas scope masih terbuka.

| Bagian | Status |
|---|---|
| Backend Express + TypeScript | Scaffold dan health endpoint tersedia |
| Frontend SvelteKit + TypeScript | Login, dashboard, akses pegawai, dan katalog pekerjaan memakai komponen shadcn-svelte; navbar aplikasi sticky, kontrol tema/logout berupa ikon berlabel, layout responsif |
| MySQL | Database lokal `sla_pengajuan` terhubung; `master_kantor` terisi 29 baris awal dan endpoint health database merespons connected |
| Login dan akses awal | Proxy SSO tersedia; profil disinkronkan ke MySQL; API Admin memvalidasi bearer; Admin menetapkan role/status, sementara scope Cabang, Korwil, dan Divisi mengikuti profil SSO |
| Master pekerjaan | CRUD katalog pekerjaan per divisi tersedia; target SLA boleh kosong sampai ditetapkan |
| Pengajuan Cabang → Korwil | Form umum, routing, daftar/detail, timer total, revisi pada nomor yang sama, dan timeline tersedia |
| Antrean Korwil | Antrean sesuai scope; Ambil, minta kelengkapan, teruskan, selesai, dan tolak tersedia |
| Antrean Divisi Pusat | Antrean sesuai divisi SSO; Ambil, minta kelengkapan, selesai, dan tolak tersedia |
| SLA | Umur total tiket, durasi tiap sesi/unit, akumulasi Cabang/Korwil/Divisi, dan waktu tunggu ditampilkan |
| Notifikasi | Lonceng desktop/mobile, event tiket, unread count, tandai dibaca; peringatan SLA menunggu target dan ambang disahkan |
| Field khusus dan lampiran | Jawaban revisi masih teks; field katalog dan lampiran privat belum tersedia |

Progres milestone dan keputusan yang masih terbuka dicatat lebih rinci di [PROJECT_STATUS.md](PROJECT_STATUS.md). Aturan kebutuhan lengkap ada di [prd.md](prd.md).

## Teknologi

- Backend: Node.js, Express 5, TypeScript, REST API.
- Frontend: SvelteKit 3, Svelte 5, TypeScript, Tailwind CSS 4, shadcn-svelte.
- Database: MySQL, diakses backend melalui `mysql2` connection pool.
- Prefix API: `/api/v1`.
- Node.js minimum mengikuti [kebutuhan SvelteKit 3](https://svelte.dev/docs/kit/migrating-to-sveltekit-3), yaitu 22.17 atau lebih baru. Scaffold ini diuji memakai Node.js 24.22.1.

ORM belum dipilih. Schema disimpan sebagai SQL di `backend/src/db/migrations/` dan dijalankan berurutan dengan `npm.cmd run db:migrate`. Seed awal `master_kantor` masih dijalankan satu kali dari `backend/src/db/seeders/001_seed_master_kantor.sql`. Perubahan schema berikutnya dibuat di migrasi bernomor baru; jangan mengubah migrasi yang sudah diterapkan.

Fondasi visual memakai preset Vega karena CLI mengidentifikasinya sebagai tampilan klasik shadcn, sesuai arahan pemilik proyek. Login dan dashboard memakai komponen shadcn-svelte seperti Button, Input, Label, Card, Badge, Separator, dan Alert. Login desktop dibatasi pada tinggi viewport; panel tetap dapat discroll bila konten atau zoom membutuhkan. Navbar aplikasi sticky; theme/logout menggunakan ikon dengan label aksesibel. Font Inter dipakai.

## Menjalankan di Windows PowerShell

Jalankan backend dan frontend di terminal terpisah. Pada environment PowerShell ini, `npm` terhalang execution policy, jadi gunakan `npm.cmd`. Di Command Prompt atau shell lain, perintah `npm` biasa dapat digunakan.

### 1. Siapkan MySQL

Pastikan layanan MySQL aktif. Buat database kosong, misalnya melalui phpMyAdmin atau MySQL client:

```sql
CREATE DATABASE IF NOT EXISTS sla_pengajuan
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Sesuaikan user dan password database di `backend/.env` dengan konfigurasi MySQL lokalmu.

Untuk membuat master kantor awal, pilih database `sla_pengajuan` lalu jalankan `backend/src/db/migrations/001_create_master_kantor.sql` dan `backend/src/db/seeders/001_seed_master_kantor.sql`. Seed aman dijalankan ulang: kode kantor yang sudah ada tidak ditimpa. Migrasi versi berikutnya dan bootstrap admin dijalankan pada langkah backend setelah dependency terpasang. Isi `SLA_INITIAL_ADMIN_EMPLOYEE_ID` di `.env` lokal sebelum bootstrap.

### 2. Jalankan backend

Dari folder utama project:

```powershell
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Edit `backend/.env`, terutama `DB_USER` dan `DB_PASSWORD`, lalu:

```powershell
Set-Location backend
npm.cmd install
npm.cmd run db:migrate
npm.cmd run db:bootstrap-admin
npm.cmd run dev
```

`db:bootstrap-admin` cukup dijalankan satu kali untuk tiap database. Perintah membaca `SLA_INITIAL_ADMIN_EMPLOYEE_ID` dari `.env` tanpa mencetak nilainya.

API berjalan di `http://127.0.0.1:3000`.

Tes endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health/database
```

Endpoint pertama memeriksa API. Endpoint kedua mengirim `SELECT 1` ke MySQL dan mengembalikan HTTP 503 jika database belum tersedia atau konfigurasinya salah.

### 3. Jalankan frontend

Buka terminal kedua dari folder utama:

```powershell
Set-Location frontend
npm.cmd install
npm.cmd run dev
```

Buka alamat yang ditampilkan Vite, biasanya `http://localhost:5173` atau `http://127.0.0.1:5173`. Pada mode development backend menerima kedua origin tersebut; production hanya menerima origin dari `FRONTEND_ORIGIN`. File `frontend/.env` memakai `VITE_API_BASE_URL` untuk koneksi ke API.

### Pemeriksaan lokal

Jalankan dari folder aplikasi masing-masing:

```powershell
npm.cmd run check
npm.cmd run build
```

## Konfigurasi dan keamanan

- Konfigurasi lokal disimpan di `backend/.env` dan `frontend/.env`; file `.env` tidak boleh masuk Git.
- Template aman untuk disalin adalah `.env.example`. Jangan menaruh password pegawai, bearer token, atau data pribadi di file contoh, source, log, maupun commit.
- Express akan menangani panggilan SSO. Path `/api/auth/login` dan `/api/auth/whoami` berada di backend sesuai kontrak SSO.
- `SSO_BASE_URL`, `SSO_APP_CODE`, dan `SSO_TIMEOUT_MS` disimpan di `backend/.env`. Untuk jaringan lokal yang membutuhkan pin IP, `SSO_CONNECT_IP=10.0.2.2` boleh diisi; hostname pada `SSO_BASE_URL` tetap dipakai agar SNI dan validasi sertifikat SSO tetap benar. App code `simpeg` hanya nilai sementara dan bisa diganti di sana setelah app khusus Sistem SLA terdaftar.
- `SLA_INITIAL_ADMIN_EMPLOYEE_ID` hanya dipakai oleh perintah satu kali `db:bootstrap-admin`. API tidak lagi memakai nilai ini untuk menentukan akses. Role admin disimpan sebagai assignment global di `user_role_scopes`.
- `master_kantor.kode_kantor` disimpan sebagai teks tiga karakter. Nilai `001`–`028` adalah Cabang, `000` adalah Pusat, dan kolom `korwil` menyimpan kelompok `semarang`, `solo`, `banyumas`, `pekalongan`, atau `pusat`.
- Frontend mengirim token melalui header `Authorization: Bearer <token>`. Token disimpan per tab di `sessionStorage` agar bertahan saat reload, dan logout menghapus sesi lokal. Mekanisme pencabutan token SSO belum tersedia dalam kontrak yang diberikan.
- Profil SSO disimpan di `users` tanpa password atau token. Kode `kode` dipetakan ke `master_kantor` jika cocok; `unit_kerja` dipetakan ke `master_divisi` setelah awalan `Divisi` dihapus. Akun baru berstatus nonaktif dan tidak mendapat role otomatis.
- Role dasar tersedia di `roles`; penugasan role dan cakupan global, kantor, Korwil, atau divisi disimpan di `user_role_scopes`. Admin mengelola akun lain melalui UI/API; akun admin yang sedang digunakan tidak dapat mengubah akses dirinya sendiri.
- Admin menetapkan role/status, bukan scope organisasi: role Cabang mengikuti kode kantor SSO, role Korwil mengikuti mapping kantor atau informasi organisasi SSO, dan role Divisi Pusat mengikuti `unit_kerja` yang cocok dengan master divisi. Scope diperbarui saat profil tersinkron; jika tidak dapat dipetakan, akses ditolak. Pengajuan terikat pada kantor, bukan pembuat, sehingga Kacab baru yang diberi role di kantor yang sama dapat melihat dan melanjutkan tiket lama; nama pembuat tetap tercatat.
- Identitas SSO saja tidak memberi hak akses. Hak aktif mensyaratkan akun lokal aktif dan assignment role/cakupan yang cocok.

## Alur bisnis

1. Cabang membuat pengajuan dan memilih kewenangannya. Jika tujuannya Pusat, Cabang memilih Divisi Pusat dan jenis pekerjaan dari katalog.
2. Semua pengajuan dikirim ke Korwil yang membawahi Cabang terlebih dahulu.
3. Korwil memproses pengajuan. Jika tujuan akhirnya Pusat, Korwil menyetujui dan meneruskannya ke Divisi Pusat yang dipilih Cabang.
4. Pengajuan kredit di bawah Rp500 juta ditangani Korwil. Pengajuan di atas Rp500 juta diperiksa Korwil lalu diteruskan ke Pemasaran. Nilai tepat Rp500 juta sementara masuk Korwil, menunggu pengesahan pemilik proses.
5. Umur tiket berjalan sejak Cabang mengirim sampai selesai/ditolak. Sesi Korwil awal dimulai saat diambil; sesi Divisi awal mulai saat petugas mengambil setelah tiket diteruskan; sesi Cabang mulai saat kelengkapan diminta.
6. Jika Korwil memproses 5 menit, meminta kelengkapan, lalu memproses 10 menit setelah Cabang mengirim, total waktu Korwil menjadi 15 menit. Waktu Cabang dan umur total tiket tampil terpisah.
7. Jika Korwil meminta dokumen/data, tiket yang sama kembali ke Korwil setelah Cabang mengirim. Jika Divisi Pusat meminta kelengkapan, tiket kembali langsung ke Divisi itu. Perubahan substansi tetap harus diperiksa Korwil.
8. Penolakan dan penyelesaian wajib memiliki alasan atau ringkasan hasil. Seluruh perpindahan dan revisi tercatat pada timeline.

Form yang tersedia saat ini hanya mengumpulkan perihal dan uraian umum. Field khusus dan lampiran sesuai katalog belum tersedia; jangan gunakan form untuk pengajuan resmi yang mewajibkan data/dokumen tersebut.

## Langkah menjalankan milestone workflow lokal

Jalankan `npm.cmd run db:migrate` dari folder `backend/` untuk menerapkan migrasi terbaru, lalu jalankan backend dan frontend seperti petunjuk di atas. API workflow memakai prefix `/api/v1`; endpoint pengajuan memerlukan bearer SSO dan assignment lokal aktif. Endpoint utama mencakup `/requests`, `/requests/:id/revision`, `/inbox/korwil`, dan `/inbox/central` beserta aksi claim, request-documents, forward, complete, dan reject.

Backend/frontend type-check dan build lulus; smoke test lokal membuktikan database notifikasi tersedia dan endpoint menolak request tanpa bearer. Click-through event notifikasi lintas Cabang/Korwil/Divisi dan validasi visual navbar mobile masih perlu diuji. Lampiran privat, target SLA serta ambang notifikasi peringatan, dan persyaratan khusus pekerjaan tetap menjadi pekerjaan berikutnya.

## Organisasi awal

| Korwil | Kode kantor Cabang |
|---|---|
| Semarang Raya | `001`–`007` |
| Solo Raya | `008`–`014` |
| Banyumas Raya | `015`–`021` |
| Pekalongan Raya | `022`–`028` |

Kode kantor disimpan sebagai teks agar nol di depan tidak hilang.

Sembilan Divisi Pusat yang diketahui: Penyelesaian Kredit, Pemasaran, Sekretaris Perusahaan, Operasional, Litbang, SKK, SKMR, SKAI, dan SDM. Katalog pekerjaan dapat dikembangkan Admin; daftar jenis pekerjaan dan target SLA per unit masih perlu dilengkapi.

Pekerjaan awal yang sudah diketahui:

- Penyelesaian Kredit: persetujuan lelang, AYDA, hapus buku, keringanan bunga, restruck, dan pelunasan sebagian.
- Pemasaran: pengajuan kredit di atas Rp500 juta.
- Sekretaris Perusahaan: pendampingan hukum, fraud, dan pekerjaan terkait.
- Operasional: permintaan EDC dan pekerjaan operasional terkait.
- Litbang, SKK, SKMR, SKAI, dan SDM: katalog pekerjaan ditambahkan Admin.

## Struktur kode

```text
backend/src/
  app.ts, server.ts
  config/env.ts
  db/client.ts
  modules/health/
  routes/api.routes.ts

frontend/src/
  lib/api/
  lib/components/{layout,ui}/
  lib/features/{auth,catalog,inbox,requests}/
  routes/
```

Modul backend menampung route dan aturan per domain. `lib/api/` menjadi satu pintu komunikasi frontend ke REST API. Folder fitur dibuat bertahap saat fiturnya mulai dikerjakan.

## Langkah berikutnya

1. Tetapkan model data pengajuan, timeline, dan antrean Korwil yang konsisten dengan PRD.
2. Sahkan field wajib/lampiran per pekerjaan serta keputusan bisnis yang masih terbuka.
3. Implementasikan submit Cabang, routing awal ke Korwil, serta SLA session dan timeline.
4. Tambahkan penerusan Korwil ke Pusat, revisi kelengkapan, dan pengembalian substansi.
5. Uji akses tiap cakupan dan skenario penerimaan PRD; target SLA diisi setelah disahkan.

## Catatan dependency

Build dan pemeriksaan TypeScript frontend/backend lolos. Audit npm frontend melaporkan empat advisory berlevel rendah pada dependency `deepmerge` yang terbawa dependency Svelte; `npm audit fix --force` menawarkan downgrade besar SvelteKit, jadi tidak dijalankan. Audit perlu diperiksa ulang saat dependency diperbarui dan sebelum rilis.
#   s l a - p e n g a j u a n  
 