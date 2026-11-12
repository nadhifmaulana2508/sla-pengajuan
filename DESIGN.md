# Arah UI Sistem SLA

## Design Read

Sistem SLA adalah aplikasi kerja internal untuk mengirim dan menindaklanjuti tiket antar Cabang, Korwil, dan Divisi Pusat. UI mengutamakan tugas yang sering dilakukan dengan satu tangan di ponsel: melihat status, membuka tiket, memberi tindak lanjut, dan menyelesaikan form.

- **Arah:** aplikasi operasional mobile-first dengan navigasi bawah untuk tujuan utama dan menu tambahan berbentuk sheet.
- **Karakter:** tenang, jelas, dan terasa siap kerja. Isi tiket lebih menonjol daripada dekorasi.
- **Palet:** permukaan netral dan hitam; aksen hijau neon muncul pada outline, fokus, teks navigasi aktif, dan pilihan tujuan terpilih. Badge status berbentuk kapsul penuh dengan fill tipis serta border/teks emerald, oranye, atau merah yang jelas. Hindari bidang neon besar.
- **Tipografi:** Inter yang sudah dipakai, dengan skala cair dan ukuran input yang nyaman disentuh.
- **Motif:** garis progres tipis yang menandai perpindahan tiket antar unit; dipakai hanya untuk konteks alur dan SLA.
- **ENERGY / RHYTHM / MOTION:** 2 / 2 / 1. Hirarki cukup tegas untuk membedakan status dan tindakan, ritme mengikuti kelompok tugas, gerakan singkat hanya untuk membuka atau menutup panel.

## Pola lintas perangkat

- Ponsel dan tablet memakai app bar ringkas serta tab bawah untuk tujuan utama; menu tambahan membuka sheet yang dapat digulir.
- Lebar besar mempertahankan navigasi desktop di header dan memberi ruang baca lebih lebar.
- Halaman mengalir satu kolom saat ruang sempit. Kartu tiket menjadi ringkas, form mengisi lebar konten, dan tabel memakai daftar kartu atau area gulir yang tetap dapat dijangkau.
- Tab bawah dan dialog menghormati safe area perangkat. Konten menyediakan ruang gulir di bawah tab agar baris terakhir dan tombol tetap bisa dijangkau.
- Target sentuh sekurangnya 44 px; status, label field, fokus keyboard, dan tema terang/gelap tetap jelas.
