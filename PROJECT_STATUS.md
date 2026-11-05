# Status Proyek Sistem SLA

Terakhir diperbarui: 5 November 2026

**Dokumentasi project (5 November 2026):** `README.md` dirapikan agar sesuai dengan implementasi aktual: role dan scope, alur workflow, aturan timer SLA, dashboard Manajemen, konfigurasi SSO lokal, endpoint utama, pemeriksaan lokal, batasan MVP, dan struktur folder. Karakter encoding rusak serta referensi status lama di README dihapus. Tidak ada perubahan kode, migrasi, atau data bisnis.

**Publikasi repository (5 November 2026):** commit awal Sistem SLA sudah dipush ke repository GitHub `nadhifmaulana2508/sla-pengajuan` pada branch `main`. Working tree bersih; file `.env` dan dump database lokal tidak ikut terlacak.

**Percobaan QA visual/click-through Manajemen (5 November 2026):** server lokal backend/frontend aktif dan halaman login Sistem SLA berhasil terbuka di browser. Akun lokal dengan role Manajemen tersedia. Pemeriksaan belum selesai karena sesi Computer Use dihentikan dengan tombol Escape fisik sebelum login dan sweep viewport/filter/detail dilakukan. Tidak ada perubahan kode, migrasi, assignment, atau data bisnis dari percobaan ini.

**Verifikasi menjalankan sistem lokal (5 November 2026):** backend dev server aktif di `http://localhost:3000` dan frontend Vite aktif di `http://localhost:5173/`. Frontend merespons HTTP 200; endpoint backend merespons dan menolak `whoami` tanpa autentikasi dengan 401 sesuai harapan. Tidak ada perubahan kode, migrasi, atau data bisnis.

**Pembukaan frontend di browser (5 November 2026):** URL `http://localhost:5173/` dibuka langsung melalui browser default karena kontrol browser Windows sedang tidak tersambung. Verifikasi HTTP tetap berhasil; jika tab masih menampilkan Tab Baru, tekan Enter pada address bar setelah memastikan URL tersebut.

**Laporan status untuk pimpinan (5 November 2026):** PDF `output/pdf/Laporan_Status_Sistem_SLA.pdf` dibuat dan dirender 6 halaman untuk pemeriksaan layout. Isinya mencakup gambaran sistem, alur dan aturan SLA, fitur yang sudah tersedia, hasil verifikasi lokal, kekurangan/risiko, keputusan yang masih dibutuhkan, serta roadmap pra-pilot. Tidak ada password, bearer token, atau data pribadi pegawai di dalam laporan.

**Laporan lengkap dengan flow, hak akses, dan screenshot (5 November 2026):** PDF `output/pdf/Laporan_Status_Sistem_SLA_Lengkap.pdf` memperluas laporan menjadi 14 halaman. Tambahan mencakup flow swimlane Cabang, Korwil, Divisi Pusat, Manajemen, dan Admin; matriks role/scope/menu/tindakan; serta 12 screenshot menu utama. Screenshot diambil dari UI lokal melalui browser headless dengan mock API dan data demo non-sensitif, diberi ribbon simulasi, dan tidak menggantikan UAT akun nyata. Semua halaman PDF dirender ulang dan diperiksa visual; tidak ada password, bearer token, atau data pribadi pegawai yang dimasukkan.

**Perbaikan diagram arsitektur PDF (5 November 2026):** diagram pada halaman 2 laporan lengkap digambar ulang dengan jarak antar kotak yang lebih lega. Label Backend, Data + SSO, dan keterangan koneksi kini tidak saling bertabrakan. Halaman 2 dirender ulang dan diverifikasi visual; isi sistem dan data laporan tidak berubah.

**Export database lokal (5 November 2026):** database `sla_pengajuan` berhasil diekspor menggunakan `mysqldump` user `root` ke `output/db/sla_pengajuan_root_2026-11-05.sql`. Dump berisi database definition, 14 tabel, data, trigger, event, dan routine jika ada. Ukuran file 44.343 byte; SHA-256 `6B3D23E1C50DE4DEA464AD8E801F0CD1F6852EB82586E7F15441450F5FA09645`. File dapat memuat data lokal, jadi perlakukan sebagai artefak terbatas dan jangan dikirim ke pihak lain tanpa persetujuan.

**Milestone Dashboard Manajemen dan pemantauan Cabang (5 November 2026):** role Manajemen, Supervisor, dan Admin global kini dapat membuka detail tiket secara baca-saja karena pemeriksaan akses detail mengenali assignment global tanpa memberi hak tindakan. Target sementara seluruh katalog dan sesi SLA diset 7 hari kalender melalui migrasi `010_default_sla_seven_days.sql`; badge hijau berarti umur tiket <3 hari, kuning 3-7 hari, dan merah >7 hari. Endpoint `/api/v1/dashboard` menerima filter Korwil dan Divisi Pusat, mengembalikan opsi filter serta hitungan SLA. Halaman `/management/branch-follow-up` menampilkan tiket `waiting_branch_revision` dengan filter Cabang dan tautan detail. Frontend dashboard menampilkan badge SLA pada kartu ringkasan dan daftar tiket. Backend/frontend check dan production build lulus; frontend check 0 error/0 warning. Migrasi 010 berhasil diterapkan dan seluruh 12 katalog serta 20 sesi lokal memakai 10.080 menit. Batas tepat 3 hari diputuskan masuk kuning dan tepat 7 hari tetap kuning.

**Verifikasi build ulang (5 November 2026):** backend `npm.cmd run check` dan `npm.cmd run build` lulus. Frontend `npm.cmd run check` lulus dengan 0 error dan 0 warning, lalu production build selesai berhasil setelah proses build dijalankan ulang secara terpisah. Catatan syntax/build lama pada milestone notifikasi tidak terulang.

**Perbaikan responsif detail tiket (5 November 2026):** panel `Tindakan pengajuan` kini menempatkan aksi secara horizontal dan rata ke sisi tindakan pada desktop, menjadi dua kolom pada ponsel, lalu satu kolom pada layar sangat sempit. Detail utama dan timeline beralih ke satu kolom pada lebar tablet agar isi tidak terjepit. CSS bersama menahan header/content Card tetap memiliki lebar minimum nol dan membungkus judul atau deskripsi panjang. Frontend check menemukan 0 error dan 0 warning, production build lulus. Perubahan hanya presentasi; alur tindakan dan aturan SLA tidak berubah. Tugas berikutnya tetap sweep visual/responsive seluruh route, tema, fokus keyboard, menu/dialog, dan click-through sesuai bagian `Tugas berikutnya`.

**Perbaikan bug pemetaan Dashboard (5 November 2026):** error intermiten `Cakupan dashboard pada akun belum dapat dipetakan` diperbaiki dengan menjadikan resolver akses sebagai satu sumber assignment untuk endpoint dashboard. Dashboard tidak lagi memilih assignment lewat resolver lalu mencarinya ulang dengan query berbeda; metadata kantor atau Divisi diambil dari assignment yang sama. Resolver juga menyamakan validasi bahwa Divisi tujuan masih aktif. Smoke test read-only pada seluruh akun aktif lokal berhasil untuk view Admin, Cabang, Korwil, dan Divisi tanpa error pemetaan. Backend `npm.cmd run check` dan `npm.cmd run build` lulus; frontend `npm.cmd run check` menemukan 0 error dan 0 warning. Detail Manajemen, filter Korwil/Divisi, halaman tindak lanjut Cabang, dan label SLA kemudian ditambahkan pada milestone 5 November 2026.

