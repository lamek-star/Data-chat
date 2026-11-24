/**
 * Live messaging for signed-in members (cloud mode):
 *  - outgoing messages go through a persistent outbox (instant on screen,
 *    retried until the server has them, safe on slow or dropped networks),
 *  - incoming messages are polled, marked unread unless that chat is open,
 *    and announced with a banner, sound, vibration and system notification,
 *  - a message from a member who isn't a contact yet (they scanned your QR)
 *    adds them as a contact instead of being silently dropped.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadDirectMessages,
  loadPublicProfiles,
  markMessagesRead,
  sendDirectMessage,
  subscribeToDirectMessages,
  unsubscribeChannel,
} from "./cloud/cloudClient.js";
import { createOutbox, localOutboxStorage } from "./cloud/outbox.js";
import { alertNewMessage, messagePreview, onNotificationTap } from "./notify.js";

export const OPEN_CHAT_EVENT = "datachat:open-chat";
export const CONTACT_ADDED_EVENT = "datachat:contact-added";
const COLORS = ["#d7a62b", "#4c8ed9", "#8f69d8", "#35a57a"];

const timeOf = (row) =>
  row.payload?.time ||
  new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** A contact for a member who wrote first (they added you by your QR or code). */
export function contactFromProfile(profile, ownerId, index) {
  return {
    id: `cloud-${profile.id}`,
    remoteUserId: profile.id,
    contactCode: profile.contact_code,
    owner: ownerId,
    name: profile.display_name || "DataChat member",
    phone: profile.contact_code ? `ID ${profile.contact_code}` : "DataChat member",
    country: profile.country || "Global",
    profilePhoto: profile.avatar_url || null,
    color: COLORS[index % COLORS.length],
    addedBy: "them",
  };
}

const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

