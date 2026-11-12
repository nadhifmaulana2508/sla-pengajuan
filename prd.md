# Sistem Pelacakan Pengajuan SLA Cabang, Korwil, dan Pusat

**Product Requirements Document**

| Informasi | Nilai |
|---|---|
| Versi | 0.9 - Draft validasi bisnis |
| Tanggal | 7 November 2026 |
| Pemilik proses | Perlu ditetapkan |
| Pengguna utama | Pengguna Cabang, Korwil, Divisi Pusat, Supervisor, Admin, dan Manajemen |
| Status | Draft kebutuhan MVP; stack aplikasi telah dipilih |

Dokumen ini menjelaskan sistem pengajuan Cabang melalui jalur yang ditentukan pada setiap katalog pekerjaan: melalui Korwil ke Divisi Pusat atau langsung ke Divisi Pusat. Sistem memakai satu nomor pengajuan untuk seluruh proses, mencatat setiap perpindahan, dan menghitung waktu berdasarkan unit yang sedang memegang pengajuan.

Daftar awal sembilan Divisi Pusat sudah dicatat. Aturan bisnis yang belum disahkan, seperti daftar pekerjaan tiap divisi, target SLA, dan hak persetujuan, ditandai sebagai keputusan yang perlu ditetapkan. Sistem tidak boleh menganggap nilai tersebut sudah final sebelum admin atau pemilik proses mengisinya.

## Ringkasan keputusan produk

| Area | Keputusan saat ini |
|---|---|
| Backend | Node.js + Express + TypeScript sebagai REST API |
| Frontend | SvelteKit sebagai aplikasi frontend terpisah |
| UI | shadcn-svelte dan Tailwind CSS, dengan gaya admin yang bersih dan padat |
| Database | MySQL |
| Login | SSO perusahaan melalui API yang diberikan; app code `simpeg` dipakai sementara |
| Hak akses organisasi | Admin menetapkan role/status. Scope Cabang, Korwil, dan Divisi Pusat mengikuti profil SSO, bukan pilihan scope manual |
| Struktur organisasi | 28 Cabang, 4 Korwil, dan 9 Divisi Pusat |
| Jalur utama | Setiap katalog pekerjaan Pusat memilih jalur Cabang → Korwil → Pusat atau Cabang → Pusat langsung |
| Pemilihan tujuan | Cabang memilih kewenangan. Jika memilih Pusat, Cabang memilih Divisi Pusat dan jenis pekerjaan dari dropdown |
| Waktu tiket | Umur total dimulai saat Cabang mengirim dan berakhir saat selesai/ditolak; sesi tiap unit mengikuti aturan awal timer per jalur |
| Jam SLA | Berjalan terus selama 24 jam. Jam kerja dan kalender hari libur belum dipakai pada MVP |
| Zona waktu | Tanggal dan waktu pembuatan, perubahan, histori, dan notifikasi ditampilkan sebagai WIB (`Asia/Jakarta`). Backend menggunakan zona sesi MySQL `+07:00`; timestamp yang tersimpan tetap merepresentasikan instant yang sama dan data lama tidak dikonversi ulang |
| Sesi proses | Setiap pengiriman ke unit membuat sesi baru. Sesi lama tidak dihapus atau di-reset |
| Akumulasi waktu | Waktu unit dijumlahkan dari semua sesi unit tersebut |
| Revisi berkas | Cabang melengkapi tiket yang sama dan mengirim kembali langsung ke unit yang meminta; timer unit itu dimulai sebagai sesi baru |
| Revisi substansi | Jika isi pengajuan berubah secara material, pengajuan kembali ke Korwil untuk diperiksa ulang |
| Kredit | Di bawah Rp250 juta ditolak. Cabang dapat memakai form Pengajuan Kredit Pemasaran untuk tujuan Korwil atau Pusat; kewenangan yang dipilih menentukan tujuan, sedangkan ambang Pemasaran pada versi form menjadi panduan nilai |

## 1. Latar belakang dan masalah

Pengajuan Cabang dapat selesai di Korwil atau membutuhkan tindak lanjut Divisi Pusat. Saat ini proses akan sulit dipantau jika perpindahan unit, permintaan kelengkapan, dan waktu penyelesaian tidak tercatat dalam satu histori.

Sistem harus menjawab pertanyaan berikut pada setiap pengajuan:

- Pengajuan berasal dari Cabang mana dan berada di bawah Korwil mana?
- Pengajuan sedang berada di antrean unit mana?
- Siapa yang sudah mengambil atau sedang memprosesnya?
- Berapa lama pengajuan berada di Korwil, Cabang, dan Divisi Pusat?
- Mengapa pengajuan dikembalikan dan ke tahap mana pengajuan harus dilanjutkan?
- Apakah waktu unit sudah melewati target SLA?

## 2. Tujuan

- Menyediakan satu tempat untuk membuat dan melacak pengajuan.
- Mengarahkan pengajuan sesuai jalur pada katalog pekerjaan; jika jalur melalui Korwil, menentukan Korwil berdasarkan kode kantor Cabang.
- Membantu Cabang memilih Divisi Pusat dan jenis pekerjaan yang sesuai.
- Menampilkan antrean kerja yang hanya berisi pengajuan untuk unit terkait.
- Menyimpan histori lengkap setiap pengiriman, pengambilan, pengembalian, revisi, dan penyelesaian.
- Menghitung waktu total pengajuan dan akumulasi waktu setiap unit.
- Membantu supervisor menemukan pengajuan yang belum diambil atau sudah melewati SLA.

## 3. Ruang lingkup MVP

### Termasuk

- Login dan hak akses berdasarkan peran serta cakupan organisasi.
- Master Korwil dan Cabang.
- Pemetaan 28 kode kantor ke 4 Korwil.
- Master Divisi Pusat.
- Katalog jenis pekerjaan untuk setiap Divisi Pusat.
- Form pengajuan dengan pilihan kewenangan, Divisi Pusat, dan jenis pekerjaan yang saling terkait.
- Pilihan jalur untuk setiap pekerjaan Pusat: Cabang → Korwil → Pusat atau Cabang → Pusat langsung.
- Persetujuan atau proses Korwil.
- Penerusan pengajuan dari Korwil ke Divisi Pusat.
- Antrean, tombol Ambil, penugasan, komentar, dan lampiran.
- Pengembalian untuk melengkapi berkas atau pemeriksaan ulang.
- Timer SLA 24 jam dan akumulasi sesi per unit.
- Timeline pengajuan dan audit log.
- Dashboard Cabang, Korwil, Divisi Pusat, Supervisor, dan Admin.
- Notifikasi dasar di dalam aplikasi.

### Belum termasuk

- Kalender jam kerja dan hari libur.
- Timer 24/7 yang berbeda berdasarkan prioritas, sebelum aturan prioritas disahkan.
- Pekerjaan beberapa Divisi Pusat secara paralel dalam satu pengajuan.
- Portal untuk nasabah atau pihak eksternal.
- Pengambilan keputusan kredit atau keputusan bisnis otomatis.
- Integrasi email atau sistem lain sebelum standar IT ditetapkan. Login SSO termasuk dalam MVP dengan app code sementara `simpeg`.
- Penghapusan atau pembuatan nomor baru saat revisi. Revisi tetap memakai nomor pengajuan yang sama.

## 4. Struktur organisasi dan master data

### Pemetaan Cabang ke Korwil

Kode kantor disimpan sebagai teks agar angka nol di depan tetap dipertahankan. Contoh `001`, bukan angka `1`.

| Korwil | Rentang kode kantor | Jumlah Cabang |
|---|---:|---:|
| Semarang Raya | 001 sampai 007 | 7 |
| Solo Raya | 008 sampai 014 | 7 |
| Banyumas Raya | 015 sampai 021 | 7 |
| Pekalongan Raya | 022 sampai 028 | 7 |

Mapping produksi harus menyimpan setiap kode kantor sebagai baris data aktif. Rentang di atas menjadi dasar seed awal dan perlu dikonfirmasi pemilik proses sebelum digunakan di produksi.

