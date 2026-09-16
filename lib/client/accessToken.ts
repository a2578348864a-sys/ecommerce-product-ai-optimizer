"use client";

export function getAccessToken(): string {
  return "";
}

export function getAccessMode(): "owner" | "demo" | null {
  return "owner";
}

export function isAuthenticated(): boolean {
  return true;
}

export function isGuestMode(): boolean {
  return false;
}

export function isNoAuthOwnerMode(): boolean {
  return true;
}

export function setNoAuthOwnerMode(): void {}

export function clearAccessSession(): void {}

export function buildAccessHeaders(): Record<string, string> {
  return {};
}

export interface DemoAccessInfo {
  id?: string;
  demoAccessId?: string;
  [key: string]: any;
}

export function getDemoAccessInfo(): DemoAccessInfo | null {
  return null;
}

export function updateDemoAccessInfo(_update?: any): void {}

export function updateDemoAccessSnapshot(_snapshot?: any): void {}

export function saveAccessToken(_token?: string, _meta?: any): void {}

export function saveGuestAccess(_info?: any): void {}
