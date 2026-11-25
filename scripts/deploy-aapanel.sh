#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
BACKEND_PM2_NAME="${BACKEND_PM2_NAME-sla-pengajuan-backend}"
FRONTEND_PM2_NAME="${FRONTEND_PM2_NAME-sla-pengajuan-frontend}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL-http://127.0.0.1:3000/api/v1/health/database}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL-http://127.0.0.1:4173/}"

fail() {
	printf 'Deploy dibatalkan: %s\n' "$1" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || fail "command '$1' tidak tersedia."
}

cd "$ROOT_DIR"
require_command git
require_command node
require_command npm
require_command pm2
require_command curl

[[ "$(pwd -P)" == "$ROOT_DIR" ]] || fail "jalankan npm run deploy:production dari root repository /www/wwwroot/sla-pengajuan."
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "folder ini bukan checkout Git."
[[ "$(cd -- "$GIT_ROOT" && pwd -P)" == "$ROOT_DIR" ]] || fail "root Git tidak cocok dengan folder aplikasi."

node -e 'const fs = require("node:fs"); const expected = [["package.json", "sla-pengajuan"], ["backend/package.json", "sla-pengajuan-backend"], ["frontend/package.json", "sla-pengajuan-frontend"]]; for (const [file, name] of expected) { if (JSON.parse(fs.readFileSync(file, "utf8")).name !== name) { console.error("Checkout ini bukan repository Sistem SLA Pengajuan."); process.exit(1); } }' || fail "identitas project tidak cocok dengan Sistem SLA Pengajuan."

[[ -r backend/.env ]] || fail "backend/.env tidak tersedia atau tidak dapat dibaca; isi konfigurasi server terlebih dahulu tanpa menampilkan nilainya."
[[ -r frontend/.env || -n "${VITE_API_BASE_URL:-}" ]] || fail "VITE_API_BASE_URL belum tersedia di frontend/.env atau environment Terminal aaPanel."
[[ -n "$BACKEND_PM2_NAME" ]] || fail "BACKEND_PM2_NAME belum diisi."
[[ -n "$FRONTEND_PM2_NAME" ]] || fail "FRONTEND_PM2_NAME belum diisi."
[[ "$BACKEND_HEALTH_URL" == http://* || "$BACKEND_HEALTH_URL" == https://* ]] || fail "BACKEND_HEALTH_URL harus berupa URL HTTP/HTTPS."
[[ "$FRONTEND_HEALTH_URL" == http://* || "$FRONTEND_HEALTH_URL" == https://* ]] || fail "FRONTEND_HEALTH_URL harus berupa URL HTTP/HTTPS."

CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" == "main" ]] || fail "branch aktif '$CURRENT_BRANCH', seharusnya 'main'. Pindah ke main sebelum deploy."
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail "working tree belum bersih. Simpan atau pulihkan perubahan sebelum deploy."

pm2 describe "$BACKEND_PM2_NAME" >/dev/null 2>&1 || fail "proses PM2 backend '$BACKEND_PM2_NAME' tidak ditemukan. Periksa BACKEND_PM2_NAME dan project aaPanel."
pm2 describe "$FRONTEND_PM2_NAME" >/dev/null 2>&1 || fail "proses PM2 frontend '$FRONTEND_PM2_NAME' tidak ditemukan. Periksa FRONTEND_PM2_NAME dan project aaPanel."

printf 'Pull perubahan terbaru pada main...\n'
git pull --ff-only origin main

printf 'Install dependency backend...\n'
npm ci --prefix backend
printf 'Install dependency frontend...\n'
npm ci --prefix frontend

printf 'Terapkan migration rutin...\n'
npm run db:upgrade --prefix backend

printf 'Build backend dan frontend...\n'
npm run prod

printf 'Restart proses aaPanel/PM2...\n'
pm2 restart "$BACKEND_PM2_NAME" --update-env
pm2 restart "$FRONTEND_PM2_NAME" --update-env

check_health() {
	local service="$1"
	local pm2_name="$2"
	local url="$3"

	if ! curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-connrefused "$url" >/dev/null; then
		printf 'Health check %s gagal. Periksa log dengan: pm2 logs %s --lines 100\n' "$service" "$pm2_name" >&2
		return 1
	fi
}

check_health backend "$BACKEND_PM2_NAME" "$BACKEND_HEALTH_URL" || exit 1
check_health frontend "$FRONTEND_PM2_NAME" "$FRONTEND_HEALTH_URL" || exit 1

printf 'Release berhasil pada commit %s.\n' "$(git rev-parse --short HEAD)"