Seed lokal awal memakai tabel `master_kantor` dengan kolom `id`, `kode_kantor`, `nama_kantor`, `korwil`, dan `is_active`. `kode_kantor` adalah teks tiga karakter; kode `000` mewakili Pusat dan bukan Cabang. Nama kantor 001–028 mengikuti data yang diberikan pemilik proyek. Kolom `korwil` sementara menyimpan kelompok `semarang`, `solo`, `banyumas`, `pekalongan`, atau `pusat` langsung pada baris kantor; belum ada tabel Korwil terpisah.

### Divisi Pusat dan katalog pekerjaan

Jumlah Divisi Pusat adalah 9 dan nama awal seluruhnya sudah diketahui. Admin dapat menambahkan katalog pekerjaan untuk setiap divisi.

| Divisi Pusat | Pekerjaan awal |
|---|---|
| Divisi Penyelesaian Kredit | Persetujuan lelang, AYDA, hapus buku, keringanan bunga, restruck, dan pelunasan sebagian |
| Pemasaran | Form Pengajuan Kredit tersedia untuk pengajuan dengan tujuan Korwil maupun Pusat; jika tujuan Pusat, katalog menentukan apakah tiket melewati Korwil |
| Sekretaris Perusahaan | Pendampingan hukum, fraud, dan pekerjaan terkait |
| Operasional | Permintaan EDC dan pekerjaan operasional terkait |
| Litbang | Katalog pekerjaan ditambahkan Admin |
| SKK | Katalog pekerjaan ditambahkan Admin |
| SKMR | Katalog pekerjaan ditambahkan Admin |
| SKAI | Katalog pekerjaan ditambahkan Admin |
| SDM | Katalog pekerjaan ditambahkan Admin |

Istilah `restruck` dipertahankan sebagai istilah kerja sementara. Nama resminya perlu dikonfirmasi pemilik proses sebelum katalog produksi dibuat.

Admin dapat membuat, mengubah, mengaktifkan, atau menonaktifkan jenis pekerjaan pada setiap divisi melalui master katalog. Penambahan pekerjaan baru tidak memerlukan perubahan kode aplikasi.

Setiap divisi memiliki katalog pekerjaan dengan struktur berikut:

| Field | Keterangan |
|---|---|
| Nama pekerjaan | Nama yang dipilih pengguna pada form |
| Divisi tujuan | Divisi yang menerima pengajuan |
| Deskripsi | Penjelasan singkat tentang pekerjaan |
| Status aktif | Menentukan apakah pekerjaan dapat dipilih |
| Kolom wajib | Data yang harus diisi untuk pekerjaan tersebut |
| Lampiran wajib | Dokumen yang harus disertakan jika ada |
| Target SLA | Target waktu yang disahkan pemilik proses |
| Jalur pengajuan | Memilih Cabang → Korwil → Pusat atau Cabang → Pusat langsung |

Jenis pekerjaan dan Divisi Pusat harus saling membatasi. Cabang tidak boleh memilih pekerjaan yang tidak tersedia untuk divisi tujuan.

## 5. Peran dan hak akses

| Peran | Hak utama | Cakupan |
|---|---|---|
| Pengguna Cabang | Membuat pengajuan, melihat pengajuan Cabang, melengkapi revisi, dan mengirim jawaban | Satu Cabang |
| Petugas Korwil | Melihat antrean Korwil, mengambil, memproses, mengembalikan, dan meneruskan pengajuan | Korwil dan Cabang di bawahnya |
| Penyetuju Korwil | Menyetujui penerusan ke Pusat, meminta perbaikan, atau menolak dengan alasan | Korwil dan Cabang di bawahnya |
| Petugas Divisi Pusat | Melihat antrean divisi, mengambil, memproses, meminta kelengkapan, dan menyelesaikan; dapat mengelola form bila diberi izin Admin | Satu Divisi Pusat |
| Supervisor | Melihat antrean dan kinerja unit, serta mengatur penugasan sesuai kewenangan | Wilayah atau divisi terkait |
| Admin | Mengelola pengguna, organisasi, katalog pekerjaan, aturan SLA, konfigurasi, dan semua form pekerjaan | Seluruh sistem |
| Manajemen | Melihat ringkasan status, SLA, backlog, dan histori sesuai hak akses | Seluruh organisasi atau cakupan yang ditetapkan |

Hak akses diperiksa di sisi server pada setiap akses dan tindakan. Menyembunyikan menu saja tidak cukup untuk membatasi data. Admin mengaktifkan akun dan menetapkan role, tetapi tidak memilih cakupan untuk role organisasi. Cakupan Pengguna Cabang mengikuti kode kantor SSO yang cocok dengan `master_kantor` aktif. Cakupan Petugas Korwil mengikuti Korwil dari mapping kantor aktif; untuk profil berkantor Pusat atau tanpa mapping kantor, sistem mencocokkan informasi organisasi SSO (`unit_kerja`, `branch_name`, dan `job_position`) dengan Korwil yang dikenal. Cakupan Petugas Divisi Pusat mengikuti `unit_kerja` yang cocok dengan nama atau alias SSO pada `master_divisi` aktif. Admin dapat mengubah nama divisi dan daftar alias `unit_kerja` dari master Divisi Pusat; alias unik lintas divisi dan hanya dipakai untuk pemetaan profil, bukan untuk memberikan role. Admin dapat memberi izin terpisah untuk mengelola form kepada Petugas Divisi Pusat. Izin itu hanya berlaku pada divisi yang cocok dengan profil SSO dan assignment aktif; Admin global dapat mengelola semua form. Backend memeriksa izin dan cakupan pada setiap penerbitan. Cakupan diperbarui ketika profil tersinkron. Jika organisasi tidak dapat dipetakan, role tetap tersimpan tetapi akses workflow ditolak sampai profil SSO cocok. SSO tidak otomatis mengaktifkan akun atau memberikan role.

Untuk MVP, Petugas Korwil atau Penyetuju Korwil yang mengambil tiket dapat menjalankan tindakan yang tersedia pada tahap Korwil. Pemisahan persetujuan formal antar-role belum dimodelkan sebagai tahap antrean tersendiri dan wajib ditinjau sebelum produksi.

Pengajuan dimiliki kantor Cabang, bukan pegawai yang membuatnya. Identitas pembuat tetap disimpan untuk audit. Pegawai baru yang telah diberi role Pengguna Cabang di kantor tersebut dapat melihat dan melanjutkan tiket yang dibuat pegawai sebelumnya. Saat pegawai rotasi dan data SSO terbaru tersinkron, cakupan role-nya mengikuti kantor baru; histori dan pengajuan tetap pada kantor asal.

## 6. Form dan routing pengajuan

### Field utama pengajuan

- Kode kantor Cabang diambil dari profil SSO pegawai dan dipetakan ke `master_kantor`; Admin tidak memilih kode kantor untuk role Pengguna Cabang.
- Korwil dihitung dari mapping Cabang.
- Kewenangan pengajuan: Korwil atau Pusat.
- Divisi Pusat tujuan, wajib dipilih jika kewenangan Pusat.
- Jenis pekerjaan, difilter berdasarkan Divisi Pusat yang dipilih.
- Perihal.
- Uraian kebutuhan.
- Data tambahan sesuai jenis pekerjaan.
- Lampiran sesuai aturan katalog.

Admin atau Petugas Divisi Pusat yang diberi izin dapat menyusun dan menerbitkan form dinamis untuk katalog pekerjaan. Tipe field MVP: teks singkat, teks panjang, angka, nominal Rupiah, tanggal, dan pilihan. Input nominal Rupiah menampilkan pemisah ribuan Indonesia (contoh `2.500.000`), sedangkan nilai yang divalidasi dan dikirim tetap numerik tanpa pemisah. Setiap field dapat ditandai wajib serta memiliki batas angka atau daftar pilihan. Penerbitan membuat versi baru; tiket menyimpan versi dan jawaban yang digunakan saat dikirim agar perubahan berikutnya tidak mengubah histori tiket.