**QA visual/responsive (4 November 2026):** laporan awal dibuat di [QA_VISUAL_RESPONSIVE_2026-11-04.md](QA_VISUAL_RESPONSIVE_2026-11-04.md). Sepuluh route frontend merespons HTTP 200 dan halaman login terbaca melalui accessibility tree browser; reload mempertahankan ID pegawai non-sensitif yang diingat per-tab. Sweep visual exact viewport, screenshot, menu/dialog, route terautentikasi, tema, fokus keyboard, dan logout belum lulus karena capture browser timeout serta sesi SSO tidak tersedia. Dua isu source-level dari laporan awal sudah diperbaiki: `html lang="id"` pada `frontend/src/app.html` dan token `--destructive-foreground` untuk badge notifikasi pada `frontend/src/routes/layout.css`. Frontend check/build lulus; tidak ada perubahan alur bisnis, API, atau database.

## Posisi sekarang

**Dashboard operasional (4 November 2026):** modul baru `backend/src/modules/dashboard/` menyediakan endpoint terautentikasi `/api/v1/dashboard` dengan scope runtime dari assignment MySQL untuk Cabang, Korwil, Divisi Pusat, Admin, Supervisor, dan Manajemen. Ringkasan mencakup status, revisi, antrean, pekerjaan berjalan, menunggu Cabang, tiket selesai/ditolak, umur tiket, total waktu unit, serta breakdown Korwil dan Divisi; dashboard global mendukung filter tanggal berdasarkan `submitted_at`. Dashboard Divisi hanya menghitung tiket yang benar-benar pernah diteruskan ke divisi tersebut. Frontend `/dashboard` menampilkan komposisi sesuai peran, daftar tiket terbaru yang dapat dibuka ke detail, state loading/error/empty, dan filter tanggal untuk dashboard global. Tidak ada label tepat waktu/terlambat dan tidak ada target SLA baru. Backend check/build dan frontend check lulus; smoke test service admin lokal mengembalikan ringkasan dan filter tanggal, health/database health lulus, serta dashboard tanpa bearer menolak 401. Production build frontend menyelesaikan transform/render tetapi finalisasi SvelteKit gagal karena proses dev/build lama di workspace menghapus `.svelte-kit/output/server`; perlu diulang setelah proses tersebut tidak berjalan. Click-through dashboard dengan sesi role Cabang/Korwil/Divisi belum dilakukan.

**E2E notifikasi (4 November 2026):** penerima dan event notifikasi diperketat agar hanya akun aktif dengan assignment scope yang cocok yang dibuatkan notifikasi; daftar, tandai satu, dan tandai semua dibaca juga dibatasi pada tiket yang masih terlihat dalam scope saat ini. Penerusan ke Divisi memberi kabar ke Divisi tujuan dan Cabang; jawaban revisi diarahkan ke petugas peminta yang masih valid, dengan fallback ke antrean unit. Runner `backend/src/scripts/e2e-notifications.ts` dan perintah `npm.cmd run test:e2e:notifications` lulus di MySQL lokal untuk pengajuan baru, Ambil, penerusan, permintaan kelengkapan, jawaban revisi, penolakan, selesai, unread count, tandai satu/semua, isolasi scope, dan pembukaan detail; seluruh fixture dibersihkan. `frontend npm.cmd run check` tetap lulus dengan 0 error/0 warning. Click-through browser aktual belum dapat diselesaikan karena Computer Use menghentikan sesi saat URL browser Windows tidak dapat dipastikan. Pada pemeriksaan backend penuh setelah perubahan, muncul syntax error di `backend/src/modules/dashboard/dashboard.service.ts` pada baris 168–171 dan 249–251; file tersebut tidak diubah dalam milestone ini dan baseline sebelumnya lulus.

**E2E workflow dan timer (4 November 2026):** ditambahkan runner `backend/src/scripts/e2e-workflow-timer.ts` dengan perintah `npm.cmd run test:e2e:workflow`. Fixture akun/assignment sintetis menguji Cabang mengirim tiket, antrean dan isolasi Korwil, timer mulai saat Ambil, permintaan revisi, timer Cabang, pengiriman kembali memakai nomor yang sama, resume Korwil tanpa Ambil ulang, penerusan ke Divisi Pusat, timer Pusat yang baru mulai saat Ambil, penyelesaian, penolakan, riwayat, dan isolasi Divisi. Test terakhir lulus pada MySQL lokal; pemeriksaan pasca-test memastikan akun dan tiket bertanda fixture berjumlah nol. Test menemukan dan memperbaiki update no-op notifikasi resume yang ambigu di MariaDB. Type-check terarah runner serta `npm.cmd run check` dan `npm.cmd run build` penuh lulus.

**Review baseline sesi lanjutan (4 November 2026):** struktur backend Express/MySQL, frontend SvelteKit, autentikasi SSO, assignment scope, workflow tiket, sesi SLA, timeline, dan notifikasi sudah ditelusuri dari source aktual. Backend `npm.cmd run check` dan `npm.cmd run build` lulus; frontend `npm.cmd run check` lulus dengan 0 error/0 warning dan `npm.cmd run build` lulus. Review ini tidak mengubah kode, migrasi, atau data bisnis. Pekerjaan terbuka tetap verifikasi click-through/visual, dashboard operasional, field dinamis, lampiran privat, dan revisi substansi.

**Keputusan timer Divisi Pusat (4 November 2026):** antrean Divisi Pusat tidak dihitung sebagai SLA proses. Sesi awal dibuat saat Korwil meneruskan tiket, tetapi `started_at` dan timer baru dimulai ketika petugas Divisi menekan Ambil; waktu antre dicatat terpisah. Jika Cabang mengirim pelengkapan kembali ke Divisi, handoff langsung tetap memulai sesi baru saat pengiriman, seperti resume pelengkapan Korwil. Perubahan kode dan teks UI sudah diselaraskan; migrasi database tidak diperlukan.

**Verifikasi perubahan timer Pusat (4 November 2026):** sesi Divisi awal kini dibuat tanpa `started_at`, claim mengisi awal timer dengan `start_reason='claim'`, dan resume setelah revisi tetap memakai `start_reason='sent'`. Backend `npm.cmd run check` dan `npm.cmd run build` lulus; frontend `npm.cmd run check` lulus dengan 0 error/0 warning dan production build lulus.

**Pin koneksi SSO lokal (4 November 2026):** backend tetap memakai `SSO_BASE_URL=https://apisso.bkkjateng.co.id` untuk hostname, SNI, dan validasi sertifikat, sementara `SSO_CONNECT_IP=10.0.2.2` pada `backend/.env` memaksa koneksi HTTPS lokal ke IP tersebut. Implementasi memakai lookup IP khusus tanpa mematikan verifikasi TLS. `.env` tetap di-ignore Git; build/check backend lulus.

