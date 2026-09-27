/**
 * Đóng gói lại các thư mục extensions/* (nằm ngoài repo con này, ../extensions)
 * thành public/<ten-thu-muc>.zip — để nút "Tải Extension" trên FE luôn tải đúng
 * bản mới nhất, không phải zip cũ copy tay rồi quên cập nhật.
 *
 * QUAN TRỌNG: Docker build của frontend chỉ có context = linkedin-crawler-ui/
 * (xem docker-compose.yml), nên bên trong container KHÔNG thấy được
 * ../extensions. Script này phải tự bỏ qua êm khi không thấy thư mục đó,
 * không được làm hỏng `npm run build` trong Docker — các file public/*.zip
 * đã commit sẵn trong git sẽ được dùng nguyên trạng trong trường hợp đó.
 * Chạy script này (qua predev/prebuild) chỉ thực sự đóng gói lại khi có sẵn
 * source ../extensions, tức là trên máy dev trong repo đầy đủ.
 */
import { createWriteStream, existsSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDir = path.join(root, "..", "extensions");
const publicDir = path.join(root, "public");

// Allowlist, KHÔNG quét tự động toàn bộ ../extensions/*: một số thư mục ở đó
// (vd post-feed-extension) là dự án TypeScript/webpack đầy đủ có package.json
// + node_modules + thư mục build riêng — zip nguyên cả thư mục nguồn của
// chúng cho ra file .zip sai/phình to (đã xảy ra thật, package-lock.json +
// src/ lọt cả vào file người dùng tải xuống). Chỉ những extension "phẳng"
// (thuần .js/manifest.json ở gốc, không cần bước build riêng) mới an toàn để
// đóng gói nguyên thư mục kiểu này.
const MANAGED_EXTENSIONS = [
  "comment-extension",
  "api-facebook-get-extension",
  "extension-login-zalo",
  "linkedin-group-crawler-extension",
];

// Ghi ra file .tmp rồi rename đè lên đích — rename là atomic ở cấp hệ điều hành,
// nên `next dev`/server đang chạy song song sẽ KHÔNG BAO GIỜ đọc phải file
// đang ghi dở (tránh lỗi trình duyệt "Không thấy tệp trên trang" khi build lại
// đúng lúc có người bấm tải).
async function zipFolder(sourceDir, destZipPath) {
  const tmpPath = `${destZipPath}.tmp-${process.pid}`;
  await new Promise((resolve, reject) => {
    const output = createWriteStream(tmpPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    output.on("error", reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  }).catch((err) => {
    try {
      unlinkSync(tmpPath);
    } catch {}
    throw err;
  });
  renameSync(tmpPath, destZipPath);
}

async function main() {
  if (!existsSync(extensionsDir)) {
    console.log(
      "[build-extension-zips] Không thấy ../extensions (bình thường trong Docker build) — giữ nguyên public/*.zip đã commit sẵn.",
    );
    return;
  }

  for (const name of MANAGED_EXTENSIONS) {
    const sourceDir = path.join(extensionsDir, name);
    if (!existsSync(sourceDir)) {
      console.warn(`[build-extension-zips] Bỏ qua ${name}: không thấy thư mục nguồn.`);
      continue;
    }
    const destZipPath = path.join(publicDir, `${name}.zip`);
    try {
      await zipFolder(sourceDir, destZipPath);
      console.log(`[build-extension-zips] Đã đóng gói ${name} -> public/${name}.zip`);
    } catch (err) {
      console.warn(`[build-extension-zips] Bỏ qua ${name}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  // Không bao giờ để lỗi ở đây làm hỏng build — chỉ cảnh báo và dùng zip cũ.
  console.warn(`[build-extension-zips] Bỏ qua bước đóng gói extension: ${err.message}`);
});