Batas editor MVP adalah 40 kolom tambahan per katalog. Pengajuan Kredit menyediakan maksimal 39 kolom tambahan karena satu kolom wajib untuk nilai kredit yang dikelola sistem. Setiap field pilihan dapat memuat maksimal 50 opsi unik.

Untuk katalog selain Pengajuan Kredit, pengelola dapat mengaktifkan kelompok data berulang, memberi nama kelompok, dan mengatur batas maksimal 2–20 kelompok. Cabang memulai dengan satu kelompok, lalu dapat menambah atau menghapus kelompok sampai batas yang ditetapkan. Semua kolom tambahan diulang bersama sebagai satu paket, misalnya satu paket untuk setiap rekening atau fasilitas. Backend memvalidasi setiap paket dan menyimpan jawaban berulang sebagai array dalam snapshot tiket; detail tiket menampilkan setiap paket terpisah. Pengajuan Kredit tidak mendukung pengulangan kelompok.

Sebelum pengajuan dikirim, sistem menampilkan Cabang asal, Korwil pemetaan, Divisi Pusat jika ada, jenis pekerjaan, dan urutan proses sesuai pengaturan katalog.

### Jalur kewenangan Korwil

```text
Cabang mengirim
  -> Antrean Korwil
  -> Korwil mengambil dan memproses
  -> Selesai, ditolak, dikembalikan ke Cabang, atau diteruskan sebagai pengecualian
```

### Jalur pekerjaan ke Pusat

Setiap katalog pekerjaan Pusat memiliki pengaturan jalur yang dikelola Admin:

- `Cabang → Korwil → Pusat`: pengajuan masuk ke antrean Korwil. Korwil mengambil dan memeriksa sebelum meneruskan ke Divisi Pusat.
- `Cabang → Pusat langsung`: pengajuan masuk ke antrean Divisi Pusat yang dipilih Cabang tanpa tahap Korwil.

Kedua pilihan berlaku untuk seluruh pekerjaan dalam katalog, sehingga Admin dapat mengatur alur setiap jenis pekerjaan secara terpisah. Pilihan ini mengatur urutan pengajuan ke Divisi Pusat; pekerjaan yang memang ditangani Korwil tetap mengikuti kewenangan dan tahap Korwil.

Pengaturan ini berlaku untuk pekerjaan baru maupun yang sudah ada. Migrasi awal mempertahankan perilaku lama dengan memilih `Cabang → Korwil → Pusat` pada semua katalog. Backend membaca jalur dari katalog aktif; pilihan jalur tidak dikirim atau dipercayakan kepada browser. Pada jalur langsung, sesi Divisi Pusat tercatat saat masuk antrean dan timer proses mulai ketika petugas mengambil tiket. Umur total tiket tetap mulai saat Cabang mengirim.

### Pengajuan kredit

- Field nilai kredit wajib diisi dan dikunci sebagai field sistem. Form Pemasaran dapat dipakai dengan memilih kewenangan Korwil maupun Pusat.
- Nilai di bawah Rp250 juta ditolak dan tidak membuat tiket.
- Nilai Rp250 juta atau lebih dengan kewenangan Korwil masuk ke Korwil dan dapat ditangani sampai selesai di sana; tiket tetap menyimpan form dan jawaban Pengajuan Kredit Pemasaran.
- Dengan kewenangan Pusat, tiket menuju Pemasaran melalui routing katalog Pengajuan Kredit: langsung dari Cabang atau setelah pemeriksaan Korwil.
- Backend memvalidasi kewenangan, tujuan, form, versi, jawaban, dan batas minimum. Ambang Pemasaran pada versi form aktif (default Rp500 juta) hanya menjadi panduan nilai dan tidak mengganti kewenangan yang dipilih Cabang.
- Tiket menyimpan versi form yang dipakai agar jawaban dan panduan versi lama tetap dapat ditampilkan.

### Katalog sebagai sumber aturan

Admin global dapat menerbitkan form untuk semua divisi; Petugas Divisi Pusat hanya dapat mengubah form pada divisinya bila assignment-nya diberi izin kelola form. Pekerjaan selain Pengajuan Kredit dan Keringanan bunga tetap memakai perihal dan uraian umum sampai form diterbitkan. Rincian field Keringanan bunga masih menunggu pengesahan pengelola proses.

Katalog dan routing menentukan apakah jenis pekerjaan:

- hanya boleh ditangani Korwil;
- harus diteruskan ke Pusat;
- boleh dipilih langsung oleh Cabang;
- membutuhkan persetujuan Korwil;
- memerlukan kolom atau lampiran tambahan.

Admin memilih salah satu dari dua alur untuk setiap pekerjaan Pusat. Pengaturan disimpan sebagai `routing_flow` pada `work_catalogs` dan selalu diperiksa backend ketika Cabang mengirim pengajuan.

Katalog awal yang sudah disepakati:

| Pilihan pengajuan | Divisi tujuan |
|---|---|
| Persetujuan lelang | Divisi Penyelesaian Kredit |
| AYDA | Divisi Penyelesaian Kredit |
| Hapus buku | Divisi Penyelesaian Kredit |
| Keringanan bunga | Divisi Penyelesaian Kredit |
| Restruck | Divisi Penyelesaian Kredit |
| Pelunasan sebagian | Divisi Penyelesaian Kredit |
| Pengajuan kredit | Form dari Pemasaran; dapat dipakai untuk tujuan Korwil atau Pusat sesuai kewenangan pilihan Cabang |
| Pendampingan hukum | Sekretaris Perusahaan |
| Fraud | Sekretaris Perusahaan |
| Permintaan EDC | Operasional |

Daftar ini menjadi data awal, bukan daftar tertutup. Admin dapat menambahkan pekerjaan lain ke divisi yang sesuai setelah aturan dan field wajibnya disahkan.

Jika pilihan Cabang tidak sesuai katalog aktif, sistem menolak pengajuan dan menampilkan alasan yang dapat diperbaiki pengguna.

## 7. Siklus hidup pengajuan

| Status | Makna |
|---|---|
| Draft | Pengajuan belum dikirim |
| Menunggu Korwil | Pengajuan sudah dikirim ke antrean Korwil |
| Diproses Korwil | Pengajuan sudah diambil Korwil |
| Menunggu Kelengkapan Cabang | Cabang perlu menambah data atau dokumen |
| Menunggu Divisi Pusat | Pengajuan sudah masuk ke antrean divisi tujuan melalui Korwil atau langsung dari Cabang sesuai katalog |
| Diproses Divisi Pusat | Pengajuan sudah diambil Divisi Pusat |
| Ditolak | Pengajuan ditutup dengan alasan |
| Selesai | Seluruh proses pengajuan selesai |
| Dibatalkan | Pengajuan dibatalkan sesuai kewenangan |

Status yang tampil pada tiket menunjukkan tahap saat ini. Detail perpindahan tetap tersedia di timeline.

### Aturan tindakan

- Tombol Ambil mengubah pemilik tindakan dari antrean menjadi pengguna yang mengambil.
- Mengembalikan pengajuan wajib menyertakan alasan dan tujuan pengembalian.
- Meneruskan ke Pusat wajib menyimpan Divisi Pusat tujuan.
- Menolak wajib menyertakan alasan.
- Menyelesaikan pengajuan wajib menyertakan ringkasan hasil.
- Mengubah Divisi Pusat atau jenis pekerjaan setelah pengajuan berjalan wajib menyimpan alasan dan dapat memicu pemeriksaan Korwil ulang.

## 8. Revisi dan kelengkapan berkas

### Kekurangan dokumen atau data

Jika unit penanganan hanya membutuhkan dokumen atau data tambahan:

1. Unit penanganan memilih status Menunggu Kelengkapan Cabang.
2. Petugas menuliskan daftar yang harus dilengkapi.
3. Cabang menerima notifikasi pada tiket yang sama.
4. Cabang menambah data atau lampiran tanpa membuat pengajuan baru.
5. Cabang menekan Kirim Kembali.
6. Sistem mengirim pengajuan langsung ke unit yang meminta kelengkapan pada tiket yang sama dan memulai sesi baru saat Cabang mengirim.
7. Jika petugas yang meminta masih aktif dan scope-nya masih cocok, sistem mengembalikan tiket otomatis kepada petugas tersebut tanpa tombol Ambil ulang. Status unit menjadi Diproses dan petugas dapat langsung melanjutkan.
8. Jika petugas sebelumnya tidak aktif, tidak lagi memiliki scope yang cocok, atau assignment lamanya tidak tersedia, tiket masuk antrean unit tanpa pemilik. Timer tetap berjalan sejak Cabang mengirim; petugas unit perlu mengambilnya untuk menjadi pemilik tindakan.
9. Untuk pelengkapan dokumen biasa, pengajuan kembali langsung ke unit yang meminta dan Korwil tidak perlu memeriksa ulang, termasuk jika pekerjaan sebelumnya melewati Korwil.

Saat meminta kelengkapan, Korwil atau Divisi Pusat memilih kolom tertentu dan/atau jenis dokumen yang harus dilengkapi, lalu menambahkan catatan konteks. Permintaan tanpa kolom atau dokumen terpilih tidak dapat dikirim. Cabang hanya dapat mengubah kolom yang diminta pada putaran revisi aktif; kolom lain tetap mengikuti snapshot sebelumnya. Pengiriman revisi wajib menyertakan semua nilai dan dokumen yang diminta.

Form yang dipakai adalah versi saat tiket dibuat. Perubahan sebelum dan sesudah revisi disimpan sebagai snapshot; histori lama tidak ditimpa. Nomor, tujuan, kewenangan, dan jenis pekerjaan tidak dapat diganti lewat pelengkapan. Nilai kredit selalu memerlukan pemeriksaan Korwil jika berubah. Pada editor form, Admin atau pengelola Divisi dapat menandai field lain yang memengaruhi keputusan; penanda disimpan pada versi form dan jika field tersebut berubah saat revisi, tiket kembali ke antrean Korwil. Perubahan perihal atau uraian juga kembali ke Korwil. Perubahan dokumen dan metadata surat saja kembali ke unit yang meminta. Dokumen pelengkapan berupa PDF privat yang diperiksa signature PDF; Surat InOffice dapat diperbarui pada revisi jika diminta.

Form pengajuan baru menerima nomor dan tanggal surat InOffice serta satu PDF opsional (maksimal 10 MB); file disimpan di direktori privat backend dan unduhannya memeriksa hak akses tiket.

### Perubahan substansi

Jika Cabang mengubah hal yang dapat memengaruhi kewenangan, Divisi Pusat, nilai, jenis pekerjaan, atau keputusan bisnis, pengajuan kembali ke Korwil. Korwil memutuskan apakah pengajuan dapat diteruskan ke Pusat atau perlu dikembalikan lagi ke Cabang.

### Permintaan revisi ke Korwil

Jika Pusat meminta tindakan atau penjelasan dari Korwil, sistem membuat sesi Korwil baru. Setelah Korwil menyelesaikan permintaan, pengajuan kembali ke Divisi Pusat yang meminta. Sesi Korwil sebelumnya tetap dihitung dalam total waktu Korwil.

## 8.1 Keputusan, penolakan, dan berita acara

- Penolakan memakai alasan pilihan dari katalog sistem, alasan tambahan Divisi, atau alasan khusus jenis pekerjaan. Catatan penjelas wajib diisi. Kode dan label alasan disalin ke keputusan agar perubahan katalog tidak mengubah histori.
- Katalog awal alasan sistem: Tidak memenuhi persyaratan, Di luar kewenangan atau cakupan, Dokumen tidak valid, Data tidak dapat diverifikasi, dan Lainnya. Admin dapat menonaktifkan alasan sistem; Divisi dengan izin kelola form dapat menambah alasan Divisi dan alasan khusus katalog.
- Penerusan ke Divisi dan penyelesaian meminta konfirmasi eksplisit sebelum dikirim. Sistem mencatat identitas petugas, waktu, dan teks persetujuan sebagai jejak persetujuan aplikasi; catatan ini bukan tanda tangan elektronik tersertifikasi.
- Korwil dan Divisi Pusat dapat menyertakan Berita Acara PDF privat saat meneruskan atau menyelesaikan tiket. Lampiran ini opsional sampai pemilik proses menetapkan kewajiban per jenis pekerjaan.

## 9. SLA dan perhitungan waktu

### Aturan waktu MVP

- Umur total tiket dimulai saat Cabang mengirim pengajuan pertama kali dan berhenti saat pengajuan selesai atau ditolak. Selama tiket terbuka, umur dihitung sampai waktu sekarang. Umur total mencakup antrean dan revisi.
- Sesi Korwil pertama dimulai saat petugas mengambil tiket; waktu antre sebelum pengambilan ditampilkan terpisah dan tidak masuk durasi kerja Korwil.
- Jika Korwil meminta kelengkapan, sesi Korwil ditutup dan sesi Cabang dimulai saat permintaan diterima Cabang. Ketika Cabang mengirim pelengkapan pada tiket yang sama, sesi Cabang ditutup dan sesi unit yang meminta dimulai lagi saat pengiriman tersebut. Jika Korwil yang meminta, akumulasi Korwil berlanjut; jika Divisi Pusat yang meminta, tiket kembali langsung ke Divisi Pusat.
- Jika petugas yang meminta masih aktif dengan scope yang sama, tiket otomatis kembali menjadi miliknya; tidak ada klaim ulang. Jika petugas tersebut sudah tidak berwenang, tiket masuk antrean unit sebagai fallback, tetapi timer sesi baru tetap dimulai saat Cabang mengirim.
- Sesi Divisi Pusat awal dibuat saat Korwil meneruskan pengajuan atau saat Cabang mengirim pengajuan dengan jalur langsung. Timer baru dimulai saat petugas Divisi mengambil tiket. Waktu antre sampai diambil dicatat terpisah dan tidak masuk durasi SLA Divisi. Jika Cabang mengirim pelengkapan kembali ke Divisi yang meminta, sesi baru dimulai saat pengiriman karena tiket kembali langsung ke unit tersebut.
- Semua durasi memakai waktu kalender 24 jam tanpa pengecualian jam kerja, weekend, atau hari libur.
- `claimed_at` selalu dicatat untuk waktu pengambilan. Pengambilan tidak mengulang timer sesi yang sudah dimulai saat tiket dikirim kembali.
- Keputusan MVP: untuk sementara seluruh pengajuan dan seluruh sesi memakai target SLA umum 7 hari kalender (10.080 menit). Nilai ini menjadi default katalog dan snapshot sesi sampai target per unit atau per jenis pekerjaan disahkan.
- Badge status SLA memakai umur total tiket: hijau jika kurang dari 3 hari, kuning jika 3 sampai 7 hari, dan merah jika lebih dari 7 hari. Batas tepat 3 hari masuk kuning; batas tepat 7 hari masih kuning.

### Sesi SLA

Setiap kali pengajuan dikirim ke unit, sistem membuat satu sesi SLA. Saat unit meneruskan, mengembalikan, atau menyelesaikan pekerjaannya, sesi ditutup.

Data minimum sesi:

| Field | Keterangan |
|---|---|
| Pengajuan | Nomor pengajuan terkait |
| Unit | Tipe dan ID unit yang memegang sesi |
| Waktu masuk unit | Awal waktu tunggu pada unit |
| Awal timer | Saat diambil Korwil pertama kali, atau saat dikirim kembali/dikirim ke unit sesuai aturan jalur |
| Pemicu timer | `claim` atau `sent`, agar alasan awal durasi dapat dibaca ulang |
| Waktu diambil | Waktu petugas menekan Ambil, jika dilakukan; tidak mengulang timer yang sudah berjalan |
| Waktu selesai sesi | Waktu unit meneruskan, mengembalikan, atau menyelesaikan |
| Durasi sesi | Selisih waktu dari mulai sampai selesai |
| Hasil sesi | Diteruskan, dikembalikan, selesai, atau ditolak |
| Alasan | Wajib untuk pengembalian, penolakan, atau perubahan tujuan |
| Target SLA | Target yang berlaku saat sesi dibuat |

### Akumulasi waktu unit