**Verifikasi login SSO lokal (4 November 2026):** endpoint lokal `/api/v1/auth/login` berhasil memproses akun uji `102-119` melalui SSO dengan konfigurasi IP pinning; respons login 200, `whoami` 200, dan workspace Admin 200 (5 pengguna, 9 divisi, 7 role). Profil memperoleh akses `admin/all` dari assignment database. Token hanya dipakai di memori proses uji dan tidak dicatat. Uji ini memverifikasi API, sedangkan click-through form browser, reload, dan logout masih menunggu pemeriksaan UI.

**Fondasi konsistensi dan responsif UI (4 November 2026, visual lintas perangkat belum final):** skala `text-xs` hingga `text-3xl` kini fluid dan dipakai utility Tailwind serta teks CSS khusus di semua route; shell/judul bersama tetap menjadi pola halaman. Kontrol shadcn pada ponsel mendapat target sentuh minimum 44px dan input 16px untuk mencegah zoom otomatis. Tombol ikon-only menggunakan ghost transparan tanpa latar tetap, bingkai dekoratif di belakang ikon empty-state dihapus, dan tinggi empty-state dipadatkan pada layar sempit. Form menggunakan komponen shadcn yang tersedia; radio pilihan kewenangan tetap kontrol radio native berlabel. `npm.cmd run check` lulus (0 error/0 warning), production build lulus, sepuluh route merespons HTTP 200, dan audit tidak menemukan ukuran teks lokal statis selain ukuran kontrol mobile yang disengaja. Capture browser timeout setelah dua percobaan, jadi belum ada konfirmasi screenshot untuk viewport ponsel/tablet/desktop dan kedua tema; pekerjaan responsif belum ditandai tuntas. Tidak ada perubahan API, PRD, atau database.

**Perbaikan Admin akses pegawai (4 November 2026):** editor role organisasi kini cukup meminta pilihan peran; kantor, Korwil, dan Divisi ditampilkan sebagai cakupan otomatis dari profil SSO. Pemetaan Divisi saat daftar dan simpan akses memakai alias aktif dari `unit_kerja`, sehingga profil lama yang kolom `divisi_id`-nya belum tersinkron tetap dapat dipetakan. Profil unit `Satuan Kerja Audit Internal` berhasil terbaca sebagai Divisi aktif; fixture sementara juga membuktikan penyimpanan role Petugas Divisi mengisi scope dari alias yang sama dan sudah dibersihkan. Tidak ada data pegawai nyata yang diubah. Backend check/build, frontend check (0 error/0 warning), dan frontend production build lulus. Click-through visual modal belum diverifikasi.

**Tahap:** Workflow Cabang, Korwil, dan Divisi Pusat kini mencakup daftar aktif, riwayat per unit, detail/timeline, tindakan, serta akumulasi timer. Admin dapat mengubah nama Divisi dan alias unit kerja SSO tanpa memberi role atau mengaktifkan akun. Setelah Cabang mengirim pelengkapan, tiket kembali ke petugas peminta jika assignment-nya masih aktif; jika tidak, tiket masuk antrean dengan timer tetap mulai saat dikirim. Migrasi `006`–`008` sudah diterapkan. Smoke test MySQL untuk riwayat dan isolasi scope lulus; backend/frontend check (frontend 0 error/0 warning) dan production build lulus. Click-through dengan akun SSO belum terkonfirmasi karena sesi browser gagal memuat profil; unggah lampiran privat belum tersedia.

Riwayat unit dan pemetaan Divisi (4 November 2026): halaman antrean Korwil dan Divisi Pusat memiliki pilihan Aktif/Riwayat. Riwayat hanya berisi tiket yang pernah benar-benar masuk ke unit terkait dan sudah keluar dari antrean atau selesai; daftar dan detail tetap dibatasi scope di backend. Admin mendapat halaman master Divisi untuk mengubah nama serta alias `unit_kerja` SSO, dengan validasi agar alias tidak dipakai dua divisi. Migrasi `008_division_sso_unit_aliases.sql` diterapkan dan memetakan `Satuan Kerja Audit Internal` ke SKAI. Perubahan alias tidak mengubah role/status; scope pegawai mengikuti pemetaan saat profil SSO berikutnya tersinkron. Smoke test MySQL memverifikasi tiket Korwil → Divisi → selesai tampil pada riwayat yang benar dan tidak dapat dibaca Divisi lain; semua fixture uji dibersihkan. Uji pemetaan alias SKAI memastikan akun contoh tidak diaktifkan atau diberi role. Backend `/health`, `/health/database`, serta route halaman Admin Divisi dan antrean/riwayat merespons HTTP 200. Click-through visual dan SSO belum dilakukan karena sesi browser gagal memuat profil.

Perbaikan resume pelengkapan (4 November 2026): `submitBranchRevision` kini mencari petugas pada assignment terdahulu yang meminta dokumen, lalu memastikan akun aktif dan scope Korwil/Divisi masih cocok sebelum memulihkan pemilik tiket. Status, assignment, API response, dan pesan sukses UI menunjukkan apakah tiket otomatis dilanjutkan atau masuk antrean fallback. PRD dan AGENTS.md diperbarui. Smoke test MySQL lokal memverifikasi Korwil dan Divisi dapat langsung bertindak tanpa klaim ulang, timer baru memakai `start_reason='sent'`, serta fallback tetap mempertahankan waktu mulai setelah klaim. Semua tiket uji sementara dibersihkan. Backend check/build, frontend check (0 error/0 warning), dan frontend production build lulus. Browser lokal sedang berada di halaman login; click-through antrean terautentikasi tidak dilakukan.

Verifikasi workflow dan SLA (4 November 2026): smoke test sementara memakai assignment lokal aktif, membuat tiket uji, menguji timer awal yang belum mulai sebelum Korwil mengambil, pengembalian ke Cabang, timer Cabang, pengiriman kembali ke Korwil tanpa nomor baru, sesi Korwil baru yang mulai saat Cabang mengirim, klaim tanpa reset timer, dan penutupan tiket. Tiket sementara dibersihkan sesudah pengujian. Migrasi 006 mengizinkan sesi menunggu tanpa `started_at`, memperluas unit aktif ke Cabang, dan menambahkan `closed_at`; migrasi 007 mencatat pemicu awal sesi dan memberi label data lama. PRD dan instruksi proyek diselaraskan dengan aturan waktu terbaru. Uji login SSO/browser dan siklus Divisi Pusat masih belum dilakukan.

Perbaikan sesi login (4 November 2026): bearer token kini disimpan sementara di `sessionStorage` per-tab dan dipulihkan saat reload; profil diminta ulang melalui `whoami` agar navigasi sesuai role tetap muncul. Logout dan respons 401 membersihkan token. Form mengingat ID pegawai terakhir di tab yang sama dan menyediakan tombol tampil/sembunyikan password; password tidak disimpan dan tidak ada ID/password contoh yang ditanam di source. Svelte check lulus (0 error/0 warning), production build lulus, dan route login lokal merespons HTTP 200 dengan label kontrol password di HTML. Click-through login, reload, logout, serta kontrol password di browser belum diverifikasi pada pekerjaan ini.

