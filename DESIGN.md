# Arah UI Sistem SLA

## Design Read

Sistem SLA adalah aplikasi kerja internal untuk mengirim dan menindaklanjuti tiket antar Cabang, Korwil, dan Divisi Pusat. UI mengutamakan tugas yang sering dilakukan dengan satu tangan di ponsel: melihat status, membuka tiket, memberi tindak lanjut, dan menyelesaikan form.

- **Arah:** aplikasi operasional mobile-first dengan navigasi bawah untuk tujuan utama dan menu tambahan berbentuk sheet.
- **Karakter:** tenang, jelas, dan terasa siap kerja. Isi tiket lebih menonjol daripada dekorasi.
- **Palet:** permukaan netral dan hitam; aksen hijau neon muncul pada outline, fokus, teks navigasi aktif, dan pilihan tujuan terpilih. Badge status berbentuk kapsul penuh dengan fill tipis serta border/teks emerald, oranye, atau merah yang jelas. Hindari bidang neon besar.
- **Tipografi:** Inter yang sudah dipakai, dengan skala `--type-*` cair dan token khusus judul halaman. Teks dasar mewarisi skala yang sama; ukuran input tetap nyaman disentuh.
- **Motif:** garis progres tipis yang menandai perpindahan tiket antar unit; dipakai hanya untuk konteks alur dan SLA.
- **ENERGY / RHYTHM / MOTION:** 2 / 2 / 1. Hirarki cukup tegas untuk membedakan status dan tindakan, ritme mengikuti kelompok tugas, gerakan singkat hanya untuk membuka atau menutup panel.

## Pola lintas perangkat

- Pada desktop, semua role memakai sidebar tetap dengan menu sesuai akses, rail ikon saat diciutkan, identitas akun di bawah, serta header ringkas berisi breadcrumb dan popover notifikasi/profil yang menempel pada tombol pemicunya.
- Ponsel dan tablet memakai app bar ringkas dan tab bawah untuk tujuan utama; menu Lainnya membuka sheet untuk tujuan sekunder serta aksi tema dan keluar, sementara profil tetap di app bar.
- Halaman mengalir satu kolom saat ruang sempit. Kartu tiket menjadi ringkas, form mengisi lebar konten, dan tabel memakai daftar kartu atau area gulir yang tetap dapat dijangkau.
- Filter halaman memakai satu pola tombol Filter yang membuka popover responsif menempel di atas pemicu, tanpa backdrop; field panjang tetap dapat digulir dan aksi Reset/Terapkan mudah dijangkau. Jika halaman menyediakan pencarian, pencarian tetap berada di toolbar di luar popover Filter. Toolbar Audit, Master, Akses Pegawai, dan daftar Rekap memakai pola ini; jumlah hasil tampil sekali di deskripsi daftar atau penghitung.
- Ikon informasi berada di baris judul untuk membuka keterangan lengkap. Dashboard menyimpan subjudul, target SLA, dan legenda ambang warna di panel informasi agar area heading tetap ringkas; ringkasan cakupan/periode serta tombol filter berada tepat di bawah judul. Pemantauan Manajemen menyimpan subjudul, jumlah tiket per status, dan ringkasan SLA di panel yang sama; daftar tiket tetap langsung terlihat di ponsel tanpa tombol tampilan Ringkasan. Halaman lain tetap menampilkan subjudul di bawah judul. Daftar tiket Dashboard Admin menyediakan pencarian dan filter status/SLA di sisi kanan, dengan baris tiket menjadi kartu di layar mobile.
- Ikon informasi, metrik, dan audit tampil sebagai glyph polos tanpa kotak atau bidang latar; status tetap dibedakan lewat teks dan warna yang sudah bermakna.
- Gutter konten memakai token `--page-gutter` bersama dan menyempit menjadi 12 px pada viewport di bawah 24 rem.
- Pada viewport sangat sempit (di bawah 24 rem), filter bertanggal turun menjadi satu kolom, pasangan tombol boleh bertumpuk, dan perbandingan nilai menempatkan label di atas isi agar tidak memaksa halaman melebar.
- Tab bawah dan dialog menghormati safe area perangkat. Konten menyediakan ruang gulir di bawah tab agar baris terakhir dan tombol tetap bisa dijangkau.
- Target sentuh sekurangnya 44 px; status, label field, fokus keyboard, dan tema terang/gelap tetap jelas.
- Login memakai SSO sebagai pilihan awal. Jika backend menyediakan akun demo aktif, pilihan SSO dan akun demo tampil sebagai switch; mode demo tersembunyi saat backend menonaktifkannya.
- Kartu Riwayat pelengkapan berada di ruang kosong kolom kiri, sejajar dengan kartu Waktu proses dan Alur pengajuan di kolom kanan; permintaan aktif, daftar item, dan tombol berikon untuk membuka form tetap menyatu di dalamnya.