Sesi tidak digabung dan tidak ditimpa. Laporan menjumlahkan semua sesi untuk unit yang sama pada satu pengajuan.

Contoh:

```text
Korwil sesi 1 : 5 menit sebelum meminta kelengkapan
Cabang        : 1 jam untuk melengkapi berkas
Korwil sesi 2 : 10 menit setelah Cabang mengirim pelengkapan
Total Korwil  : 15 menit
Umur tiket    : minimal 1 jam 15 menit, ditambah waktu antre dan tahap lain
```

Setelah sesi Korwil kedua, Korwil meneruskan pengajuan ke Pusat. Sesi Korwil ditutup dan sesi Divisi Pusat masuk antrean; timer Divisi Pusat baru dimulai saat petugas mengambil tiket. Akumulasi sesi lama Korwil tidak ditimpa.

### Metrik yang ditampilkan

- Umur total pengajuan sejak pertama dikirim.
- Durasi setiap sesi.
- Total durasi Korwil dari seluruh sesi Korwil.
- Total durasi Cabang dari seluruh sesi Cabang.
- Total durasi Divisi Pusat dari seluruh sesi Divisi Pusat.
- Umur total tiket dari pengiriman pertama sampai selesai/ditolak.
- Waktu menunggu sebelum diambil, berdasarkan `waktu masuk unit` dan `waktu diambil`.
- Jumlah putaran revisi.
- Status SLA: belum ada target, dalam target, mendekati target, atau melewati target.

Contoh pengajuan yang dikirim malam hari:

```text
Dikirim : Senin 21:00
Target  : 24 jam
Jatuh tempo: Selasa 21:00
```

## 10. Kebutuhan fungsional

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-01 | Hak akses | Pengguna hanya dapat melihat dan mengubah data sesuai peran dan cakupan organisasi |
| FR-02 | Mapping Cabang | Sistem menentukan Korwil dari kode kantor aktif |
| FR-03 | Form dinamis | Jenis pekerjaan menentukan kolom, pengulangan kelompok data, dan lampiran yang wajib; backend memvalidasi jumlah serta isi setiap kelompok |
| FR-04 | Dropdown tujuan | Divisi Pusat hanya muncul jika kewenangan Pusat dipilih |
| FR-05 | Dropdown pekerjaan | Jenis pekerjaan hanya menampilkan pekerjaan aktif milik divisi yang dipilih |
| FR-06 | Routing awal | Backend membaca jalur dari katalog aktif. Jalur melalui Korwil masuk ke Korwil pemetaan Cabang; jalur langsung masuk ke Divisi Pusat tujuan |
| FR-07 | Routing Pusat | Pengajuan masuk ke Divisi Pusat yang dipilih setelah Korwil meneruskan atau langsung dari Cabang sesuai katalog |
| FR-08 | Tombol Ambil | Pengambilan awal Korwil memulai sesi; pada unit/sesi yang sudah berjalan, sistem mencatat waktu ambil tanpa mereset awal timer |
| FR-09 | Revisi dokumen | Cabang dapat melengkapi tiket yang sama dan mengirim langsung ke unit yang meminta |
| FR-10 | Revisi substansi | Perubahan material mengembalikan pengajuan ke Korwil untuk pemeriksaan ulang |
| FR-11 | Sesi SLA | Setiap handoff mencatat waktu masuk unit, awal timer sesuai aturan jalur, waktu selesai, durasi, dan hasil |
| FR-12 | Akumulasi SLA | Sistem menjumlahkan seluruh sesi berdasarkan unit, tanpa menghapus sesi lama |
| FR-13 | Penolakan | Sistem meminta alasan sebelum status Ditolak disimpan |
| FR-14 | Penyelesaian | Sistem meminta ringkasan hasil sebelum status Selesai disimpan |
| FR-15 | Timeline | Pengguna yang berhak dapat melihat histori status, unit, petugas, komentar, lampiran, dan alasan |
| FR-16 | Dashboard antrean | Unit dapat melihat pengajuan yang menunggu diambil, sedang diproses, dikembalikan, dan melewati SLA |
| FR-17 | Konfigurasi katalog dan form | Admin mengelola katalog serta semua form; Petugas Divisi Pusat yang diberi izin dapat menerbitkan form untuk divisinya. Tiket menyimpan versi dan jawaban form |
| FR-18 | Audit log | Sistem mencatat pelaku, waktu, tindakan, status asal, status tujuan, unit asal, unit tujuan, dan alasan |
| FR-19 | Surat InOffice | Form pengajuan menerima nomor surat maksimal 100 karakter, tanggal valid, dan satu PDF opsional maksimal 10 MB; file privat hanya dapat diunduh oleh pengguna yang berhak melihat tiket |
| FR-20 | Revisi terstruktur | Unit memilih kolom/dokumen yang diminta; Cabang hanya dapat mengubah pilihan tersebut. Permintaan, jawaban, lampiran, dan snapshot sebelum/sesudah tetap tersimpan pada tiket yang sama. Perubahan field yang ditandai memengaruhi keputusan kembali ke Korwil |
| FR-21 | Alasan penolakan | Penolakan memerlukan alasan aktif dari cakupan sistem, Divisi, atau katalog pekerjaan serta catatan penjelas; keputusan menyimpan snapshot alasan |
| FR-22 | Persetujuan dan Berita Acara | Penerusan/penyelesaian meminta konfirmasi eksplisit; Korwil dan Divisi dapat melampirkan Berita Acara PDF privat, opsional sampai kewajiban ditetapkan pemilik proses |
| FR-23 | Ringkasan Dashboard | Admin dapat membuka Pemantauan Tiket dari kartu ringkasan, Korwil, atau Divisi dengan filter tanggal, status, kondisi SLA, dan cakupan yang sesuai |
| FR-24 | Prioritas tiket Dashboard | Daftar terbaru menampilkan lima tiket per halaman; tiket terbuka yang paling mendesak berdasarkan SLA tampil lebih dulu, lalu tiket selesai, lalu ditolak |
| FR-25 | Ringkasan Direksi | Dashboard peran Manajemen tidak menampilkan kartu Selesai dan Ditolak; kartu ringkasan lain tetap mengarah ke Pemantauan Tiket sesuai filternya |

## 11. Dashboard dan notifikasi

### Dashboard Cabang

Menampilkan pengajuan milik Cabang, status saat ini, unit yang memegang, waktu terakhir berubah, sisa atau selisih SLA, permintaan kelengkapan, dan timeline.

### Dashboard Korwil

Menampilkan pengajuan aktif dari 7 Cabang di bawah Korwil tersebut, pengajuan yang belum diambil, pengajuan yang perlu diperiksa, permintaan revisi, pengajuan yang akan diteruskan ke Pusat, dan total waktu Korwil per pengajuan. Tampilan Riwayat memuat tiket yang pernah masuk ke Korwil tersebut dan sudah berpindah dari antrean Korwil, termasuk yang diteruskan ke Pusat, menunggu kelengkapan Cabang, selesai, atau ditolak. Status dan lokasi terkini tetap terlihat dan detail membuka timeline tiket.

### Dashboard Divisi Pusat

Menampilkan pengajuan yang saat ini berada di divisi tersebut, pengajuan yang belum diambil, pengajuan yang sedang diproses, permintaan kelengkapan yang menunggu Cabang, dan pengajuan yang melewati SLA. Tampilan Riwayat memuat tiket yang benar-benar pernah masuk ke antrean divisi itu, baik dikirim langsung Cabang atau diteruskan Korwil, dan sudah berpindah dari antrean atau ditutup. Pengajuan yang baru memilih divisi tetapi belum masuk ke antrean divisi tidak termasuk riwayat. Status, lokasi terkini, dan timeline tiket tetap tersedia.

### Dashboard Supervisor atau Manajemen

