"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { AppUser } from "@/types/unified.types";
import { authService } from "@/services/all-platform.service";

// ─── Context ─────────────────────────────────────────────────────────────────
interface AppAuthContextType {
  user: AppUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AppUser>;
  loginWithGoogle: (credential: string) => Promise<AppUser>;
  register: (email: string, password: string, name?: string) => Promise<AppUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setLwuuSession: (email: string, remember: boolean) => void;
  clearLwuuSession: () => void;
}

const AppAuthContext = createContext<AppAuthContextType | undefined>(undefined);
const AUTH_CHECK_TIMEOUT_MS = 6000;

// ─── DEV BYPASS ────────────────────────────────────────────────────────────
// Bật NEXT_PUBLIC_SKIP_AUTH=true trong .env.local để bỏ qua gọi API /auth/me
// và /auth/login khi backend (Supabase) chưa sẵn sàng. Dùng khi chỉ làm UI.
// NHỚ: không để true khi build production.
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
const MOCK_USER: AppUser = {
  id: "dev-mock-user",
  email: "dev@markee.ai",
  name: "Dev User",
  role: "admin",
  is_active: true,
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Auth check timeout")),
      ms,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function AppAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (SKIP_AUTH) {
      setUser(MOCK_USER);
      return;
    }
    try {
      const res = await withTimeout(authService.me(), AUTH_CHECK_TIMEOUT_MS);
      if (res.success && res.data) {
        setUser(res.data as AppUser);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  /** Cookie-based session; no localStorage session needed */
  const setLwuuSession = useCallback((_email: string, _remember: boolean) => {
    void _email;
    void _remember;
    // no-op (kept for backward compatibility with AuthPage)
  }, []);

  /** Cookie-based session; no localStorage session needed */
  const clearLwuuSession = useCallback(() => {
    // no-op
  }, []);

  /** On mount: attempt to load current user from cookie */
  useEffect(() => {
    let alive = true;
    void refreshUser().finally(() => {
      if (alive) setIsLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    if (SKIP_AUTH) {
      setUser(MOCK_USER);
      return MOCK_USER;
    }
    setIsLoading(true);
    try {
      const res = await authService.login({ email, password });
      if (!res.success || !res.data) {
        throw new Error(res.message || "Login failed");
      }
      if (res.data.redirect_required && res.data.redirect_url) {
        // Tài khoản này thuộc site khác — chuyển hướng trình duyệt thật sang
        // đúng site (trang /auth/handoff ở đó tự đăng nhập tiếp). Trả về
        // promise "treo" vì trang sắp điều hướng đi nơi khác.
        window.location.href = res.data.redirect_url;
        return new Promise<AppUser>(() => {});
      }
      // Cookie is set by backend; just take user.
      const data = res.data as { user: AppUser };
      setUser(data.user);
      return data.user;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    if (SKIP_AUTH) {
      setUser(MOCK_USER);
      return MOCK_USER;
    }
    setIsLoading(true);
    try {
      const res = await authService.loginWithGoogle(credential);
      if (!res.success || !res.data) {
        throw new Error(res.message || "Login failed");
      }
      if (res.data.redirect_required && res.data.redirect_url) {
        window.location.href = res.data.redirect_url;
        return new Promise<AppUser>(() => {});
      }
      // Cookie is set by backend; just take user — data.user.role phản ánh
      // đúng role hiện tại trong app_users (backend resolve theo email Google
      // ngay lúc login), dùng để AuthPage.tsx redirect đúng dashboard theo role.
      const data = res.data as { user: AppUser };
      setUser(data.user);
      return data.user;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      setIsLoading(true);
      try {
        const res = await authService.register({ email, password, name });
        if (!res.success || !res.data) {
          throw new Error(res.message || "Registration failed");
        }
        // Cookie is set by backend; just take user.
        const data = res.data as { user: AppUser };
        setUser(data.user);
        return data.user;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  useEffect(() => {
    if (user?.email) {
      window.localStorage?.setItem("app_user_email", user.email);
    } else {
      window.localStorage?.removeItem("app_user_email");
    }
  }, [user]);

  return (
    <AppAuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        loginWithGoogle,
        register,
        logout,
        refreshUser,
        setLwuuSession,
        clearLwuuSession,
      }}
    >
      {children}
    </AppAuthContext.Provider>
  );
}

export function useAppAuth(): AppAuthContextType {
  const ctx = useContext(AppAuthContext);
  if (!ctx) {
    throw new Error("useAppAuth must be used within AppAuthProvider");
  }
  return ctx;
}