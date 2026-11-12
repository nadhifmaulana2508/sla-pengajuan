# Sinkronkan data development dengan aaPanel

Database development lokal menjadi sumber data untuk staging privat. Snapshot berisi seluruh tabel bisnis development dan lampiran privat. `db:sync:dev` mengosongkan tabel staging lalu mengisi ulang snapshot; jalankan hanya untuk staging dengan data uji, jangan untuk production.

## 1. Perbarui snapshot dari lokal

Di komputer lokal, dari folder `backend`:

```powershell
npm.cmd run db:upgrade
npm.cmd run db:export:dev-seed
```

Exporter hanya menerima database lokal dengan `NODE_ENV=development` dan `DUMMY_AUTH_ENABLED=true`. Snapshot tersimpan di `src/db/dev-seeders/local-snapshot.json`; lampiran tersimpan di `src/db/dev-seeders/private-uploads/`. Identitas akun yang tidak ditandai sebagai akun dummy diganti dengan identitas uji sintetis.

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

## 3. Pull dan seed di aaPanel

Pastikan `backend/.env` staging memakai database terpisah dengan nama berakhiran `_staging`, `NODE_ENV=development`, `DUMMY_AUTH_ENABLED=true`, dan `PRIVATE_UPLOAD_DIR` mengarah ke folder privat khusus, misalnya `/www/private/sla-pengajuan/uploads`. Batasi akses staging ke VPN/IP tepercaya.

Setelah itu jalankan:

```bash
cd /www/wwwroot/sla-pengajuan
git fetch origin
git checkout main
git pull --ff-only origin main

cd backend
npm ci
npm run db:sync:dev
npm run build

cd ../frontend
npm ci
npm run build
```

`db:sync:dev` menjalankan migrasi dan seed kantor, lalu mengisi ulang seluruh tabel dari snapshot. Setelah build berhasil, restart backend dan frontend lewat aaPanel/PM2. Periksa login dummy, dashboard, detail tiket, dan lampiran.

## 4. Pull code tanpa reset data

Jika ingin mempertahankan perubahan uji yang dibuat langsung di staging, jangan jalankan `db:sync:dev`. Pull code, lalu jalankan `npm run db:upgrade` untuk menerapkan migrasi/seed acuan saja sebelum build.

Jangan aktifkan `DUMMY_AUTH_ENABLED` pada production. `db:seed:dev` menolak production, host remote non-staging, dan database yang tidak memakai akhiran `_staging`.
