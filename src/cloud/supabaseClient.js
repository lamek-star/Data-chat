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

export async function signInWithUsername(username, password) {
  const client = requireSupabase();
  const normalized = String(username || "").trim().toLowerCase();
  const { data: email, error: lookupError } = await client.rpc(
    "datachat_login_email",
    { requested_username: normalized },
  );
  if (lookupError) throw lookupError;
  if (!email) throw new Error("Username or password is incorrect.");
  return signIn(email, password);
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

export async function markEmailVerified() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("mark_datachat_email_verified");
  if (error) throw error;
  return data;
}

export async function loadAdminSnapshot(username, password) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("datachat_admin_snapshot", {
    requested_username: username,
    requested_password: password,
  });
  if (error) throw error;
  return data || { users: [], communities: [] };
}

export async function updateCloudUserFromAdmin(
  username,
  password,
  userId,
  plan,
  status,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("datachat_admin_update_user", {
    requested_username: username,
    requested_password: password,
    requested_user_id: userId,
    requested_plan: plan,
    requested_status: status,
  });
  if (error) throw error;
  return data;
}

export async function deleteCloudUserFromAdmin(username, password, userId) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("datachat_admin_delete_user", {
    requested_username: username,
    requested_password: password,
    requested_user_id: userId,
  });
  if (error) throw error;
  return data;
}

export async function createRootCommunityFromAdmin(
  username,
  password,
  community,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(
    "datachat_admin_create_root_community",
    {
      requested_username: username,
      requested_password: password,
      requested_name: community.name,
      requested_location: community.location,
      requested_purpose: community.purpose,
      requested_parent_id: community.parentId || null,
      requested_allow_subgroups: Boolean(community.allowSubgroups),
      requested_allow_invites: Boolean(community.allowInvites),
    },
  );
  if (error) throw error;
  return data;
}

export async function loadCloudCommunities() {
  const client = requireSupabase();
  const [{ data: communities, error }, { data: memberships, error: memberError }] =
    await Promise.all([
      client
        .from("communities")
        .select(
          "id,name,location,purpose,parent_id,owner_id,is_admin_root,allow_subgroups,allow_invites,created_at",
        )
        .order("created_at", { ascending: true }),
      client
        .from("community_memberships")
        .select(
          "community_id,user_id,status,role,requested_at,decided_at",
        ),
    ]);
  if (error) throw error;
  if (memberError) throw memberError;
  const applicantIds = [
    ...new Set(
      (memberships || [])
        .filter((membership) => membership.status === "pending")
        .map((membership) => membership.user_id),
    ),
  ];
  const applicantProfiles = await loadPublicProfiles(applicantIds);
  const applicantById = new Map(
    applicantProfiles.map((profile) => [profile.id, profile]),
  );
  return (communities || []).map((community) => ({
    id: community.id,
    name: community.name,
    location: community.location,
    purpose: community.purpose,
    parentId: community.parent_id,
    createdBy: community.owner_id,
    isAdminRoot: community.is_admin_root,
    permissions: {
      allowSubgroups: community.allow_subgroups,
      allowInvites: community.allow_invites,
    },
    members: (memberships || [])
      .filter(
        (membership) =>
          membership.community_id === community.id &&
          membership.status === "approved",
      )
      .map((membership) => membership.user_id),
    joinRequests: (memberships || [])
      .filter(
        (membership) =>
          membership.community_id === community.id &&
          membership.status === "pending",
      )
      .map((membership) => ({
        userId: membership.user_id,
        name:
          applicantById.get(membership.user_id)?.display_name ||
          "DataChat member",
        username: applicantById.get(membership.user_id)?.username || "",
        status: membership.status,
        requestedAt: membership.requested_at,
      })),
    createdAt: community.created_at,
  }));
}

export async function createCloudCommunity(community) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_datachat_child_community", {
    requested_name: community.name,
    requested_location: community.location,
    requested_purpose: community.purpose,
    requested_parent_id: community.parentId,
    requested_allow_subgroups: Boolean(community.allowSubgroups),
  });
  if (error) throw error;
  return { id: data };
}

export async function requestCloudCommunityJoin(communityId) {
  const client = requireSupabase();
  const { error } = await client.rpc("request_datachat_community_join", {
    requested_community_id: communityId,
  });
  if (error) throw error;
  return true;
}

export async function decideCloudCommunityJoin(
  communityId,
  userId,
  approved,
) {
  const client = requireSupabase();
  const { error } = await client.rpc("decide_datachat_community_join", {
    requested_community_id: communityId,
    requested_user_id: userId,
    requested_approved: Boolean(approved),
  });
  if (error) throw error;
  return true;
}

export async function loadAdminCommunityRequests(username, password) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(
    "datachat_admin_community_requests",
    {
      requested_username: username,
      requested_password: password,
    },
  );
  if (error) throw error;
  return data || [];
}

