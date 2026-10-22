export const TOKEN_KEY = "tl-token";
export const GUEST_TOKEN_KEY = "tl-guest-token";

// 部分嵌入浏览器禁用持久存储；当前页面仍可通过内存中的令牌维持会话。
const memoryTokens = new Map<string, string>();
const volatileKeys = new Set<string>();

export function readToken(key: string): string | null {
  if (volatileKeys.has(key)) return memoryTokens.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryTokens.get(key) ?? null;
  }
}

export function writeToken(key: string, token: string | null) {
  if (token) memoryTokens.set(key, token);
  else memoryTokens.delete(key);
  try {
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
    volatileKeys.delete(key);
  } catch {
    volatileKeys.add(key);
    // Cookie 和当前页面的内存令牌仍然可用。
  }
}
