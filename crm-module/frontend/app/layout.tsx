import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "@/modules/crm/styles/crm.css";
import "@/modules/quotes/styles/quotes.css";
import "@/modules/contracts/styles/contracts.css";
import { Toaster } from "sonner";
import { AppAuthProvider } from "@/contexts/AppAuthContext";
import { QueryProvider } from "@/components/providers/QueryProvider";

// Inter — dung dung font app.markeeai.com dang dung (xac nhan qua CSS production:
// font-family:var(--font-inter)). Chi expose bien --font-inter, KHONG doi --font-sans
// mac dinh cua toan app (van la system-ui stack) de tranh anh huong giao dien hien co —
// trang/component nao muon dung Inter thi tu ap dung className={inter.variable} hoac
// font-[family-name:var(--font-inter)].
const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter" });

// ROOT CAUSE THAT cua bug "mobile van la khung nho giua man hinh" (khong
// phai CSS specificity/containing-block nhu nghi ban dau): toan bo app CHUA
// TUNG khai bao viewport meta nao (grep toan bo app/ xac nhan) - dien thoai
// that mac dinh render trang o "layout viewport" ~980px (theo chuan mobile
// browser cho trang khong khai bao viewport) roi thu nho lai de vua man
// hinh, nen MOI @media (max-width:...) khong bao gio duoc kich hoat tren may
// that (Playwright set thang CSS viewport nen khong bao gio bat duoc loi
// nay). Fix o dung 1 cho - layout goc - ap dung cho toan bo app, khong rieng
// gi Quote Center/Workspace.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "MarkeeAI - CRM",
  description: "Quản lý Leads, Khách hàng, Cơ hội, Báo giá, Hợp đồng và Sản phẩm & dịch vụ.",
  icons: {
    icon: "https://markeeai.com/logo.svg",
    shortcut: "https://markeeai.com/logo.svg",
    apple: "https://markeeai.com/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={`light h-full antialiased ${inter.variable}`}>
      <head>
        {/* Material Symbols — không có next/font; cần cho icon ligature */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full" suppressHydrationWarning>
        <QueryProvider>
          <AppAuthProvider>
            {children}
          </AppAuthProvider>
        </QueryProvider>

        <Toaster
          position="top-right"
          richColors
          closeButton
          duration={4000}
        />
      </body>
    </html>
  );
}
