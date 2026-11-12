# Deployment Sistem SLA ke aaPanel

Dokumen ini adalah runbook untuk menjalankan Sistem SLA pada VPS aaPanel dengan Nginx, Node.js, PM2, dan MySQL.

## 1. Arsitektur yang digunakan

Gunakan dua subdomain agar konfigurasi reverse proxy dan CORS mudah dipantau:

```text
sla.example.com      -> frontend SvelteKit Node 127.0.0.1:4173
api.sla.example.com  -> backend Express       127.0.0.1:3000
MySQL                 -> 127.0.0.1:3306
SSO perusahaan       -> https://apisso.bkkjateng.co.id/
```

Port `3000`, `4173`, dan `3306` tidak perlu dibuka ke internet. Hanya Nginx pada port `80/443` yang menerima trafik publik.

## 2. Prasyarat

- VPS sudah terpasang aaPanel.
- DNS `A` untuk `sla.example.com` dan `api.sla.example.com` mengarah ke IP VPS.
- Nginx, MySQL, dan Node.js aktif di aaPanel.
- Node.js minimal mengikuti requirement SvelteKit pada project. Gunakan Node.js 22 LTS atau versi yang kompatibel dengan lockfile.
- Server dapat mengakses API SSO perusahaan melalui HTTPS.
- Akses SSH atau Terminal aaPanel tersedia.

Di aaPanel, Node.js Project dapat dipakai untuk mengelola aplikasi Node, PM2, versi Node, domain, SSL, dan log project.

## 3. Alur development lokal

Kerjakan perubahan di branch fitur, lalu gabungkan ke `main` setelah pemeriksaan selesai.

```powershell
git switch -c feat/nama-perubahan

Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env

Set-Location backend
npm.cmd install
npm.cmd run db:migrate
npm.cmd run dev
```

Buka terminal kedua untuk frontend:

```powershell
Set-Location frontend
npm.cmd install
npm.cmd run dev
```

Sebelum commit:

```powershell
Set-Location backend
npm.cmd run check
npm.cmd run build

Set-Location ../frontend
npm.cmd run check
npm.cmd run build

Set-Location ..
git status
git diff --stat
git add -A
git commit -m "deskripsi perubahan"
git push -u origin nama-branch
```

Jangan pernah meng-commit `backend/.env`, `frontend/.env`, password, bearer token, atau dump database berisi data pribadi. Template konfigurasi yang boleh masuk Git adalah `.env.example`.

## 4. Siapkan aplikasi pertama kali di server

### 4.1 Buat folder aplikasi

Contoh lokasi aplikasi:

```bash
mkdir -p /www/wwwroot/sla-pengajuan
cd /www/wwwroot/sla-pengajuan
git clone https://github.com/nadhifmaulana2508/sla-pengajuan.git .
```

Jika repository bersifat private, gunakan deploy key atau credential Git server. Jangan menaruh token Git di file project.

### 4.2 Buat database dan user MySQL

Buat database `sla_pengajuan` dan user aplikasi dengan hak akses hanya ke database tersebut. Jangan gunakan user `root` untuk runtime aplikasi.

```sql
CREATE DATABASE IF NOT EXISTS sla_pengajuan
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'sla_app'@'127.0.0.1' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_KUAT';
GRANT ALL PRIVILEGES ON sla_pengajuan.* TO 'sla_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Simpan password database di aaPanel atau secret manager, bukan di Git. Aktifkan backup database terjadwal sebelum migrasi pertama.

### 4.3 Konfigurasi backend

Salin template dan edit file `.env` di server:

```bash
cd /www/wwwroot/sla-pengajuan/backend
cp .env.example .env
nano .env
```

Nilai minimum untuk production:

```dotenv
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=3000
FRONTEND_ORIGIN=https://sla.example.com

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=sla_pengajuan
DB_USER=sla_app
DB_PASSWORD=ISI_DI_SERVER_SAJA

SSO_BASE_URL=https://apisso.bkkjateng.co.id
SSO_APP_CODE=simpeg
SSO_TIMEOUT_MS=10000
SSO_CONNECT_IP=

PRIVATE_UPLOAD_DIR=/www/private/sla-pengajuan/uploads