export function useMessaging({ authUser, db, setDb, save, setToast }) {
  const me = authUser?.id;
  const dbRef = useRef(db);
  dbRef.current = db;
  const saveRef = useRef(save);
  saveRef.current = save;
  const toastRef = useRef(setToast);
  toastRef.current = setToast;
  const openChatRef = useRef(null);
  const alertedRef = useRef(new Set());
  const channelRef = useRef(null);
  const strangersRef = useRef(new Map()); // sender id -> rows waiting for a profile
  const [banner, setBanner] = useState(null);

  // ------------------------------------------------------------ outbox --
  const outboxRef = useRef(null);
  if (me && outboxRef.current?.owner !== me) {
    outboxRef.current?.box.stop();
    outboxRef.current = {
      owner: me,
      box: createOutbox({
        storage: localOutboxStorage(me),
        send: (item) => sendDirectMessage(item.recipientId, item.message),
        onStatus: (id, status, _row, error) => {
          setDb((d) => {
            if (!d.messages.some((m) => m.id === id && m.deliveryStatus !== status)) return d;
            return { ...d, messages: d.messages.map((m) => (m.id === id ? { ...m, deliveryStatus: status } : m)) };
          });
          if (status === "failed") toastRef.current(`Message not sent: ${error?.message || "refused by the server"}`);
          if (status === "sent") channelRef.current?.pollNow?.();
        },
      }),
    };
  }
  const outbox = outboxRef.current?.box;

  /** Send a chat message to a member: shown at once, delivered when possible. */
  const queueMessage = useCallback(
    (recipientId, message) => outboxRef.current?.box.push({ id: message.id, recipientId, message }),
    [],
  );

  /** Put a failed message back in the outbox. */
  const retryMessage = useCallback(
    (message) => {
      const contact = dbRef.current.contacts.find((c) => c.id === message.contact);
      if (!contact?.remoteUserId) return;
      const { deliveryStatus: _status, ...clean } = message;
      setDb((d) => ({ ...d, messages: d.messages.map((m) => (m.id === message.id ? { ...m, deliveryStatus: "sending" } : m)) }));
      outboxRef.current?.box.push({ id: message.id, recipientId: contact.remoteUserId, message: clean });
    },
    [setDb],
  );

  /** Messages still in the outbox, to show again after the app reloads. */
  const pendingOutgoing = useCallback(
    () => (outboxRef.current?.box.pending() || []).map((item) => ({ ...item.message, deliveryStatus: "waiting" })),
    [],
  );

  // ------------------------------------------------------------ unread --
  const markChatRead = useCallback(
    (contactId) => {
      const unread = dbRef.current.messages.filter(
        (m) => m.contact === contactId && m.sender === "them" && m.unread,
      );
      if (!unread.length) return;
      const ids = new Set(unread.map((m) => m.id));
      setDb((d) => ({ ...d, messages: d.messages.map((m) => (ids.has(m.id) ? { ...m, unread: false } : m)) }));
      const cloudIds = unread.filter((m) => m.cloudMessage).map((m) => m.id);
      if (cloudIds.length) markMessagesRead(cloudIds).catch(() => {});
    },
    [setDb],
  );

  const setOpenChat = useCallback((contactId) => {
    openChatRef.current = contactId;
  }, []);

  // ----------------------------------------------------------- receive --
  const addIncoming = useCallback(
    (row, contact, { initial = false } = {}) => {
      if (dbRef.current.messages.some((m) => m.id === row.id)) return;
      const viewing = openChatRef.current === contact.id && visible();
      const unread = !viewing && !contact.blocked && !(initial && row.read_at);
      setDb((current) => {
        if (current.messages.some((m) => m.id === row.id)) return current;
        return {
          ...current,
          messages: [
            ...current.messages,
            {
              ...row.payload,
              id: row.id,
              owner: me,
              contact: contact.id,
              sender: "them",
              cloudMessage: true,
              unread,
              deliveryStatus: undefined,
              time: timeOf(row),
            },
          ],
        };
      });
      if (viewing) markMessagesRead([row.id]).catch(() => {});
      if (initial || contact.blocked || alertedRef.current.has(row.id)) return;
      alertedRef.current.add(row.id);
      const body = messagePreview(row.payload) || "New message";
      if (!viewing) setBanner({ contactId: contact.id, title: contact.name, body, at: Date.now() });
      alertNewMessage({ title: contact.name, body, contactId: contact.id, background: !visible() });
    },
    [me, setDb],
  );

  const adoptStranger = useCallback(
    async (senderId) => {
      try {
        const [profile] = await loadPublicProfiles([senderId]);
        const rows = strangersRef.current.get(senderId) || [];
        strangersRef.current.delete(senderId);
        if (!profile) return;
        let contact = dbRef.current.contacts.find((c) => c.remoteUserId === senderId);
        if (!contact) {
          contact = contactFromProfile(profile, me, dbRef.current.contacts.length);
          const added = contact;
          saveRef.current((d) =>
            d.contacts.some((c) => c.remoteUserId === senderId) ? d : { ...d, contacts: [...d.contacts, added] },
          );
          dbRef.current = { ...dbRef.current, contacts: [...dbRef.current.contacts, added] };
        }
        rows.forEach(({ row, initial }) => addIncoming(row, contact, { initial }));
      } catch {
        strangersRef.current.delete(senderId); // try again with their next message
      }
    },
    [me, addIncoming],
  );

  const receive = useCallback(
    (row, options = {}) => {
      if (!row || !me || row.sender_id === me) return;
      const contact = dbRef.current.contacts.find((c) => c.remoteUserId === row.sender_id);
      if (contact) return addIncoming(row, contact, options);
      const waiting = strangersRef.current.get(row.sender_id);
      if (waiting) return void waiting.push({ row, ...options });
      strangersRef.current.set(row.sender_id, [{ row, ...options }]);
      adoptStranger(row.sender_id);
    },
    [me, addIncoming, adoptStranger],
  );

  useEffect(() => {
    if (!me) return;
    const channel = subscribeToDirectMessages(({ new: row }) => receive(row));
    channelRef.current = channel;
    // A new contact may have written before they were added: show those too.
    const pullHistory = () =>
      loadDirectMessages()
        .then((rows) => rows.forEach((row) => receive(row, { initial: true })))
        .catch(() => {});
    const onOnline = () => outboxRef.current?.box.retryNow();
    window.addEventListener(CONTACT_ADDED_EVENT, pullHistory);
    window.addEventListener("online", onOnline);
    const stopTap = onNotificationTap((contactId) =>
      window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: contactId })),
    );
    outboxRef.current?.box.retryNow();
    return () => {
      window.removeEventListener(CONTACT_ADDED_EVENT, pullHistory);
      window.removeEventListener("online", onOnline);
      stopTap();
      unsubscribeChannel(channel);
      channelRef.current = null;
    };
  }, [me, receive]);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(timer);
  }, [banner]);

  return {
    queueMessage,
    retryMessage,
    pendingOutgoing,
    markChatRead,
    setOpenChat,
    receive,
    banner,
    dismissBanner: () => setBanner(null),
    outboxReady: Boolean(outbox),
  };
}
