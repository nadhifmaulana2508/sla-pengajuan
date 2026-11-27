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
SSO_DUMMY_LOGIN_ENABLED=false
SSO_DUMMY_LOGIN_UAT_ENABLED=false
SSO_CONNECT_IP=
DUMMY_AUTH_ENABLED=false

PRIVATE_UPLOAD_DIR=/www/private/sla-pengajuan/uploads

SLA_INITIAL_ADMIN_EMPLOYEE_ID=
```

Pada production final, `SSO_DUMMY_LOGIN_ENABLED`, `SSO_DUMMY_LOGIN_UAT_ENABLED`, dan `DUMMY_AUTH_ENABLED` harus `false`. Backend memvalidasi konfigurasi ini saat proses migration maupun saat aplikasi dimulai.

Untuk UAT yang dibatasi VPN/IP tepercaya dan berisi data sintetis, kedua metode login dummy dapat diaktifkan pada database bernama `sla_pengajuan` atau berakhiran `_staging`. Tambahkan/ubah flag berikut di `backend/.env`:

```dotenv
SSO_DUMMY_LOGIN_ENABLED=true
SSO_DUMMY_LOGIN_UAT_ENABLED=true
DUMMY_AUTH_ENABLED=true
```

Pertahankan `NODE_ENV=production`. Isi `SSO_BASE_URL` dan `SSO_APP_TOKEN` dengan endpoint serta token aplikasi milik SSO UAT yang secara resmi mendukung `api/auth/login-dummy`; jangan gunakan endpoint SSO production untuk login dummy. Jika environment variable juga dikelola pada Node.js Project/PM2 aaPanel, samakan ketiga flag tersebut di sana karena environment proses dapat menimpa `.env`. Batasi host UAT di firewall/reverse proxy agar hanya VPN atau IP tepercaya yang dapat mengaksesnya. Flag ini tidak membuat akun; login Akun demo membutuhkan baris aktif pada `dummy_users` beserta user, role, dan scope aktif.

Login SSO dummy memakai `GET /api/v1/auth/sso-dummy-login-status` dan `POST /api/v1/auth/sso-dummy-login` dengan body `{"id_peg":"ID_UJI"}`. Login Akun demo lokal memakai `GET /api/v1/auth/dummy-users` dan `POST /api/v1/auth/dummy-login` dengan body `{"employee_id":"ID_UJI"}`. Setelah mengubah `.env`, lakukan backup database dan jalankan deploy penuh agar validasi, build, dan restart backend memakai konfigurasi baru.

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
- Nama proses PM2: `sla-pengajuan-backend`
- User: user aplikasi `www` atau user non-root yang sesuai

Pastikan command build dan migrasi dilakukan sebelum restart project. aaPanel/PM2 hanya menjaga proses tetap hidup; migrasi database tetap dijalankan secara terkontrol saat release.

### 5.2 Project frontend

- Project path: `/www/wwwroot/sla-pengajuan/frontend`
- Startup file: `build/index.js`
- Run directory: `/www/wwwroot/sla-pengajuan/frontend`
- Port: `4173`
- Node version: sama dengan backend
- Process manager: PM2
- Nama proses PM2: `sla-pengajuan-frontend`
- User: user aplikasi `www` atau user non-root yang sesuai

Jika aaPanel meminta command, gunakan `npm run start`. Adapter Node memakai `PORT` dari environment; proses frontend harus mendengarkan di `4173` agar cocok dengan reverse proxy dan health check. Script deploy mengirim `PORT=4173` saat restart PM2 (`FRONTEND_PORT` dapat dipakai untuk port lain). Saat restart manual dari aaPanel, pastikan variabel `PORT` proses frontend juga bernilai `4173`.

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

Buat backup database melalui aaPanel sebelum release yang menerapkan migration. Jangan menjalankan release dari laptop. Dari Terminal aaPanel, jalankan satu perintah ini di root repository:

Untuk perubahan frontend saja, gunakan target terpisah berikut. Target ini menarik commit terbaru, meng-install dependency frontend, membangun frontend, me-restart proses frontend, dan memeriksa port frontend. Backend, dependency backend, migration, serta proses backend tidak disentuh:

```bash
FRONTEND_PM2_NAME=sla-frontend npm run deploy:frontend
```

Jika checkout lama sudah menolak deploy karena `package-lock.json` root tak terlacak, jalankan `git pull --ff-only origin main` satu kali terlebih dahulu untuk mengambil aturan ignore lockfile tersebut, lalu jalankan perintah deploy di atas.

Port default `4173` dapat dioverride lewat `FRONTEND_PORT`; health check akan mengikuti port tersebut kecuali `FRONTEND_HEALTH_URL` diatur sendiri. Jika frontend release memerlukan kontrak API/backend yang belum tersedia di server, gunakan deploy penuh atau deploy backend secara terpisah sebelum mengandalkan fitur terkait.

Untuk release frontend dan backend sekaligus, gunakan:

```bash
npm run deploy:production
```

Script memeriksa root dan identitas package repository, branch `main`, working tree bersih, konfigurasi backend/frontend tersedia, dan kedua proses PM2 sudah ada sebelum pull. Urutannya: `git pull --ff-only origin main`, `npm ci` untuk backend/frontend, `npm run db:upgrade --prefix backend`, `npm run prod`, restart kedua proses PM2 dengan `--update-env`, lalu health check. `db:upgrade` menerapkan migration yang belum tercatat dan seed master acuan; script tidak menjalankan `db:replace:prod` atau seeder snapshot. Isi tiket dan rekap tetap dipertahankan. Script hanya memeriksa keberadaan/konfigurasi; ia tidak menampilkan, mengedit, atau menimpa `.env`.

Konfigurasi default mengikuti repo: API memakai port `3000` dari default `API_PORT` di backend, frontend memakai port `4173` dari runbook aaPanel dan `PORT` adapter-node. Health check backend menggunakan route database agar memeriksa koneksi API sekaligus MySQL. Port `3100` dan nama `sla-backend`/`sla-frontend` tidak menjadi default yang tercatat pada checkout ini. `API_PORT` dapat memakai port lain di server; sesuaikan URL health check jika demikian. Nama proses PM2 tidak ditetapkan di kode; nama default berikut mengikuti runbook dan dapat dioverride bila project aaPanel production memakai nama lain:

| Environment variable | Default repo | Keterangan |
| --- | --- | --- |
| `BACKEND_PM2_NAME` | `sla-pengajuan-backend` | Nama proses PM2 backend |
| `FRONTEND_PM2_NAME` | `sla-pengajuan-frontend` | Nama proses PM2 frontend |
| `BACKEND_HEALTH_URL` | `http://127.0.0.1:3000/api/v1/health/database` | API dan koneksi database |
| `FRONTEND_HEALTH_URL` | `http://127.0.0.1:4173/` | Halaman frontend |

