"use client";

export type CredentialRecord = {
  id?: string;
  email: string;
  password?: string;
  name?: string;
  avatar?: string;
  status?: "connected" | "disconnected" | "error";
  phone?: string;
  platform?: "linkedin" | "facebook" | "zalo";
};

const EMAIL_COOKIE = "linkedin_email";
const PASSWORD_COOKIE = "linkedin_password";
const DEFAULT_MAX_AGE_DAYS = 7;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split(";");
  for (const raw of cookies) {
    const [key, ...rest] = raw.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeDays: number): void {
  if (typeof document === "undefined") return;
  const maxAge = Math.max(1, Math.floor(maxAgeDays * 24 * 60 * 60));
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function readLinkedInCredentials(): CredentialRecord | null {
  const email = readCookie(EMAIL_COOKIE) ?? "";
  const password = readCookie(PASSWORD_COOKIE) ?? "";
  if (!email || !password) {
    return null;
  }
  return { email, password };
}

export function writeLinkedInCredentials(
  email: string,
  password: string,
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): void {
  if (!email || !password) return;
  writeCookie(EMAIL_COOKIE, email, maxAgeDays);
  writeCookie(PASSWORD_COOKIE, password, maxAgeDays);
}

export function clearLinkedInCredentials(): void {
  writeCookie(EMAIL_COOKIE, "", -1);
  writeCookie(PASSWORD_COOKIE, "", -1);
}

// Multi-account support
const ACCOUNTS_STORAGE_KEY = "linkedin_multi_accounts";
const ACTIVE_ACCOUNT_ID_KEY = "linkedin_active_account_id";

function getAccountsFromStorage(): CredentialRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAccountsToStorage(accounts: CredentialRecord[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
}

export function getAllLinkedInAccounts(): CredentialRecord[] {
  return getAccountsFromStorage();
}

export function saveLinkedInAccount(account: CredentialRecord): void {
  const accounts = getAccountsFromStorage();
  const existingIndex = accounts.findIndex((a) => a.email === account.email);
  if (existingIndex >= 0) {
    accounts[existingIndex] = { ...accounts[existingIndex], ...account };
  } else {
    accounts.push({
      ...account,
      id: account.id || Math.random().toString(36).substring(2, 9),
    });
  }
  saveAccountsToStorage(accounts);
}

export function removeLinkedInAccount(email: string): void {
  const accounts = getAccountsFromStorage();
  saveAccountsToStorage(accounts.filter((a) => a.email !== email));
}

export function setActiveAccount(id: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(ACTIVE_ACCOUNT_ID_KEY, id);
  }
}