API health check dan database lokal `sla_pengajuan` terhubung lewat `/api/v1/health/database`. Database memiliki 29 kantor aktif, 9 divisi, 7 role dasar, akun admin bootstrap, serta tabel `user_access_audit_logs` (migrasi 004 sudah diterapkan). Pemeriksaan tanpa bearer menghasilkan 401 pada API Admin. Kredensial aplikasi lokal disimpan di `backend/.env` yang diabaikan Git.

Verifikasi workflow Cabang awal (4 November 2026, sebelum aturan timer diperbarui): path yang benar mencapai API dan path dobel menghasilkan 404. Dengan profil Cabang dan scope kantor dari MySQL lokal, respons SSO `whoami` dimock untuk tidak mengirim kredensial atau token ke layanan eksternal. API opsi dan daftar merespons 200, submit 201, detail 200, dan daftar setelah submit 200. Kantor 010 dirutekan ke `solo`; pada implementasi saat itu detail menunjukkan sesi Korwil aktif sejak submit. Keputusan timer terbaru dan migrasi 006–007 mengubah sesi awal Korwil menjadi belum dimulai sampai diambil. Tiket lokal `[UJI LOKAL] Verifikasi route Cabang 20261103215229` (`SLA-00000002`) tetap tersimpan untuk inspeksi manual. Uji ini menggunakan SSO dimock, bukan login SSO atau click-through browser.

Verifikasi scope organisasi SSO (3 November 2026): backend check/build dan frontend check/build lulus; tiga kasus inferensi Korwil lulus (mapping dari profil, konflik/unmapped ditolak); halaman `/admin/users` merespons 200. Tidak ada migrasi atau perubahan data MySQL pada pekerjaan ini. Konektor browser tidak menemukan browser yang dapat dikendalikan, jadi tampilan responsif belum diverifikasi dengan click-through.

Verifikasi konsistensi UI (3 November 2026): halaman Beranda, Admin, dan workflow memakai shell konten, jarak, serta hierarki judul bersama yang lebih ringkas; layout login tetap khusus untuk alur autentikasi. Svelte check menghasilkan 0 error/0 warning, production build lulus, dan enam route aplikasi merespons 200. Tidak ada perubahan PRD atau database. Click-through visual lintas ukuran layar belum dilakukan karena browser yang dapat dikendalikan tidak tersedia.

Verifikasi panel Admin (3 November 2026): filter Divisi, pencarian, dan aksi katalog ditempatkan di dalam Card daftar pekerjaan; pencarian dan hitungan hasil berada di Card daftar pegawai. Judul dan keterangan halaman disusun satu baris fleksibel di semua halaman aplikasi dan menumpuk rapat di layar sempit. Svelte check 0 error/0 warning, production build lulus, dan lima route merespons 200. Inventaris konektor menunjukkan tidak ada browser yang dapat dikendalikan, sehingga pemeriksaan visual/click-through belum dilakukan. Tidak ada perubahan PRD atau database.

Verifikasi UI Admin lanjutan (3 November 2026): halaman akses pegawai dan master pekerjaan dirapikan sebagai workspace daftar dengan Card shadcn ukuran ringkas, judul/status sejajar, pencarian berikon, jumlah hasil, header tabel yang lebih jelas, dan hover baris. Kartu responsif untuk mobile tetap dipertahankan dengan jarak yang dipadatkan. Svelte check 0 error/0 warning, production build lulus, route `/admin/users` dan `/admin/master` merespons 200, serta API health merespons 200. Pasangan warna teks dan permukaan yang dipakai lulus pemeriksaan kontras AA. Tidak ada perubahan PRD atau database; pemeriksaan visual/click-through belum dilakukan.

Verifikasi editor akses pegawai (3 November 2026): form dipindah dari atas daftar ke Dialog shadcn-svelte agar tabel tetap menjadi konteks; dialog punya batas tinggi dan scroll internal, tombol tutup berikon, penutupan Escape/klik luar dari primitive Dialog, serta reflow assignment di layar sempit. Svelte check 0 error/0 warning dan production build lulus. Pemeriksaan visual dialog belum tuntas: reload browser menghapus sesi token yang hanya tersimpan di memori dan mengembalikan tab ke halaman login; tidak ada data bisnis yang berubah. Tidak ada perubahan PRD atau database. Design read: editor admin ringkas, ENERGY 1 / RHYTHM 1 / MOTION 1; modal menjaga fokus pada daftar pegawai dan membatasi form panjang.

Perbaikan responsif Master Pekerjaan (3 November 2026): screenshot mobile menunjukkan filter Divisi dan pencarian terpisah oleh ruang kosong yang besar. Penyebabnya `flex-basis: 28rem` pada grid filter desktop tetap aktif saat toolbar beralih menjadi kolom; basis tersebut berubah menjadi tinggi dan membuat baris grid meregang. Basis mobile kini mengikuti isi dan baris filter dirapatkan. Audit statis mencakup login, dashboard, Admin Pengguna/Pekerjaan, daftar/buat/detail pengajuan, antrean Korwil, dan shell bersama. Svelte check lulus (0 error/0 warning), production build lulus, serta delapan route frontend lokal merespons HTTP 200. Screenshot pascaperbaikan dan click-through di beberapa viewport belum dapat diambil karena capture jendela browser timeout; verifikasi visual lintas perangkat masih perlu dilakukan. Tidak ada perubahan PRD, API, atau database. Design read: workflow admin internal, ENERGY 1 / RHYTHM 1 / MOTION 1; filter mobile mengikuti tinggi kontennya agar kontrol terlihat berurutan tanpa ruang kosong semu.

Audit responsif lanjutan (3 November 2026): source seluruh route dan shell frontend ditinjau untuk header, grid, tabel, form, dialog, dan overflow. Header dashboard/workflow kini reflow menjadi grid yang tidak memakai posisi absolut pada ponsel sempit; baris sesi/timer detail menumpuk saat ruang horizontal terbatas. Base layer mengikuti affordance pointer untuk kontrol shadcn dan menandai kontrol nonaktif. `npm.cmd run check` lulus (0 error/0 warning), `npm.cmd run build` lulus, dan delapan route frontend merespons HTTP 200. Capture browser kembali timeout, jadi ukuran viewport nyata, horizontal overflow aktual, click-through, serta tampilan light/dark belum selesai diverifikasi visual. Tidak ada perubahan PRD, API, atau database. Design read: workflow SLA internal, ENERGY 1 / RHYTHM 1 / MOTION 1; reflow header mempertahankan navigasi dan aksi tanpa tumpang tindih di lebar sempit.

