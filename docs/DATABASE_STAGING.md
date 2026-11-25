# Sinkronkan data development dengan aaPanel

Snapshot development menjadi sumber data untuk staging privat. Snapshot berisi seluruh tabel development dan lampiran privat; tabel `schema_migrations` tidak disalin karena riwayat migrasi mengikuti kode yang dipasang. Selama UAT saat ini, aplikasi memakai database `sla_pengajuan`; setelah UAT disetujui, server database development dan production akan dipisah dan MySQL lokal tidak lagi dipakai untuk development.

## 1. Perbarui snapshot dari lokal

Di komputer lokal, dari folder `backend`:

```powershell
npm.cmd run db:upgrade
npm.cmd run db:export:dev-seed
```

Exporter hanya menerima database lokal dengan `NODE_ENV=development`, `DUMMY_AUTH_ENABLED=true`, dan host MySQL lokal. Jalankan `npm run db:upgrade` lebih dulu supaya schema lokal dan migration terbaru sama. Snapshot tersimpan di `src/db/dev-seeders/local-snapshot.json`; lampiran tersimpan di `src/db/dev-seeders/private-uploads/`. Exporter menyalin seluruh tabel dan lampiran lokal, tetapi hanya menyamarkan kolom profil pengguna untuk akun non-dummy. Pastikan jawaban form, nama/isi tiket, rekap, komentar, dan file lampiran juga hanya berisi data contoh sintetis sebelum menyimpan snapshot ke Git. Pastikan snapshot memiliki tabel `request_recaps`, `request_recap_rows`, dan `request_recap_proposals`; bila belum ada, ekspor ulang dari database lokal yang sudah dimigrasikan. Bila belum ada contoh rekap, buat rekap contoh lewat aplikasi lokal sebelum ekspor.

Setelah memastikan snapshot hanya memuat data uji, commit dan push:

```powershell
git add backend/package.json backend/src/db/export-dev-seed.ts backend/src/db/run-dev-seeders.ts backend/src/db/run-seeders.ts backend/src/db/seeders backend/src/db/dev-seeders docs/DATABASE_STAGING.md README.md docs/DEPLOY_AAPANEL.md PROJECT_STATUS.md
git commit -m "chore: update development seed data"
git push
```

## 2. Backup data staging

Di terminal aaPanel, sebelum sinkronisasi, buat backup database staging. Password diminta secara interaktif:

```bash
mysqldump --single-transaction --routines --triggers --hex-blob --host=127.0.0.1 --port=3306 --user=sla_staging --password sla_pengajuan_staging > /tmp/sla-staging-before-seed.sql
```

Seeder juga mengosongkan `PRIVATE_UPLOAD_DIR` sebelum menyalin lampiran fixture. Backup folder tersebut dari path yang sama dengan konfigurasi backend aaPanel; contoh bila nilainya `/www/private/sla-pengajuan/uploads`:

```bash
tar -czf /tmp/sla-staging-uploads-before-seed.tar.gz -C /www/private/sla-pengajuan/uploads .
```

## 3. Pull dan seed di aaPanel

### 3.1 UAT sementara pada `sla_pengajuan`

Environment ini dipakai untuk uji coba sementara. Batasi domain aplikasi ke VPN/IP tepercaya sebelum mengaktifkan akun dummy. Backend hanya menerima login dummy dalam mode production jika flag aktif dan database bernama tepat `sla_pengajuan` atau berakhiran `_staging`.

Untuk UAT yang saat ini memakai `sla_pengajuan`, atur environment backend:

```dotenv
NODE_ENV=production
DB_NAME=sla_pengajuan
DUMMY_AUTH_ENABLED=true
```

Tarik kode terbaru, lalu dari root repository jalankan:

```bash
npm ci --prefix backend
npm ci --prefix frontend
npm run db:upgrade --prefix backend
npm run db:seed-dummy-users --prefix backend
npm run prod
```

`db:seed-dummy-users` menambahkan/memperbarui akun sintetis dan assignment uji; command menolak menimpa pengguna non-dummy dengan ID yang sama. Setelah build, restart backend dan frontend melalui aaPanel/PM2. Jangan jalankan `db:replace:prod` pada `sla_pengajuan`; command pengganti fixture hanya menerima database berakhiran `_staging` dan menghapus isi database target. Setelah UAT selesai, ubah `DUMMY_AUTH_ENABLED=false` dan restart backend sebelum go-live.

### 3.2 Staging terpisah

Pastikan `backend/.env` aaPanel memakai database staging terpisah dengan nama berakhiran `_staging`, dan `PRIVATE_UPLOAD_DIR` mengarah ke folder privat khusus, misalnya `/www/private/sla-pengajuan/uploads`. Batasi situs staging ke VPN/IP tepercaya sebelum mengaktifkan login akun uji. Pada staging, akun uji dapat digunakan dengan `DUMMY_AUTH_ENABLED=true` di `NODE_ENV=development` atau `NODE_ENV=production`; konfigurasi production hanya diterima bila nama database berakhiran `_staging`. Database production asli tetap harus memakai `DUMMY_AUTH_ENABLED=false`.

Untuk staging yang memakai mode production di aaPanel, setel:

```dotenv
NODE_ENV=production
DB_NAME=sla_pengajuan_staging
DUMMY_AUTH_ENABLED=true
```

Simpan pengaturan tersebut di environment backend aaPanel atau `backend/.env`, lalu restart backend. Setelah uji selesai, ubah `DUMMY_AUTH_ENABLED=false` dan restart lagi.

Setelah itu jalankan satu perintah dari root repository:

```bash
cd /www/wwwroot/sla-pengajuan
DEPLOY_WITH_LOCAL_SEED=true bash scripts/deploy-aapanel.sh
```

`db:replace:prod` menjalankan migrasi dan seed kantor, memeriksa kecocokan tabel serta kolom, lalu mengganti seluruh isi tabel dari snapshot, termasuk tiket dan rekap, serta menyalin ulang lampiran privat. Jika struktur snapshot tidak cocok, command berhenti sebelum mengosongkan tabel. Command hanya menerima database bernama akhiran `_staging`; nama command tidak berarti database production boleh ditimpa. Jalankan sebelum `npm run prod`, kemudian restart backend dan frontend lewat aaPanel/PM2. Periksa dashboard, detail tiket, halaman rekap, dan lampiran.

## 4. Pull code tanpa reset data

Jika ingin mempertahankan perubahan uji yang dibuat langsung di staging, jangan aktifkan `DEPLOY_WITH_LOCAL_SEED`. Jalankan `bash scripts/deploy-aapanel.sh`; script menarik code, menerapkan migration/seed acuan, build, dan restart tanpa menyalin atau menghapus tiket dan rekap.

Pada database production final, jangan aktifkan `DUMMY_AUTH_ENABLED`. Pada UAT `sla_pengajuan` dan staging, setel kembali ke `false` setelah pengujian selesai. `db:replace:prod` menolak database yang tidak memakai akhiran `_staging`; command tersebut mengganti semua data aplikasi staging dengan snapshot.