Jika konfigurasi production berbeda, isi nilainya pada environment Terminal aaPanel sebelum release, atau berikan inline saat menjalankan command. Contoh berikut hanya dipakai jika nama proses dan port lama sudah diverifikasi di aaPanel:

```bash
BACKEND_PM2_NAME=sla-backend FRONTEND_PM2_NAME=sla-frontend BACKEND_HEALTH_URL=http://127.0.0.1:3100/api/v1/health/database FRONTEND_HEALTH_URL=http://127.0.0.1:4173/ npm run deploy:production
```

Jalankan sebagai user Linux yang sama dengan pemilik proses PM2. Pastikan `backend/.env` dapat dibaca dan `frontend/.env` sudah memiliki `VITE_API_BASE_URL` (atau nilai itu tersedia pada environment Terminal). Script berhenti dengan pesan yang menyebut variabel jika nama/URL kosong atau tidak valid, dan berhenti sebelum pull jika proses PM2 tidak ditemukan. Nilai default dari runbook adalah pilihan yang didukung repo; pastikan nilainya cocok dengan proses dan port yang benar-benar aktif di server.

Script tidak menampilkan atau mengubah file `.env`. Migration harus tetap memakai konfigurasi backend yang sudah tersedia di server. Jika pull, dependency, migration, atau build gagal, script berhenti sebelum restart. Migration database tidak memiliki rollback otomatis; siapkan backup sebelum release.