export async function decideAdminCommunityJoin(
  username,
  password,
  communityId,
  userId,
  approved,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(
    "datachat_admin_decide_community_join",
    {
      requested_username: username,
      requested_password: password,
      requested_community_id: communityId,
      requested_user_id: userId,
      requested_approved: Boolean(approved),
    },
  );
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

export async function configureCloudAdmin(username, password) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("configure_datachat_admin", {
    requested_username: username,
    requested_password: password,
  });
  if (error) throw error;
  return data;
}

export async function createCloudAccessCode(username, password, code) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_datachat_pro_code", {
    requested_username: username,
    requested_password: password,
    requested_code: code,
  });
  if (error) throw error;
  return data;
}

export async function listCloudAccessCodes(username, password) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("list_datachat_pro_codes", {
    requested_username: username,
    requested_password: password,
  });
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
  const client = requireSupabase();
  const normalized = (records || []).map((record) => ({
      app_id: appId,
      user_id: userId,
      ...record,
      updated_at: new Date().toISOString(),
    }));
  if (normalized.length) {
    const { error } = await client.from("app_data").upsert(normalized, {
      onConflict: "app_id,user_id,entity_type,entity_id",
    });
    if (error) throw error;
  }
  const { data: existing, error: readError } = await client
    .from("app_data")
    .select("entity_type,entity_id")
    .eq("app_id", appId)
    .eq("user_id", userId);
  if (readError) throw readError;
  const keep = new Set(
    normalized.map((record) => `${record.entity_type}:${record.entity_id}`),
  );
  const stale = (existing || []).filter(
    (record) => !keep.has(`${record.entity_type}:${record.entity_id}`),
  );
  for (const record of stale) {
    const { error } = await client
      .from("app_data")
      .delete()
      .eq("app_id", appId)
      .eq("user_id", userId)
      .eq("entity_type", record.entity_type)
      .eq("entity_id", record.entity_id);
    if (error) throw error;
  }
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
    username:
      user.user_metadata?.username ||
      `${user.email?.split("@")[0]?.toLowerCase() || "member"}-${String(user.id)
        .replaceAll("-", "")
        .slice(0, 6)}`,
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
  const { data, error } = await client.rpc("resolve_datachat_contact", {
    requested_user_id: userId || null,
    requested_contact_code: contactCode || null,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function loadDirectMessages(userId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("direct_messages")
    .select("id, sender_id, recipient_id, payload, created_at, read_at")
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) throw error;
  return (data || []).reverse();
}

export async function loadPublicProfiles(userIds) {
  if (!userIds?.length) return [];
  const client = requireSupabase();
  const { data, error } = await client
    .from("profiles")
    .select("id, display_name, username, contact_code, country, avatar_url, plan, status, email_verified,visible_in_community")
    .in("id", [...new Set(userIds)]);
  if (error) throw error;
  return data || [];
}

export async function updateCommunityVisibility(visible) {
  const client = requireSupabase();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) throw new Error("Sign in again.");
  const { data, error } = await client
    .from("profiles")
    .update({
      visible_in_community: Boolean(visible),
      updated_at: new Date().toISOString(),
    })
    .eq("id", authData.user.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function loadCommunityDirectory() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("profiles")
    .select(
      "id,display_name,username,country,avatar_url,plan,status,visible_in_community",
    )
    .eq("visible_in_community", true)
    .eq("status", "active")
    .order("display_name");
  if (error) throw error;
  return data || [];
}

export async function loadContactNetwork() {
  const client = requireSupabase();
  const [{ data: authData }, contactResult, requestResult, ratingResult] =
    await Promise.all([
      client.auth.getUser(),
      client
        .from("user_contacts")
        .select("owner_id,contact_user_id,source,created_at"),
      client
        .from("contact_requests")
        .select(
          "id,requester_id,recipient_id,status,created_at,responded_at",
        )
        .order("created_at", { ascending: false }),
      client
        .from("customer_ratings")
        .select(
          "owner_id,rated_user_id,rating,note,created_at,updated_at",
        ),
    ]);
  if (!authData.user) throw new Error("Sign in again.");
  if (contactResult.error) throw contactResult.error;
  if (requestResult.error) throw requestResult.error;
  if (ratingResult.error) throw ratingResult.error;
  const peerIds = [
    ...(contactResult.data || []).map((item) => item.contact_user_id),
    ...(requestResult.data || []).flatMap((item) => [
      item.requester_id,
      item.recipient_id,
    ]),
  ].filter((id) => id && id !== authData.user.id);
  const profiles = await loadPublicProfiles(peerIds);
  return {
    userId: authData.user.id,
    contacts: contactResult.data || [],
    requests: requestResult.data || [],
    ratings: ratingResult.data || [],
    profiles,
  };
}

export async function sendContactRequest(recipientId) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("request_datachat_contact", {
    requested_recipient_id: recipientId,
  });
  if (error) throw error;
  return data;
}

