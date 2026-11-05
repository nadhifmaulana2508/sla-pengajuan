# Laporan QA visual dan responsive

Tanggal: 4 November 2026  
Scope: 10 route frontend, viewport 320, 360, 390, 430, 768, 1024, 1280, 1440 px, tema terang dan gelap.

## Ringkasan hasil

**Status keseluruhan: FAIL, dengan visual sweep belum terverifikasi penuh.**

Semua route dapat dijangkau oleh dev server dan mengembalikan HTTP 200. Halaman login berhasil dibaca melalui accessibility tree browser Edge, termasuk heading, label form, toggle tema, toggle password, dan tombol Masuk. Setelah reload, ID uji non-sensitif `qa-user` tetap terisi, sehingga pemulihan `sessionStorage` untuk ID pegawai terverifikasi. Password tidak diisi atau dikirim.

Capture screenshot browser gagal pada percobaan berulang dengan `FrameArrived timed out` atau `window capture timed out`. Route terautentikasi juga mengembalikan pengguna ke login karena tidak ada sesi SSO yang dapat digunakan. Karena itu, matrix visual exact viewport di bawah ditandai `FAIL*`: kombinasi tersebut belum boleh dianggap PASS. Tanda ini berarti verifikasi terblokir, bukan klaim bahwa setiap layout pasti rusak.

## Route yang diuji

| Route | HTTP | Accessibility/login | Visual exact viewport |
|---|---:|---:|---:|
| `/` login | PASS | PASS, AX tree terbaca | FAIL* |
| `/dashboard` | PASS | FAIL*, redirect ke login tanpa sesi | FAIL* |
| `/admin/users` | PASS | FAIL*, redirect ke login tanpa sesi | FAIL* |
| `/admin/master` | PASS | FAIL*, redirect ke login tanpa sesi | FAIL* |
| `/admin/divisions` | PASS | FAIL*, redirect ke login tanpa sesi | FAIL* |
| `/requests` | PASS | FAIL*, redirect ke login tanpa sesi | FAIL* |
| `/requests/new` | PASS | FAIL*, redirect ke login tanpa sesi | FAIL* |
| `/requests/[id]` dengan `/requests/1` | PASS | FAIL*, redirect ke login tanpa sesi | FAIL* |
| `/inbox/korwil` | PASS | FAIL*, redirect ke login tanpa sesi | FAIL* |
| `/inbox/central` | PASS | FAIL*, redirect ke login tanpa sesi | FAIL* |

## Matrix viewport dan tema

Keterangan: `F*` = FAIL verifikasi, karena screenshot dan click-through pada kombinasi exact tersebut belum tersedia. `P` = PASS hanya jika ada bukti langsung.

### Tema terang