Perbaikan lanjutan dari screenshot mobile (3 November 2026): konten Dashboard dan kedua halaman Admin ditetapkan sebagai stack grid dengan `align-content: start` dan jarak eksplisit agar kartu tidak terdorong jauh dari judul. Svelte check kembali lulus (0 error/0 warning), production build lulus, dan seluruh delapan route merespons HTTP 200. Capture browser tetap timeout sehingga perubahan visual belum bisa dikonfirmasi langsung di viewport; validasi visual/click-through tetap menjadi pekerjaan terbuka. Tidak ada perubahan PRD, API, atau database.

Audit ulang setelah laporan tampilan mobile masih sama (3 November 2026): server di `127.0.0.1:5173` dipastikan menjalankan `D:\Framwork_Laravel\sla-pengajuan\frontend`, dan meta viewport sudah benar. Shell aplikasi mobile kini memakai baris intrinsik `max-content` dan tinggi otomatis; Dashboard, halaman Admin, serta filter katalog diberi batas tinggi minimum agar layout mengikuti isi. `npm.cmd run check` menghasilkan 0 error/0 warning, production build lulus, dan delapan route merespons HTTP 200. Ini belum dianggap selesai secara visual: capture/click-through browser mobile belum berhasil, jadi perlu konfirmasi screenshot terbaru sebelum menandai responsif beres. Tidak ada perubahan PRD, API, atau database.

Audit responsif visual lintas halaman (3 November 2026): penyebab ruang kosong besar pada header mobile adalah `flex-basis: 24rem` di deskripsi halaman yang berubah menjadi tinggi saat header menumpuk; basis mobile kini mengikuti isi. Master Pekerjaan dan Akses Pegawai memakai Card shadcn sampai breakpoint 58rem agar tabel dan kontrol tidak terpotong di tablet; dialog akses dibatasi lebar viewport. Login mobile tidak lagi menyisakan panel kosong dan muat tanpa scroll pada 390×844. Browser diuji memakai sesi dan data dummy yang diintersep lokal, tanpa SSO/kredensial pegawai: tujuh route terautentikasi disweep pada 28 lebar 320–1440px tanpa horizontal overflow, dengan jarak judul-ke-konten 14–16px. Tampilan mobile login light/dark serta halaman workflow/admin dikonfirmasi secara visual; delapan route merespons HTTP 200. `npm.cmd run check` menghasilkan 0 error/0 warning dan production build lulus. Tidak ada perubahan PRD, API, atau database. Design read: ENERGY 1 / RHYTHM 1 / MOTION 1.

Diagnosis login lokal (3 November 2026): frontend memakai `VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1`, tetapi backend tidak sedang listen pada port 3000 saat error dilaporkan. Backend telah dijalankan kembali. MySQL XAMPP juga berhenti; instance lokal yang ada telah dinyalakan tanpa migrasi atau perubahan data. Verifikasi sesudahnya: API health 200, database health 200, preflight CORS dari `localhost:5173` dan `127.0.0.1:5173` masing-masing 204, dan route login menerima request serta mengembalikan validasi 400 untuk body kosong. Login SSO dengan kredensial pengguna belum dicoba.

Navbar aplikasi (3 November 2026): header autentikasi Dashboard, Admin, dan workflow kini memakai satu komposisi bersama dari komponen Button shadcn-svelte. Tujuan navigasi mengikuti role dan menandai halaman aktif; tombol tema/keluar memakai ikon ghost tanpa border atau latar permanen, dengan area sentuh 44px. Reflow satu baris desktop dan dua baris tablet/mobile menjaga brand, menu, serta aksi tetap terpisah. Click-through fixture lokal menguji navigasi Admin/Cabang, toggle light/dark, dan logout tanpa error browser. Sweep navbar Admin 320-1440px dan Cabang 320/390/768/1024px tidak menemukan horizontal overflow. `npm.cmd run check` lulus (0 error/0 warning) dan production build lulus. Tidak ada perubahan PRD, API, atau database. Design read: aplikasi workflow internal, ENERGY 1 / RHYTHM 1 / MOTION 1; ruang visual tombol ikon dipertahankan transparan agar fokus tetap pada menu aktif dan nama produk.

Navbar mobile shadcn (4 November 2026): link desktop disatukan dalam satu daftar agar tujuan role tetap konsisten; pada ponsel, baris kedua diganti tombol Menu berlabel yang membuka Dialog shadcn. Dialog memusatkan ikon relevan di atas tiap nama halaman dan menempatkan tema/keluar sebagai aksi tanpa latar permanen. Tombol penutup memiliki target 44px; primitive Dialog menangani fokus dan Escape. `npm.cmd run check` lulus (0 error/0 warning) dan production build lulus. Browser lokal masih memiliki sesi Admin, tetapi capture screenshot timeout dua kali setelah pemilihan ulang jendela; click-through buka/tutup dan konfirmasi visual belum selesai. Tidak ada perubahan PRD, API, atau database. Design read: aplikasi workflow internal, ENERGY 1 / RHYTHM 1 / MOTION 1; header satu baris menghemat ruang layar, panel grid memusatkan ikon dan label serta tetap menyisakan ruang untuk aksi akun.

Perbaikan reload Akses Pegawai dan notifikasi (4 November 2026): halaman Admin memakai satu endpoint workspace yang mengembalikan profil SSO terverifikasi, daftar pegawai, dan opsi akses sekaligus. Pada reload halaman ini, pemuatan penting FE berkurang dari whoami + dua endpoint Admin menjadi satu request workspace; pemuatan lonceng berjalan di latar belakang dan tidak menahan tabel. Pengukuran read-only query workspace lokal: 5 profil dan opsi role/kantor/divisi dimuat dalam sekitar 193 ms; waktu SSO jaringan tidak termasuk. Lonceng tersedia di navbar desktop dan mobile, membuka Dialog shadcn dengan status belum dibaca, tandai semua dibaca, dan tautan detail tiket. Backend menyimpan notifikasi per penerima/unit dan membuat event di dalam transaksi workflow untuk pengajuan baru, klaim, permintaan kelengkapan, penerusan ke Divisi Pusat, jawaban kelengkapan, penolakan, dan penyelesaian. Daftar dan hitungan unread memeriksa cakupan pengguna terkini agar notifikasi lama tidak membuka ringkasan tiket di luar scope. Migrasi `009_create_notifications.sql` diterapkan ke MySQL lokal; health database 200, workspace Admin dan notifikasi tanpa bearer menolak dengan 401, halaman `/admin/users` merespons 200, dan smoke test read-only memuat daftar notifikasi untuk akun aktif (0 item saat diuji). BE/FE `npm.cmd run check` dan `npm.cmd run build` lulus; Svelte check 0 error/0 warning. Visual dialog, click-through notif, dan validasi penerima pada aksi workflow belum dilakukan. Peringatan SLA otomatis belum aktif sampai target dan ambang "mendekati" disahkan. Design read: navbar utilitas internal, ENERGY 1 / RHYTHM 1 / MOTION 1; ikon lonceng ghost tanpa latar, badge hanya muncul untuk unread, dan dialog menggunakan ruang layar terbatas dengan daftar yang bisa discroll.

## Keputusan yang sudah disepakati

