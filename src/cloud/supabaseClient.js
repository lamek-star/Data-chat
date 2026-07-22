import { createClient } from "@supabase/supabase-js";

const url =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://ufneentdbsdmfiwvjthj.supabase.co";
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_kF_WLO_XatQrqmp_a9Ls2g_IcA6NTgL";
const appId = import.meta.env.VITE_DATACHAT_APP_ID || "datachat";

export const cloudConfigured = Boolean(url && anonKey);
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

export async function verifyEmailOtp(email, token) {
  const client = requireSupabase();
  const { data, error } = await client.auth.verifyOtp({
    email,
    token: String(token || "").replace(/\D/g, ""),
    type: "email",
  });
  if (error) throw error;
  return data;
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
    callback(event, session?.session || null);
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

export async function upsertPublicProfile(user) {
  const client = requireSupabase();
  const profile = {
    id: user.id,
    display_name:
      user.user_metadata?.name || user.email?.split("@")[0] || "DataChat member",
    contact_code: String(user.id).replaceAll("-", "").slice(0, 12).toUpperCase(),
    country: user.user_metadata?.country || "Global",
    phone: user.user_metadata?.phone || "",
    avatar_url: user.user_metadata?.avatar_url || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("profiles")
    .upsert(profile, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function findPublicProfile({ userId, contactCode }) {
  const client = requireSupabase();
  let query = client
    .from("profiles")
    .select("id, display_name, contact_code, country, phone, avatar_url");
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
    .select("id, display_name, contact_code, country, phone, avatar_url")
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
