const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloudConfigured = Boolean(url && anonKey);
export const cloudConfig = {
  url,
  anonKey,
  appId: import.meta.env.VITE_DATACHAT_APP_ID || "datachat",
};
export async function cloudRequest(path, options = {}) {
  if (!cloudConfigured)
    throw new Error(
      "Cloud storage is not configured. Copy .env.example to .env first.",
    );
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${options.accessToken || anonKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}
