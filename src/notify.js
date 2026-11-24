/**
 * New-message alerts, like other chat apps:
 *  - unread counts per conversation and in total,
 *  - a short sound and a vibration,
 *  - a system notification when DataChat is in the background: the Android
 *    app's local notifications, or the browser's Notification API on the web.
 * Alerts only fire while DataChat is running; alerts with the app fully
 * closed need push messaging (Firebase), which is not set up yet.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

const LocalNotifications = registerPlugin("LocalNotifications");
const PREFS_KEY = "dc-alert-prefs";

const nativeAvailable = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("LocalNotifications");

export function alertPrefs() {
  try {
    return { sound: true, vibrate: true, system: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return { sound: true, vibrate: true, system: true };
  }
}

export function setAlertPrefs(changes) {
  const next = { ...alertPrefs(), ...changes };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* preferences stay for this session only */
  }
  return next;
}

// ------------------------------------------------------------ unread --

/** Unread incoming messages per contact id. */
export function unreadByContact(messages, ownerId) {
  const counts = {};
  for (const m of messages) {
    if (m.owner === ownerId && m.sender === "them" && m.unread) counts[m.contact] = (counts[m.contact] || 0) + 1;
  }
  return counts;
}

export const totalUnread = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

/** Last message per contact, for previews and "most recent first" sorting. */
export function lastMessageByContact(messages, ownerId) {
  const last = {};
  messages.forEach((m, index) => {
    if (m.owner !== ownerId) return;
    last[m.contact] = { message: m, order: index };
  });
  return last;
}

export function messagePreview(m) {
  if (!m) return "";
  if (m.transaction) return `Transaction ${m.transaction.reference || ""}`.trim();
  if (m.voiceUrl) return "Voice message";
  if (m.sealCode) return "Locked transfer";
  return String(m.content || "").replace(/\s+/g, " ").slice(0, 80);
}

// ------------------------------------------------------------- alerts --

let audioContext;
function chime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioContext ||= new AudioCtx();
    const ctx = audioContext;
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.25);
    });
  } catch {
    /* sound is a nicety */
  }
}

let nextId = 1;
/**
 * Alert for one incoming message. `background` is true when the member
 * isn't looking at the app (hidden tab, app in the background).
 */
export async function alertNewMessage({ title, body, contactId, background }) {
  const prefs = alertPrefs();
  if (prefs.sound && !background) chime();
  // Browsers refuse vibration until the member has tapped the page once.
  if (prefs.vibrate && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.([60, 40, 60]);
  if (!background || !prefs.system) return;
  try {
    if (nativeAvailable()) {
      await LocalNotifications.schedule({
        notifications: [{ id: nextId++, title, body, extra: { contactId } }],
      });
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(title, { body, tag: `dc-${contactId}`, icon: "/assets/email-logo.png" });
      n.onclick = () => {
        window.focus();
        window.dispatchEvent(new CustomEvent("datachat:open-chat", { detail: contactId }));
        n.close();
      };
    }
  } catch {
    /* the in-app badge and banner still show */
  }
}

/** "granted" | "denied" | "default" | "unsupported" */
export async function systemPermission() {
  try {
    if (nativeAvailable()) return (await LocalNotifications.checkPermissions()).display === "granted" ? "granted" : "default";
  } catch {
    return "unsupported";
  }
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function requestSystemPermission() {
  try {
    if (nativeAvailable()) {
      const result = await LocalNotifications.requestPermissions();
      return result.display === "granted" ? "granted" : "denied";
    }
    if (typeof Notification === "undefined") return "unsupported";
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Tapping a native notification opens that conversation. */
export function onNotificationTap(handler) {
  if (!nativeAvailable()) return () => {};
  let handle;
  LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    const contactId = event?.notification?.extra?.contactId;
    if (contactId) handler(contactId);
  })
    .then((h) => (handle = h))
    .catch(() => {});
  return () => handle?.remove?.();
}