Menampilkan pemantauan untuk semua tiket dan seluruh status, bukan hanya tiket yang sedang menunggu jawaban Cabang. Daftar menampilkan status, lokasi penanganan terkini, umur tiket, dan badge SLA; Supervisor atau Manajemen global dapat membuka detail secara baca-saja sampai timeline pengajuan. Filter tersedia berdasarkan status, kondisi SLA, rentang tanggal, Cabang, Korwil, dan Divisi. Dashboard global dan Pemantauan Tiket memakai rentang bawaan 60 hari terakhir, termasuk hari ini; pengguna dapat memperluas tanggal secara manual untuk melihat pengajuan sebelumnya. Kartu ringkasan serta baris Korwil/Divisi membuka daftar pemantauan dengan filter yang sesuai. Daftar terbaru menampilkan lima tiket per halaman dengan tiket terbuka paling mendesak lebih dulu, disusul tiket selesai dan ditolak. Kartu Selesai dan Ditolak tidak tampil pada dashboard peran Manajemen/Direksi. Filter halaman pemantauan dibuka melalui modal ringkas di samping judul.

### Notifikasi MVP

Notifikasi aplikasi dikirim saat:

- pengajuan baru masuk ke unit;
- pengajuan diambil;
- pengajuan dikembalikan;
- pengajuan diteruskan ke Divisi Pusat;
- kelengkapan diminta;
- kelengkapan dikirim kembali;
- pengajuan mendekati atau melewati SLA;
- pengajuan ditolak atau selesai.

Penerima mengikuti keanggotaan unit yang aktif di Sistem SLA. Pengajuan baru dan pelengkapan Cabang dikirim ke unit tujuan; saat pengajuan diambil, dikembalikan, diminta kelengkapan, ditolak, atau selesai, Cabang pemilik tiket diberi kabar; jawaban kelengkapan dikirim ke unit yang meminta. Daftar hanya menampilkan tiket yang masih dapat diakses pengguna berdasarkan cakupan saat ini. Notifikasi dapat ditandai dibaca satu per satu atau sekaligus dan membuka detail tiket.

Badge mendekati atau melewati SLA sudah memakai target umum MVP 7 hari dan ambang 3 hari. Notifikasi otomatis untuk peringatan SLA belum diaktifkan; kanal dan frekuensi notifikasinya ditentukan setelah dashboard diuji.

Kanal email atau pesan eksternal ditentukan setelah kebutuhan dan akses organisasi disahkan.

## 12. Audit, keamanan, dan kebutuhan nonfungsional

- Semua perpindahan unit, perubahan status, pengambilan, komentar, lampiran, revisi, dan perubahan tujuan dicatat.
- Lampiran disimpan privat dan hanya dapat diakses setelah pemeriksaan hak pengguna.
- Server memeriksa cakupan Cabang atau Divisi Pusat pada setiap request API.
- Nomor pengajuan tetap sama sepanjang proses dan revisi.
- Waktu disimpan dengan timezone yang ditetapkan organisasi dan ditampilkan konsisten pada aplikasi.
- Sistem menampilkan pesan yang jelas jika kode Cabang, Korwil, Divisi Pusat, jenis pekerjaan, atau target SLA belum dikonfigurasi.
- Payload pengajuan divalidasi dengan skema Zod yang ketat; query SQL menggunakan parameter binding untuk semua nilai dari pengguna.
- Lampiran surat InOffice memeriksa ekstensi PDF, MIME, dan signature `%PDF-` serta dibatasi 10 MB. File disimpan di `PRIVATE_UPLOAD_DIR`, tidak disajikan sebagai file publik, dan setiap unduhan memeriksa scope tiket. Retensi, backup, pemulihan, logging, dan monitoring perlu ditetapkan sebelum produksi.
- Target kinerja dan ketersediaan ditetapkan oleh tim IT sesuai infrastruktur yang dipilih.
- Akun sintetis untuk mencoba seluruh role tersedia pada development dan staging privat melalui `DUMMY_AUTH_ENABLED=true` dengan `NODE_ENV=development`. Akun tersebut ditandai dalam `dummy_users`, memakai data profil tanpa password, dan tetap diperiksa dengan assignment role/scope MySQL. Replacement fixture hanya boleh menyasar database staging terpisah bernama dengan akhiran `_staging`; backend tetap harus menolak konfigurasi autentikasi dummy pada production dan database production tidak boleh ditimpa fixture development.

## 13. Model data konseptual

Tabel atau entitas awal:

- `master_kantor`: kode kantor, nama kantor, nilai Korwil, dan status aktif; tabel awal lokal sudah tersedia.
- `korwils`: master kode dan nama Korwil jika nanti diperlukan untuk pengelolaan Korwil terpisah.
- `central_divisions`: kode, nama, dan status aktif Divisi Pusat.
- `division_sso_unit_aliases`: nama unit `unit_kerja` SSO yang dipetakan ke satu Divisi Pusat; alias tidak memberi role dan dikelola Admin melalui master divisi.
- `work_catalogs`: jenis pekerjaan, Divisi Pusat, pilihan jalur routing (`branch_korwil_central` atau `branch_central`), dan target SLA.
- `work_catalog_form_versions`: versi definisi field dan pengaturan kelompok berulang yang diterbitkan untuk katalog pekerjaan; versi lama tidak ditimpa.
- `user_role_scopes`: role, scope organisasi, status assignment, dan izin opsional untuk mengelola form Divisi.
- `users`: akun, peran, kode Cabang atau unit, serta status aktif.
- `dummy_users`: allowlist akun sintetis untuk autentikasi development saja; bukan sumber role atau scope.
- `service_requests`: data utama pengajuan, pemilik tindakan saat ini, versi form yang dipakai, jawaban snapshot, nominal kredit jika ada, dan metadata nomor/tanggal surat InOffice.
- `request_sla_sessions`: seluruh sesi timer per unit.
- `request_status_histories`: perubahan status dan tahap.
- `request_assignments`: histori penugasan dan pengambilan.
- `request_comments`: komentar dan permintaan kelengkapan.
- `request_revisions`: item permintaan kelengkapan, jawaban Cabang, serta snapshot sebelum/sesudah tiap putaran revisi.
- `request_attachments`: lampiran privat dan metadata file.
- `rejection_reasons`: alasan penolakan bawaan sistem, tambahan Divisi, atau khusus katalog pekerjaan.
- `request_decisions`: keputusan petugas, snapshot alasan, konfirmasi persetujuan, dan tautan Berita Acara.
- `notifications`: notifikasi aplikasi.
- `audit_logs`: catatan tindakan yang perlu diaudit.

Relasi penting:

```text
Korwil 1 --- banyak Cabang
Divisi Pusat 1 --- banyak Jenis Pekerjaan
Cabang 1 --- banyak Pengajuan
Pengajuan 1 --- banyak Sesi SLA
Pengajuan 1 --- banyak Histori Status
Pengajuan 1 --- banyak Komentar dan Lampiran
```

## 14. Stack aplikasi

| Bagian | Pilihan MVP | Catatan |
|---|---|---|
| Backend | Node.js + Express + TypeScript REST API | Menangani autentikasi, aturan bisnis, routing, SLA, audit, dan notifikasi |
| Frontend | SvelteKit dan TypeScript | Menangani form, antrean, dashboard, timeline, dan state UI |
| UI | shadcn-svelte dan Tailwind CSS | Dipakai untuk komponen admin yang konsisten dan mudah dirawat |
| Database | MySQL | Menyimpan data transaksi, master, histori, dan konfigurasi |
| Auth | SSO perusahaan dengan bearer token | Frontend menyimpan token di `sessionStorage` per-tab agar bertahan saat reload, mengirimkannya melalui header Authorization, dan menghapusnya saat logout atau token ditolak; Express memvalidasi token dengan `whoami` dan memeriksa akses lokal pada endpoint terlindungi. Auth dummy lokal development dapat dipakai untuk UAT role, dinonaktifkan secara default, dan tidak boleh aktif pada production |
| Queue | Belum diperlukan untuk alur dasar MVP | Notifikasi terjadwal dapat ditambahkan setelah kebutuhan dan beban diketahui |
| Storage | Storage privat yang disetujui organisasi | Lampiran tidak disimpan sebagai file publik |
| API | Prefix `/api/v1` | Menjaga ruang untuk perubahan API berikutnya |