- Backend: Node.js + Express REST API di `backend/`.
- Frontend: SvelteKit di `frontend/`.
- Database: MySQL.
- TypeScript dipakai sebagai default awal untuk kedua aplikasi.
- Login menggunakan API SSO perusahaan. Path login dan `whoami` ditetapkan di backend; base URL, app code sementara `simpeg`, dan timeout disimpan di `.env`. `.env.example` menjadi template tanpa password/token dan `.env` tidak di-commit.
- Token bearer disimpan sementara di `sessionStorage` per-tab agar bertahan saat reload, lalu dikirim lewat header `Authorization`; logout atau respons 401 menghapus token dari state dan storage. Profil SSO diminta ulang setelah reload. Password tidak disimpan.
- ID pegawai terakhir diingat di `sessionStorage` per-tab untuk memudahkan pengisian ulang form login; tidak ada ID uji coba atau password yang ditanam di repository.
- CORS development menerima dua alamat frontend lokal: `localhost:5173` dan `127.0.0.1:5173`.
- Akun pemilik proyek adalah admin awal. `SLA_INITIAL_ADMIN_EMPLOYEE_ID` hanya digunakan oleh perintah `db:bootstrap-admin`; akses runtime berasal dari assignment MySQL. Template `.env.example` membiarkannya kosong.
- Profil pegawai SSO disimpan di `users`; kode kantor yang cocok dipetakan ke `master_kantor`, dan nama `unit_kerja` yang cocok (dengan awalan `Divisi` diabaikan) dipetakan ke `master_divisi`. Sinkronisasi profil tidak mengaktifkan akun dan tidak memberi role.
- Admin menetapkan role/status, bukan cakupan untuk role organisasi. Pengguna Cabang mengikuti kode kantor aktif dari SSO; Petugas Korwil mengikuti mapping kantor atau informasi organisasi SSO; Petugas Divisi Pusat mengikuti `unit_kerja` yang cocok dengan master divisi. Scope diselaraskan saat profil disinkronkan dan perubahan dicatat di `user_access_audit_logs`; scope yang tidak dapat dipetakan tidak memberi akses.
- Tiket Cabang dimiliki kantor (`kode_kantor`), bukan pegawai pembuat. Role Cabang baru pada kantor yang sama dapat melihat dan melanjutkan tiket lama; `created_by_user_id` tetap menjaga jejak pembuat.
- Role dasar tersimpan di `roles`. Assignment pegawai dan cakupan `global`, `office`, `korwil`, atau `division` tersimpan di `user_role_scopes`.
- UI memakai shadcn-svelte dan Tailwind CSS dengan gaya dashboard admin yang bersih.
- Endpoint Admin saat ini memvalidasi bearer dengan pemanggilan SSO `whoami` per request dan menolak akun tanpa assignment admin global aktif.
- Workspace Akses Pegawai menggabungkan pemuatan profil terverifikasi, daftar pegawai, dan pilihan akses dalam satu API request; endpoint Admin lain tetap memvalidasi bearer SSO secara mandiri.
- Notifikasi aplikasi tersimpan per pengguna, dikirim sesuai scope unit aktif, dan daftar hanya menampilkan tiket yang masih terjangkau scope pengguna sekarang. Peringatan SLA belum dijalankan sampai target dan ambang disepakati.
- Daftar pegawai Admin berisi profil yang sudah tersinkron setidaknya sekali lewat login SSO; sinkronisasi tidak otomatis mengaktifkan akun atau memberi role.
- Pengajuan mengalir dari Cabang ke Korwil, lalu ke Divisi Pusat jika tujuan pengajuan memang Pusat.
- Cabang memilih Divisi Pusat dan jenis pekerjaan dari katalog jika memilih kewenangan Pusat.
- Umur tiket dimulai saat pengiriman pertama Cabang dan berhenti saat selesai/ditolak; antrean dan revisi tetap termasuk umur total.
- Timer Korwil awal dimulai saat diambil; antrean Korwil terpisah. Sesi Cabang dimulai saat kelengkapan diminta. Bila Korwil meminta dokumen, sesi Korwil baru dimulai saat Cabang mengirim jawaban; bila Divisi meminta, tiket kembali langsung ke Divisi. Sesi Divisi awal masuk antrean saat diteruskan, tetapi timer baru dimulai saat diambil; resume pelengkapan langsung dimulai saat Cabang mengirim jawaban.
- Semua durasi memakai waktu kalender 24 jam. Setiap handoff membuat sesi baru; total waktu per unit adalah penjumlahan seluruh sesinya.
- Nomor pengajuan memakai format teknis `SLA-` diikuti ID database delapan digit; format ini belum menjadi kebijakan bisnis publik.
- Form MVP awal saat ini hanya mengumpulkan perihal dan uraian umum. Field khusus tiap pekerjaan dan lampiran belum tersedia, sehingga form belum siap untuk pengajuan resmi yang mensyaratkan field/dokumen tersebut.
- Kekurangan berkas kembali langsung ke Cabang. Perubahan substansi kembali ke Korwil.
- Untuk MVP, Petugas Korwil atau Penyetuju Korwil yang mengambil tiket dapat menjalankan tindakan yang tersedia pada tahap Korwil; pemisahan persetujuan formal belum dimodelkan dan perlu ditinjau sebelum produksi.
- Pelengkapan saat ini berupa catatan teks pada timeline; file lampiran belum dapat diunggah karena kebijakan storage privat, tipe file, dan batas ukuran belum ditetapkan.
- Organisasi terdiri dari 28 Cabang, 4 Korwil, dan 9 Divisi Pusat: Penyelesaian Kredit, Pemasaran, Sekretaris Perusahaan, Operasional, Litbang, SKK, SKMR, SKAI, dan SDM.
- Master lokal awal memakai satu tabel `master_kantor` dengan kolom `id`, `kode_kantor`, `nama_kantor`, `korwil`, `is_active`. `kode_kantor` bertipe teks tiga karakter; `000` adalah Pusat. Kolom `korwil` memakai nilai kelompok seperti pada data sumber, belum dipisah menjadi tabel Korwil.
- Pengajuan kredit di bawah Rp500 juta masuk ke Korwil; pengajuan di atas Rp500 juta melalui Korwil ke Pemasaran.

## Progres

### Persiapan produk

- [x] Alur dasar Cabang, Korwil, dan Divisi Pusat dibahas.
- [x] Aturan pengembalian berkas dan perubahan substansi dibahas.
- [x] Perhitungan timer per sesi dan akumulasi waktu unit dibahas.
- [x] Mapping 28 Cabang ke 4 Korwil dicatat di PRD.
- [x] Sembilan nama Divisi Pusat dicatat; katalog awal tersedia untuk pekerjaan yang sudah disebutkan.
- [x] Stack Express, SvelteKit, dan MySQL dipilih.
- [x] Endpoint dan field profil SSO dicatat dari informasi yang diberikan.
- [x] Konfigurasi SSO diputuskan memakai `.env`; app code sementara `simpeg` dapat diganti di sana setelah app khusus terdaftar.
- [x] Header bearer dan perilaku logout lokal dicatat.
- [x] PRD diselaraskan dengan keputusan stack dan alur terbaru.
- [x] README dibuat sebagai panduan menjalankan project, status milestone, dan ringkasan alur bisnis.
- [ ] Pemilik proses mengesahkan target SLA dan detail katalog.