| Route | 320 | 360 | 390 | 430 | 768 | 1024 | 1280 | 1440 |
|---|---|---|---|---|---|---|---|---|
| `/` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/dashboard` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/admin/users` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/admin/master` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/admin/divisions` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/requests` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/requests/new` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/requests/[id]` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/inbox/korwil` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/inbox/central` | F* | F* | F* | F* | F* | F* | F* | F* |

### Tema gelap

| Route | 320 | 360 | 390 | 430 | 768 | 1024 | 1280 | 1440 |
|---|---|---|---|---|---|---|---|---|
| `/` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/dashboard` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/admin/users` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/admin/master` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/admin/divisions` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/requests` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/requests/new` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/requests/[id]` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/inbox/korwil` | F* | F* | F* | F* | F* | F* | F* | F* |
| `/inbox/central` | F* | F* | F* | F* | F* | F* | F* | F* |

## Pemeriksaan khusus

| Area | Hasil | Bukti atau catatan |
|---|---|---|
| Overflow horizontal | FAIL* | Tidak dapat mengukur `scrollWidth` atau menangkap screenshot pada exact viewport. Source memakai `min-width: 0`, `overflow-wrap`, tabel mobile, dan container overflow yang disengaja. |
| Navbar desktop/tablet/mobile | FAIL* | Source memiliki breakpoint 62rem dan 42rem, tombol Menu berlabel, serta target minimal 44 px. Click-through tidak dapat dilakukan tanpa sesi terautentikasi. |
| Menu mobile | FAIL* | Dialog shadcn, label Menu, tombol tutup 44 px, Escape dan focus handling tersedia di source. Tidak ada bukti visual/click-through. |
| Dialog notifikasi | FAIL* | Dialog memiliki empty/loading/error state, daftar scroll, tombol tandai dibaca, dan close. Tidak ada sesi untuk membuka dialog. |
| Dialog Admin | FAIL* | Dialog akses pegawai dibatasi `calc(100vw - 2rem)` dan `max-height` dengan scroll internal; route terlindungi sehingga belum dibuka. |
| Fokus keyboard | FAIL* | AX tree memberi nama kontrol dan source menyediakan `:focus-visible`; urutan fokus interaktif belum dapat dijalankan karena browser automation tidak dapat mengklik web element. |
| Target sentuh | PASS source-level | Base layer dan komponen mobile memakai `min-height: 2.75rem` atau 44 px pada breakpoint 40rem. Belum tervalidasi lewat screenshot. |
| Login form | PASS partial | AX tree menampilkan label ID pegawai, Password, toggle tampilkan password, tombol Masuk, dan pesan keamanan. Submit login tidak dilakukan karena kredensial SSO tidak tersedia. |
| Reload | PASS partial | ID pegawai `qa-user` tetap muncul setelah reload. Token SSO tidak diuji. |
| Logout | FAIL* | Tidak ada sesi autentikasi yang dapat dipakai untuk menguji penghapusan token dan redirect. Source `clearAuthenticatedSession()` menghapus token dari `sessionStorage`. |
| Tema terang/gelap | FAIL* | Store tema menyimpan pilihan di `localStorage` dan CSS memiliki kedua token tema. Toggle visual tidak dapat diklik karena geometry browser unavailable. |

## Temuan source-level

1. **FAIL aksesibilitas, prioritas sedang:** `frontend/src/app.html:2` memakai `<html lang="en">`, sementara seluruh UI berbahasa Indonesia. Seharusnya `lang="id"`.
2. **FAIL kontras berpotensi, prioritas sedang:** `frontend/src/lib/components/AppNavbar.svelte:372` memakai `var(--destructive-foreground)` pada badge unread, tetapi token tersebut tidak didefinisikan di `frontend/src/routes/layout.css`. Kontras teks badge belum dapat dijamin pada kedua tema.
3. **Belum terverifikasi, bukan temuan layout:** screenshot exact viewport, overflow aktual, menu/dialog, dan click-through route terautentikasi belum dapat dibuktikan karena browser capture timeout dan sesi SSO tidak tersedia.

## Bukti eksekusi

- Frontend dev server: `http://127.0.0.1:5173`.
- Backend health: `/api/v1/health` HTTP 200 dan `/api/v1/health/database` HTTP 200.
- Semua 10 route di atas: HTTP 200 dari dev server.
- Browser AX login: PASS untuk struktur heading, main landmark, label, tombol, dan status form.
- Screenshot: tidak tersedia, percobaan capture gagal timeout.
- Tidak ada perubahan alur bisnis, database, atau API.

## Kesimpulan dan langkah wajib berikutnya

Milestone QA visual belum boleh ditandai selesai. Perbaiki dua temuan source-level, lalu ulangi sweep dengan browser yang dapat mengubah viewport dan mengambil screenshot. Setelah sesi SSO/fixture lokal tersedia, ulangi 10 route pada 16 kombinasi tema dan viewport, buka menu mobile, dialog notifikasi, dialog Admin, lalu jalankan login, reload, dan logout.