`npm run db:upgrade --prefix backend` menerapkan migration SQL bernomor yang belum tercatat pada `schema_migrations`, lalu memasukkan data master acuan. Jangan membuat tabel atau menjalankan file SQL secara manual. Migration `021_create_request_recaps.sql` menambahkan tabel `request_recaps`, `request_recap_rows`, dan `request_recap_proposals`; migration berikutnya ikut diterapkan otomatis saat upgrade.

Jika health check gagal setelah restart, script menampilkan command log PM2 untuk proses yang gagal dan keluar dengan status gagal. Jalankan command tersebut, lalu periksa status proses:

```bash
pm2 status
pm2 logs sla-pengajuan-backend --lines 100
pm2 logs sla-pengajuan-frontend --lines 100
```

Jika nama PM2 di server dioverride, ganti nama pada command log sesuai nilainya. Setelah health check backend dan frontend berhasil, script menampilkan short commit yang dirilis.

### CD otomatis ke UAT melalui GitHub Actions

Workflow `.github/workflows/ci.yml` menjalankan pemeriksaan untuk pull request dan push ke `main`. Setelah CI pada push `main` lulus, job `deploy-uat` otomatis menghubungi aaPanel melalui SSH dan menjalankan `npm run deploy:production`. Deploy hanya aktif setelah environment variable `AAPANEL_CD_ENABLED=true` dipasang pada GitHub Environment `uat`; sebelum itu CI tetap berjalan tetapi job deploy dilewati. `workflow_dispatch` pada branch `main` juga tersedia untuk memulai CI dan deploy secara manual.

Workflow mengirim `EXPECTED_DEPLOY_COMMIT` ke server. Jika `main` di server sudah bergeser dari commit yang lulus CI, deploy berhenti sebelum install, migration, build, atau restart. Health check dipatok ke backend `http://127.0.0.1:3100/api/v1/health/database` dan frontend `http://127.0.0.1:4173/`, dengan proses PM2 `sla-backend` dan `sla-frontend`. Pastikan health backend lulus dari aaPanel sebelum mengaktifkan CD; status PM2 `online` saja tidak cukup.

Siapkan akses GitHub Environment bernama `uat`:

1. Buat SSH key deploy di komputer tepercaya. Pasang **public key** pada `/root/.ssh/authorized_keys` aaPanel; private key tetap di komputer sampai dimasukkan ke GitHub Secret. Jangan simpan private key dalam folder project.
2. Verifikasi fingerprint SSH server lewat aaPanel, lalu simpan baris `known_hosts` yang cocok sebagai secret `AAPANEL_KNOWN_HOSTS`. Workflow menolak host key yang tidak cocok.
3. Di **Settings → Environments**, buat environment `uat`. Tambahkan environment variables `AAPANEL_HOST`, `AAPANEL_PORT`, dan `AAPANEL_USER`; tambahkan secrets `AAPANEL_SSH_PRIVATE_KEY` dan `AAPANEL_KNOWN_HOSTS`. Batasi deployment branch ke `main`.
4. Di **Settings → Secrets and variables → Actions → Variables**, buat repository variable `AAPANEL_CD_ENABLED=false` atau biarkan belum ada selama setup awal. Uji login SSH dari komputer, pastikan health backend/frontend lulus, lalu ubah variable itu menjadi `true`. Push berikutnya ke `main` akan menjalankan deploy setelah CI berhasil. Untuk menjalankan segera setelah aktivasi, pilih **Actions → CI → Run workflow** pada branch `main`.

Saat ini proses PM2 dimiliki `root`, jadi `AAPANEL_USER` harus `root` agar workflow dapat me-restart proses. Key yang dipasang pada akun root memiliki akses server luas; pisahkan user deploy dan pindahkan PM2 bila ingin isolasi per project. Server tetap harus dapat menjalankan `git pull --ff-only origin main` dari GitHub dan menyediakan Node/npm pada login shell. GitHub tidak menerima `.env`; konfigurasi SSO dan database tetap di server.


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