Repository memakai folder `backend/` untuk REST API Express dan `frontend/` untuk SvelteKit. Frontend berkomunikasi dengan backend melalui API dan tidak mengakses MySQL secara langsung.

### Integrasi login SSO

SSO perusahaan memverifikasi identitas pegawai. Express menjadi perantara antara frontend dan SSO; browser tidak memanggil SSO secara langsung.

| Operasi | Kontrak dari SSO |
|---|---|
| Login | `POST https://apisso.bkkjateng.co.id/api/auth/login` dengan `id_peg`, `password`, dan `app` |
| Profil pengguna | `GET https://apisso.bkkjateng.co.id/api/auth/whoami` dengan header `Authorization: Bearer <token>` |
| App code sementara | `simpeg`, sesuai arahan pemilik proyek; ganti setelah app code khusus Sistem SLA terdaftar |
| Token | Respons login memberikan bearer token yang dipakai untuk meminta profil pengguna |
| Field profil | `kode`, `employee_id`, `full_name`, `email`, `telp`, `branch_name`, `unit_kerja`, `job_position`, `level`, dan `group_jabatan` |

Alur aplikasi: frontend mengirim kredensial ke endpoint login milik Express; Express meneruskan login ke SSO dan meminta profil melalui `whoami`. Setelah validasi, Express mengembalikan bearer token dan profil yang diperlukan ke frontend. Frontend menyimpan bearer token di `sessionStorage` per-tab agar sesi bertahan saat halaman di-reload, lalu mengirimkannya ke API menggunakan header `Authorization: Bearer <token>`. Setelah reload, profil diminta kembali melalui backend. ID pegawai terakhir boleh diingat di `sessionStorage` untuk mengisi form login; password tidak pernah disimpan. Endpoint Admin memvalidasi token dengan memanggil `whoami`, lalu memeriksa akun lokal dan hak akses SLA. Password dan token tidak boleh masuk ke repository atau log.

Saat logout, frontend menghapus token dari state autentikasi dan `sessionStorage`; request berikutnya tidak mengirim header Authorization. Token juga dihapus jika API menolaknya dengan 401. Sesi per-tab bertahan saat reload dan berakhir saat tab ditutup atau pengguna logout. Kontrak SSO yang diberikan belum menyebut endpoint pencabutan token, jadi logout aplikasi belum tentu membatalkan token di SSO sebelum token kedaluwarsa. Header tetap menjadi cara mengirim token pada setiap request, bukan tempat penyimpanan.

SSO membuktikan identitas dan menyediakan profil organisasi terkini. Admin mengelola status aktif dan role aplikasi pada data pengguna lokal; sinkronisasi profil tidak mengaktifkan akun dan tidak memberi role. Scope untuk role Pengguna Cabang diturunkan dari kode kantor SSO yang dipetakan ke `master_kantor`; scope Petugas Korwil diturunkan dari mapping kantor atau informasi organisasi SSO yang cocok dengan Korwil; scope Petugas Divisi Pusat diturunkan dari `unit_kerja` yang cocok dengan `master_divisi`. Scope tersebut diselaraskan otomatis ketika profil tersinkron, dan perubahan dicatat di audit akses. Jika scope belum dapat dipetakan, akses role terkait ditolak sampai profil cocok. Kode Pusat tidak memberikan scope Pengguna Cabang. Akun yang belum aktif atau belum memiliki role lokal tetap tidak mendapat akses. Sistem tidak menyimpulkan role dari jabatan.

Express menangani seluruh komunikasi dengan SSO. Path endpoint login (`/api/auth/login`) dan profil (`/api/auth/whoami`) ditetapkan di backend karena merupakan bagian dari kontrak API. `.env` backend menyimpan konfigurasi yang dapat berbeda antar lingkungan: base URL SSO, app code sementara `simpeg`, dan timeout request. Nilai environment yang aman dicantumkan di `.env.example`, sedangkan `.env` lokal tidak boleh masuk Git. Setelah app code khusus Sistem SLA didaftarkan, cukup ubah nilainya di `.env`. Password pegawai dimasukkan saat login, bukan disimpan di `.env`; bearer token hanya diproses saat runtime. Status akses dan role lokal dikelola melalui assignment MySQL dan tidak disimpulkan otomatis dari jabatan. Masa berlaku token dan format error SSO tetap perlu dipastikan. Password, bearer token, dan data pribadi dari contoh tidak disimpan di repository.

Antarmuka memakai gaya shadcn yang bersih, tetapi tidak menyalin produk tertentu. Fokus utama adalah antrean kerja, status, countdown SLA, filter, form bertahap, dan timeline pengajuan.

## 15. Tahapan implementasi

### Tahap 1: Fondasi organisasi dan akses

- Buat struktur Express API dan SvelteKit dengan MySQL.
- Buat pengguna, peran, Korwil, Cabang, dan mapping kode kantor.
- Masukkan 28 kode kantor ke 4 Korwil.
- Buat autentikasi dan pembatasan cakupan data.

### Tahap 2: Katalog dan form

- Buat master Divisi Pusat.
- Buat katalog jenis pekerjaan per divisi.
- Buat editor form per katalog untuk Admin global dan Petugas Divisi yang diberi izin.
- Simpan versi form dan snapshot jawaban bersama pengajuan; validasi field dinamis di backend.
- Tetapkan field wajib dan lampiran privat sesuai katalog setelah disahkan pemilik proses.

### Tahap 3: Workflow inti

- Buat pengajuan, antrean Korwil, tombol Ambil, dan persetujuan.
- Buat penerusan ke Divisi Pusat.
- Buat status, komentar, lampiran, penolakan, dan penyelesaian.
- Buat aturan revisi berkas dan revisi substansi.

### Tahap 4: SLA dan visibilitas

- Buat `request_sla_sessions`.
- Hitung durasi 24 jam dan akumulasi waktu per unit.
- Buat dashboard antrean, timeline, dan status SLA.
- Tambahkan notifikasi aplikasi dan audit log.

### Tahap 5: Pilot

- Uji dengan data contoh dari seluruh Korwil.
- Verifikasi mapping, katalog pekerjaan, hak akses, routing, dan perhitungan sesi.
- Perbaiki aturan berdasarkan hasil pilot sebelum digunakan luas.

## 16. Skenario penerimaan bisnis