SLA_INITIAL_ADMIN_EMPLOYEE_ID=
```

`SSO_CONNECT_IP=10.0.2.2` adalah pola untuk environment lokal yang membutuhkan pemetaan host. Di production, kosongkan kecuali jaringan VPS memang secara resmi membutuhkan IP tersebut dan sudah diuji. Hostname SSO tetap digunakan untuk SNI dan validasi sertifikat.
`PRIVATE_UPLOAD_DIR` harus menunjuk ke direktori persisten di luar document root frontend/Nginx. Buat direktori tersebut dan beri hak tulis hanya kepada user proses backend; sertakan direktori ini dalam backup terenkripsi bersama database. File di dalamnya tidak boleh disajikan langsung oleh web server.

Setelah itu jalankan:

```bash
npm ci
npm run db:upgrade
npm run build
```

Bootstrap admin hanya dilakukan satu kali pada database baru. Isi `SLA_INITIAL_ADMIN_EMPLOYEE_ID` sementara, jalankan perintah berikut, lalu hapus nilainya dari `.env`:

```bash
npm run db:bootstrap-admin
```

Jangan menjalankan bootstrap admin pada setiap restart aplikasi.

### 4.4 Konfigurasi frontend

Frontend memakai nilai `VITE_API_BASE_URL` saat proses build. Atur sebelum build:

```bash
cd /www/wwwroot/sla-pengajuan/frontend
cp .env.example .env
nano .env
```

Isi:

```dotenv
VITE_API_BASE_URL=https://api.sla.example.com/api/v1
```

Lalu install dan build:

```bash
npm ci
npm run build
```

Frontend production memakai `adapter-node`. Entry point hasil build adalah `build/index.js` dan dapat dijalankan dengan:

```bash
npm run start
```

## 5. Tambahkan dua project Node di aaPanel

Gunakan menu **Website → Node.js Project** atau plugin Node.js Project yang tersedia pada versi aaPanel.

### 5.1 Project backend

- Project path: `/www/wwwroot/sla-pengajuan/backend`
- Startup file: `dist/server.js`
- Run directory: `/www/wwwroot/sla-pengajuan/backend`
- Port: `3000`
- Node version: versi yang dipakai saat development, minimal Node 22 LTS
- Process manager: PM2
- User: user aplikasi `www` atau user non-root yang sesuai

Pastikan command build dan migrasi dilakukan sebelum restart project. aaPanel/PM2 hanya menjaga proses tetap hidup; migrasi database tetap dijalankan secara terkontrol saat release.

### 5.2 Project frontend

- Project path: `/www/wwwroot/sla-pengajuan/frontend`
- Startup file: `build/index.js`
- Run directory: `/www/wwwroot/sla-pengajuan/frontend`
- Port: `4173`
- Node version: sama dengan backend
- Process manager: PM2
- User: user aplikasi `www` atau user non-root yang sesuai

Jika aaPanel meminta command, gunakan `npm run start`. Pastikan environment `PORT=4173` tersedia untuk proses frontend; adapter-node juga menerima `HOST` dan `PORT` dari environment.

## 6. Reverse proxy dan SSL

### 6.1 Domain frontend

Buat website/domain `sla.example.com`, aktifkan SSL Let’s Encrypt, lalu pasang reverse proxy ke:

```text
http://127.0.0.1:4173
```

### 6.2 Domain API

Buat website/domain `api.sla.example.com`, aktifkan SSL Let’s Encrypt, lalu pasang reverse proxy ke:

```text
http://127.0.0.1:3000
```

`FRONTEND_ORIGIN` backend harus sama persis dengan origin frontend, termasuk `https://` dan tanpa slash tambahan.

Setelah perubahan konfigurasi Nginx, uji konfigurasi lalu reload Nginx dari aaPanel atau terminal:

```bash
nginx -t
/etc/init.d/nginx reload
```

## 7. Verifikasi setelah deploy

Jalankan dari server:

```bash
curl http://127.0.0.1:3000/api/v1/health
curl http://127.0.0.1:3000/api/v1/health/database
curl -I http://127.0.0.1:4173
```

Jalankan dari komputer pengguna:

```text
https://sla.example.com
https://api.sla.example.com/api/v1/health
```

Checklist browser:

- Halaman login terbuka melalui HTTPS.
- Login SSO berhasil dan profil lokal terbaca.
- Dashboard sesuai role.
- Daftar/detail pengajuan dapat dibuka.
- CORS tidak menghasilkan error pada DevTools.
- Aksi workflow membuat timeline dan notifikasi.
- Mobile dan desktop tidak memiliki scroll horizontal.
- Log PM2/Nginx tidak mencetak password atau bearer token.

## 8. Alur release dari GitHub ke aaPanel

Simpan `.env` hanya di server. Pada setiap release:

```bash
cd /www/wwwroot/sla-pengajuan
git fetch origin
git checkout main
git pull --ff-only origin main

cd backend
npm ci
npm run db:upgrade
npm run build

cd ../frontend
npm ci
npm run build
```

Restart kedua project dari aaPanel/PM2 setelah build selesai. Backup database dilakukan sebelum migrasi yang mengubah schema. Migrations pada repository tidak memiliki rollback otomatis, sehingga rollback release dan rollback data harus diperlakukan sebagai dua langkah terpisah.

Untuk pull dan mengganti seluruh data staging dengan fixture database lokal selama development, ikuti [panduan sinkronisasi staging](DATABASE_STAGING.md). Release rutin cukup memakai `npm run db:upgrade`; jangan jalankan `db:replace:prod` pada database production.

## 9. Backup dan keamanan minimum

- Backup MySQL harian melalui aaPanel dan simpan salinan di lokasi berbeda.
- Uji restore backup secara berkala pada database staging.
- Buka firewall hanya untuk SSH terbatas, HTTP, dan HTTPS.
- Jangan expose MySQL atau port Node ke publik.
- Gunakan HTTPS untuk frontend, API, dan panggilan SSO.
- Gunakan user runtime non-root.
- Jangan menyimpan `.env`, password, token, atau data pribadi di repository.
- Setelah bootstrap admin selesai, kosongkan `SLA_INITIAL_ADMIN_EMPLOYEE_ID`.
- Periksa log PM2 dan Nginx setelah setiap release.

## 10. Referensi aaPanel

- [Node.js Project aaPanel](https://www.aapanel.com/docs/Function/Node.html)
- [Proxy Project aaPanel](https://www.aapanel.com/docs/Function/proxy.html)
- [MySQL aaPanel](https://www.aapanel.com/docs/Function/MySQL.html)
- [Service management aaPanel](https://www.aapanel.com/docs/faq/Service_Manage_Commands.html)
