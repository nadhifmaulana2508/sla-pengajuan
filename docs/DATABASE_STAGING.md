# Menyamakan database lokal dan staging

Database lokal dan server tidak perlu berisi tiket yang sama untuk menjalankan versi aplikasi yang sama. Gunakan migrasi untuk menyamakan struktur, seed untuk data acuan awal, dan dump satu kali hanya saat membuat staging dari snapshot lokal.

## Update schema dan seed dasar

Di folder backend, jalankan:

```bash
npm ci
npm run db:upgrade
```

`db:upgrade` menjalankan migrasi yang belum diterapkan dan seed kantor dasar. Divisi, role, katalog awal, form bawaan, serta alasan penolakan dibuat oleh migrasi. Perintah ini tidak menghapus atau menyalin pengguna, assignment, tiket, histori, atau lampiran; aman diulang saat release.

Di Windows lokal, padanannya:

```powershell
npm.cmd ci
npm.cmd run db:upgrade
```

Akun dummy dijalankan terpisah dengan `npm run db:seed-dummy-users` dan hanya untuk development. Jangan aktifkan autentikasi dummy pada staging yang bisa diakses publik atau pada production.

## Clone lokal satu kali ke staging

Pakai ini hanya untuk membuat atau menyegarkan database staging. Jangan restore dump lokal ke production. Dump dapat memuat profil pegawai, tiket, histori, notifikasi, dan metadata lampiran. Pastikan isi lokal sintetis atau sudah dianonimkan dan disetujui untuk dipakai di staging. Jangan taruh dump di repository atau mengirimnya melalui chat.

1. Buat database staging terpisah yang kosong, misalnya `sla_pengajuan_staging`, dan user MySQL staging. Jika database staging sudah berisi data, backup serta verifikasi dump itu sebelum menggantinya.
2. Di komputer lokal, jalankan perintah ini dari folder `backend`. Script membaca koneksi dari `backend/.env`, menolak host database non-lokal dan `NODE_ENV=production`, menaruh dump di `%TEMP%` di luar repository, serta menghapus file kredensial sementara setelah selesai:

   ```powershell
   npm.cmd run db:dump:staging
   ```

   Terminal menampilkan lokasi file dump. Jika `mysqldump` tidak ada di `C:\xampp\mysql\bin\mysqldump.exe` atau `PATH`, atur environment `MYSQLDUMP_PATH` ke executable MySQL client yang tersedia.

3. Transfer file memakai SCP/SFTP ke server staging. Contoh dengan SCP:

   ```powershell
   scp "$dumpPath" user-staging@HOST_STAGING:/tmp/sla-pengajuan-staging.sql
   ```

4. Di server, restore ke database staging yang kosong. Perintah `mysql` juga meminta password secara interaktif:

   ```bash
   mysql --host=127.0.0.1 --port=3306 --user=sla_staging --password sla_pengajuan_staging < /tmp/sla-pengajuan-staging.sql
   ```

5. Pastikan `backend/.env` staging menunjuk ke `DB_NAME=sla_pengajuan_staging`, lalu jalankan `npm run db:upgrade`, build aplikasi, dan restart backend. Autentikasi dummy hanya berjalan dengan `NODE_ENV=development` dan `DUMMY_AUTH_ENABLED=true`; aktifkan sementara hanya pada staging yang dibatasi ke VPN/IP tepercaya. Biarkan nonaktif di server publik dan production.
6. Jika staging perlu membuka lampiran lokal, salin isi `PRIVATE_UPLOAD_DIR` lewat jalur privat yang sama. Dump MySQL hanya menyimpan metadata lampiran, bukan file-nya. Jika file berisi dokumen nyata, jangan salin ke staging tanpa persetujuan dan sanitasi.
7. Setelah restore dan pemeriksaan selesai, hapus dump sementara dari komputer lokal dan `/tmp` server.

Dump adalah snapshot satu kali, bukan cara sinkronisasi setiap release. Setelah itu, gunakan `npm run db:upgrade`; jangan restore ulang di atas data staging yang sudah dipakai.
