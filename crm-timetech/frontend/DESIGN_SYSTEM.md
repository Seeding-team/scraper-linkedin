# DESIGN SYSTEM — Seeding (đồng nhất với app.markeeai.com)

> **Đọc file này TRƯỚC khi sửa/làm mới bất kỳ trang nào trong `linkedin-crawler-ui`.**
> Mục tiêu: mọi trang của seeding.markeeai.com nhìn và hoạt động như "cùng một khung sinh ra"
> với app.markeeai.com — cùng token màu, cùng font, cùng bộ component, cùng layout.
> Dùng AI để code thì **dán nguyên file này vào ngữ cảnh** trước khi yêu cầu sửa trang.

---

## 1. Nguồn chuẩn (source of truth)

| Thứ | Ở đâu |
|---|---|
| Webapp app.markee (source thật) | VPS `hostserver@10.30.194.50` → `~/Work/Markee/webapp` |
| Bản copy tham chiếu design (đã kéo về local) | `C:\Users\opc\code\seeding_markee\_markee_design_ref\` (globals.css, src/styles/*, src/components/ui/*) |
| Token + component của seeding (SỬA Ở ĐÂY) | `linkedin-crawler-ui/app/globals.css` + `linkedin-crawler-ui/components/ui/` |

Stack app.markee: **Next.js + Tailwind v4 + shadcn/ui (Radix) + lucide-react + Inter + sonner**.
Seeding đã cài đủ các gói này (xem `package.json`) — **không tự thêm thư viện UI khác**
(không MUI, không AntD, không bootstrap, không icon pack mới).

## 2. Token màu (đã khai báo trong `app/globals.css`)

### 2.1 Brand & shadcn tokens (dùng cho MỌI trang mới / trang đã convert)

| Token (class Tailwind) | Giá trị | Dùng cho |
|---|---|---|
| `bg-primary` / `text-primary` | `#ba244a` | Màu brand chính, nút chính, trạng thái active |
| `text-primary-foreground` | `#ffffff` | Chữ trên nền primary |
| `bg-card` / `text-card-foreground` | `#ffffff` / `#0a0a0a` | Nền thẻ/card |
| `bg-popover` / `text-popover-foreground` | `#ffffff` / `#0a0a0a` | Dropdown, popover |
| `bg-muted` / `text-muted-foreground` | `#f5f5f5` / `#737373` | Nền phụ, chữ mờ/nhãn phụ |
| `bg-accent` / `text-accent-foreground` | `#f5f5f5` / `#171717` | Hover nhẹ |
| `bg-destructive` | `#e40014` | Hành động xoá/nguy hiểm |
| `border-border` / `border-input` | `#e5e5e5` | Viền mặc định / viền input |
| `ring-ring` | `#a1a1a1` | Focus ring |
| `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-primary`… | `#fafafa`… | CHỈ dùng trong sidebar (shadcn Sidebar block) |
| `text-chart-1..5` | cam/xanh/vàng/… | Màu biểu đồ (recharts) |

Màu phụ trợ theo app.markee (dùng inline khi cần trạng thái): success `#16a34a`,
error `#dc2626`, warning `#ea580c`, info `#2563eb` — ưu tiên dạng nhạt
`bg-green-50 text-green-700` cho badge trạng thái, đúng kiểu shadcn.

### 2.2 ⚠️ Token Material CŨ — còn dùng ở các trang chưa convert, KHÔNG ĐƯỢC GHI ĐÈ