| Skenario | Hasil yang diharapkan |
|---|---|
| Pengguna Cabang 001 mengirim pekerjaan yang disetel melalui Korwil | Sistem mengarahkan pengajuan ke Korwil Semarang Raya |
| Pengguna Cabang 008 mengirim pekerjaan yang disetel melalui Korwil | Sistem mengarahkan pengajuan ke Korwil Solo Raya |
| Pengguna Cabang 015 mengirim pekerjaan yang disetel melalui Korwil | Sistem mengarahkan pengajuan ke Korwil Banyumas Raya |
| Pengguna Cabang 022 mengirim pekerjaan yang disetel melalui Korwil | Sistem mengarahkan pengajuan ke Korwil Pekalongan Raya |
| Admin memberi role Pengguna Cabang kepada pegawai | Backend menetapkan cakupan kantor dari profil SSO terkini; Admin tidak memilih kantor pada form |
| Pegawai Cabang pindah ke kantor lain | Setelah profil SSO terbaru tersinkron, cakupan role mengikuti kantor baru tanpa mengubah kantor asal atau histori tiket |
| Kacab baru diberi role Pengguna Cabang pada kantor yang sama | Ia dapat melihat dan melanjutkan pengajuan kantor tersebut, termasuk pengajuan yang dibuat Kacab sebelumnya |
| Profil SSO menunjukkan Pusat atau kode kantor belum terpetakan untuk role Pengguna Cabang | Sistem tidak menampilkan akses Cabang dan API menolak akses Cabang |
| Admin memberi role Petugas Korwil | Backend menetapkan Korwil dari mapping kantor aktif atau profil organisasi SSO; Admin tidak memilih Korwil pada form |
| Pegawai Korwil pindah wilayah | Setelah profil SSO terbaru tersinkron, scope Korwil mengikuti wilayah baru; scope lama tidak memberikan akses |
| Admin memberi role Petugas Divisi Pusat | Backend menetapkan divisi dari `unit_kerja` SSO yang cocok dengan master divisi aktif; Admin tidak memilih divisi pada form |
| Pegawai Divisi Pusat pindah divisi | Setelah profil SSO terbaru tersinkron, scope mengikuti divisi baru dan divisi lama tidak lagi memberi akses |
| `unit_kerja` SSO belum cocok dengan divisi aktif | Role tetap ditetapkan secara lokal, tetapi API tidak memberi akses sebagai petugas divisi sampai profil dapat dipetakan |
| `unit_kerja` SSO bernilai `Satuan Kerja Audit Internal` | Alias master memetakan profil ke SKAI saat profil tersinkron; role dan status aktif tetap harus ditetapkan Admin |
| Admin mengubah alias unit SSO pada Divisi Pusat | Alias tersimpan unik pada satu divisi dan cakupan pegawai diperbarui saat profil SSO berikutnya tersinkron |
| Admin memasukkan alias yang sudah dimiliki divisi lain | API menolak perubahan dan tidak mengubah master divisi |
| Cabang mengajukan kredit di bawah Rp250 juta | Sistem menolak dan tidak membuat tiket |
| Cabang mengajukan kredit minimal Rp250 juta dan memilih Korwil | Sistem membuat tiket Korwil dengan versi form serta jawaban Pengajuan Kredit Pemasaran |
| Cabang mengajukan kredit minimal Rp250 juta dan memilih Pusat | Sistem mengirim ke Pemasaran langsung atau melalui Korwil sesuai pengaturan katalog Pengajuan Kredit, tanpa mengubah tujuan berdasarkan ambang nilai |
| Admin memberi izin kelola form pada Petugas Divisi | Petugas hanya dapat mengubah form divisi yang dipetakan dari profil SSO dan assignment aktifnya |
| Pengelola menerbitkan versi baru form | Pengajuan berikutnya memakai versi baru; tiket lama tetap menampilkan jawaban versi sebelumnya |
| Pengelola mengaktifkan kelompok data berulang pada form non-kredit dengan batas 5 | Cabang dapat mengisi kelompok pertama, menambah sampai 5 kelompok, menghapus tambahan, dan setiap kelompok divalidasi serta ditampilkan terpisah pada detail tiket |
| Cabang mengirim lebih banyak kelompok daripada batas form atau kelompok kosong | Backend menolak pengajuan dan tidak membuat tiket |
| Cabang memilih kewenangan Korwil | Pengajuan masuk ke Korwil dan dapat selesai di Korwil |
| Cabang memilih kewenangan Pusat | Cabang wajib memilih Divisi Pusat dan jenis pekerjaan yang tersedia |
| Admin mengatur jalur pekerjaan ke Cabang → Korwil → Pusat | Pengajuan pekerjaan itu masuk ke antrean Korwil untuk diperiksa sebelum diteruskan |
| Admin mengatur jalur pekerjaan ke Cabang → Pusat langsung | Pengajuan pekerjaan itu masuk langsung ke antrean Divisi Pusat yang dipilih Cabang |
| Korwil menyetujui pekerjaan dengan jalur melalui Korwil | Pengajuan masuk ke antrean Divisi Pusat yang dipilih Cabang |
| Cabang mengirim pekerjaan dengan jalur langsung | Pengajuan masuk langsung ke antrean Divisi Pusat; pekerjaan tidak muncul di antrean atau riwayat Korwil |
| Pusat meminta dokumen tambahan | Cabang melengkapi tiket yang sama dan mengirim langsung kembali ke Pusat |
| Pusat meminta perubahan substansi | Pengajuan kembali ke Korwil untuk pemeriksaan ulang |
| Korwil memproses 2 jam lalu pengajuan kembali ke Korwil | Sistem menyimpan dua sesi dan menjumlahkan total waktu Korwil |
| Korwil memproses 5 menit, meminta kelengkapan, lalu memproses 10 menit setelah jawaban Cabang | Sesi Korwil dijumlahkan menjadi 15 menit; sesi Cabang tampil terpisah; umur total mencakup seluruh perjalanan tiket |
| Pengajuan Korwil belum diambil | Timer proses Korwil belum mulai; waktu antre tampil terpisah dan tetap termasuk umur total tiket |
| Cabang melengkapi permintaan Korwil | Nomor tiket tetap sama dan sesi Korwil baru dimulai saat Cabang mengirim pelengkapan |
| Petugas Korwil yang meminta kelengkapan masih aktif dan scope-nya cocok | Tiket kembali otomatis kepadanya dengan status Diproses Korwil; tombol Ambil tidak muncul lagi |
| Petugas yang meminta sudah tidak aktif atau scope-nya berubah | Tiket kembali ke antrean unit tanpa pemilik; timer tetap berjalan sejak pengiriman Cabang |
| Divisi Pusat meminta dokumen | Sesi Divisi berhenti, sesi Cabang berjalan, lalu tiket kembali langsung ke Divisi yang meminta |
| Pengajuan jalur melalui Korwil dikirim pukul 21:00 | Umur tiket dimulai langsung; sesi Korwil dimulai saat diambil dan sesi Divisi dimulai saat Korwil meneruskan lalu petugas Divisi mengambil |
| Pengajuan jalur langsung dikirim pukul 21:00 | Umur tiket dimulai langsung; sesi Divisi masuk antrean saat Cabang mengirim dan timer Divisi dimulai saat petugas mengambil |
| Pengguna di luar cakupan membuka tiket | API menolak akses dan tidak mengembalikan data tiket |
| Petugas Korwil membuka Riwayat | Hanya tiket yang pernah dirutekan ke Korwil pada scope tersebut dan sudah keluar dari antreannya yang ditampilkan |
| Petugas Divisi membuka Riwayat | Hanya tiket yang pernah masuk ke divisi pada scope tersebut dan sudah keluar dari antrean atau ditutup yang ditampilkan |
| Tiket memilih Divisi Pusat tetapi ditolak Korwil sebelum diteruskan | Tiket tidak muncul pada riwayat Divisi Pusat yang dipilih |

## 17. Keputusan yang perlu disahkan

1. Daftar jenis pekerjaan yang dimiliki setiap Divisi Pusat.
2. Jenis pekerjaan yang boleh selesai di Korwil dan yang harus diteruskan ke Pusat.
3. Kolom dan lampiran wajib untuk setiap jenis pekerjaan, termasuk field Keringanan bunga.
4. Target SLA khusus untuk Korwil, Cabang, dan setiap Divisi Pusat setelah target umum MVP 7 hari dievaluasi.
5. Apakah setelah MVP target SLA dihitung per jenis pekerjaan atau tetap memakai target umum.
6. Peran yang boleh menyetujui penerusan dari Korwil ke Pusat.
7. Batas tindakan Petugas Korwil dan Penyetuju Korwil.
8. Aturan perubahan substansi yang wajib kembali ke Korwil.
9. Aturan pembatalan setelah pengajuan diambil.
10. Kanal notifikasi setelah notifikasi aplikasi diuji.
11. Pendaftaran app code khusus Sistem SLA untuk menggantikan sementara `simpeg`.
12. Masa berlaku token dan format error resmi dari SSO.
13. Standar hosting, storage, backup, dan logging dari tim IT.

## 18. Ukuran keberhasilan

Target angka ditentukan setelah baseline tersedia. Indikator awal:

- Persentase pengajuan yang berhasil dirouting ke Korwil yang benar.
- Persentase pengajuan yang masuk ke Divisi Pusat sesuai katalog.
- Persentase pengajuan dengan pemilik tindakan yang jelas.
- Waktu menunggu sebelum pengajuan diambil.
- Total waktu Korwil, Cabang, dan Divisi Pusat per pengajuan.
- Persentase pengajuan yang selesai sesuai target SLA setelah target disahkan.
- Jumlah pengajuan yang dikembalikan karena kelengkapan.
- Jumlah pengajuan yang harus kembali ke Korwil karena perubahan substansi.
- Jumlah pengajuan tanpa histori atau alasan tindakan yang lengkap.

