import { redirect } from "next/navigation";

// Trang "Post feed" cu da duoc gom vao tab "Seeding ben ngoai" cua
// /all-platform/internal-engagement (theo yeu cau user) - khong con menu
// rieng trong sidebar nua (xem AllPlatformSidebar.tsx). Giu route nay lai
// duoi dang redirect thay vi xoa han, de link/bookmark cu khong bi 404.
export default function AllPlatformPostFeedPage() {
  redirect("/all-platform/internal-engagement");
}