### Implementasi

- [x] Buat kerangka `backend/` Express + TypeScript, konfigurasi keamanan dasar, dan health endpoint.
- [x] Buat kerangka `frontend/` SvelteKit + TypeScript + Tailwind CSS; inisialisasi shadcn-svelte preset Vega.
- [x] Buat konfigurasi environment MySQL dan pool `mysql2`; endpoint kesehatan database tersedia.
- [x] Buat database lokal `sla_pengajuan`, akun aplikasi terbatas ke database tersebut, dan verifikasi `/api/v1/health/database` merespons connected.
- [x] Buat migration SQL dan seed `master_kantor`; verifikasi 29 baris aktif, kode `000` Pusat, serta tujuh Cabang per masing-masing kelompok Korwil.
- [x] Implementasikan proxy login Express ke SSO dan validasi profil melalui `whoami`; login SSO berhasil dikonfirmasi pemilik proyek.
- [x] Buat halaman login, profil, pengiriman bearer di header, pemulihan token per-tab setelah reload, logout yang menghapus sesi, ID pegawai terakhir untuk prefill, dan kontrol tampil/sembunyikan password.
- [x] Rapikan login dan dashboard memakai komponen shadcn-svelte; tombol tema/logout ikon, navbar aplikasi sticky, login desktop mengikuti tinggi viewport, dan layout responsif.
- [x] Perbaiki CORS development untuk `localhost`/`127.0.0.1`; preflight dan request validasi tanpa kredensial berhasil diverifikasi.
- [x] Buat migration runner SQL dan schema pengguna, role, cakupan akses, serta master sembilan Divisi Pusat.
- [x] Sinkronkan profil SSO ke MySQL dan petakan kode kantor/unit divisi jika cocok; akun sinkron baru tetap nonaktif tanpa role.
- [x] Pindahkan admin awal ke assignment global di MySQL melalui perintah bootstrap satu kali.
- [x] Validasi bearer SSO pada API Admin dengan `whoami` dan cek assignment admin global MySQL.
- [x] Buat UI/API Admin untuk melihat profil tersinkron, mengaktifkan/nonaktifkan pegawai, serta menetapkan role dan cakupan.
- [x] Ubah assignment role Cabang, Korwil, dan Divisi Pusat agar scope otomatis mengikuti profil SSO dan berpindah saat pegawai rotasi; form Admin menampilkan scope sebagai informasi baca-saja.
- [x] Tegaskan kepemilikan tiket berbasis kantor agar pegawai pengganti dapat melanjutkan pengajuan tanpa menghapus identitas pembuat.
- [x] Buat audit perubahan akses Admin melalui migrasi `004_create_user_access_audit_logs.sql`; migrasi sudah diterapkan ke MySQL lokal.
- [x] Buat UI/API CRUD katalog pekerjaan per divisi dengan target SLA opsional; target belum diisi sebelum disahkan.
- [x] Buat migration `005_create_request_intake.sql` untuk tiket, assignment, sesi SLA, dan timeline.
- [x] Buat API Cabang untuk opsi kantor/katalog, pengiriman dengan routing Korwil, daftar kantor sendiri, dan detail dengan sesi/timeline.
- [x] Validasi akses Cabang dan Korwil melalui assignment MySQL aktif dan scope yang cocok pada backend.
- [x] Buat antrean Korwil sesuai scope dan aksi Ambil transaksional; waktu ambil tercatat dan timer sesi pertama dimulai saat klaim.
- [x] Buat UI shadcn-svelte responsif untuk form/daftar Cabang, detail/timeline/durasi, dan antrean Korwil; navigasi dari dashboard memakai ikon berlabel.
- [x] Seragamkan shell, lebar konten, jarak, dan judul halaman Beranda/Admin/workflow dengan gaya ringkas; halaman login tetap memakai layout autentikasi tersendiri.
- [x] Satukan judul dan keterangan halaman dalam satu baris responsif; gabungkan filter/pencarian dengan Card tabel pada halaman Admin.
- [x] Rapikan toolbar dan tabel Admin agar lebih padat: pencarian berikon, ringkasan status dan hasil sejajar, serta variasi baris yang tetap terbaca dalam tema terang/gelap dan layout mobile.
- [x] Pindahkan editor akses pegawai ke Dialog shadcn-svelte; form panjang tidak lagi mendorong daftar, dan tinggi/scroll dialog disesuaikan untuk layar pendek.
- [x] Perkuat reflow header dashboard/workflow untuk ponsel sempit, susun ulang sesi timer detail di layar kecil, dan tetapkan pointer affordance pada kontrol aktif di base layer.
- [ ] Verifikasi visual dan click-through seluruh route pada viewport ponsel kecil, ponsel umum, tablet, dan desktop; pastikan overflow nol serta kedua tema tetap terbaca.
- [x] Lengkapi tindakan Korwil: minta kelengkapan, teruskan tujuan Pusat, selesai, atau tolak; tindakan menutup sesi/assignment aktif dan mencatat alasan/timeline.
- [x] Buat pengiriman jawaban Cabang pada tiket yang sama; tiket otomatis kembali ke petugas unit yang meminta jika masih aktif dan sesuai scope, atau masuk antrean fallback dengan timer tetap berjalan sejak pengiriman.
- [x] Uji lokal MySQL untuk resume otomatis Korwil dan Divisi, hak tindakan tanpa klaim ulang, serta fallback petugas tidak tersedia tanpa reset timer; bersihkan seluruh tiket uji sementara.
- [x] Buat antrean Divisi Pusat, klaim, permintaan kelengkapan, selesai, dan tolak dengan cakupan divisi di backend.
- [x] Tambahkan tampilan Riwayat Korwil dan Divisi Pusat; daftar dan detail hanya menampilkan tiket yang pernah masuk ke scope unit tersebut.
- [x] Buat Admin master Divisi untuk mengubah nama dan alias unit kerja SSO; validasi alias unik dan terapkan migrasi `008_division_sso_unit_aliases.sql`.
- [x] Satukan profil Admin, daftar pegawai, dan opsi role ke endpoint workspace untuk mengurangi round-trip saat reload Akses Pegawai.
- [x] Buat migrasi `009_create_notifications.sql`, API list/tandai dibaca, serta notifikasi transaksi untuk perubahan alur tiket; tambahkan ikon lonceng desktop/mobile dengan Dialog shadcn.
- [x] Tambahkan runner E2E notifikasi untuk penerima lintas unit, seluruh event workflow, unread count, tandai satu/semua dibaca, isolasi scope, detail tiket, dan cleanup fixture.
- [ ] Click-through semua event notifikasi dan pastikan penerima lintas Cabang/Korwil/Divisi hanya melihat tiket sesuai scope.
- [x] Uji alur riwayat Korwil/Divisi dan penolakan akses lintas Divisi dengan fixture MySQL sementara; seluruh fixture dibersihkan.
- [x] Tampilkan umur total tiket, sesi individual, akumulasi per Cabang/Korwil/Divisi, serta waktu tunggu pengambilan; terapkan migrasi 006–007.
- [ ] Tambahkan unggah/unduh lampiran secara privat setelah tipe file, batas ukuran, dan lokasi storage disetujui; dukung revisi substansi dengan pemeriksaan ulang Korwil.
- [ ] Uji end-to-end aksi Divisi Pusat dengan profil SSO dan assignment lokal Divisi yang aktif; uji penolakan akses lintas scope.
- [x] Tambahkan smoke E2E workflow/timer dengan assignment lokal sintetis, uji selesai/tolak dan isolasi scope Korwil/Divisi; cleanup fixture diverifikasi otomatis.
- [x] Buat dashboard Cabang, Korwil, Divisi Pusat, dan Admin.
- [x] Tambahkan akses baca detail untuk Manajemen/Supervisor global dan badge SLA umum 7 hari pada dashboard/detail.
- [x] Tambahkan filter Korwil/Divisi pada dashboard global serta halaman tiket menunggu tindak lanjut Cabang dengan filter kantor.
- [ ] Siapkan data uji dan jalankan skenario penerimaan di PRD.

