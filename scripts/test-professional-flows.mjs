import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const adminKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !adminKey || !anonKey) throw new Error("Missing Supabase test configuration");

const admin = createClient(url, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
const password = `DataChat-${crypto.randomUUID()}!`;
const ids = [];
const voicePaths = [];
const proCodeIds = [];
const communityIds = [];
const check = (condition, label) => {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`PASS: ${label}`);
};

try {
  const users = [];
  for (const label of ["sender", "receiver"]) {
    const email = `codex-${label}-${suffix}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `Test ${label}`, username: `${label}-${suffix}` },
    });
    if (error) throw error;
    ids.push(data.user.id);
    users.push({ email, id: data.user.id });
  }
  await new Promise((resolve) => setTimeout(resolve, 700));

  const clients = [];
  for (const user of users) {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (error) throw error;
    clients.push(client);
  }
  const [sender, receiver] = clients;
  const [senderUser, receiverUser] = users;

  const { data: createdProfiles, error: profileError } = await admin
    .from("profiles")
    .select("id,status,visible_in_community,created_at,contact_code")
    .in("id", ids);
  if (profileError) throw profileError;
  check(createdProfiles.length === 2, "registration creates admin-visible profiles");
  check(createdProfiles.every((item) => item.status === "active"), "new accounts are active");
  check(createdProfiles.every((item) => item.visible_in_community === false), "community visibility defaults private");

  await admin.from("profiles").update({ email_verified: true }).eq("id", senderUser.id);
  const proCode = `DCP-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
  const { data: createdCode, error: codeCreateError } = await admin
    .from("pro_access_codes")
    .insert({ code: proCode })
    .select("id")
    .single();
  if (codeCreateError) throw codeCreateError;
  proCodeIds.push(createdCode.id);
  const { data: redeemedCode, error: codeRedeemError } = await sender.rpc(
    "redeem_datachat_pro_code",
    { requested_code: proCode },
  );
  if (codeRedeemError) throw codeRedeemError;
  const { data: proProfile } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", senderUser.id)
    .single();
  check(
    redeemedCode.status === "used" && proProfile.plan === "Pro",
    "strong admin code persists the member Pro subscription",
  );
  const receiverProfile = createdProfiles.find((item) => item.id === receiverUser.id);
  const { data: hiddenQr, error: hiddenQrError } = await sender.rpc(
    "resolve_datachat_contact",
    {
      requested_user_id: receiverUser.id,
      requested_contact_code: receiverProfile.contact_code,
    },
  );
  if (hiddenQrError) throw hiddenQrError;
  check(hiddenQr.length === 1, "hidden users resolve through an exact QR identity pair");

  const { error: visibilityError } = await receiver
    .from("profiles")
    .update({ visible_in_community: true })
    .eq("id", receiverUser.id);
  if (visibilityError) throw visibilityError;
  const { data: request, error: requestError } = await sender.rpc(
    "request_datachat_contact",
    { requested_recipient_id: receiverUser.id },
  );
  if (requestError) throw requestError;
  check(request.status === "pending", "contact request is created");

  const { error: acceptError } = await receiver.rpc(
    "respond_datachat_contact_request",
    { requested_request_id: request.id, requested_accept: true },
  );
  if (acceptError) throw acceptError;
  const { data: relationships, error: relationshipError } = await admin
    .from("user_contacts")
    .select("owner_id,contact_user_id")
    .in("owner_id", ids);
  if (relationshipError) throw relationshipError;
  check(relationships.length === 2, "acceptance creates reciprocal contacts");

  const { error: duplicateError } = await admin.from("user_contacts").upsert(
    {
      owner_id: senderUser.id,
      contact_user_id: receiverUser.id,
      source: "request",
    },
    { onConflict: "owner_id,contact_user_id" },
  );
  if (duplicateError) throw duplicateError;
  const { count, error: countError } = await admin
    .from("user_contacts")
    .select("*", { count: "exact", head: true })
    .eq("owner_id", senderUser.id)
    .eq("contact_user_id", receiverUser.id);
  if (countError) throw countError;
  check(count === 1, "duplicate contacts are prevented");

  const { error: ratingError } = await sender.from("customer_ratings").upsert(
    { owner_id: senderUser.id, rated_user_id: receiverUser.id, rating: 4, note: "Good" },
    { onConflict: "owner_id,rated_user_id" },
  );
  if (ratingError) throw ratingError;
  const { error: ratingUpdateError } = await sender.from("customer_ratings").upsert(
    { owner_id: senderUser.id, rated_user_id: receiverUser.id, rating: 5, note: "Updated" },
    { onConflict: "owner_id,rated_user_id" },
  );
  if (ratingUpdateError) throw ratingUpdateError;
  const { data: ratings } = await sender.from("customer_ratings").select();
  check(ratings.length === 1 && ratings[0].rating === 5, "ratings persist and update without duplication");

  const messageId = crypto.randomUUID();
  const { error: messageError } = await sender.from("direct_messages").insert({
    id: messageId,
    sender_id: senderUser.id,
    recipient_id: receiverUser.id,
    payload: { version: 2, content: "E2E", time: "now" },
  });
  if (messageError) throw messageError;
  const { data: received, error: receivedError } = await receiver
    .from("direct_messages")
    .select("id,payload")
    .eq("id", messageId)
    .single();
  if (receivedError) throw receivedError;
  check(received.payload.content === "E2E", "direct messages cross user accounts");
  const { error: duplicateMessageError } = await sender.from("direct_messages").insert({
    id: messageId,
    sender_id: senderUser.id,
    recipient_id: receiverUser.id,
    payload: { version: 2, content: "E2E", time: "now" },
  });
  check(
    duplicateMessageError?.code === "23505",
    "stable message IDs make low-bandwidth retries idempotent",
  );

  const { data: rootCommunity, error: rootCommunityError } = await admin
    .from("communities")
    .insert({
      name: `Test root ${suffix}`,
      location: "Test location",
      purpose: "Root approval test",
      owner_id: null,
      is_admin_root: true,
      allow_subgroups: true,
      allow_invites: true,
    })
    .select("id")
    .single();
  if (rootCommunityError) throw rootCommunityError;
  communityIds.push(rootCommunity.id);

  const { error: rootRequestError } = await sender.rpc(
    "request_datachat_community_join",
    { requested_community_id: rootCommunity.id },
  );
  if (rootRequestError) throw rootRequestError;
  const { data: rootRequest } = await admin
    .from("community_memberships")
    .select("status")
    .eq("community_id", rootCommunity.id)
    .eq("user_id", senderUser.id)
    .single();
  check(rootRequest.status === "pending", "root community join requests reach the admin queue");

  await admin
    .from("community_memberships")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("community_id", rootCommunity.id)
    .eq("user_id", senderUser.id);
  const { data: childId, error: childError } = await sender.rpc(
    "create_datachat_child_community",
    {
      requested_name: `Test child ${suffix}`,
      requested_location: "Test location",
      requested_purpose: "Owner approval test",
      requested_parent_id: rootCommunity.id,
      requested_allow_subgroups: false,
    },
  );
  if (childError) throw childError;
  communityIds.push(childId);

  const { error: childRequestError } = await receiver.rpc(
    "request_datachat_community_join",
    { requested_community_id: childId },
  );
  if (childRequestError) throw childRequestError;
  const { error: childDecisionError } = await sender.rpc(
    "decide_datachat_community_join",
    {
      requested_community_id: childId,
      requested_user_id: receiverUser.id,
      requested_approved: true,
    },
  );
  if (childDecisionError) throw childDecisionError;
  const { data: childMembership } = await admin
    .from("community_memberships")
    .select("status")
    .eq("community_id", childId)
    .eq("user_id", receiverUser.id)
    .single();
  check(
    childMembership.status === "approved",
    "child community owners receive and approve join requests",
  );

  const voiceId = crypto.randomUUID();
  const voicePath = `${senderUser.id}/${voiceId}.webm`;
  voicePaths.push(voicePath);
  const voiceBytes = new Uint8Array([26, 69, 223, 163, 66, 134, 129, 1]);
  const { error: voiceUploadError } = await sender.storage
    .from("voice-messages")
    .upload(voicePath, voiceBytes, { contentType: "audio/webm" });
  if (voiceUploadError) throw voiceUploadError;
  const { error: voiceMetadataError } = await sender.from("voice_messages").insert({
    id: voiceId,
    sender_id: senderUser.id,
    recipient_id: receiverUser.id,
    object_path: voicePath,
    mime_type: "audio/webm",
    byte_size: voiceBytes.byteLength,
    duration_ms: 250,
  });
  if (voiceMetadataError) throw voiceMetadataError;
  const { data: signedVoice, error: signedVoiceError } = await receiver.storage
    .from("voice-messages")
    .createSignedUrl(voicePath, 60);
  if (signedVoiceError) throw signedVoiceError;
  check(Boolean(signedVoice.signedUrl), "voice files are private and playable by the recipient");
} finally {
  if (communityIds.length) {
    await admin.from("communities").delete().in("id", communityIds);
  }
  if (voicePaths.length) {
    await admin.storage.from("voice-messages").remove(voicePaths);
  }
  if (proCodeIds.length) {
    await admin.from("pro_access_codes").delete().in("id", proCodeIds);
  }
  for (const id of ids) await admin.auth.admin.deleteUser(id);
}
