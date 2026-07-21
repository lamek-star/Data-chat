import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
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