## Rancangan struktur folder

Gunakan satu repository dengan dua aplikasi. Struktur berikut adalah target yang akan diisi bertahap; file yang sudah tersedia saat ini diringkas di `README.md`:

```text
sla-pengajuan/
├── AGENTS.md
├── PROJECT_STATUS.md
├── prd.md
├── README.md
├── backend/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── app.ts
│       ├── server.ts
│       ├── config/
│       ├── db/
│       │   ├── migrations/
│       │   └── seeders/
│       ├── middleware/
│       ├── modules/
│       │   ├── auth/
│       │   ├── users/
│       │   ├── organization/
│       │   ├── catalog/
│       │   ├── requests/
│       │   ├── sla/
│       │   ├── attachments/
│       │   └── notifications/
│       └── shared/
└── frontend/
    ├── .env.example
    ├── package.json
    └── src/
        ├── lib/
        │   ├── api/
        │   ├── components/
        │   │   ├── ui/
        │   │   └── layout/
        │   ├── features/
        │   │   ├── auth/
        │   │   ├── requests/
        │   │   ├── inbox/
        │   │   └── catalog/
        │   └── utils/
        └── routes/
            ├── (auth)/login/
            └── (app)/
                ├── dashboard/
                ├── requests/
                └── inbox/
```

Backend membagi endpoint dan aturan domain dalam modul. Frontend memakai `routes/` untuk halaman, `features/` untuk kebutuhan tiap fitur, `components/ui/` untuk komponen shadcn-svelte, serta `lib/api/` sebagai satu pintu komunikasi ke REST API. Backend memakai `mysql2`; migration runner menjalankan SQL bernomor dari `backend/src/db/migrations/`. ORM belum dipilih.

## Tugas berikutnya

Milestone dashboard Manajemen sudah selesai secara kode dan perlu click-through/visual QA sebelum dipakai sebagai bukti penerimaan. Verifikasi wajib mencakup detail baca-saja untuk Manajemen, filter Korwil/Divisi, halaman tiket menunggu Cabang, dan badge SLA pada batas umur 3 serta 7 hari.

**Prioritas sebelum milestone berikutnya — verifikasi visual responsif dan notifikasi:** sweep seluruh sepuluh route pada lebar 320, 360, 390, 430, 768, 1024, 1280, dan 1440 px dalam tema terang/gelap. Periksa overflow horizontal, reflow judul/kartu/tabel/form/dialog, navbar sticky, buka-tutup menu dan dialog lonceng, fokus keyboard, serta target sentuh. Capture browser yang tersedia timeout dua kali; ulangi ketika screenshot browser dapat diambil atau gunakan screenshot aktual sebagai bukti. Dalam click-through, jalankan pengajuan sampai klaim, pengembalian, penerusan, pelengkapan, dan penutupan; pastikan unread berkurang setelah dibaca dan pengguna di luar scope tidak menerima/menampilkan tiket. Jangan lanjut ke feature milestone sampai UI lolos pemeriksaan visual tersebut.

**Sesudah verifikasi UI:** ulangi click-through memakai sesi SSO yang dapat memuat profil. Di Admin, pastikan editor role pegawai SKAI hanya meminta peran dan menampilkan cakupan Divisi otomatis; cek Riwayat Korwil/Pusat dan editor Master Divisi. Verifikasi alur pelengkapan Cabang: tiket kembali Diproses tanpa Ambil ulang, nomor tiket tetap, timer sesi Cabang berhenti, dan waktu unit menjumlah seluruh sesi. Lanjutkan login/reload/logout serta tema terang/gelap.

**Milestone berikutnya:** setelah click-through, sepakati tipe file, batas ukuran, dan lokasi storage untuk unggah/unduh lampiran privat, lalu lanjutkan implementasinya. Sebelum produksi, pemilik proses juga perlu menetapkan apakah `Petugas Korwil` dan `Penyetuju Korwil` memiliki hak tindakan berbeda; MVP saat ini membolehkan pemegang tiket dari kedua role bertindak. Definisi field dinamis dan dokumen wajib per katalog tetap terbuka.

## Hal yang masih perlu diputuskan

- Pendaftaran app code khusus Sistem SLA untuk menggantikan sementara `simpeg`.
- Masa berlaku token dan format error dari SSO.
- Profil pegawai muncul setelah login SSO pertama kali; impor direktori SSO belum tersedia.
- Jika satu pegawai memiliki beberapa assignment aktif, aturan prioritas/perpaduan role efektif perlu ditetapkan sebelum endpoint workflow menggunakan akses tersebut.
- Katalog pekerjaan saat ini menyimpan nama, deskripsi, status, divisi, dan target opsional. Field dinamis, lampiran wajib, dan aturan routing lanjutan belum dimodelkan.
- ORM belum dipilih; migrasi saat ini memakai SQL bernomor dan runner sederhana.
- Target SLA per unit atau jenis pekerjaan.
- Konfirmasi batas tepat Rp500 juta. Usulan sementara: Korwil, karena Pemasaran berlaku untuk nilai di atas Rp500 juta.
- Peran Korwil yang boleh menyetujui penerusan ke Pusat.
- Ketentuan hosting dan penyimpanan lampiran.

Keputusan teknis yang diperlukan untuk membuat scaffold boleh memakai pilihan umum dan sederhana, lalu dicatat di sini. Keputusan bisnis yang mengubah alur pengajuan harus mengikuti PRD.

## Prompt untuk melanjutkan di sesi baru

```text
Lanjutkan Sistem SLA. Baca AGENTS.md dan PROJECT_STATUS.md, lalu baca bagian prd.md yang relevan dengan tugas berikutnya. Lanjutkan dari "Tugas berikutnya" tanpa mengulang pekerjaan yang sudah dicentang. Setelah satu milestone selesai, perbarui PROJECT_STATUS.md dengan hasil dan tugas berikutnya.
```