export async function respondContactRequest(requestId, accept) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(
    "respond_datachat_contact_request",
    {
      requested_request_id: requestId,
      requested_accept: Boolean(accept),
    },
  );
  if (error) throw error;
  return data;
}

export async function addContactByQr(userId, contactCode) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("add_datachat_contact_by_qr", {
    requested_user_id: userId,
    requested_contact_code: String(contactCode || "").trim().toUpperCase(),
  });
  if (error) throw error;
  return data;
}

export async function removeCloudContact(contactUserId) {
  const client = requireSupabase();
  const { error } = await client
    .from("user_contacts")
    .delete()
    .eq("contact_user_id", contactUserId);
  if (error) throw error;
  return true;
}

export async function saveCustomerRating(ratedUserId, rating, note = "") {
  const client = requireSupabase();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) throw new Error("Sign in again.");
  const { data, error } = await client
    .from("customer_ratings")
    .upsert(
      {
        owner_id: authData.user.id,
        rated_user_id: ratedUserId,
        rating,
        note: String(note || "").trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,rated_user_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCustomerRating(ratedUserId) {
  const client = requireSupabase();
  const { error } = await client
    .from("customer_ratings")
    .delete()
    .eq("rated_user_id", ratedUserId);
  if (error) throw error;
  return true;
}

export async function uploadVoiceMessage(
  recipientId,
  messageId,
  blob,
  durationMs,
) {
  const client = requireSupabase();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) throw new Error("Sign in again.");
  const contentType = (blob.type || "audio/webm").split(";")[0].toLowerCase();
  const extension = contentType.includes("mp4")
    ? "m4a"
    : contentType.includes("ogg")
      ? "ogg"
      : "webm";
  const path = `${authData.user.id}/${messageId}.${extension}`;
  let uploadError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await client.storage.from("voice-messages").upload(path, blob, {
      upsert: attempt > 0,
      contentType,
      cacheControl: "86400",
    });
    uploadError = result.error;
    if (!uploadError) break;
    if (attempt < 2)
      await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
  }
  if (uploadError) throw uploadError;
  const { error: metadataError } = await client.from("voice_messages").insert({
    id: messageId,
    sender_id: authData.user.id,
    recipient_id: recipientId,
    object_path: path,
    mime_type: contentType,
    byte_size: blob.size,
    duration_ms: durationMs || null,
  });
  if (metadataError && metadataError.code !== "23505") {
    await client.storage.from("voice-messages").remove([path]);
    throw metadataError;
  }
  const { data, error } = await client.storage
    .from("voice-messages")
    .createSignedUrl(path, 86400);
  if (error) throw error;
  return { voicePath: path, voiceUrl: data.signedUrl };
}

export async function createVoicePlaybackUrl(path) {
  if (!path) return null;
  const client = requireSupabase();
  const { data, error } = await client.storage
    .from("voice-messages")
    .createSignedUrl(path, 86400);
  if (error) throw error;
  return data.signedUrl;
}

export async function loadAdminOperationalSnapshot(username, password) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(
    "datachat_admin_operational_snapshot",
    {
      requested_username: username,
      requested_password: password,
    },
  );
  if (error) throw error;
  return data || {};
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
  const payload = {
    version: 2,
    content: String(message.content || "").slice(0, 4000),
    time: message.time,
    transaction: message.transaction || undefined,
    recordId: message.recordId || undefined,
    voicePath: message.voicePath || undefined,
    voiceType: message.voiceType || undefined,
    durationMs: message.durationMs || undefined,
  };
  const { data, error } = await client
    .from("direct_messages")
    .insert({
      id: message.id,
      sender_id: authData.user.id,
      recipient_id: recipientId,
      payload,
    })
    .select()
    .single();
  if (error?.code === "23505") return { id: message.id, duplicate: true };
  if (error) throw error;
  return data;
}

export async function editDirectMessage(messageId, content) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("edit_datachat_direct_message", {
    requested_message_id: messageId,
    requested_content: content,
  });
  if (error) throw error;
  return data;
}

export async function deleteDirectMessage(messageId) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("delete_datachat_direct_message", {
    requested_message_id: messageId,
  });
  if (error) throw error;
  return data;
}

export function subscribeToDirectMessages(callback) {
  const client = requireSupabase();
  return client
    .channel("datachat-direct-messages")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "direct_messages" },
      callback,
    )
    .subscribe();
}

export function subscribeToContactNetwork(callback) {
  const client = requireSupabase();
  return client
    .channel(`datachat-contact-network-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "contact_requests" },
      callback,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "user_contacts" },
      callback,
    )
    .subscribe();
}

export function subscribeToCommunityNetwork(callback) {
  const client = requireSupabase();
  return client
    .channel(`datachat-communities-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "community_memberships" },
      callback,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "communities" },
      callback,
    )
    .subscribe();
}

export function unsubscribeChannel(channel) {
  if (!supabase || !channel) return;
  return supabase.removeChannel(channel);
}