`--color-background` (#f6faff), `--color-secondary` (#006d3c — xanh KPI),
`--color-surface*`, `--color-on-*`, `--color-outline*`… đang được ~26 file dùng.
**Không đổi giá trị, không xoá** cho tới khi TẤT CẢ trang convert xong.
Trang mới thì **không dùng** các token này nữa.

### 2.3 Bảng quy đổi khi convert trang cũ → chuẩn mới

| Cũ (Material) | Mới (shadcn) |
|---|---|
| `bg-surface`, `bg-surface-bright` | `bg-card` (trong card) / `bg-white` |
| `bg-surface-container-low`, `bg-surface-dim`, `bg-surface-variant` | `bg-muted` |
| `bg-background` (#f6faff xanh nhạt) | `bg-white` (app.markee nền trắng) |
| `text-on-surface`, `text-on-background` | `text-foreground` |
| `text-on-surface-variant` | `text-muted-foreground` |
| `border-outline`, `border-outline-variant` | `border-border` |
| `text-on-primary` | `text-primary-foreground` |
| `bg-secondary` (xanh lá) | giữ ý nghĩa: dùng `bg-green-600`/badge xanh, KHÔNG dùng `bg-secondary` mới |
| `text-body-sm`, `text-h1/h2/h3` (token typography cũ) | `text-sm`, `text-2xl font-bold`, `text-lg font-semibold`… |
| `px-md py-sm gap-md` (spacing token cũ) | `px-4 py-3 gap-4` (Tailwind chuẩn) |
| `rounded-xl` (cũ = 0.5rem) | `rounded-lg` (–radius chuẩn shadcn 0.625rem đã map sẵn) |
| Icon `MaterialIcon name="..."` | Icon `lucide-react` (map sẵn: `lib/material-to-lucide-icon.tsx`) |
| Hex cứng `#4F46E5`, `bg-[#...]` | ❌ CẤM — luôn dùng token |

## 3. Component có sẵn (`components/ui/`)

Tất cả lấy đúng từ app.markee (shadcn/ui), import trực tiếp theo file:

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar, SidebarProvider, SidebarInset } from "@/components/ui/sidebar"; // chỉ dùng trong layout shell
```

Quy tắc:
- **Nút bấm** → `<Button>` với variant `default | outline | secondary | ghost | destructive | link`.
  Không tự viết `<button className="bg-primary...">` nữa.
- **Modal** → `<Dialog>`. **Dropdown** → `<DropdownMenu>` hoặc `<Popover>`. Không tự viết
  div absolute + useEffect click-outside nữa.
- **Toast** → `sonner` (`toast.success(...)`) — đã có sẵn `<Toaster/>` ở root layout.
- **Icon** → `lucide-react`. Trang cũ dùng `MaterialIcon` thì convert dần qua
  `lib/material-to-lucide-icon.tsx`.
- Cần component shadcn chưa có (calendar, radio-group, hover-card…) → copy từ
  `_markee_design_ref/src/components/ui/` và đổi hex cứng `#ba244a` → `bg-primary`
  (đã làm vậy với switch/progress/checkbox).

## 4. Font

App.markee dùng **Inter**. Root layout đã load `next/font` Inter và expose biến `--font-inter`.
Trang đã convert: thêm `font-[family-name:var(--font-inter)]` ở container gốc của trang
(hoặc để layout shell tự áp). KHÔNG đổi `--font-sans` toàn cục cho tới khi convert xong hết.

## 5. Khung trang (layout)

Mọi trang thuộc `(all-platform)` render trong `AllPlatformShell`:
- `SidebarProvider` + `AllPlatformSidebarShadcn` (shadcn Sidebar block, nền `#fafafa`,
  active = `bg-primary/10 text-primary` giống app.markee)
- `SidebarInset` nền trắng + header thanh mảnh 48px hiện tên trang.

Cấu trúc chuẩn 1 trang nội dung:

```tsx
<div className="space-y-5">
  {/* Tiêu đề trang */}
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Tên trang</h1>
      <p className="text-sm text-muted-foreground">Mô tả ngắn.</p>
    </div>
    <Button>Hành động chính</Button>
  </div>

  {/* Hàng thẻ số liệu */}
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Nhãn</CardTitle>
        <FileText className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">19</div>
        <p className="text-xs text-muted-foreground">ghi chú phụ</p>
      </CardContent>
    </Card>
  </div>

  {/* Khối nội dung chính */}
  <Card>…</Card>
</div>
```

## 6. Công thức convert 1 trang cũ (checklist cho dev/AI)

1. Đọc file trang + các component nó import. **Không đụng logic/data/handler** — chỉ lớp hiển thị.
2. Thay token theo bảng quy đổi mục 2.3 (surface→card, outline→border, on-surface→foreground…).
3. Thay nút/dropdown/modal tự chế bằng component mục 3.
4. Thay MaterialIcon → lucide.
5. Xoá mọi hex cứng; trạng thái dùng badge nhạt (`bg-green-50 text-green-700` v.v.).
6. Chạy `npm run dev` (local đã có Node) → so trực quan với app.markeeai.com.
7. Grep lại chính file đó: `surface|outline-variant|on-surface|MaterialIcon|#[0-9a-f]{6}` = 0 kết quả mới đạt.
8. Commit message tiếng Việt không dấu, prefix `style(<trang>):` như lịch sử repo.

## 7. Trạng thái convert (cập nhật khi làm xong trang nào)

| Trang | Route | Trạng thái |
|---|---|---|
| Khung sidebar + shell | `components/all-platform/layout/` | ✅ 2026-07-03 (shadcn Sidebar) |
| Inbox Facebook | `/all-platform/inbox` | 🔄 đang convert |
| Post Feed | `/all-platform/post-feed` | 🔄 đang convert |
| Quản lý Teams | `/all-platform/admin/teams-management` | 🔄 đang convert |
| CRM Khách hàng | `/all-platform/customers` | 🔄 làm kanban + quick chat |
| Đăng bài | `/all-platform/dang-bai` | ⬜ chưa |
| Quản lý nhóm / danh mục / tài khoản / VPS | `/all-platform/quan-ly-*` | ⬜ chưa |
| Zalo inbox / crawl / chat | `/all-platform/zalo-*`, `/zalo-chat` | ⬜ chưa |
| Dashboard admin/leader | `/all-platform/{admin,leader}/dashboard` | ⬜ chưa |
| Login/Register | `/auth/*` | ⬜ chưa |
