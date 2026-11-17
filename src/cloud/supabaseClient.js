import { createClient } from "@supabase/supabase-js";

const url =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://ufneentdbsdmfiwvjthj.supabase.co";
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_kF_WLO_XatQrqmp_a9Ls2g_IcA6NTgL";
const appId = import.meta.env.VITE_DATACHAT_APP_ID || "datachat";

// VITE_DATACHAT_OFFLINE=1 runs the app on browser storage only, for local
// testing and demos without touching the production Supabase project.
const offline = import.meta.env.VITE_DATACHAT_OFFLINE === "1";
export const cloudConfigured = !offline && Boolean(url && anonKey);
export const cloudConfig = { url, anonKey, appId };

const supabase = cloudConfigured ? createClient(url, anonKey) : null;

function requireSupabase() {
  if (!supabase)
    throw new Error(
      "Cloud storage is not configured. Copy .env.example to .env first.",
    );
  return supabase;
}

export async function signIn(email, password) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ??
  // In development, call the local API through the Vite /api proxy.
  (import.meta.env.DEV ? "" : "https://datachat.harmongt.uk")
).replace(/\/$/, "");

// Usernames are resolved by the server, which never returns the email
// address. An email address typed into the username field signs in directly.
export async function signInWithUsername(username, password) {
  const client = requireSupabase();
  const normalized = String(username || "").trim().toLowerCase();
  if (normalized.includes("@")) return signIn(normalized, password);
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: normalized, password }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Username or password is incorrect.");
  const { data, error } = await client.auth.setSession({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
  if (error) throw error;
  return data;
}

export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token || null;
}

// Plan, role and status come from datachat_entitlements, which users can
// read but not write. A missing row means a Free, active, normal account.
export async function loadEntitlement(userId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("datachat_entitlements")
    .select("plan, role, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return {
    plan: data?.plan || "Free",
    role: data?.role || "user",
    status: data?.status || "active",
  };
}

export async function signUp(email, password, userMetadata = {}) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: userMetadata,
    },
  });
  if (error) throw error;
  return data;
}

export async function requestEmailOtp(email, userMetadata = {}, createUser = true) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: createUser, data: userMetadata },
  });
  if (error) throw error;
  return data;
}

export async function resendSignupOtp(email) {
  const client = requireSupabase();
  const { data, error } = await client.auth.resend({ type: "signup", email });
  if (error) throw error;
  return data;
}

export async function verifyEmailOtp(email, token, type = "signup") {
  const client = requireSupabase();
  const { data, error } = await client.auth.verifyOtp({
    email,
    token: String(token || "").replace(/\D/g, ""),
    type,
  });
  if (error) throw error;
  return data;
}

export async function updateCurrentUserPassword(password, username) {
  const client = requireSupabase();
  const { data, error } = await client.auth.updateUser({
    password,
    data: { username: String(username || "").trim().toLowerCase() },
  });
  if (error) throw error;
  return data;
}

export async function redeemProAccessCode(code) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("redeem_datachat_pro_code", {
    requested_code: String(code || "").trim().toUpperCase(),
  });
  if (error) throw error;
  return data;
}

// Administrator calls. The database checks the signed-in user's admin role
// (datachat_entitlements.role = 'admin') on every call.
export async function isCloudAdmin() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("is_datachat_admin");
  if (error) throw error;
  return data === true;
}

export async function createCloudAccessCode(code) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("admin_create_pro_code", {
    requested_code: code,
  });
  if (error) throw error;
  return data;
}

export async function listCloudAccessCodes() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("admin_list_pro_codes");
  if (error) throw error;
  return data || [];
}

export async function signOut() {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  return true;
}

export async function getSession() {
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

export function onAuthStateChange(callback) {
  const supabase = requireSupabase();
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // supabase-js v2 passes the Session itself (it has no .session field).
    callback(event, session || null);
  });
  return data.subscription;
}

export async function loadAppData(userId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("app_data")
    .select("entity_type, entity_id, payload")
    .eq("app_id", appId)
    .eq("user_id", userId);
  if (error) throw error;
  return data || [];
}

export async function overwriteAppData(userId, records) {
  const supabase = requireSupabase();
  const { error: deleteError } = await supabase
    .from("app_data")
    .delete()
    .eq("app_id", appId)
    .eq("user_id", userId);
  if (deleteError) throw deleteError;
  if (!records || records.length === 0) return true;
  const { error } = await supabase.from("app_data").insert(
    records.map((record) => ({
      app_id: appId,
      user_id: userId,
      ...record,
    })),
  );
  if (error) throw error;
  return true;
}

export async function uploadBackupFile(userId, file, options = {}) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.storage
    .from("private-backups")
    .upload(`${userId}/${file.name}`, file, {
      cacheControl: "3600",
      upsert: true,
      ...options,
    });
  if (error) throw error;
  return data;
}

export async function createBackupUrl(path, expiresIn = 60) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .storage
    .from("private-backups")
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data?.signedUrl;
}

const PUBLIC_PROFILE_COLUMNS =
  "id, display_name, username, contact_code, country, avatar_url";

// The profile row is created by the sign-up trigger; the client may only
// read it and change display_name, country and avatar_url. Contact codes and
// usernames cannot be set from the browser, and phone numbers are private.
export async function upsertPublicProfile(user) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error("Your DataChat profile is missing. Contact the administrator.");
  return { ...data, phone: user.user_metadata?.phone || "" };
}

export async function findPublicProfile({ userId, contactCode }) {
  const client = requireSupabase();
  let query = client
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS);
  query = userId
    ? query.eq("id", userId)
    : query.eq("contact_code", String(contactCode || "").trim().toUpperCase());
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadDirectMessages(userId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("direct_messages")
    .select("id, sender_id, recipient_id, payload, created_at, read_at")
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadPublicProfiles(userIds) {
  if (!userIds?.length) return [];
  const client = requireSupabase();
  const { data, error } = await client
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .in("id", [...new Set(userIds)]);
  if (error) throw error;
  return data || [];
}

export async function uploadProfilePhoto(userId, file) {
  const client = requireSupabase();
  const extension = (file.name?.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/avatar.${extension}`;
  const { error } = await client.storage.from("profile-images").upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: "3600",
  });
  if (error) throw error;
  const { data } = client.storage.from("profile-images").getPublicUrl(path);
  const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
  const { error: profileError } = await client
    .from("profiles")
    .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (profileError) throw profileError;
  await client.auth.updateUser({ data: { avatar_url: avatarUrl } });
  return avatarUrl;
}

export async function sendDirectMessage(recipientId, message) {
  const client = requireSupabase();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) throw authError || new Error("Sign in again.");
  const { data, error } = await client
    .from("direct_messages")
    .insert({
      id: message.id,
      sender_id: authData.user.id,
      recipient_id: recipientId,
      payload: message,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function subscribeToDirectMessages(callback) {
  const client = requireSupabase();
  return client
    .channel("datachat-direct-messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "direct_messages" },
      callback,
    )
    .subscribe();
}

export function unsubscribeChannel(channel) {
  if (!supabase || !channel) return;
  return supabase.removeChannel(channel);
}
