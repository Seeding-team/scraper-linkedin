"use client";

import dynamic from "next/dynamic";

const AuthPage = dynamic(
  () => import("@/components/features/auth/AuthPage").then((m) => m.AuthPage),
  { ssr: false }
);

export default function LoginPage() {
  return <AuthPage />;
}
