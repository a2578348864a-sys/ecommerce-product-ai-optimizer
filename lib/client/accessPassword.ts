"use client";

export function getStoredAccessPassword(): string {
  return "";
}

export function getValidAccessPassword(): string {
  return "";
}

export function saveAccessPassword(_password: string): void {}

export function clearAccessPassword(): void {}

export function isAccessPasswordExpired(): boolean {
  return false;
}

export function canRequestWithAccessPassword(_isReady?: boolean, _password?: string): boolean {
  return true;
}

export function useAccessPassword(): [string, (v: any) => void, boolean, () => void, boolean] & {
  accessPassword: string;
  setAccessPassword: (v: any) => void;
  isReady: boolean;
  clearAccessPassword: () => void;
  hasAccessPassword: boolean;
  isExpired: boolean;
  expiresAt: null;
  noAuthOwner: boolean;
  saveAccessPassword: (v: any) => void;
  getValidAccessPassword: () => string;
} {
  const noop = () => {};
  const res: any = ["", noop, true, noop, true];
  res.accessPassword = "";
  res.setAccessPassword = noop;
  res.isReady = true;
  res.clearAccessPassword = noop;
  res.hasAccessPassword = true;
  res.isExpired = false;
  res.expiresAt = null;
  res.noAuthOwner = true;
  res.saveAccessPassword = noop;
  res.getValidAccessPassword = () => "";
  return res;
}
