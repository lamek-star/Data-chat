import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  AndroidBiometryStrength,
  BiometricAuth,
} from "@aparajita/capacitor-biometric-auth";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import { LocalNotifications } from "@capacitor/local-notifications";
import { App as CapacitorApp } from "@capacitor/app";
import {
  getCryptoPrices,
  getFxRates,
  getMetalPrice,
  getSupportedCurrencies,
} from "./services/publicApis";
import {
  cloudConfigured,
  cloudConfig,
  getSession,
  onAuthStateChange,
  signIn as cloudSignIn,
  signInWithUsername,
  signUp as cloudSignUp,
  requestEmailOtp,
  resendSignupOtp,
  verifyEmailOtp,
  markEmailVerified,
  updateCurrentUserPassword,
  redeemProAccessCode,
  signOut as cloudSignOut,
  loadAppData,
  overwriteAppData,
  upsertPublicProfile,
  findPublicProfile,
  loadDirectMessages,
  sendDirectMessage,
  editDirectMessage,
  deleteDirectMessage,
  subscribeToDirectMessages,
  subscribeToContactNetwork,
  subscribeToCommunityNetwork,
  unsubscribeChannel,
  uploadProfilePhoto,
  loadCloudCommunities,
  createCloudCommunity,
  requestCloudCommunityJoin,
  decideCloudCommunityJoin,
  updateCommunityVisibility,
  loadCommunityDirectory,
  loadContactNetwork,
  sendContactRequest,
  respondContactRequest,
  addContactByQr,
  saveCustomerRating,
  deleteCustomerRating,
  uploadVoiceMessage,
  createVoicePlaybackUrl,
} from "./cloud/supabaseClient";
import * as I from "lucide-react";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const K = "datachat-v1";
const DataChatNativeSettings = registerPlugin("DataChatNativeSettings");
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "https://datachat.harmongt.uk"
).replace(/\/$/, "");
const STRIPE_PAYMENT_LINK =
  import.meta.env.VITE_STRIPE_PAYMENT_LINK ||
  "https://buy.stripe.com/test_eVq5kD42Fcqe0ALaoJao801";
const apiUrl = (path) => `${API_BASE}${path}`;
const seed = {
  users: [],
  records: [],
  contacts: [],
  messages: [],
  notifications: [],
  accessCodes: [],
  adminConfig: {
    repositoryUrl: "https://github.com/lamek-star/Data-chat",
    paymentUrl: STRIPE_PAYMENT_LINK,
    supportEmail: "support@datachat.app",
  },
  communities: [],
};
const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(K));
    if (!saved) return seed;
    const demoOwners = new Set(["demo", "free-demo", "admin"]);
    const users = (saved.users || []).filter((x) => !demoOwners.has(x.id));
    return {
      ...seed,
      ...saved,
      users,
      records: (saved.records || []).filter((x) => !demoOwners.has(x.owner)),
      contacts: (saved.contacts || []).filter((x) => !demoOwners.has(x.owner)),
      messages: (saved.messages || []).filter((x) => !demoOwners.has(x.owner)),
      rateOffers: (saved.rateOffers || []).filter((x) => x.owner !== "market"),
      accessCodes: (saved.accessCodes || []).filter((x) => x.id !== "code-demo"),
      communities: (saved.communities || []).filter(
        (x) => !["community-global", "community-uae"].includes(x.id),
      ),
      adminConfig: { ...seed.adminConfig, ...(saved.adminConfig || {}) },
    };
  } catch {
    return seed;
  }
};

const buildCloudDb = (rows, userId, profile = {}) => {
  const profileRow = rows.find(
    (row) => row.entity_type === "profile" && row.entity_id === userId,
  );
  const profileData = {
    ...profileRow?.payload,
    ...profile,
    email: profileRow?.payload?.email || profile?.email,
  };
  const currentUser = {
    ...profileData,
    id: userId,
    name: profileData.name || "",
    email: profileData.email || "",
    plan: profileData.plan || "Free",
    role: profileData.role || "user",
    status: profileData.status || "active",
    createdAt: profileData.createdAt || new Date().toISOString(),
  };
  const records = rows
    .filter((row) => row.entity_type === "transaction")
    .map((row) => ({ id: row.entity_id, ...row.payload }));
  const contacts = rows
    .filter((row) => row.entity_type === "contact")
    .map((row) => ({ id: row.entity_id, ...row.payload }));
  const messages = rows
    .filter((row) => row.entity_type === "message")
    .map((row) => ({ id: row.entity_id, ...row.payload }));
  const notifications = rows
    .filter((row) => row.entity_type === "notification")
    .map((row) => ({ id: row.entity_id, ...row.payload }));
  const accessCodes = rows
    .filter((row) => row.entity_type === "accessCode")
    .map((row) => ({ id: row.entity_id, ...row.payload }));
  return {
    ...seed,
    users: [currentUser],
    records,
    contacts,
    messages,
    notifications,
    accessCodes,
    communities: seed.communities,
    adminConfig: seed.adminConfig,
  };
};

async function loadCloudDb(authUser) {
  const [
    rows,
    publicProfile,
    remoteMessages,
    cloudCommunities,
    contactNetwork,
    communityDirectory,
  ] = await Promise.all([
    loadAppData(authUser.id),
    upsertPublicProfile(authUser),
    loadDirectMessages(authUser.id),
    loadCloudCommunities(),
    loadContactNetwork(),
    loadCommunityDirectory(),
  ]);
  const cloudDb = buildCloudDb(rows, authUser.id, {
    name: authUser.user_metadata?.name || authUser.email?.split("@")[0],
    username: authUser.user_metadata?.username || publicProfile.username,
    email: authUser.email,
    plan: authUser.user_metadata?.plan || "Free",
    role: authUser.user_metadata?.role || "user",
    status: authUser.user_metadata?.status || "active",
    createdAt: authUser.user_metadata?.createdAt,
  });
  cloudDb.users[0] = {
    ...cloudDb.users[0],
    contactCode: publicProfile.contact_code,
    username: publicProfile.username || cloudDb.users[0].username,
    country: publicProfile.country,
    phone: publicProfile.phone || cloudDb.users[0].phone,
    profilePhoto: publicProfile.avatar_url || cloudDb.users[0].profilePhoto,
    plan: publicProfile.plan || cloudDb.users[0].plan,
    status: publicProfile.status || cloudDb.users[0].status,
    emailVerified: Boolean(publicProfile.email_verified),
    visibleInCommunity: Boolean(publicProfile.visible_in_community),
  };
  cloudDb.communities = cloudCommunities;
  const profileById = new Map(
    (contactNetwork.profiles || []).map((profile) => [profile.id, profile]),
  );
  const normalizedContacts = (contactNetwork.contacts || [])
    .map((relationship, index) => {
      const profile = profileById.get(relationship.contact_user_id);
      if (!profile) return null;
      return {
        id: `contact-${profile.id}`,
        owner: authUser.id,
        remoteUserId: profile.id,
        contactCode: profile.contact_code,
        name: profile.display_name,
        username: profile.username,
        phone: "",
        country: profile.country || "Global",
        profilePhoto: profile.avatar_url || null,
        color: ["#d7a62b", "#4c8ed9", "#8f69d8", "#35a57a"][index % 4],
        source: relationship.source,
        createdAt: relationship.created_at,
      };
    })
    .filter(Boolean);
  cloudDb.contacts = [
    ...normalizedContacts,
    ...cloudDb.contacts.filter((contact) => !contact.remoteUserId),
  ];
  cloudDb.contactRequests = contactNetwork.requests || [];
  cloudDb.customerRatings = contactNetwork.ratings || [];
  cloudDb.communityDirectory = communityDirectory || [];
  try {
    const deviceNotifications = JSON.parse(
      localStorage.getItem(`dc-notifications-${authUser.id}`) || "[]",
    );
    const existingNotificationIds = new Set(
      cloudDb.notifications.map((item) => item.id),
    );
    cloudDb.notifications = [
      ...deviceNotifications.filter(
        (item) => !existingNotificationIds.has(item.id),
      ),
      ...cloudDb.notifications,
    ].slice(0, 100);
  } catch {
    // Ignore damaged device notification cache.
  }
  const contactByRemoteId = new Map(
    cloudDb.contacts
      .filter((contact) => contact.remoteUserId)
      .map((contact) => [contact.remoteUserId, contact]),
  );
  const knownMessageIds = new Set(cloudDb.messages.map((message) => message.id));
  const knownNotificationMessages = new Set(
    cloudDb.notifications.map((item) => item.messageId).filter(Boolean),
  );
  for (const row of remoteMessages) {
    if (knownMessageIds.has(row.id)) continue;
    const peerId = row.sender_id === authUser.id ? row.recipient_id : row.sender_id;
    const contact = contactByRemoteId.get(peerId);
    if (!contact) continue;
    const voiceUrl = row.payload?.voicePath
      ? await createVoicePlaybackUrl(row.payload.voicePath).catch(() => null)
      : row.payload?.voiceUrl;
    cloudDb.messages.push({
      ...row.payload,
      voiceUrl,
      id: row.id,
      owner: authUser.id,
      contact: contact.id,
      sender: row.sender_id === authUser.id ? "me" : "them",
      cloudMessage: true,
      time:
        row.payload?.time ||
        new Date(row.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
    });
    if (
      row.sender_id !== authUser.id &&
      !knownNotificationMessages.has(row.id)
    ) {
      cloudDb.notifications.unshift({
        id: `notification-${row.id}`,
        owner: authUser.id,
        title: `New message from ${contact.name}`,
        messageId: row.id,
        createdAt: row.created_at || new Date().toISOString(),
        read: false,
      });
      knownNotificationMessages.add(row.id);
    }
  }
  cloudDb.notifications = cloudDb.notifications.slice(0, 100);
  localStorage.setItem(
    `dc-notifications-${authUser.id}`,
    JSON.stringify(cloudDb.notifications),
  );
  return cloudDb;
}

const serializeCloudRows = (dbState, userId) => {
  const currentUser = dbState.users.find((x) => x.id === userId) || {
    id: userId,
    name: "",
    email: "",
    plan: "Free",
    role: "user",
    status: "active",
    createdAt: new Date().toISOString(),
  };
  return [
    {
      entity_type: "profile",
      entity_id: userId,
      payload: {
        name: currentUser.name,
        email: currentUser.email,
        plan: currentUser.plan,
        role: currentUser.role,
        status: currentUser.status,
        phone: currentUser.phone || "",
        profilePhoto: currentUser.profilePhoto || null,
        createdAt: currentUser.createdAt || new Date().toISOString(),
      },
    },
    ...dbState.records.map((record) => ({
      entity_type: "transaction",
      entity_id: record.id,
      payload: record,
    })),
    ...dbState.contacts.map((contact) => ({
      entity_type: "contact",
      entity_id: contact.id,
      payload: contact,
    })),
    ...dbState.messages.filter((message) => !message.cloudMessage).map((message) => ({
      entity_type: "message",
      entity_id: message.id,
      payload: message,
    })),
    ...dbState.notifications.map((notification) => ({
      entity_type: "notification",
      entity_id: notification.id,
      payload: notification,
    })),
    ...dbState.accessCodes.map((code) => ({
      entity_type: "accessCode",
      entity_id: code.id,
      payload: code,
    })),
  ];
};

async function persistCloudData(state, userId) {
  const rows = serializeCloudRows(state, userId);
  await overwriteAppData(userId, rows);
}
const money = (n, c = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 0,
  }).format(+n || 0);
const today = () => new Date().toISOString().slice(0, 10);
const uid = (p = "id") =>
  p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const transactionPayload = (record) => ({
  version: 1,
  type: "datachat-transaction-record",
  reference: record.id,
  sender: record.sender,
  senderPhone: record.senderPhone || "",
  receiver: record.receiver,
  receiverPhone: record.receiverPhone || "",
  from: record.from,
  to: record.to,
  amount: Number(record.amount) || 0,
  currency: record.currency || "USD",
  rate: Number(record.rate) || 1,
  account: record.account || "",
  category: record.category || "Remittance",
  date: record.date || today(),
  status: record.status || "Pending",
  securityKey: record.key || "",
  note: record.remark || "",
});
const transactionText = (data) =>
  [
    "DATACHAT TRANSACTION RECORD",
    `Reference: ${data.reference}`,
    `Sender: ${data.sender} (${data.senderPhone || "No phone"})`,
    `Receiver: ${data.receiver} (${data.receiverPhone || "No phone"})`,
    `Route: ${data.from} to ${data.to}`,
    `Amount: ${data.amount} ${data.currency}`,
    `Rate: ${data.rate}`,
    `Date: ${data.date}`,
    `Status: ${data.status}`,
    `Security key: ${data.securityKey || "Not generated"}`,
    `Note: ${data.note || "None"}`,
  ].join("\n");
const downloadText = (filename, content) => {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replaceAll(/[^a-z0-9._-]/gi, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
const countries = [
  "UAE",
  "Ethiopia",
  "USA",
  "UK",
  "Canada",
  "Saudi Arabia",
  "Qatar",
  "Germany",
  "Kenya",
  "South Africa",
  "Other",
];
const priorityCurrencies = [
  "AED",
  "USD",
  "EUR",
  "GBP",
  "SAR",
  "ETB",
  "CAD",
  "AUD",
  "CHF",
  "TRY",
  "JPY",
  "CNY",
  "INR",
  "KES",
  "ZAR",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
];
const nativeCurrencyCodes = (() => {
  try {
    return Intl.supportedValuesOf("currency");
  } catch {
    return priorityCurrencies;
  }
})();
const currencyDisplayNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    return null;
  }
})();
const currencyLabel = (code) => {
  if (code === "Other") return "Other";
  let symbol = code;
  try {
    symbol =
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value || code;
  } catch {
    // Keep the ISO code when the platform cannot format a rare currency.
  }
  const name = currencyDisplayNames?.of(code) || code;
  return `${code} · ${name} (${symbol})`;
};
function useCurrencyCodes(includeOther = false) {
  const [codes, setCodes] = useState([
    ...new Set([...priorityCurrencies, ...nativeCurrencyCodes]),
  ]);
  useEffect(() => {
    const controller = new AbortController();
    getSupportedCurrencies({ signal: controller.signal })
      .then((rows) =>
        setCodes([
          ...new Set([
            ...priorityCurrencies,
            ...nativeCurrencyCodes,
            ...rows.map((x) => x.code),
          ]),
        ]),
      )
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return includeOther ? [...codes, "Other"] : codes;
}
function Icon({ name, size = 18 }) {
  const C = I[name] || I.Circle;
  return <C size={size} strokeWidth={1.8} />;
}
const isNativeApp = () => Capacitor.isNativePlatform();
async function authenticateDevice() {
  await BiometricAuth.authenticate({
    reason: "Unlock your private DataChat workspace",
    cancelTitle: "Cancel",
    allowDeviceCredential: true,
    iosFallbackTitle: "Use device passcode",
    androidTitle: "Unlock DataChat",
    androidSubtitle: "Confirm your fingerprint, face, or device PIN",
    androidConfirmationRequired: false,
    androidBiometryStrength: AndroidBiometryStrength.weak,
  });
}
async function scanNativeQr(instructions) {
  if (!isNativeApp()) return null;
  const result = await CapacitorBarcodeScanner.scanBarcode({
    hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
    scanInstructions: instructions,
    scanButton: false,
    cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
    scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
    cancelButtonAccessibilityLabel: "Cancel QR scanner",
    torchButtonOnAccessibilityLabel: "Turn flashlight off",
    torchButtonOffAccessibilityLabel: "Turn flashlight on",
    android: { scanningLibrary: "mlkit" },
  });
  return result?.ScanResult || "";
}
async function scanQrImage(file, readerElementId) {
  const scanner = new Html5Qrcode(readerElementId);
  try {
    return await scanner.scanFile(file, true);
  } finally {
    await scanner.clear().catch(() => {});
  }
}
function readSelectedFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(reader.error || new Error("The selected file could not be read."));
    reader.readAsText(file);
  });
}
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = String(text || "").replace(/^\ufeff/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && quoted && source[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  if (quoted) throw new Error("The CSV contains an unfinished quoted value.");
  return rows;
}
async function requestNotificationPermission() {
  if (isNativeApp()) {
    const current = await LocalNotifications.checkPermissions();
    const result =
      current.display === "granted"
        ? current
        : await LocalNotifications.requestPermissions();
    if (result.display !== "granted") return false;
    if (Capacitor.getPlatform() === "android") {
      await LocalNotifications.createChannel({
        id: "datachat-messages-v2",
        name: "DataChat messages",
        description: "New messages, transactions, and voice messages",
        importance: 5,
        visibility: 1,
        vibration: true,
      }).catch(() => {});
    }
    return true;
  }
  if (!("Notification" in window)) return false;
  return (await Notification.requestPermission()) === "granted";
}
async function requestMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Voice recording is not supported on this device.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}
async function openNativeAppSettings() {
  if (isNativeApp() && Capacitor.getPlatform() === "android") {
    await DataChatNativeSettings.openAppSettings();
    return true;
  }
  return false;
}
async function notifyIncomingMessage(senderName, message) {
  const title = `New message from ${senderName || "DataChat contact"}`;
  const body = message?.transaction
    ? `Transaction ${message.transaction.reference || "record"} received`
    : message?.voicePath || message?.voiceUrl
      ? "Voice message received"
      : String(message?.content || "Open DataChat to view the message").slice(
          0,
          140,
        );
  if (isNativeApp()) {
    if (Capacitor.getPlatform() === "android") {
      await LocalNotifications.createChannel({
        id: "datachat-messages-v2",
        name: "DataChat messages",
        description: "New messages, transactions, and voice messages",
        importance: 5,
        visibility: 1,
        vibration: true,
      }).catch(() => {});
    }
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") return false;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() % 2147483647),
          title,
          body,
          channelId: "datachat-messages-v2",
          extra: { page: "home" },
        },
      ],
    });
    return true;
  }
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/assets/datachat-logo.webp" });
    return true;
  }
  return false;
}

const outgoingQueueKey = (userId) => `dc-outgoing-v2-${userId}`;
function readOutgoingQueue(userId) {
  try {
    return JSON.parse(localStorage.getItem(outgoingQueueKey(userId)) || "[]");
  } catch {
    return [];
  }
}
function writeOutgoingQueue(userId, queue) {
  localStorage.setItem(outgoingQueueKey(userId), JSON.stringify(queue.slice(-100)));
}
function queueOutgoingMessage(userId, recipientId, message) {
  const queue = readOutgoingQueue(userId);
  if (!queue.some((item) => item.message.id === message.id)) {
    queue.push({
      recipientId,
      message: {
        id: message.id,
        content: message.content,
        time: message.time,
        transaction: message.transaction,
        recordId: message.recordId,
        voicePath: message.voicePath,
        voiceType: message.voiceType,
        durationMs: message.durationMs,
      },
      attempts: 0,
      queuedAt: new Date().toISOString(),
    });
    writeOutgoingQueue(userId, queue);
  }
  window.dispatchEvent(new Event("datachat-flush-outgoing"));
}
function App() {
  const [db, setDb] = useState(load),
    [user, setUser] = useState(() =>
      cloudConfigured
        ? null
        : JSON.parse(localStorage.getItem("dc-user") || "null"),
    ),
    [cloudAuthUser, setCloudAuthUser] = useState(null),
    [page, setPage] = useState("home"),
    [toast, setToast] = useState(""),
    [onboarding, setOnboarding] = useState(false),
    [biometricAvailable, setBiometricAvailable] = useState(false),
    [biometricEnabled, setBiometricEnabled] = useState(false),
    [biometricUnlocked, setBiometricUnlocked] = useState(true),
    [biometricBusy, setBiometricBusy] = useState(false),
    [authLoading, setAuthLoading] = useState(cloudConfigured);
  const biometricUserRef = useRef(null);
  const biometricPromptRef = useRef(false);

  useEffect(() => {
    if (!cloudConfigured) localStorage.setItem(K, JSON.stringify(db));
  }, [db]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 2600);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    if (!cloudConfigured) return;
    let active = true;
    getSession()
      .then((session) => {
        if (!active) return;
        if (session?.user) {
          setCloudAuthUser(session.user);
        } else {
          setAuthLoading(false);
        }
      })
      .catch(() => setAuthLoading(false));
    const subscription = onAuthStateChange((_event, session) => {
      if (session?.user) setAuthLoading(true);
      setCloudAuthUser(session?.user || null);
      if (!session?.user) {
        setUser(null);
        setAuthLoading(false);
      }
    });
    return () => {
      active = false;
      subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!cloudConfigured || !cloudAuthUser) return;
    let active = true;
    loadCloudDb(cloudAuthUser)
      .then((cloudDb) => {
        if (!active) return;
        setDb(cloudDb);
        setUser(cloudDb.users[0]);
      })
      .catch((error) => setToast(`Cloud data load failed: ${error.message}`))
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cloudAuthUser]);

  useEffect(() => {
    if (!isNativeApp()) return;
    let actionListener;
    LocalNotifications.addListener(
      "localNotificationActionPerformed",
      () => setPage("home"),
    ).then((handle) => {
      actionListener = handle;
    });
    return () => actionListener?.remove();
  }, []);

  useEffect(() => {
    if (!cloudConfigured || !cloudAuthUser) return;
    let flushing = false;
    const flush = async () => {
      if (flushing || navigator.onLine === false) return;
      const queued = readOutgoingQueue(cloudAuthUser.id);
      if (!queued.length) return;
      flushing = true;
      const remaining = [];
      for (const item of queued) {
        try {
          await sendDirectMessage(item.recipientId, item.message);
          setDb((current) => ({
            ...current,
            messages: current.messages.map((message) =>
              message.id === item.message.id
                ? { ...message, deliveryStatus: "sent" }
                : message,
            ),
          }));
        } catch {
          remaining.push({ ...item, attempts: (item.attempts || 0) + 1 });
          if (navigator.onLine === false) {
            remaining.push(...queued.slice(queued.indexOf(item) + 1));
            break;
          }
        }
      }
      const attemptedIds = new Set(queued.map((item) => item.message.id));
      const newlyQueued = readOutgoingQueue(cloudAuthUser.id).filter(
        (item) => !attemptedIds.has(item.message.id),
      );
      writeOutgoingQueue(cloudAuthUser.id, [...remaining, ...newlyQueued]);
      flushing = false;
    };
    const interval = window.setInterval(flush, 12000);
    window.addEventListener("online", flush);
    window.addEventListener("datachat-flush-outgoing", flush);
    flush();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", flush);
      window.removeEventListener("datachat-flush-outgoing", flush);
    };
  }, [cloudAuthUser]);

  useEffect(() => {
    if (!cloudConfigured || !cloudAuthUser) return;
    let refreshing = false;
    const refreshCommunities = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const communities = await loadCloudCommunities();
        setDb((current) => ({ ...current, communities }));
      } catch (error) {
        setToast(`Community refresh failed: ${error.message}`);
      } finally {
        refreshing = false;
      }
    };
    const channel = subscribeToCommunityNetwork(refreshCommunities);
    return () => unsubscribeChannel(channel);
  }, [cloudAuthUser]);

  useEffect(() => {
    if (!isNativeApp()) return;
    let listener;
    CapacitorApp.addListener("backButton", () => {
      if (document.body.dataset.datachatChatOpen === "true") {
        window.dispatchEvent(new Event("datachat-close-chat"));
        return;
      }
      if (page !== "home") {
        setPage("home");
        return;
      }
      CapacitorApp.exitApp();
    }).then((handle) => {
      listener = handle;
    });
    return () => listener?.remove();
  }, [page]);

  useEffect(() => {
    if (!user?.id || !isNativeApp()) {
      biometricUserRef.current = user?.id || null;
      setBiometricAvailable(false);
      setBiometricEnabled(false);
      setBiometricUnlocked(true);
      return;
    }
    let active = true;
    biometricUserRef.current = user.id;
    const enabled =
      localStorage.getItem(`dc-biometric-${user.id}`) === "true";
    const unlockedThisLaunch =
      sessionStorage.getItem(`dc-biometric-unlocked-${user.id}`) === "true";
    setBiometricEnabled(enabled);
    BiometricAuth.checkBiometry()
      .then(async (info) => {
        if (!active) return;
        const available = Boolean(info.isAvailable || info.deviceIsSecure);
        setBiometricAvailable(available);
        if (!enabled || !available) {
          setBiometricUnlocked(true);
          return;
        }
        if (unlockedThisLaunch) {
          setBiometricUnlocked(true);
          return;
        }
        setBiometricUnlocked(false);
        setBiometricBusy(true);
        biometricPromptRef.current = true;
        try {
          await authenticateDevice();
          if (active) {
            sessionStorage.setItem(
              `dc-biometric-unlocked-${user.id}`,
              "true",
            );
            setBiometricUnlocked(true);
          }
        } catch {
          if (active) setBiometricUnlocked(false);
        } finally {
          biometricPromptRef.current = false;
          if (active) setBiometricBusy(false);
        }
      })
      .catch(() => {
        if (active) {
          setBiometricAvailable(false);
          setBiometricUnlocked(true);
        }
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!cloudConfigured || !cloudAuthUser) return;
    const receive = async ({ eventType, new: row }) => {
      if (!row) return;
      if (eventType === "UPDATE") {
        setDb((current) => ({
          ...current,
          messages: current.messages.map((message) =>
            message.id === row.id
              ? {
                  ...message,
                  ...row.payload,
                  voiceUrl: row.payload?.voicePath
                    ? message.voiceUrl
                    : null,
                }
              : message,
          ),
        }));
        return;
      }
      if (row.sender_id === cloudAuthUser.id) return;
      const resolvedVoiceUrl = row.payload?.voicePath
        ? await createVoicePlaybackUrl(row.payload.voicePath).catch(() => null)
        : row.payload?.voiceUrl;
      setDb((current) => {
        if (current.messages.some((message) => message.id === row.id))
          return current;
        const contact = current.contacts.find(
          (item) => item.remoteUserId === row.sender_id,
        );
        if (!contact) return current;
        const incoming = {
          ...row.payload,
          voiceUrl: resolvedVoiceUrl,
          id: row.id,
          owner: cloudAuthUser.id,
          contact: contact.id,
          sender: "them",
          cloudMessage: true,
          time:
            row.payload?.time ||
            new Date(row.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
        };
        notifyIncomingMessage(contact.name, incoming).catch(() => {});
        const nextNotifications = [
          {
            id: `notification-${row.id}`,
            owner: cloudAuthUser.id,
            title: `New message from ${contact.name}`,
            messageId: row.id,
            createdAt: row.created_at || new Date().toISOString(),
            read: false,
          },
          ...(current.notifications || []).filter(
            (item) => item.messageId !== row.id,
          ),
        ].slice(0, 100);
        localStorage.setItem(
          `dc-notifications-${cloudAuthUser.id}`,
          JSON.stringify(nextNotifications),
        );
        return {
          ...current,
          messages: [...current.messages, incoming],
          notifications: nextNotifications,
        };
      });
    };
    const channel = subscribeToDirectMessages(receive);
    return () => {
      unsubscribeChannel(channel);
    };
  }, [cloudAuthUser]);

  useEffect(() => {
    if (!cloudConfigured || !cloudAuthUser) return;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const [network, directory] = await Promise.all([
          loadContactNetwork(),
          loadCommunityDirectory(),
        ]);
        const profileById = new Map(
          (network.profiles || []).map((profile) => [profile.id, profile]),
        );
        const normalized = (network.contacts || [])
          .map((relationship, index) => {
            const profile = profileById.get(relationship.contact_user_id);
            if (!profile) return null;
            return {
              id: `contact-${profile.id}`,
              owner: cloudAuthUser.id,
              remoteUserId: profile.id,
              contactCode: profile.contact_code,
              name: profile.display_name,
              username: profile.username,
              phone: "",
              country: profile.country || "Global",
              profilePhoto: profile.avatar_url || null,
              color: ["#d7a62b", "#4c8ed9", "#8f69d8", "#35a57a"][
                index % 4
              ],
              source: relationship.source,
              createdAt: relationship.created_at,
            };
          })
          .filter(Boolean);
        setDb((current) => ({
          ...current,
          contacts: [
            ...normalized,
            ...current.contacts.filter((contact) => !contact.remoteUserId),
          ],
          contactRequests: network.requests || [],
          customerRatings: network.ratings || [],
          communityDirectory: directory || [],
        }));
      } catch (error) {
        setToast(`Contact refresh failed: ${error.message}`);
      } finally {
        refreshing = false;
      }
    };
    const channel = subscribeToContactNetwork(refresh);
    return () => unsubscribeChannel(channel);
  }, [cloudAuthUser]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id");
    if (checkout === "cancelled") {
      setToast("Checkout cancelled. No charge was made.");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (checkout !== "success" || !sessionId) return;
    fetch(apiUrl(`/api/stripe/session-status?session_id=${encodeURIComponent(sessionId)}`))
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not verify payment.");
        if (result.userId !== user.id || result.paymentStatus !== "paid") throw new Error("Stripe has not confirmed this subscription payment.");
        const upgraded = { ...user, plan: "Pro", stripeCheckoutSession: sessionId };
        setDb((d) => ({ ...d, users: d.users.map((x) => x.id === user.id ? { ...x, plan: "Pro", stripeCheckoutSession: sessionId } : x) }));
        setUser(upgraded);
        if (!cloudConfigured) localStorage.setItem("dc-user", JSON.stringify(upgraded));
        setPage("settings");
        setToast("Payment confirmed. DataChat Pro is now active.");
      })
      .catch((error) => setToast(error.message))
      .finally(() => window.history.replaceState({}, "", window.location.pathname));
  }, [user?.id]);

  const save = (fn) =>
    setDb((d) => {
      const next = typeof fn === "function" ? fn(d) : fn;
      if (cloudConfigured && user?.id) {
        persistCloudData(next, user.id).catch((error) =>
          setToast(`Cloud sync failed: ${error.message}`),
        );
      } else {
        localStorage.setItem(K, JSON.stringify(next));
      }
      return next;
    });

  const login = (u) => {
    if (u.status === "suspended" || u.status === "pending") return;
    setUser(u);
    if (u.username)
      localStorage.setItem("dc-last-username", String(u.username));
    if (u.role === "admin") return;
    if (!cloudConfigured) localStorage.setItem("dc-user", JSON.stringify(u));
    if (u.role !== "admin" && !localStorage.getItem(`dc-onboarded-${u.id}`))
      setOnboarding(true);
  };
  if (authLoading)
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <img src="/assets/datachat-logo.webp" alt="" />
        <b>DataChat</b>
        <span>Opening your secure workspace…</span>
      </div>
    );
  if (!user) return <Auth db={db} save={save} login={login} />;
  const activeUser = db.users.find((x) => x.id === user.id) || user;
  const props = { db, save, user: activeUser, setToast };
  const retryBiometricUnlock = async () => {
    if (biometricPromptRef.current) return;
    setBiometricBusy(true);
    biometricPromptRef.current = true;
    try {
      await authenticateDevice();
      sessionStorage.setItem(
        `dc-biometric-unlocked-${activeUser.id}`,
        "true",
      );
      setBiometricUnlocked(true);
    } catch (error) {
      setToast(error?.message || "Device authentication was cancelled.");
    } finally {
      biometricPromptRef.current = false;
      setBiometricBusy(false);
    }
  };
  const changeBiometricAccess = async (enabled) => {
    if (!isNativeApp())
      return setToast("Biometric access is available in the Android and iOS apps.");
    if (enabled) {
      const info = await BiometricAuth.checkBiometry();
      if (!info.isAvailable && !info.deviceIsSecure)
        throw new Error("Set up a fingerprint, face, or device PIN first.");
      biometricPromptRef.current = true;
      try {
        await authenticateDevice();
      } finally {
        biometricPromptRef.current = false;
      }
      localStorage.setItem(`dc-biometric-${activeUser.id}`, "true");
      sessionStorage.setItem(
        `dc-biometric-unlocked-${activeUser.id}`,
        "true",
      );
      setBiometricAvailable(true);
      setBiometricEnabled(true);
      setBiometricUnlocked(true);
      setToast("Biometric access enabled.");
      return;
    }
    localStorage.removeItem(`dc-biometric-${activeUser.id}`);
    sessionStorage.removeItem(`dc-biometric-unlocked-${activeUser.id}`);
    setBiometricEnabled(false);
    setBiometricUnlocked(true);
    setToast("Biometric access disabled.");
  };
  return (
    <div className="app">
      <Sidebar page={page} setPage={setPage} user={activeUser} />
      <main>
        {page === "home" && <Home {...props} setPage={setPage} />}{" "}
        {page === "portal" && <Portal {...props} setPage={setPage} />}{" "}
        {page === "rates" && activeUser.plan === "Pro" && (
          <RatesMarketplace {...props} setPage={setPage} />
        )}{" "}
        {page === "records" && <Records {...props} />}{" "}
        {page === "reports" && activeUser.plan === "Pro" && <Reports {...props} />}{" "}
        {(page === "rates" || page === "reports") && activeUser.plan !== "Pro" && (
          <PremiumGate
            feature={
              page === "rates"
                ? "Live rates and marketplace"
                : "Financial reports"
            }
            setPage={setPage}
          />
        )}
        {page === "settings" && (
          <Settings
            {...props}
            biometricAvailable={biometricAvailable}
            biometricEnabled={biometricEnabled}
            onBiometricChange={changeBiometricAccess}
            onPlanChanged={(changes) => {
              const next = { ...activeUser, ...changes };
              setUser(next);
              if (!cloudConfigured)
                localStorage.setItem("dc-user", JSON.stringify(next));
            }}
            logout={() => {
              if (cloudConfigured) cloudSignOut().catch(() => {});
              localStorage.removeItem("dc-user");
              sessionStorage.removeItem(
                `dc-biometric-unlocked-${activeUser.id}`,
              );
              setUser(null);
            }}
          />
        )}
      </main>
      <MobileNav page={page} setPage={setPage} user={activeUser} />
      {toast && (
        <div className="toast">
          <Icon name="CheckCircle2" />
          {toast}
        </div>
      )}
      {onboarding && (
        <Onboarding
          user={user}
          close={() => {
            localStorage.setItem(`dc-onboarded-${user.id}`, "true");
            setOnboarding(false);
          }}
        />
      )}
      {biometricEnabled && !biometricUnlocked && (
        <div className="biometric-lock" role="dialog" aria-modal="true">
          <div className="biometric-lock-card">
            <span><Icon name="Fingerprint" size={34} /></span>
            <img src="/assets/datachat-logo.webp" alt="DataChat" />
            <h2>DataChat is locked</h2>
            <p>Authenticate with your fingerprint, face, or device PIN to open your private workspace.</p>
            <button
              className="primary full-btn"
              disabled={biometricBusy}
              onClick={retryBiometricUnlock}
            >
              <Icon name="ScanFace" />
              {biometricBusy ? "Checking…" : "Unlock DataChat"}
            </button>
            <button
              className="secondary full-btn"
              onClick={() => {
                if (cloudConfigured) cloudSignOut().catch(() => {});
                localStorage.removeItem("dc-user");
                sessionStorage.removeItem(
                  `dc-biometric-unlocked-${activeUser.id}`,
                );
                setUser(null);
              }}
            >
              Use username and password
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function LegacyAuth({ db, save, login }) {
  const [mode, setMode] = useState("login"),
    [err, setErr] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      email = f.get("email").trim().toLowerCase(),
      password = f.get("password");
    if (mode === "login") {
      const u = db.users.find(
        (x) => x.email === email && x.password === password,
      );
      if (!u) return setErr("Email or password is incorrect.");
      if (u.role === "admin")
        return setErr(
          "Administrator accounts must use the separate admin portal.",
        );
      login(u);
    } else {
      if (db.users.some((x) => x.email === email))
        return setErr("An account already exists for this email.");
      const u = {
        id: uid("user"),
        name: f.get("name"),
        email,
        password,
        plan: "Free",
      };
      save((d) => ({ ...d, users: [...d.users, u] }));
      login(u);
    }
  };
  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="logo big">
          <Icon name="MessagesSquare" size={30} />
        </div>
        <p className="eyebrow">SECURE FINANCIAL OPERATIONS</p>
        <h1>
          Money records.
          <br />
          <span>Clear conversations.</span>
        </h1>
        <p>
          Manage international transfers, approvals, contacts and reporting from
          one private workspace.
        </p>
        <div className="trust">
          <span>
            <Icon name="ShieldCheck" />
            Private by design
          </span>
          <span>
            <Icon name="Zap" />
            Real-time workflow
          </span>
        </div>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <div className="mobile-brand">
          <div className="logo">
            <Icon name="MessagesSquare" />
          </div>
          DataChat
        </div>
        <h2>{mode === "login" ? "Welcome back" : "Create your workspace"}</h2>
        <p>
          {mode === "login"
            ? "Sign in to continue to DataChat."
            : "Your data is isolated from every other user."}
        </p>
        {mode === "register" && (
          <label>
            Full name
            <input name="name" required placeholder="Your full name" />
          </label>
        )}
        <label>
          Email address
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength="6"
            placeholder="At least 6 characters"
          />
        </label>
        {err && <div className="error">{err}</div>}
        <button className="primary" type="submit">
          {mode === "login" ? "Sign in" : "Create account"}
          <Icon name="ArrowRight" />
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setErr("");
          }}
        >
          {mode === "login"
            ? "New to DataChat? Create account"
            : "Already registered? Sign in"}
        </button>
      </form>
    </div>
  );
}
function Auth({ db, save, login }) {
  const [mode, setMode] = useState(() => {
    const recoveryRequested = localStorage.getItem("dc-open-recovery") === "1";
    if (recoveryRequested) localStorage.removeItem("dc-open-recovery");
    return recoveryRequested ? "recover" : "login";
  });
  const [err, setErr] = useState("");
  const [otpStep, setOtpStep] = useState(null);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [slide, setSlide] = useState(0);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const slides = [
    {
      image: "/assets/welcome-community.webp",
      eyebrow: "CONNECTED COMMUNITY",
      title: "Talk, transfer and stay close.",
      text: "Find trusted people, chat privately, and keep every financial conversation connected to a clear record.",
      icon: "MessagesSquare",
    },
    {
      image: "/assets/welcome-verify.webp",
      eyebrow: "SAFE CASH HANDOFF",
      title: "Verify the right receiver.",
      text: "Receiver-bound QR and text codes reduce mistakes before cash is released.",
      icon: "ScanQrCode",
    },
    {
      image: "/assets/datachat-transfer-ad.webp",
      eyebrow: "CLEAR FINANCIAL RECORDS",
      title: "One place for every transfer.",
      text: "Create transactions, approve pending orders, import or export CSV files, and understand your activity.",
      icon: "ChartNoAxesCombined",
    },
  ];
  useEffect(() => {
    const timer = setInterval(
      () => setSlide((s) => (s + 1) % slides.length),
      6500,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);
  const resendOtp = async () => {
    if (!otpStep || resendIn > 0 || busy) return;
    try {
      setBusy(true);
      setErr("");
      if (otpStep.mode === "recover") {
        await requestEmailOtp(otpStep.email, {}, false);
      } else {
        await resendSignupOtp(otpStep.email);
      }
      setResendIn(60);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(otpStep?.email || f.get("email") || "").trim().toLowerCase();
    const password = String(f.get("password") || "");
    if (cloudConfigured) {
      try {
        setBusy(true);
        setErr("");
        if (otpStep) {
          const result = await verifyEmailOtp(
            email,
            f.get("otp"),
            otpStep.mode === "recover" ? "email" : "signup",
          );
          if (!result?.user) throw new Error("The confirmation code is invalid or expired.");
          if (otpStep.mode === "recover") {
            const updated = await updateCurrentUserPassword(
              otpStep.password,
              otpStep.username,
            );
            if (!updated?.user) throw new Error("The password could not be saved.");
            const cloudDb = await loadCloudDb(updated.user);
            login(cloudDb.users[0]);
            return;
          }
          const cloudDb = await loadCloudDb(result.user);
          login(cloudDb.users[0]);
          return;
        }
        if (mode === "login") {
          const result = await signInWithUsername(f.get("username"), password);
          if (!result?.user) throw new Error("Username or password is incorrect.");
          const cloudDb = await loadCloudDb(result.user);
          login(cloudDb.users[0]);
          return;
        }
        if (mode === "recover") {
          if (password.length < 8)
            throw new Error("Use a password with at least 8 characters.");
          if (password !== f.get("confirmPassword"))
            throw new Error("The passwords do not match.");
          const username = String(f.get("username") || "").trim().toLowerCase();
          await requestEmailOtp(email, {}, false);
          setOtpStep({ email, mode: "recover", username, password });
          setResendIn(60);
          return;
        }
        if (mode === "register" && f.get("agreement") !== "on")
          throw new Error("You must accept the User Access & Privacy Agreement.");
        if (password.length < 8)
          throw new Error("Use a password with at least 8 characters.");
        if (password !== f.get("confirmPassword"))
          throw new Error("The passwords do not match.");
        const metadata = {
          name: f.get("name").trim(),
          username: f.get("username").trim().toLowerCase(),
          phone: f.get("phone").trim(),
          email,
          plan: "Free",
          role: "user",
          status: "active",
          createdAt: new Date().toISOString(),
        };
        const result = await cloudSignUp(email, password, metadata);
        if (result?.session && result?.user?.email_confirmed_at) {
          const cloudDb = await loadCloudDb(result.user);
          login(cloudDb.users[0]);
          return;
        }
        setOtpStep({
          email,
          mode: "register",
        });
        setResendIn(60);
        setErr("");
      } catch (error) {
        setErr(error.message);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "login") {
      const u = db.users.find(
        (x) =>
          (x.username === f.get("username") ||
            x.email === f.get("username")) &&
          x.password === password,
      );
      if (!u) return setErr("Email or password is incorrect.");
      if (u.status === "suspended")
        return setErr("This account is suspended. Contact support.");
      if (u.status === "pending")
        return setErr("This account is waiting for administrator approval.");
      login(u);
    } else {
      if (db.users.some((x) => x.email === email))
        return setErr("An account already exists for this email.");
      if (f.get("agreement") !== "on")
        return setErr("You must accept the User Access & Privacy Agreement.");
      const u = {
        id: uid("user"),
        name: f.get("name"),
        username: f.get("username"),
        email,
        phone: f.get("phone"),
        password,
        plan: "Free",
        role: "user",
        status: "active",
        createdAt: new Date().toISOString(),
      };
      save((d) => ({
        ...d,
        users: [...d.users, u],
      }));
      login(u);
    }
  };
  const item = slides[slide];
  return (
    <div className="welcome">
      <section
        className="welcome-story"
        style={{
          backgroundImage: `linear-gradient(90deg,#06101fe8 0%,#06101f88 48%,#06101f12 100%),url(${item.image})`,
        }}
      >
        <div className="welcome-top">
          <div className="brand">
            <div className="logo">
              <img src="/assets/datachat-logo.webp" alt="DataChat" />
            </div>
            <b>DataChat</b>
          </div>
          <span>
            <Icon name="ShieldCheck" />
            Private financial community
          </span>
        </div>
        <div className="welcome-copy" key={slide}>
          <span className="story-icon">
            <Icon name={item.icon} size={24} />
          </span>
          <p className="eyebrow">{item.eyebrow}</p>
          <h1>{item.title}</h1>
          <p>{item.text}</p>
          <div className="story-dots" aria-label="Welcome slides">
            {slides.map((x, i) => (
              <button
                key={x.title}
                aria-label={`Show slide ${i + 1}`}
                className={i === slide ? "on" : ""}
                onClick={() => setSlide(i)}
              />
            ))}
          </div>
        </div>
        <div className="welcome-proof">
          <span>
            <b>Private</b>
            <small>User-isolated records</small>
          </span>
          <span>
            <b>Safer</b>
            <small>Report and block controls</small>
          </span>
          <span>
            <b>Portable</b>
            <small>CSV import and export</small>
          </span>
        </div>
      </section>
      <section className="welcome-access">
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">
            {mode === "login"
              ? "WELCOME BACK"
              : mode === "recover"
                ? "PASSWORD RECOVERY"
                : "JOIN DATACHAT"}
          </p>
          <h2>
            {mode === "login"
              ? "Sign in to your workspace"
              : mode === "recover"
                ? "Recover your password"
                : "Create your private workspace"}
          </h2>
          <p>
            {mode === "login"
              ? "Continue your conversations and financial records."
              : mode === "recover"
                ? "Confirm the code sent to your email, then save a new password."
                : "New accounts begin with completely separate data and a short guided tour."}
          </p>
          {mode === "register" && !otpStep && (
            <>
              <label>
                Full name
                <input name="name" required placeholder="Your full name" />
              </label>
              <label>
                Phone number
                <input name="phone" type="tel" required autoComplete="tel" placeholder="+971 50 123 4567" />
              </label>
              <label>
                Username
                <input name="username" required autoComplete="username" pattern="[A-Za-z0-9._-]{3,24}" placeholder="Choose a username" />
              </label>
            </>
          )}
          {(mode === "login" || mode === "recover") && !otpStep && <label>
            Username
            <input name="username" required autoComplete="username" pattern="[A-Za-z0-9._-]{3,24}" defaultValue={mode === "login" ? localStorage.getItem("dc-last-username") || "" : ""} placeholder={mode === "recover" ? "Your username" : "Your username"} />
          </label>}
          {(mode === "register" || mode === "recover") && !otpStep && <label>
            Email address
            <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
          </label>}
          {mode === "register" && !otpStep && (
            <label className="check-row agreement-check">
              <input type="checkbox" name="agreement" required />
              <span>
                I have read and accept the{" "}
                <button type="button" onClick={() => setAgreementOpen(true)}>
                  User Access & Privacy Agreement
                </button>
                .
              </span>
            </label>
          )}
          {otpStep ? (
            <div className="otp-field-group"><label>
              Email confirmation code
              <input name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" minLength="8" maxLength="8" required autoFocus placeholder="Enter 8 digits" />
              <small>Enter the eight-digit code sent to {otpStep.email}.</small>
            </label><button type="button" className="secondary resend-otp" disabled={resendIn > 0 || busy} onClick={resendOtp}><Icon name="RefreshCw" />{resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}</button></div>
          ) : (
            <>
            <label>
              Password
              <span className="password-field"><input name="password" type={showPassword ? "text" : "password"} required minLength={mode === "login" ? 6 : 8} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Your password" : "At least 8 characters"} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}><Icon name={showPassword ? "EyeOff" : "Eye"} /></button></span>
            </label>
            {mode !== "login" && <label>
              Confirm password
              <input name="confirmPassword" type={showPassword ? "text" : "password"} required minLength="8" autoComplete="new-password" placeholder="Repeat your password" />
            </label>}
            </>
          )}
          {err && <div className="error">{err}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : otpStep ? "Confirm and continue" : mode === "login" ? "Sign in" : mode === "recover" ? "Send one-time code" : "Create free account"}
            <Icon name="ArrowRight" />
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setOtpStep(null);
              setResendIn(0);
              setErr("");
            }}
          >
            {mode === "login"
              ? "First time here? Create an account"
              : "Already have an account? Sign in"}
          </button>
          {mode === "login" && (
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode("recover");
                setOtpStep(null);
                setErr("");
              }}
            >
              Forgot password? Send recovery code
            </button>
          )}
          {mode === "register" && db.adminConfig?.paymentUrl && false && (
            <a
              className="payment-link"
              href={db.adminConfig.paymentUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="CreditCard" />
              Pay online to request an access code
            </a>
          )}
          <small className="auth-legal">
            <Icon name="LockKeyhole" />
            By continuing, you agree to use DataChat lawfully and protect other
            members' privacy.
          </small>
        </form>
      </section>
      {agreementOpen && (
        <AccessAgreement
          close={() => setAgreementOpen(false)}
          config={db.adminConfig}
        />
      )}
    </div>
  );
}
function Onboarding({ user, close }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      icon: "Sparkles",
      title: `Welcome, ${user.name.split(" ")[0]}`,
      text: "This is your private DataChat workspace. Your contacts, messages, and records are separated from every other account.",
    },
    {
      icon: "MessagesSquare",
      title: "Connect with people",
      text: "Use the Community portal to discover members, add a trusted contact, and begin a conversation.",
    },
    {
      icon: "ShieldCheck",
      title: "Verify before cash release",
      text: "Generate a receiver-bound claim code for each transfer. Validate the complete QR or text code—not only the six digits.",
    },
    {
      icon: "Flag",
      title: "Keep the community safe",
      text: "Every chat includes report and block controls. Reports save the reason and recent conversation context for review.",
    },
  ];
  const item = steps[step];
  return (
    <div className="scrim onboarding-scrim">
      <section className="onboarding" role="dialog" aria-modal="true">
        <button className="skip" onClick={close}>
          Skip tour
        </button>
        <div className="onboard-visual">
          <div className="onboard-rings">
            <span>
              <Icon name={item.icon} size={42} />
            </span>
          </div>
        </div>
        <div className="onboard-copy">
          <p className="eyebrow">
            GETTING STARTED · {step + 1} OF {steps.length}
          </p>
          <h2>{item.title}</h2>
          <p>{item.text}</p>
          <div className="onboard-dots">
            {steps.map((x, i) => (
              <i key={x.title} className={i === step ? "on" : ""} />
            ))}
          </div>
          <div className="onboard-actions">
            <button
              className="secondary"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              <Icon name="ArrowLeft" />
              Back
            </button>
            <button
              className="primary"
              onClick={() =>
                step === steps.length - 1 ? close() : setStep(step + 1)
              }
            >
              {step === steps.length - 1 ? "Open DataChat" : "Continue"}
              <Icon name={step === steps.length - 1 ? "Check" : "ArrowRight"} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
function AccessAgreement({ close, config }) {
  return (
    <Modal title="User Access & Privacy Agreement" close={close} wide>
      <div className="legal access-agreement">
        <p>Effective July 18, 2026 · Please read before creating an account.</p>
        <h3>1. Account administration</h3>
        <p>
          DataChat administrators may view account metadata needed to operate
          access: your name, email address, account status, plan, registration
          date, access-code history, and support information. Administrators may
          approve, suspend, or change account access.
        </p>
        <h3>2. Private workspace content</h3>
        <p>
          Administrators are not authorized through the admin dashboard to read
          your messages, contacts, financial records, transaction security keys,
          or backup contents. Those remain private to the signed-in user
          account. Production deployment must enforce this boundary on the
          server, not only in the interface.
        </p>
        <h3>3. Payments and access codes</h3>
        <p>
          Online payments may use the payment link configured by the
          administrator. For approved cash payments, an administrator may issue
          a random one-time code. Codes can be redeemed once, may expire, and
          must not be purchased from an unauthorized person.
        </p>
        <h3>4. Backups</h3>
        <p>
          You are responsible for keeping a recovery password and backup copy
          safe. Encrypted backups can be downloaded to your phone or shared
          through supported device apps such as Drive or Gmail. DataChat cannot
          recover a forgotten backup password.
        </p>
        <h3>5. Financial and community responsibility</h3>
        <p>
          DataChat is a communication and recordkeeping tool, not a bank or
          money transmitter. Verify identities, rates, fees, payment
          instructions, and legal requirements independently. Fraud, harassment,
          sanctions evasion, and unlawful activity are prohibited.
        </p>
        <h3>6. Links and consent</h3>
        <p>
          Repository: {config?.repositoryUrl || "Not configured"}. Payment links
          and external services have their own terms. By creating an account,
          you acknowledge this agreement and consent to the limited
          administrative access described above.
        </p>
        <button className="primary full-btn" onClick={close}>
          I understand
        </button>
      </div>
    </Modal>
  );
}
const nav = [
  ["admin", "ShieldCheck", "Admin"],
  ["home", "MessagesSquare", "Messages"],
  ["portal", "UsersRound", "Community"],
  ["rates", "BadgeDollarSign", "Rates"],
  ["records", "TableProperties", "Transactions"],
  ["reports", "ChartNoAxesCombined", "Reports"],
  ["settings", "Settings", "Settings"],
];
function Sidebar({ page, setPage, user }) {
  const visibleNav =
    user.role === "admin"
      ? nav.filter(([p]) => p === "admin" || p === "settings")
      : nav.filter(([p]) => p !== "admin");
  return (
    <aside>
      <div className="brand">
        <div className="logo">
          <img src="/assets/datachat-logo.webp" alt="DataChat" />
        </div>
        <b>DataChat</b>
      </div>
      <nav>
        {visibleNav.map(([p, i, l]) => (
          <button
            key={p}
            className={page === p ? "active" : ""}
            onClick={() => setPage(p)}
          >
            <Icon name={i} />
            <span>{l}</span>
          </button>
        ))}
      </nav>
      <div className="side-user">
        <UserAvatar person={user} />
        <div>
          <b>{user.name}</b>
          <small>{user.plan} workspace</small>
        </div>
      </div>
    </aside>
  );
}
function UserAvatar({ person, large = false }) {
  const initials =
    person?.name
      ?.split(" ")
      .map((x) => x[0])
      .slice(0, 2)
      .join("") || "U";
  return (
    <div
      className={`avatar ${large ? "large" : ""} ${person?.profilePhoto ? "has-photo" : ""}`}
    >
      {person?.profilePhoto ? (
        <img src={person.profilePhoto} alt={`${person.name} profile`} />
      ) : (
        initials
      )}
    </div>
  );
}
function MobileNav({ page, setPage, user }) {
  const mobileNav =
    user?.role === "admin"
      ? nav.filter(([p]) => p === "admin" || p === "settings")
      : nav.filter(([p]) => p !== "reports" && p !== "admin");
  return (
    <div className="mobile-nav">
      {mobileNav.map(([p, i, l]) => (
        <button
          key={p}
          className={page === p ? "active" : ""}
          onClick={() => setPage(p)}
        >
          <Icon name={i} />
          <small>{l}</small>
        </button>
      ))}
    </div>
  );
}
function Header({ title, sub, actions }) {
  return (
    <header>
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <div className="actions">{actions}</div>
    </header>
  );
}
function PremiumGate({ feature, setPage }) {
  return (
    <div className="page">
      <section className="panel premium-gate">
        <span>
          <Icon name="Crown" size={30} />
        </span>
        <p className="eyebrow">PRO FEATURE</p>
        <h1>{feature}</h1>
        <p>
          This area is reserved for Pro workspaces. Redeem a Pro access code or
          contact the administrator to upgrade.
        </p>
        <button className="primary" onClick={() => setPage("settings")}>
          <Icon name="ArrowRight" />
          Open account settings
        </button>
      </section>
    </div>
  );
}
function RatesMarketplace({ db, save, user, setToast, setPage }) {
  const [base, setBase] = useState("USD");
  const [market, setMarket] = useState("UAE");
  const [assets, setAssets] = useState({
    metals: [],
    crypto: [],
    loading: true,
    error: "",
  });
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [add, setAdd] = useState(null);
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const marketOptions = {
    UAE: { currency: "AED", label: "Dubai / UAE" },
    USA: { currency: "USD", label: "United States" },
    UK: { currency: "GBP", label: "United Kingdom" },
    Europe: { currency: "EUR", label: "Europe" },
    India: { currency: "INR", label: "India" },
  };
  useEffect(() => {
    const currency = marketOptions[market].currency.toLowerCase();
    const controller = new AbortController();
    setAssets((x) => ({ ...x, loading: true, error: "" }));
    Promise.allSettled([
      getMetalPrice("XAU", { signal: controller.signal }),
      getMetalPrice("XAG", { signal: controller.signal }),
      getCryptoPrices(currency, { signal: controller.signal }),
      currency === "usd"
        ? Promise.resolve({ rates: { USD: 1 } })
        : getFxRates("USD", [currency.toUpperCase()], {
            signal: controller.signal,
          }),
    ]).then(([gold, silver, crypto, fx]) => {
      const conversion =
        fx.status === "fulfilled"
          ? fx.value.rates?.[currency.toUpperCase()] || 1
          : 1;
      const metalRows = [
        ["Gold", "XAU", gold],
        ["Silver", "XAG", silver],
      ].flatMap(([name, symbol, result]) =>
        result.status === "fulfilled"
          ? [
              {
                name,
                symbol,
                value: Number(result.value.price) * conversion,
                unit: "troy oz",
              },
            ]
          : [],
      );
      const names = {
        bitcoin: ["Bitcoin", "BTC"],
        ethereum: ["Ethereum", "ETH"],
        solana: ["Solana", "SOL"],
        tether: ["Tether", "USDT"],
      };
      const cryptoRows =
        crypto.status === "fulfilled"
          ? Object.entries(crypto.value).map(([id, quote]) => ({
              name: names[id][0],
              symbol: names[id][1],
              value: quote[currency],
              change: quote[`${currency}_24h_change`],
            }))
          : [];
      setAssets({
        metals: metalRows,
        crypto: cryptoRows,
        loading: false,
        error:
          !metalRows.length || !cryptoRows.length
            ? "One market source is temporarily unavailable; available quotes are shown."
            : "",
      });
    });
    return () => controller.abort();
  }, [market, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getFxRates(
      base,
      [
        "USD",
        "EUR",
        "GBP",
        "CAD",
        "JPY",
        "CHF",
        "TRY",
        "AUD",
        "CNY",
        "AED",
        "SAR",
        "INR",
      ],
      { signal: controller.signal },
    )
      .then((data) => {
        setLive(data);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(
            "Live reference rates could not be loaded. Try again shortly.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [base, refresh]);
  const offers = db.rateOffers || [];
  const visible = offers.filter((x) =>
    (x.provider + x.fromCurrency + x.toCurrency + x.instrument + x.location)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const messageProvider = (offer) => {
    const contact = db.contacts.find(
      (x) =>
        x.owner === user.id &&
        (x.phone === offer.contact || x.rateProvider === offer.provider),
    );
    const orderText = `Rate order inquiry: ${offer.side} ${offer.fromCurrency}/${offer.toCurrency} at ${offer.rate}. Instrument: ${offer.instrument}. Please confirm availability, fees, and final amount.`;
    if (!contact) {
      navigator.clipboard?.writeText(
        `${orderText}\nProvider contact: ${offer.contact}`,
      );
      setToast(
        "Inquiry copied. Add this provider through Community or their QR before messaging.",
      );
      return;
    }
    save((d) => ({
      ...d,
      messages: [
        ...d.messages,
        {
          id: uid("m"),
          owner: user.id,
          contact: contact.id,
          sender: "me",
          content: orderText,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ],
    }));
    setToast("Order inquiry added to messages");
    setPage("home");
  };
  const rateEntries = live
    ? Object.entries(live.rates).filter(([code]) => code !== base)
    : [];
  return (
    <div className="page rates-page">
      <Header
        title="Rates marketplace"
        sub="Compare official reference rates with offers posted by community providers"
        actions={
          <button
            className="primary"
            onClick={() =>
              user.plan === "Pro"
                ? setAdd({})
                : setToast("Publishing rates is a Pro feature")
            }
          >
            <Icon name="Plus" />
            List your rate
          </button>
        }
      />
      <section className="rate-hero">
        <div>
          <span className="eyebrow">LIVE REFERENCE MARKET</span>
          <h2>
            Know the reference.
            <br />
            <span>Choose your offer.</span>
          </h2>
          <p>
            Use reference rates to compare; contact providers directly to
            confirm the executable rate, fees, settlement time, and
            availability.
          </p>
        </div>
        <div className="rate-converter">
          <label>
            Base currency
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
            </select>
          </label>
          <div>
            <small>Source</small>
            <b>Official-provider reference data</b>
          </div>
          <div>
            <small>Publication date</small>
            <b>{live?.date || "Loading…"}</b>
          </div>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>Reference exchange rates</h2>
          <p>1 {base} equals the values below</p>
        </div>
        <span className="live-pill">
          <i />
          {loading ? "Updating" : "Latest published"}
        </span>
      </div>
      <section className="asset-market panel">
        <div className="asset-market-head">
          <div>
            <span className="eyebrow">METALS & CRYPTO</span>
            <h2>Global spot reference</h2>
            <p>
              Select a market currency. Dubai selection displays global spot
              converted to AED, not a local jewellery retail quote.
            </p>
          </div>
          <label>
            Market / country
            <select value={market} onChange={(e) => setMarket(e.target.value)}>
              {Object.entries(marketOptions).map(([key, x]) => (
                <option key={key} value={key}>
                  {x.label} · {x.currency}
                </option>
              ))}
            </select>
          </label>
        </div>
        {assets.error && (
          <div className="market-notice">
            <Icon name="CircleAlert" />
            {assets.error}
          </div>
        )}
        <div className="asset-groups">
          <div>
            <h3>
              <Icon name="Gem" />
              Precious metals
            </h3>
            {assets.loading ? (
              <div className="rate-skeleton" />
            ) : (
              assets.metals.map((x) => (
                <article className="asset-quote" key={x.symbol}>
                  <span>
                    <b>{x.name}</b>
                    <small>
                      {x.symbol} · per {x.unit}
                    </small>
                  </span>
                  <strong>
                    {Number(x.value).toLocaleString(undefined, {
                      style: "currency",
                      currency: marketOptions[market].currency,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </article>
              ))
            )}
          </div>
          <div>
            <h3>
              <Icon name="Bitcoin" />
              Cryptocurrencies
            </h3>
            {assets.loading ? (
              <div className="rate-skeleton" />
            ) : (
              assets.crypto.map((x) => (
                <article className="asset-quote" key={x.symbol}>
                  <span>
                    <b>{x.name}</b>
                    <small>{x.symbol}</small>
                  </span>
                  <strong>
                    {Number(x.value).toLocaleString(undefined, {
                      style: "currency",
                      currency: marketOptions[market].currency,
                      maximumFractionDigits: x.value < 10 ? 4 : 2,
                    })}
                    <small
                      className={(x.change || 0) >= 0 ? "positive" : "negative"}
                    >
                      {Number(x.change || 0).toFixed(2)}%
                    </small>
                  </strong>
                </article>
              ))
            )}
          </div>
        </div>
        <footer>
          Sources: Gold API (XAU/XAG), CoinGecko global averages, and
          Frankfurter currency conversion. Reference only.
        </footer>
      </section>
      {error && (
        <div className="error rate-error" role="alert">
          <Icon name="CircleAlert" />
          {error}
          <button onClick={() => setRefresh((x) => x + 1)}>Retry</button>
        </div>
      )}
      <div className="reference-grid" aria-live="polite">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div className="rate-skeleton" key={i} />
            ))
          : rateEntries.map(([code, value]) => (
              <article key={code} className="reference-card">
                <span>{code}</span>
                <b className="mono">
                  {Number(value).toLocaleString(undefined, {
                    maximumFractionDigits: 5,
                  })}
                </b>
                <small>per 1 {base}</small>
              </article>
            ))}
      </div>
      <div className="market-head">
        <div>
          <span className="eyebrow">COMMUNITY MARKETPLACE</span>
          <h2>Provider offers</h2>
          <p>
            Rates and terms posted by members. Verify identity and terms before
            ordering.
          </p>
        </div>
        <div className="search">
          <Icon name="Search" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search currency, provider or instrument"
          />
        </div>
      </div>
      <div className="offer-list">
        {visible.map((offer) => (
          <article className="offer-card" key={offer.id}>
            <div className="offer-provider">
              <div
                className="avatar"
                style={{ background: offer.verified ? "#35a57a" : "#4c5d77" }}
              >
                {offer.provider
                  .split(" ")
                  .map((x) => x[0])
                  .slice(0, 2)}
              </div>
              <div>
                <h3>
                  {offer.provider}
                  {offer.verified && <Icon name="BadgeCheck" size={16} />}
                </h3>
                <span>
                  {offer.location} · {offer.contact}
                </span>
              </div>
              <small className="user-posted">User posted</small>
            </div>
            <div className="offer-pair">
              <span>{offer.side}</span>
              <b>
                {offer.fromCurrency} <Icon name="ArrowRight" size={16} />{" "}
                {offer.toCurrency}
              </b>
              <strong className="mono">{offer.rate}</strong>
            </div>
            <div className="offer-terms">
              <span>
                <Icon name="Landmark" />
                {offer.instrument}
              </span>
              <span>
                <Icon name="MoveHorizontal" />
                {offer.min}–{offer.max} {offer.fromCurrency}
              </span>
              <p>{offer.note}</p>
            </div>
            <button className="primary" onClick={() => messageProvider(offer)}>
              <Icon name="MessageCircle" />
              Message & place order
            </button>
            {offer.owner === user.id && (
              <button className="secondary" onClick={() => setAdd(offer)}>
                <Icon name="Pencil" />
                Update today’s rate
              </button>
            )}
          </article>
        ))}
      </div>
      <div className="rate-disclaimer">
        <Icon name="ShieldAlert" />
        <div>
          <b>Reference rates are not guaranteed transaction prices</b>
          <p>
            Rates can change and community offers are submitted by users.
            DataChat does not hold funds or guarantee a provider. Confirm
            identity, fees, final payout, timing, and local legal requirements
            before sending money.
          </p>
        </div>
      </div>
      {add && (
        <RateOfferModal
          user={user}
          save={save}
          existing={add?.id ? add : null}
          close={() => setAdd(false)}
          setToast={setToast}
        />
      )}
    </div>
  );
}
function RateOfferModal({ user, save, existing, close, setToast }) {
  const submit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const offer = {
      ...f,
      id: existing?.id || uid("offer"),
      owner: user.id,
      rate: +f.rate,
      min: +f.min,
      max: +f.max,
      verified: false,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rateDate: new Date().toISOString().slice(0, 10),
    };
    save((d) => ({
      ...d,
      rateOffers: [
        ...(d.rateOffers || []).filter((item) => item.id !== offer.id),
        offer,
      ],
    }));
    setToast(existing ? "Today’s rate was updated" : "Your market rate was published");
    close();
  };
  const currencies = useCurrencyCodes(true);
  return (
    <Modal title={existing ? "Update today’s market rate" : "Publish a market rate"} close={close} wide>
      <form className="form grid rate-form" onSubmit={submit}>
        <div className="full premium-note">
          <Icon name="Crown" />
          <div>
            <b>Pro marketplace listing</b>
            <small>
              Your contact information and terms will be visible to signed-in
              members.
            </small>
          </div>
        </div>
        <label>
          Provider or display name
          <input name="provider" required defaultValue={existing?.provider || user.name} />
        </label>
        <label>
          Contact information
          <input
            name="contact"
            required
            defaultValue={existing?.contact || ""}
            placeholder="Phone, email or @username"
          />
        </label>
        <label>
          Location
          <input name="location" required defaultValue={existing?.location || ""} placeholder="City, country" />
        </label>
        <label>
          Offer type
          <select name="side" defaultValue={existing?.side || "Sell"}>
            <option>Sell</option>
            <option>Buy</option>
            <option>Exchange</option>
          </select>
        </label>
        <label>
          From currency
          <select name="fromCurrency" defaultValue={existing?.fromCurrency || "USD"}>
            {currencies.map((x) => (
              <option key={x} value={x}>{currencyLabel(x)}</option>
            ))}
          </select>
        </label>
        <label>
          To currency
          <select name="toCurrency" defaultValue={existing?.toCurrency || "ETB"}>
            {currencies.map((x) => (
              <option key={x} value={x}>{currencyLabel(x)}</option>
            ))}
          </select>
        </label>
        <label>
          Rate
          <input
            name="rate"
            type="number"
            min=".000001"
            step=".000001"
            required
            defaultValue={existing?.rate ?? ""}
            placeholder="e.g. 151.50"
          />
        </label>
        <label>
          Minimum amount
          <input name="min" type="number" min="0" required defaultValue={existing?.min ?? ""} />
        </label>
        <label>
          Maximum amount
          <input name="max" type="number" min="0" required defaultValue={existing?.max ?? ""} />
        </label>
        <label>
          Financial instrument
          <select name="instrument" defaultValue={existing?.instrument || "Bank transfer"}>
            <option>Bank transfer</option>
            <option>Cash pickup</option>
            <option>Mobile money</option>
            <option>Debit or credit card</option>
            <option>Digital wallet</option>
            <option>Stablecoin settlement</option>
            <option>Other</option>
          </select>
        </label>
        <label className="full">
          Terms and notes
          <textarea
            name="note"
            required
            defaultValue={existing?.note || ""}
            placeholder="Fees, availability, settlement timing and identification requirements."
          />
        </label>
        <div className="full listing-consent">
          <Icon name="Info" />
          <span>
            I confirm this information is accurate and understand that members
            will contact me directly to confirm an order.
          </span>
        </div>
        <div className="full modal-actions">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button className="primary">
            <Icon name="Send" />
            {existing ? "Save updated rate" : "Publish rate"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Portal({ db, save, user, setToast, setPage }) {
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("All");
  const [busyMember, setBusyMember] = useState(null);
  const contacts = db.contacts.filter((contact) => contact.owner === user.id);
  const directory = (db.communityDirectory || []).filter(
    (profile) => profile.id !== user.id,
  );
  const incomingRequests = (db.contactRequests || []).filter(
    (request) =>
      request.recipient_id === user.id && request.status === "pending",
  );
  const countriesInPortal = [
    "All",
    ...new Set(directory.map((profile) => profile.country).filter(Boolean)),
  ];
  const visible = directory.filter(
    (profile) =>
      `${profile.display_name} ${profile.username} ${profile.country}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (country === "All" || profile.country === country),
  );
  const profileToContact = (profile) => ({
    id: `contact-${profile.id}`,
    owner: user.id,
    remoteUserId: profile.id,
    name: profile.display_name,
    username: profile.username,
    phone: "",
    country: profile.country || "Global",
    profilePhoto: profile.avatar_url || null,
    color: "#35a57a",
    source: "request",
    createdAt: new Date().toISOString(),
  });
  const requestContact = async (profile) => {
    setBusyMember(profile.id);
    try {
      const request = await sendContactRequest(profile.id);
      save((state) => ({
        ...state,
        contactRequests: [
          request,
          ...(state.contactRequests || []).filter(
            (item) => item.id !== request.id,
          ),
        ],
      }));
      setToast(`Contact request sent to ${profile.display_name}`);
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusyMember(null);
    }
  };
  const respond = async (request, accept) => {
    setBusyMember(request.id);
    try {
      await respondContactRequest(request.id, accept);
      const profile = directory.find(
        (item) => item.id === request.requester_id,
      );
      save((state) => ({
        ...state,
        contactRequests: (state.contactRequests || []).map((item) =>
          item.id === request.id
            ? { ...item, status: accept ? "accepted" : "rejected" }
            : item,
        ),
        contacts:
          accept &&
          profile &&
          !state.contacts.some(
            (contact) => contact.remoteUserId === profile.id,
          )
            ? [...state.contacts, profileToContact(profile)]
            : state.contacts,
      }));
      setToast(accept ? "Contact request accepted" : "Contact request rejected");
    } catch (error) {
      setToast(`Request update failed: ${error.message}`);
    } finally {
      setBusyMember(null);
    }
  };
  return (
    <div className="page portal-page">
      <section className="portal-hero">
        <div>
          <span className="eyebrow">DATACHAT COMMUNITY</span>
          <h1>
            Find people. Build trust.
            <br />
            <span>Chat with confidence.</span>
          </h1>
          <p>
            Only members who choose to be visible appear here. Private members
            can still share their secure contact QR directly.
          </p>
          <div className="portal-trust">
            <span><Icon name="BadgeCheck" />Verified profiles</span>
            <span><Icon name="UserRoundCheck" />Request approval</span>
            <span><Icon name="LockKeyhole" />Private contact lists</span>
          </div>
        </div>
        <div className="portal-orbit" aria-hidden="true">
          <div className="orbit-center"><Icon name="UsersRound" size={30} /></div>
          {directory.slice(0, 4).map((profile, index) => (
            <div
              key={profile.id}
              className={`orbit-user orbit-${index + 1}`}
              style={{ background: "#35a57a" }}
            >
              {profile.display_name.split(" ").map((name) => name[0]).join("")}
            </div>
          ))}
        </div>
      </section>
      <div className="portal-toolbar">
        <div className="search">
          <Icon name="Search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people, username or country"
          />
        </div>
        <select
          value={country}
          onChange={(event) => setCountry(event.target.value)}
          aria-label="Filter community by country"
        >
          {countriesInPortal.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      {incomingRequests.length > 0 && (
        <section className="panel contact-request-panel">
          <div className="panel-title">
            <div><h2>Contact requests</h2><p>Approve only people you recognize.</p></div>
            <span className="badge pending">{incomingRequests.length}</span>
          </div>
          <div className="contact-request-list">
            {incomingRequests.map((request) => {
              const profile = directory.find(
                (item) => item.id === request.requester_id,
              );
              return (
                <article key={request.id}>
                  <UserAvatar person={{
                    name: profile?.display_name || "DataChat member",
                    profilePhoto: profile?.avatar_url,
                    color: "#4c8ed9",
                  }} />
                  <div><b>{profile?.display_name || "DataChat member"}</b><small>@{profile?.username || "member"}</small></div>
                  <button className="secondary" disabled={busyMember === request.id} onClick={() => respond(request, false)}>Reject</button>
                  <button className="primary" disabled={busyMember === request.id} onClick={() => respond(request, true)}>Accept</button>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <div className="member-grid">
        {visible.map((profile) => {
          const contact = contacts.find(
            (item) => item.remoteUserId === profile.id,
          );
          const pending = (db.contactRequests || []).some(
            (request) =>
              request.requester_id === user.id &&
              request.recipient_id === profile.id &&
              request.status === "pending",
          );
          return (
            <article className="member-card" key={profile.id}>
              <div className="member-cover">
                <span className="online-label"><i />Community</span>
              </div>
              <div className="member-avatar" style={{ background: "#35a57a" }}>
                {profile.display_name.split(" ").map((name) => name[0]).join("")}
              </div>
              <div className="member-info">
                <h3>{profile.display_name}<Icon name="BadgeCheck" size={17} /></h3>
                <span>@{profile.username} · {profile.country}</span>
                <p>{profile.plan === "Pro" ? "Verified Pro member" : "Community member"}</p>
                <button
                  className={contact ? "primary" : "secondary"}
                  disabled={pending || busyMember === profile.id}
                  onClick={() => {
                    if (contact) {
                      setPage("home");
                      setToast(`Opening your conversation with ${contact.name}`);
                    } else {
                      requestContact(profile);
                    }
                  }}
                >
                  <Icon name={contact ? "MessageCircle" : "UserPlus"} />
                  {contact ? "Open chat" : pending ? "Request sent" : "Add contact"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <Empty
          icon="Users"
          title="No visible members"
          text="No community members match this search. Hidden members can still be added using their QR code."
        />
      )}
      <div className="portal-notice">
        <Icon name="Info" />
        <div>
          <b>Visibility is controlled by each member</b>
          <p>Hidden accounts never appear in discovery, but their exact DataChat QR remains usable.</p>
        </div>
      </div>
      <CommunityManager db={db} save={save} user={user} setToast={setToast} />
    </div>
  );
}
function CommunityManager({ db, save, user, setToast }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [manage, setManage] = useState(null);
  const communities = db.communities || [];
  const visibleCommunities = communities.filter((x) => !x.isAdminRoot);
  const eligibleParents = visibleCommunities.filter(
    (x) =>
      x.permissions?.allowSubgroups &&
      (x.members || []).includes(user.id),
  );
  const hierarchyFor = (community) => {
    const path = [];
    const visited = new Set();
    let current = community;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift(current);
      current = visibleCommunities.find((item) => item.id === current.parentId);
    }
    return path;
  };
  const createGroup = async (e) => {
    e.preventDefault();
    if (user.plan !== "Pro")
      return setToast("Only Pro members can create communities.");
    if (cloudConfigured && !user.emailVerified)
      return setToast("Verify your email before creating a community.");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const parent = visibleCommunities.find((x) => x.id === f.parentId) || null;
    const group = {
      id: uid("community"),
      name: f.name,
      location: f.location,
      purpose: f.purpose,
      parentId: parent?.id || null,
      level: parent ? (parent.level || 0) + 1 : 0,
      createdBy: user.id,
      permissions: {
        allowSubgroups: f.allowSubgroups === "on",
        allowInvites: true,
      },
      members: [user.id],
      contactMembers: [],
      admins: [user.id],
      createdAt: new Date().toISOString(),
    };
    try {
      if (cloudConfigured) {
        const created = await createCloudCommunity({
          ...group,
          allowSubgroups: group.permissions.allowSubgroups,
        });
        group.id = created.id;
      }
      save((d) => ({
        ...d,
        communities: [...(d.communities || []), group],
      }));
      setToast(
        parent
          ? `${group.name} created under ${parent.name}`
          : `${group.name} community created`,
      );
      setCreateOpen(false);
    } catch (error) {
      setToast(`Community creation failed: ${error.message}`);
    }
  };
  const join = async (group) => {
    try {
      if (cloudConfigured) await requestCloudCommunityJoin(group.id);
    save((d) => ({
      ...d,
      communities: d.communities.map((x) =>
        x.id === group.id
          ? { ...x, joinRequests: [...(x.joinRequests || []).filter((request) => request.userId !== user.id), { userId: user.id, name: user.name, email: user.email, status: "pending", requestedAt: new Date().toISOString() }] }
          : x,
      ),
    }));
    setToast(`Join request sent to the owner of ${group.name}`);
    } catch (error) {
      setToast(`Join request failed: ${error.message}`);
    }
  };
  const decideJoin = async (groupId, requesterId, approved) => {
    try {
      if (cloudConfigured)
        await decideCloudCommunityJoin(groupId, requesterId, approved);
    save((d) => ({ ...d, communities: d.communities.map((x) => x.id !== groupId ? x : ({
      ...x,
      members: approved ? [...new Set([...(x.members || []), requesterId])] : (x.members || []),
      joinRequests: (x.joinRequests || []).map((request) => request.userId === requesterId ? { ...request, status: approved ? "approved" : "declined", decidedAt: new Date().toISOString() } : request),
    })) }));
    setToast(approved ? "Join request approved" : "Join request declined");
    } catch (error) {
      setToast(`Approval failed: ${error.message}`);
    }
  };
  const saveMembers = (e) => {
    e.preventDefault();
    const chosen = new FormData(e.currentTarget).getAll("contacts");
    save((d) => ({
      ...d,
      communities: d.communities.map((x) =>
        x.id === manage.id
          ? {
              ...x,
              contactMembers: [
                ...new Set([...(x.contactMembers || []), ...chosen]),
              ],
            }
          : x,
      ),
    }));
    setToast("Community invitations updated");
    setManage(null);
  };
  return (
    <section className="community-hub">
      <div className="community-title">
        <div>
          <span className="eyebrow">COMMUNITY HIERARCHY</span>
          <h2>Your communities</h2>
          <p>
            Create an independent community, or place a subgroup beneath a
            community where you are already an approved member.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => setCreateOpen(true)}
          disabled={
            user.plan !== "Pro" ||
            (cloudConfigured && !user.emailVerified)
          }
        >
          <Icon name="UsersRound" />
          Create community
        </button>
        {user.plan !== "Pro" && (
          <small>Community creation is available to verified Pro members.</small>
        )}
      </div>
      <div className="community-tree">
        {visibleCommunities.map((group) => {
          const parent = visibleCommunities.find((x) => x.id === group.parentId);
          const hierarchy = hierarchyFor(group);
          const isMember = (group.members || []).includes(user.id);
          const pendingRequest = (group.joinRequests || []).some((request) => request.userId === user.id && request.status === "pending");
          const canManage =
            (group.admins || []).includes(user.id) ||
            group.createdBy === user.id;
          return (
            <article
              key={group.id}
              style={{ "--depth": Math.min(hierarchy.length - 1, 3) }}
            >
              <div className="community-path">
                {parent ? (
                  <>
                    <Icon name="CornerDownRight" />
                    {hierarchy.map((item) => item.name).join(" › ")}
                  </>
                ) : (
                  <>
                    <Icon name="Network" />
                    Independent community
                  </>
                )}
              </div>
              <div className="community-main">
                <span className="community-icon">
                  <Icon name="MapPinned" />
                </span>
                <div>
                  <h3>{group.name}</h3>
                  <p>{group.purpose}</p>
                  <div className="community-meta">
                    <span>
                      <Icon name="MapPin" />
                      {group.location}
                    </span>
                    <span>
                      <Icon name="Users" />
                      {(group.members || []).length +
                        (group.contactMembers || []).length}{" "}
                      members
                    </span>
                    <span>
                      <Icon name="ShieldCheck" />
                      Level {Math.max(0, hierarchy.length - 1)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="community-actions">
                {!isMember && (
                  <button className="secondary" disabled={pendingRequest} onClick={() => join(group)}>
                    {pendingRequest ? "Approval pending" : "Request to join"}
                  </button>
                )}
                {canManage && group.permissions?.allowInvites && (
                  <button
                    className="secondary"
                    onClick={() => setManage(group)}
                  >
                    <Icon name="UserPlus" />
                    Invite contacts
                  </button>
                )}
              </div>
              {canManage && (group.joinRequests || []).some((request) => request.status === "pending") && (
                <div className="join-request-list">
                  <b>Join requests</b>
                  {(group.joinRequests || []).filter((request) => request.status === "pending").map((request) => (
                    <div key={request.userId}><span>{request.name}<small>{request.email}</small></span><button className="secondary" onClick={() => decideJoin(group.id, request.userId, true)}>Approve</button><button className="icon-btn danger" aria-label={`Decline ${request.name}`} onClick={() => decideJoin(group.id, request.userId, false)}><Icon name="X" /></button></div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {createOpen && (
        <Modal
          title="Create a community group"
          close={() => setCreateOpen(false)}
        >
          <form className="form" onSubmit={createGroup}>
            <label>
              Parent community
              <select name="parentId" defaultValue="">
                <option value="">Independent community</option>
                {eligibleParents.map((x) => (
                  <option key={x.id} value={x.id}>
                    {"—".repeat(x.level || 0)} {x.name} · {x.location}
                  </option>
                ))}
              </select>
              <small>
                A parent is optional. Only approved communities that allow
                subgroups appear here.
              </small>
            </label>
            <label>
              Community name
              <input name="name" required maxLength="60" />
            </label>
            <label>
              Specific location
              <input
                name="location"
                required
                placeholder="City, region or country"
              />
            </label>
            <label>
              Purpose
              <textarea
                name="purpose"
                required
                minLength="12"
                placeholder="What this community exists to do"
              />
            </label>
            <label className="check-row">
              <input type="checkbox" name="allowSubgroups" />
              <span>
                <b>Allow subgroups</b>
                <small>
                  Members with authority may create another level below this
                  group.
                </small>
              </span>
            </label>
            <button className="primary">
              <Icon name="Plus" />
              Create community
            </button>
          </form>
        </Modal>
      )}
      {manage && (
        <Modal
          title={`Invite contacts to ${manage.name}`}
          close={() => setManage(null)}
        >
          <form className="form" onSubmit={saveMembers}>
            <p className="form-note">
              Invited contacts are added as community members in this workspace.
            </p>
            <div className="invite-list">
              {db.contacts
                .filter((x) => x.owner === user.id)
                .map((x) => (
                  <label className="check-row" key={x.id}>
                    <input
                      type="checkbox"
                      name="contacts"
                      value={x.id}
                      defaultChecked={(manage.contactMembers || []).includes(
                        x.id,
                      )}
                    />
                    <span>
                      <b>{x.name}</b>
                      <small>
                        {x.phone} · {x.country}
                      </small>
                    </span>
                  </label>
                ))}
            </div>
            <button className="primary">
              <Icon name="Send" />
              Save invitations
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
function Home({ db, save, user, setToast, setPage }) {
  const contacts = db.contacts.filter((x) => x.owner === user.id),
    [selected, setSelected] = useState(() =>
      window.matchMedia("(max-width: 760px)").matches
        ? null
        : contacts[0]?.id,
    ),
    [search, setSearch] = useState(""),
    [add, setAdd] = useState(false),
    [report, setReport] = useState(null),
    [attachments, setAttachments] = useState(false),
    [messageAction, setMessageAction] = useState(null),
    [editingMessage, setEditingMessage] = useState(null),
    [draft, setDraft] = useState("");
  const messagesRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingStartedRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [online, setOnline] = useState(navigator.onLine !== false);
  const c = contacts.find((x) => x.id === selected),
    msgs = db.messages.filter(
      (x) => x.owner === user.id && x.contact === selected,
    );
  useEffect(() => {
    document.body.dataset.datachatChatOpen = c ? "true" : "false";
    const closeChat = () => setSelected(null);
    window.addEventListener("datachat-close-chat", closeChat);
    return () => {
      delete document.body.dataset.datachatChatOpen;
      window.removeEventListener("datachat-close-chat", closeChat);
    };
  }, [c]);
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);
  const send = async (e) => {
    e.preventDefault();
    if (c?.blocked) return setToast("This member is blocked");
    const content = draft.trim();
    if (!content) return;
    if (editingMessage) {
      if (
        editingMessage.cloudMessage &&
        (navigator.onLine === false || editingMessage.deliveryStatus === "queued")
      ) {
        return setToast("Connect to edit a message that has already been sent.");
      }
      try {
        if (editingMessage.cloudMessage) {
          await editDirectMessage(editingMessage.id, content);
        }
        save((d) => ({
          ...d,
          messages: d.messages.map((item) =>
            item.id === editingMessage.id
              ? { ...item, content, edited: true }
              : item,
          ),
        }));
        setDraft("");
        setEditingMessage(null);
        setToast("Message edited");
      } catch (error) {
        setToast(`Message could not be edited: ${error.message}`);
      }
      return;
    }
    const message = {
      id: c?.remoteUserId ? crypto.randomUUID() : uid("m"),
      owner: user.id,
      contact: selected,
      sender: "me",
      content,
      cloudMessage: Boolean(c?.remoteUserId),
      deliveryStatus: c?.remoteUserId ? "sending" : "sent",
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    setDraft("");
    save((d) => ({
      ...d,
      messages: [...d.messages, message],
    }));
    if (c?.remoteUserId) {
      if (navigator.onLine === false) {
        queueOutgoingMessage(user.id, c.remoteUserId, message);
        save((d) => ({
          ...d,
          messages: d.messages.map((item) =>
            item.id === message.id
              ? { ...item, deliveryStatus: "queued" }
              : item,
          ),
        }));
        return setToast("Message queued. It will send when a connection returns.");
      }
      try {
        await sendDirectMessage(c.remoteUserId, message);
        save((d) => ({
          ...d,
          messages: d.messages.map((item) =>
            item.id === message.id
              ? { ...item, deliveryStatus: "sent" }
              : item,
          ),
        }));
      } catch (error) {
        queueOutgoingMessage(user.id, c.remoteUserId, message);
        save((d) => ({
          ...d,
          messages: d.messages.map((item) =>
            item.id === message.id
              ? { ...item, deliveryStatus: "queued" }
              : item,
          ),
        }));
        setToast(`Weak connection: message queued for automatic retry.`);
      }
    }
  };
  const sendTransaction = async (record) => {
    if (!c || c.blocked) return;
    const transaction = transactionPayload(record);
    const content = transactionText(transaction);
    const message = {
      id: c.remoteUserId ? crypto.randomUUID() : uid("m"),
      owner: user.id,
      contact: c.id,
      sender: "me",
      content,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      recordId: record.id,
      transaction,
      cloudMessage: Boolean(c.remoteUserId),
      deliveryStatus: c.remoteUserId ? "sending" : "sent",
    };
    save((d) => ({
      ...d,
      messages: [...d.messages, message],
    }));
    setAttachments(false);
    if (c.remoteUserId) {
      if (navigator.onLine === false) {
        queueOutgoingMessage(user.id, c.remoteUserId, message);
        save((d) => ({
          ...d,
          messages: d.messages.map((item) =>
            item.id === message.id
              ? { ...item, deliveryStatus: "queued" }
              : item,
          ),
        }));
        return setToast("Transaction queued until the connection returns.");
      }
      try {
        await sendDirectMessage(c.remoteUserId, message);
        save((d) => ({
          ...d,
          messages: d.messages.map((item) =>
            item.id === message.id
              ? { ...item, deliveryStatus: "sent" }
              : item,
          ),
        }));
      } catch (error) {
        queueOutgoingMessage(user.id, c.remoteUserId, message);
        save((d) => ({
          ...d,
          messages: d.messages.map((item) =>
            item.id === message.id
              ? { ...item, deliveryStatus: "queued" }
              : item,
          ),
        }));
        setToast("Weak connection: transaction queued for automatic retry.");
        return;
      }
    }
    setToast(`Transaction ${record.id} sent to ${c.name}`);
  };
  const beginEditMessage = (message) => {
    setDraft(message.content || "");
    setEditingMessage(message);
    setMessageAction(null);
    window.setTimeout(() => {
      document.querySelector('.composer textarea[name="message"]')?.focus();
    }, 50);
  };
  const deleteMessageForEveryone = async (message) => {
    if (!window.confirm("Delete this message for both people?")) return;
    if (
      message.cloudMessage &&
      (navigator.onLine === false || message.deliveryStatus === "queued")
    ) {
      return setToast("Connect to delete a message that has already been sent.");
    }
    try {
      if (message.cloudMessage) await deleteDirectMessage(message.id);
      save((d) => ({
        ...d,
        messages: d.messages.map((item) =>
          item.id === message.id
            ? {
                ...item,
                content: "This message was deleted",
                deleted: true,
                edited: false,
                voiceUrl: null,
                voicePath: null,
                transaction: null,
              }
            : item,
        ),
      }));
      setMessageAction(null);
      if (editingMessage?.id === message.id) {
        setEditingMessage(null);
        setDraft("");
      }
      setToast("Message deleted for everyone");
    } catch (error) {
      setToast(`Message could not be deleted: ${error.message}`);
    }
  };
  const toggleVoiceRecording = async () => {
    if (user.plan !== "Pro") return setToast("Voice messages are available with DataChat Pro");
    if (!c || c.blocked) return;
    if (recording) return recorderRef.current?.stop();
    if (c.remoteUserId && navigator.onLine === false)
      return setToast("Connect briefly to upload a compressed voice message.");
    try {
      const stream = await requestMicrophonePermission();
      const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorderOptions = { audioBitsPerSecond: 20000 };
      if (preferredType) recorderOptions.mimeType = preferredType;
      const recorder = new MediaRecorder(stream, recorderOptions);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size && recordingChunksRef.current.push(event.data);
      recorder.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) return;
        if (blob.size > 1400000) return setToast("Voice message is too long. Keep recordings under about one minute.");
        const messageId = c.remoteUserId ? crypto.randomUUID() : uid("m");
        const durationMs = Math.max(0, Date.now() - recordingStartedRef.current);
        try {
          let voiceUrl = URL.createObjectURL(blob);
          let voicePath = null;
          if (c.remoteUserId) {
            const uploaded = await uploadVoiceMessage(
              c.remoteUserId,
              messageId,
              blob,
              durationMs,
            );
            voiceUrl = uploaded.voiceUrl;
            voicePath = uploaded.voicePath;
          }
          const message = {
            id: messageId,
            owner: user.id,
            contact: c.id,
            sender: "me",
            content: "Voice message",
            voiceUrl,
            voicePath,
            voiceType: blob.type,
            durationMs,
            cloudMessage: Boolean(c.remoteUserId),
            deliveryStatus: c.remoteUserId ? "sending" : "sent",
            time: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          };
          if (c.remoteUserId) {
            try {
              await sendDirectMessage(c.remoteUserId, {
                ...message,
                voiceUrl: undefined,
              });
              message.deliveryStatus = "sent";
            } catch {
              queueOutgoingMessage(user.id, c.remoteUserId, message);
              message.deliveryStatus = "queued";
            }
          }
          save((d) => ({ ...d, messages: [...d.messages, message] }));
          if (message.deliveryStatus === "queued")
            setToast("Voice message uploaded and queued for delivery.");
        } catch (error) { setToast(`Voice message not sent: ${error.message}`); }
      };
      recorder.start(500);
      recorderRef.current = recorder;
      recordingStartedRef.current = Date.now();
      setRecording(true);
      window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 45000);
    } catch (error) {
      setToast(`Microphone unavailable: ${error.message}`);
    }
  };
  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs.length, selected]);
  return (
    <div className="home">
      <div className={"contact-pane " + (c ? "has-chat" : "")}>
        <Header
          title="Messages"
          sub={
            online
              ? `${contacts.length} trusted contacts · Low-data mode`
              : "Offline · messages will send automatically"
          }
          actions={
            <>
              <MyContactQr user={user} setToast={setToast} />
              <button className="primary compact" onClick={() => setAdd(true)}>
                <Icon name="UserPlus" />
                Add contact
              </button>
            </>
          }
        />
        {!online && (
          <div className="offline-banner">
            <Icon name="WifiOff" />
            Very weak or no connection. Text messages stay safely queued.
          </div>
        )}
        <div className="ad">
          <img
            src="/assets/datachat-transfer-ad.webp"
            alt="Secure international transfer confirmation"
          />
          <div>
            <span>SECURE CASH HANDOFF</span>
            <b>Verify the right receiver.</b>
            <p>Receiver-bound QR and text claim codes.</p>
          </div>
          <button onClick={() => setPage("records")}>Open transfers</button>
        </div>
        <div className="search">
          <Icon name="Search" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone"
          />
        </div>
        <div className="contact-list">
          {contacts
            .filter((x) =>
              (x.name + x.phone).toLowerCase().includes(search.toLowerCase()),
            )
            .map((x) => (
              <button
                className={x.id === selected ? "selected" : ""}
                onClick={() => setSelected(x.id)}
                key={x.id}
              >
                <div className="avatar" style={{ background: x.color }}>
                  {x.name
                    .split(" ")
                    .map((y) => y[0])
                    .slice(0, 2)}
                </div>
                <div>
                  <b>{x.name}</b>
                  <small>
                    {x.phone} · {x.country}
                  </small>
                </div>
                <span className="online" />
              </button>
            ))}
          {!contacts.length && (
            <Empty
              icon="Users"
              title="No contacts yet"
              text="Add a trusted contact to start messaging."
            />
          )}
        </div>
      </div>
      <section className={"chat " + (!c ? "empty-chat" : "")}>
        {c ? (
          <>
            <div className="chat-head">
              <button
                className="icon-btn mobile-back"
                onClick={() => setSelected(null)}
              >
                <Icon name="ArrowLeft" />
              </button>
              <UserAvatar person={c} />
              <div>
                <b>{c.name}</b>
                <small>
                  {c.phone} · {c.country}
                </small>
              </div>
              <ContactQr c={c} setToast={setToast} />
              <button
                className="icon-btn"
                title={c.phone ? `Call ${c.name}` : "No phone number available"}
                aria-label={`Voice call ${c.name}`}
                disabled={!c.phone}
                onClick={() => {
                  if (!c.phone) return;
                  if (window.confirm(`Start a voice call with ${c.name}?`))
                    window.location.href = `tel:${String(c.phone).replace(/[^+\d]/g, "")}`;
                }}
              >
                <Icon name="Phone" />
              </button>
              <button
                className="icon-btn"
                title="Report or block user"
                aria-label="Report or block user"
                onClick={() => setReport(c)}
              >
                <Icon name="ShieldAlert" />
              </button>
            </div>
            <div className="messages" ref={messagesRef}>
              {msgs.map((m) =>
                m.transaction ? (
                  <TransactionChatCard
                    key={m.id}
                    message={m}
                    db={db}
                    save={save}
                    user={user}
                    setToast={setToast}
                    onActions={() => setMessageAction(m)}
                  />
                ) : (
                  <div key={m.id} className={"bubble " + m.sender}>
                    <button
                      type="button"
                      className="message-menu-button"
                      aria-label="Message actions"
                      onClick={() => setMessageAction(m)}
                    >
                      <Icon name="ChevronDown" size={15} />
                    </button>
                    {m.voicePath || m.voiceUrl ? (
                      <VoiceMessage message={m} />
                    ) : (
                      <span className={m.deleted ? "deleted-message" : ""}>
                        {m.content}
                      </span>
                    )}
                    <small>
                      {m.edited && !m.deleted ? "edited · " : ""}
                      {m.time}
                      {m.sender === "me" && m.deliveryStatus
                        ? ` · ${m.deliveryStatus}`
                        : ""}
                    </small>
                  </div>
                ),
              )}
            </div>
            <form className="composer" onSubmit={send}>
              {attachments && (
                <div className="transaction-picker">
                  <div>
                    <b>Share a transaction</b>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setAttachments(false)}
                      aria-label="Close transaction picker"
                    >
                      <Icon name="X" />
                    </button>
                  </div>
                  {db.records
                    .filter((x) => x.owner === user.id)
                    .map((r) => (
                      <button
                        type="button"
                        key={r.id}
                        onClick={() => sendTransaction(r)}
                      >
                        <span>
                          <b>{r.id}</b>
                          <small>
                            {r.receiver} · {r.amount} {r.currency}
                          </small>
                        </span>
                        <Icon name="Send" />
                      </button>
                    ))}
                </div>
              )}
              <button
                type="button"
                className="icon-btn"
                onClick={() => setAttachments((x) => !x)}
                aria-label="Add transaction to message"
                title="Share transaction"
              >
                <Icon name="Paperclip" />
              </button>
              {editingMessage && (
                <div className="composer-edit-banner">
                  <span>
                    <b>Edit message</b>
                    <small>{editingMessage.content}</small>
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Cancel editing"
                    onClick={() => {
                      setEditingMessage(null);
                      setDraft("");
                    }}
                  >
                    <Icon name="X" />
                  </button>
                </div>
              )}
              <textarea
                name="message"
                aria-label="Message"
                disabled={c.blocked}
                placeholder="Message"
                rows="1"
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 4000))}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent?.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              {draft.trim() || editingMessage ? (
                <button className="send" aria-label={editingMessage ? "Save edited message" : "Send"} disabled={c.blocked}>
                  <Icon name={editingMessage ? "Check" : "Send"} />
                </button>
              ) : (
                <button type="button" className={`send voice-button ${recording ? "recording" : ""}`} onClick={toggleVoiceRecording} aria-label={recording ? "Stop voice recording" : "Record voice message"} title={user.plan === "Pro" ? "Voice message" : "Voice messages require Pro"}>
                  <Icon name={recording ? "Square" : "Mic"} />
                </button>
              )}
            </form>
          </>
        ) : (
          <Empty
            icon="MessageCircleMore"
            title="Your secure conversation space"
            text="Choose a contact to start a conversation, share a transaction, or exchange a security key."
          />
        )}
      </section>
      {messageAction && (
        <Modal
          title="Message actions"
          close={() => setMessageAction(null)}
        >
          <div className="message-action-sheet">
            <p>{messageAction.content || "Voice message"}</p>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  messageAction.content || "",
                );
                setMessageAction(null);
                setToast("Message copied");
              }}
            >
              <Icon name="Copy" />
              Copy
            </button>
            {messageAction.sender === "me" &&
              !messageAction.deleted &&
              !messageAction.transaction &&
              !messageAction.voicePath &&
              !messageAction.voiceUrl && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => beginEditMessage(messageAction)}
                >
                  <Icon name="Pencil" />
                  Edit message
                </button>
              )}
            {messageAction.sender === "me" && !messageAction.deleted && (
              <button
                type="button"
                className="secondary danger"
                onClick={() => deleteMessageForEveryone(messageAction)}
              >
                <Icon name="Trash2" />
                Delete for everyone
              </button>
            )}
            {messageAction.sender === "them" && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setMessageAction(null);
                  setReport(c);
                }}
              >
                <Icon name="ShieldAlert" />
                Report sender
              </button>
            )}
          </div>
        </Modal>
      )}
      {add && (
        <ContactModal
          user={user}
          save={save}
          close={() => setAdd(false)}
          setToast={setToast}
        />
      )}
      {report && (
        <ReportUser
          contact={report}
          messages={msgs}
          user={user}
          rating={(db.customerRatings || []).find(
            (item) => item.rated_user_id === report.remoteUserId,
          )}
          save={save}
          setToast={setToast}
          close={() => setReport(null)}
        />
      )}
    </div>
  );
}
function VoiceMessage({ message }) {
  const [source, setSource] = useState(message.voiceUrl || "");
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (!message.voicePath || refreshing) return;
    setRefreshing(true);
    try {
      setSource(await createVoicePlaybackUrl(message.voicePath));
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    setSource(message.voiceUrl || "");
    if (!message.voiceUrl && message.voicePath) refresh();
  }, [message.voiceUrl, message.voicePath]);
  return source ? (
    <audio
      className="voice-message"
      controls
      preload="none"
      src={source}
      onError={refresh}
    >
      Voice message
    </audio>
  ) : (
    <button className="secondary voice-retry" onClick={refresh} disabled={refreshing}>
      <Icon name="RefreshCw" />
      {refreshing ? "Loading voice…" : "Load voice message"}
    </button>
  );
}
function ReportUser({
  contact,
  messages,
  user,
  rating,
  save,
  setToast,
  close,
}) {
  const [submitted, setSubmitted] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const report = {
      id: uid("report"),
      reporterId: user.id,
      contactId: contact.id,
      contactName: contact.name,
      reason: f.get("reason"),
      details: f.get("details"),
      includeMessages: f.get("evidence") === "on",
      evidence: f.get("evidence") === "on" ? messages.slice(-10) : [],
      createdAt: new Date().toISOString(),
      status: "Submitted",
    };
    save((d) => ({
      ...d,
      reports: [...(d.reports || []), report],
      contacts:
        f.get("block") === "on"
          ? d.contacts.map((x) =>
              x.id === contact.id ? { ...x, blocked: true } : x,
            )
          : d.contacts,
    }));
    setSubmitted(true);
    setToast("Safety report submitted");
  };
  const submitRating = async (event) => {
    event.preventDefault();
    if (!contact.remoteUserId)
      return setToast("Ratings require a registered DataChat contact.");
    const form = new FormData(event.currentTarget);
    try {
      const savedRating = await saveCustomerRating(
        contact.remoteUserId,
        Number(form.get("rating")),
        form.get("note"),
      );
      save((state) => ({
        ...state,
        customerRatings: [
          ...(state.customerRatings || []).filter(
            (item) => item.rated_user_id !== contact.remoteUserId,
          ),
          savedRating,
        ],
      }));
      setToast("Your rating was saved.");
    } catch (error) {
      setToast(`Rating failed: ${error.message}`);
    }
  };
  const removeRating = async () => {
    if (!rating || !contact.remoteUserId) return;
    try {
      await deleteCustomerRating(contact.remoteUserId);
      save((state) => ({
        ...state,
        customerRatings: (state.customerRatings || []).filter(
          (item) => item.rated_user_id !== contact.remoteUserId,
        ),
      }));
      setToast("Your rating was deleted.");
    } catch (error) {
      setToast(`Rating deletion failed: ${error.message}`);
    }
  };
  return (
    <Modal title="Report or block member" close={close}>
      {submitted ? (
        <div className="report-success">
          <span>
            <Icon name="ShieldCheck" size={30} />
          </span>
          <h3>Report received</h3>
          <p>
            Your report about {contact.name} was saved for safety review. If you
            feel in immediate danger, contact local emergency services.
          </p>
          <button className="primary" onClick={close}>
            Done
          </button>
        </div>
      ) : (
        <form className="form report-form" onSubmit={submit}>
          <div className="report-person">
            <div className="avatar" style={{ background: contact.color }}>
              {contact.name[0]}
            </div>
            <div>
              <b>{contact.name}</b>
              <small>
                {contact.phone} · {contact.country}
              </small>
            </div>
          </div>
          <label>
            Why are you reporting this member?
            <select name="reason" required defaultValue="">
              <option value="" disabled>
                Select a reason
              </option>
              <option>Scam or fraud attempt</option>
              <option>Harassment or threats</option>
              <option>False identity</option>
              <option>Suspicious transaction request</option>
              <option>Spam</option>
              <option>Other safety concern</option>
            </select>
          </label>
          <label>
            Tell us what happened
            <textarea
              name="details"
              required
              minLength="10"
              placeholder="Describe the behavior and when it happened."
            />
          </label>
          <label className="check-row">
            <input type="checkbox" name="evidence" defaultChecked />
            <span>
              <b>Include recent messages</b>
              <small>Attach the last 10 messages as evidence.</small>
            </span>
          </label>
          <label className="check-row danger-row">
            <input type="checkbox" name="block" />
            <span>
              <b>Block {contact.name}</b>
              <small>Prevent new messages in this local workspace.</small>
            </span>
          </label>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary danger-submit">
              <Icon name="Flag" />
              Submit report
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
function MyContactQr({ user, setToast }) {
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState("");
  const payload = JSON.stringify({
    version: 1,
    type: "datachat-user-contact",
    userId: user.id,
    contactCode:
      user.contactCode ||
      String(user.id).replaceAll("-", "").slice(0, 12).toUpperCase(),
    name: user.name,
    country: user.country || "Global",
  });
  useEffect(() => {
    if (open)
      QRCode.toDataURL(payload, {
        margin: 3,
        width: 320,
        errorCorrectionLevel: "M",
      }).then(setUrl);
  }, [open, payload]);
  return (
    <>
      <button
        className="icon-btn"
        aria-label="Show my contact QR code"
        title="My contact QR"
        onClick={() => setOpen(true)}
      >
        <Icon name="QrCode" />
      </button>
      {open && (
        <Modal title="My DataChat contact" close={() => setOpen(false)}>
          <div className="qr share-card">
            {url && <img src={url} alt={`Contact QR code for ${user.name}`} />}
            <div className="share-summary">
              <b>{user.name}</b>
              <span>Code {JSON.parse(payload).contactCode}</span>
              <small>Ask another DataChat user to scan this code.</small>
            </div>
            <div className="share-actions">
              <button
                className="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(payload);
                  setToast("Your contact code was copied");
                }}
              >
                <Icon name="Copy" />
                Copy contact code
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function ContactQr({ c, setToast }) {
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState("");
  const payload = JSON.stringify(
    {
      version: 1,
      type: "datachat-contact",
      contactId: c.id,
      name: c.name,
      phone: c.phone,
      country: c.country,
    },
    null,
    2,
  );
  useEffect(() => {
    if (open)
      QRCode.toDataURL(payload, {
        margin: 4,
        width: 320,
        errorCorrectionLevel: "M",
      }).then(setUrl);
  }, [open, payload]);
  return (
    <>
      <button
        className="icon-btn push"
        title="Contact code"
        onClick={() => setOpen(true)}
      >
        <Icon name="QrCode" />
      </button>
      {open && (
        <Modal title="Contact security code" close={() => setOpen(false)}>
          <div className="qr share-card">
            {url && <img src={url} alt="Contact QR code" />}
            <div className="share-summary">
              <b>{c.name}</b>
              <span>{c.phone}</span>
              <small>{c.country}</small>
            </div>
            <p>Scan the QR or share the complete text below.</p>
            <label className="share-text">
              Contact text
              <textarea readOnly value={payload} />
            </label>
            <div className="share-actions">
              <button
                className="secondary"
                onClick={async () => {
                  await navigator.clipboard?.writeText(payload);
                  setToast("Complete contact copied");
                }}
              >
                <Icon name="Copy" />
                Copy text
              </button>
              <button
                className="secondary"
                onClick={() =>
                  downloadText(`datachat-contact-${c.name}.txt`, payload)
                }
              >
                <Icon name="Download" />
                Download .txt
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function ContactModal({ user, save, close, setToast }) {
  const [scanError, setScanError] = useState(""),
    [busy, setBusy] = useState(false),
    fileRef = useRef(null);
  const addRemoteProfile = async (profile, contactCode) => {
    if (!profile) throw new Error("No DataChat account matches that code.");
    if (profile.id === user.id) throw new Error("You cannot add your own account.");
    if (
      cloudConfigured &&
      !String(contactCode || profile.contact_code || "").trim()
    )
      throw new Error("The contact QR is incomplete.");
    if (cloudConfigured) {
      await addContactByQr(
        profile.id,
        contactCode || profile.contact_code,
      );
    }
    save((d) => {
      if (d.contacts.some((contact) => contact.remoteUserId === profile.id))
        return d;
      return {
        ...d,
        contacts: [
          ...d.contacts,
          {
            id: `contact-${profile.id}`,
            remoteUserId: profile.id,
            contactCode: profile.contact_code,
            owner: user.id,
            name: profile.display_name,
            phone: "",
            country: profile.country || "Global",
            color: ["#d7a62b", "#4c8ed9", "#8f69d8", "#35a57a"][d.contacts.length % 4],
            isOnline: true,
          },
        ],
      };
    });
    setToast(`${profile.display_name} added. You can now message each other.`);
    close();
  };
  const acceptScannedContact = async (value) => {
    const payload = JSON.parse(value);
    if (payload.type !== "datachat-user-contact" || !payload.userId)
      throw new Error("This is not a DataChat user contact QR code.");
    if (!payload.contactCode)
      throw new Error("This contact QR is missing its security code.");
    const profile = await findPublicProfile({
      userId: payload.userId,
      contactCode: payload.contactCode,
    });
    await addRemoteProfile(profile, payload.contactCode);
  };
  const scanCamera = async () => {
    setBusy(true);
    setScanError("");
    try {
      const value = await scanNativeQr(
        "Place the DataChat contact QR inside the frame",
      );
      if (!value) throw new Error("The QR scan was cancelled.");
      await acceptScannedContact(value);
    } catch (error) {
      setScanError(error.message || "No readable DataChat contact was found.");
    } finally {
      setBusy(false);
    }
  };
  const scanFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setScanError("");
    try {
      await acceptScannedContact(
        await scanQrImage(file, "contact-qr-reader"),
      );
    } catch (error) {
      setScanError(error.message || "No readable DataChat contact was found.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const contactCode = String(f.get("contactCode") || "").trim();
    if (cloudConfigured && contactCode) {
      setBusy(true);
      setScanError("");
      try {
        const profile = await findPublicProfile({ contactCode });
        await addRemoteProfile(profile, contactCode);
      } catch (error) {
        setScanError(error.message);
        setBusy(false);
      }
      return;
    }
    save((d) => {
      const phone = String(f.get("phone") || "").replace(/\s+/g, "");
      if (
        d.contacts.some(
          (contact) =>
            contact.owner === user.id &&
            String(contact.phone || "").replace(/\s+/g, "") === phone,
        )
      ) {
        setToast("This contact already exists.");
        return d;
      }
      return {
        ...d,
        contacts: [
          ...d.contacts,
        {
          id: uid("c"),
          owner: user.id,
          name: f.get("name"),
          phone: f.get("phone"),
          country: f.get("country"),
          color: ["#d7a62b", "#4c8ed9", "#8f69d8", "#35a57a"][
            d.contacts.length % 4
          ],
        }],
      };
    });
    setToast("Contact added");
    close();
  };
  return (
    <Modal title="Add trusted contact" close={close}>
      <form className="form" onSubmit={submit}>
        {cloudConfigured && (
          <>
            <div className="scan-contact-card">
              <span><Icon name="ScanLine" /></span>
              <div>
                <b>Scan their DataChat QR</b>
                <small>Choose a QR image or take a photo with your phone.</small>
              </div>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={isNativeApp() ? scanCamera : () => fileRef.current?.click()}
              >
                {busy
                  ? "Reading…"
                  : isNativeApp()
                    ? "Open camera"
                    : "Choose QR image"}
              </button>
              <input ref={fileRef} hidden type="file" accept="image/*" onChange={(event) => scanFile(event.target.files?.[0])} />
              <div id="contact-qr-reader" />
            </div>
            {isNativeApp() && (
              <button
                type="button"
                className="secondary full-btn"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="ImagePlus" />
                Choose a QR image instead
              </button>
            )}
            <div className="billing-divider"><span>or enter their code</span></div>
            <label>
              DataChat contact code
              <input name="contactCode" autoCapitalize="characters" placeholder="12-character code" />
              <small>The code is displayed beneath the user’s personal QR.</small>
            </label>
            {scanError && <div className="error" role="alert">{scanError}</div>}
          </>
        )}
        <label>
          Full name
          <input name="name" required={!cloudConfigured} />
        </label>
        <label>
          Phone number
          <input name="phone" required={!cloudConfigured} type="tel" />
        </label>
        <label>
          Country
          <select name="country">
            {countries.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy}>{cloudConfigured ? "Add by contact code" : "Add contact"}</button>
      </form>
      {contact.remoteUserId && (
        <form className="form contact-rating-form" onSubmit={submitRating}>
          <div className="panel-title">
            <div>
              <h3>Your private customer rating</h3>
              <p>Saved permanently until you update or delete it.</p>
            </div>
          </div>
          <label>
            Rating
            <select name="rating" defaultValue={rating?.rating || 5}>
              <option value="5">5 · Excellent</option>
              <option value="4">4 · Good</option>
              <option value="3">3 · Fair</option>
              <option value="2">2 · Poor</option>
              <option value="1">1 · Very poor</option>
            </select>
          </label>
          <label>
            Private note
            <textarea
              name="note"
              maxLength="500"
              defaultValue={rating?.note || ""}
              placeholder="Only you can see this note"
            />
          </label>
          <div className="actions">
            <button className="primary">
              <Icon name="Star" />
              {rating ? "Update rating" : "Save rating"}
            </button>
            {rating && (
              <button type="button" className="secondary danger" onClick={removeRating}>
                <Icon name="Trash2" />
                Delete
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
function Records({ db, save, user, setToast }) {
  const all = db.records.filter((x) => x.owner === user.id),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All"),
    [group, setGroup] = useState(false),
    [edit, setEdit] = useState(null),
    [review, setReview] = useState(false),
    [handoff, setHandoff] = useState(null),
    [sharing, setSharing] = useState(null);
  const rows = all.filter(
    (r) =>
      (r.id + r.sender + r.receiver + r.account)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "All" || r.status === filter || r.tag === filter),
  );
  const update = (id, changes) => {
    save((d) => ({
      ...d,
      records: d.records.map((r) => (r.id === id ? { ...r, ...changes } : r)),
      notifications:
        changes.tag === "Verified"
          ? [
              ...d.notifications,
              {
                id: uid("n"),
                owner: user.id,
                text: `${id} was verified`,
                date: new Date().toISOString(),
              },
            ]
          : d.notifications,
    }));
    setToast("Transaction updated");
  };
  const del = (id) => {
    if (confirm("Delete this transaction?"))
      save((d) => ({ ...d, records: d.records.filter((r) => r.id !== id) }));
  };
  const exportCsv = () => {
    const head = [
      "ID",
      "Sender",
      "Sender Phone",
      "From",
      "Receiver",
      "Receiver Phone",
      "To",
      "Account",
      "Amount",
      "Currency",
      "Rate",
      "Category",
      "Date",
      "Status",
      "Tag",
      "Security Key",
      "Remark",
    ];
    const csv =
      "\ufeff" +
      [
        head,
        ...all.map((r) => [
          r.id,
          r.sender,
          r.senderPhone,
          r.from,
          r.receiver,
          r.receiverPhone,
          r.to,
          r.account,
          r.amount,
          r.currency,
          r.rate,
          r.category,
          r.date,
          r.status,
          r.tag,
          r.key,
          r.remark,
        ]),
      ]
        .map((a) =>
          a
            .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
            .join(","),
        )
        .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `datachat-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importCsv = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsedRows = parseCsvRows(await readSelectedFile(file));
      if (parsedRows.length < 2)
        throw new Error("The CSV has no transaction rows.");
      const h = parsedRows[0].map((value) =>
          value.toLowerCase().replaceAll("_", " ").trim(),
        ),
        get = (row, ...names) => {
          const index = names
            .map((name) => h.indexOf(name))
            .find((position) => position >= 0);
          return index >= 0 ? row[index] || "" : "";
        };
      if (!h.includes("id") && !h.includes("receiver"))
        throw new Error(
          "This is not a DataChat CSV. Include at least an ID or Receiver column.",
        );
      const existing = new Set(
        db.records
          .filter((record) => record.owner === user.id)
          .map((record) => String(record.id).trim().toLowerCase()),
      );
      const imported = parsedRows
        .slice(1)
        .map((a) => {
          const requestedId = get(a, "id", "reference", "transaction id");
          const id = requestedId || uid("TXN");
          if (existing.has(id.trim().toLowerCase())) return null;
          existing.add(id.trim().toLowerCase());
        return {
          id,
          owner: user.id,
          sender: get(a, "sender", "sender name"),
          senderPhone: get(a, "sender phone", "senderphone"),
          from: get(a, "from", "origin"),
          receiver: get(a, "receiver", "receiver name"),
          receiverPhone: get(a, "receiver phone", "receiverphone"),
          to: get(a, "to", "destination"),
          account: get(a, "account", "account number"),
          amount: Number(get(a, "amount").replaceAll(",", "")) || 0,
          currency: get(a, "currency") || "USD",
          rate: Number(get(a, "rate").replaceAll(",", "")) || 1,
          category: get(a, "category") || "Remittance",
          date: get(a, "date") || today(),
          status: get(a, "status") || "Draft",
          tag: get(a, "tag") || "",
          key: get(a, "security key", "key"),
          remark: get(a, "remark", "note"),
        };
      })
        .filter(Boolean);
      if (!imported.length)
        throw new Error("Every transaction in this file already exists.");
      save((d) => ({ ...d, records: [...d.records, ...imported] }));
      setToast(`${imported.length} records imported`);
    } catch (error) {
      setToast(`Import failed: ${error.message}`);
    } finally {
      e.target.value = "";
    }
  };
  const groups = group
    ? Object.entries(
        rows.reduce(
          (a, r) => ((a[r.from || "Unspecified"] ??= []).push(r), a),
          {},
        ),
      ).sort()
    : [["", rows]];
  return (
    <div className="page">
      <Header
        title="Transactions"
        sub="Review, verify and reconcile international transfers"
        actions={
          <>
            <label className="secondary file">
              <Icon name="Upload" />
              Import
              <input type="file" accept=".csv" onChange={importCsv} />
            </label>
            <button className="secondary" onClick={exportCsv}>
              <Icon name="Download" />
              Export
            </button>
            <button className="primary" onClick={() => setEdit({})}>
              <Icon name="Plus" />
              New record
            </button>
          </>
        }
      />
      <Stats records={all} />
      <div className="toolbar">
        <div className="search">
          <Icon name="Search" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, people or account"
          />
        </div>
        <div className="chips">
          {["All", "Pending", "Completed", "Verified", "Flagged"].map((x) => (
            <button
              key={x}
              className={filter === x ? "on" : ""}
              onClick={() => setFilter(x)}
            >
              {x}
            </button>
          ))}
        </div>
        <button
          className={"secondary " + (group ? "on" : "")}
          onClick={() => setGroup(!group)}
        >
          <Icon name="Layers3" />
          Group by country
        </button>
        <button className="secondary review" onClick={() => setReview(true)}>
          <Icon name="ClipboardCheck" />
          Review queue{" "}
          <span>{all.filter((x) => x.tag === "Pending review").length}</span>
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Sender → Receiver</th>
              <th>Route</th>
              <th>Amount</th>
              <th>Date</th>
              <th>Status</th>
              <th>Security</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([name, items]) => (
              <React.Fragment key={name}>
                {name && (
                  <tr className="group">
                    <td colSpan="8">
                      <Icon name="MapPin" />
                      {name}
                      <span>{items.length} transfers</span>
                    </td>
                  </tr>
                )}
                {items.map((r) => (
                  <RecordRow
                    key={r.id}
                    r={r}
                    edit={() => setEdit(r)}
                    del={() => del(r.id)}
                    update={update}
                    handoff={() => setHandoff(r)}
                    share={() => setSharing(r)}
                  />
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <Empty
            icon="SearchX"
            title="No matching transactions"
            text="Try changing your filters or create a new record."
          />
        )}
      </div>
      {edit && (
        <RecordModal
          user={user}
          record={edit}
          save={save}
          close={() => setEdit(null)}
          setToast={setToast}
        />
      )}{" "}
      {review && (
        <Review
          records={all.filter((x) => x.tag === "Pending review")}
          close={() => setReview(false)}
          update={update}
        />
      )}
      {handoff && (
        <HandoffModal
          record={handoff}
          close={() => setHandoff(null)}
          confirm={() => {
            update(handoff.id, {
              status: "Completed",
              tag: "Verified",
              handoffStatus: "Cash released",
              handoffAt: new Date().toISOString(),
            });
            setHandoff(null);
          }}
          setToast={setToast}
        />
      )}
      {sharing && (
        <ShareRecordModal
          record={sharing}
          db={db}
          save={save}
          user={user}
          close={() => setSharing(null)}
          setToast={setToast}
        />
      )}
    </div>
  );
}
function Stats({ records }) {
  const completed = records.filter((x) => x.status === "Completed"),
    pending = records.filter((x) => x.status === "Pending");
  return (
    <div className="stats">
      <Stat
        icon="WalletCards"
        label="Total volume"
        value={money(records.reduce((a, x) => a + x.amount, 0))}
        note={`${records.length} transactions`}
      />
      <Stat
        icon="BadgeCheck"
        label="Completed"
        value={money(completed.reduce((a, x) => a + x.amount, 0))}
        note={`${completed.length} cleared`}
      />
      <Stat
        icon="Clock3"
        label="Awaiting review"
        value={pending.length}
        note="Manual approval required"
      />
      <Stat
        icon="Globe2"
        label="Active routes"
        value={new Set(records.map((x) => x.from + "-" + x.to)).size}
        note="International corridors"
      />
    </div>
  );
}
function Stat({ icon, label, value, note }) {
  return (
    <div className="stat">
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <b>{value}</b>
        <p>{note}</p>
      </div>
    </div>
  );
}
function RecordRow({ r, edit, del, update, handoff, share }) {
  return (
    <tr>
      <td>
        <b className="mono">{r.id}</b>
        <small>{r.category}</small>
      </td>
      <td>
        <b>{r.sender}</b>
        <small>{r.receiver}</small>
      </td>
      <td>
        <b>
          {r.from} <span className="muted">→</span> {r.to}
        </b>
        <small>{r.senderPhone}</small>
      </td>
      <td>
        <b className="mono">{money(r.amount, r.currency)}</b>
        <small>Rate {r.rate}</small>
      </td>
      <td>{r.date}</td>
      <td>
        <span className={"badge " + r.status.toLowerCase()}>{r.status}</span>
        <small>{r.tag}</small>
      </td>
      <td>
        <button
          className="key"
          onClick={() => navigator.clipboard?.writeText(r.key)}
        >
          <Icon name="KeyRound" size={14} />
          {r.key || "Generate"}
        </button>
        <button className="handoff-link" onClick={handoff}>
          {r.handoffStatus === "Cash released"
            ? "Cash released"
            : "Cash handoff"}
        </button>
      </td>
      <td>
        <div className="row-actions">
          <button title="Share record" onClick={share}>
            <Icon name="Share2" />
          </button>
          {r.tag === "Pending review" && (
            <button
              title="Approve"
              onClick={() =>
                update(r.id, { status: "Completed", tag: "Verified" })
              }
            >
              <Icon name="Check" />
            </button>
          )}
          <button title="Edit" onClick={edit}>
            <Icon name="Pencil" />
          </button>
          <button title="Delete" onClick={del}>
            <Icon name="Trash2" />
          </button>
        </div>
      </td>
    </tr>
  );
}
function TransactionChatCard({ message, db, save, user, setToast, onActions }) {
  const [qr, setQr] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const data = message.transaction;
  const existingRecord = db.records.find(
    (x) =>
      x.owner === user.id &&
      (x.importedFromMessage === message.id ||
        x.id === data.reference ||
        x.sourceReference === data.reference ||
        (data.securityKey &&
          x.key === data.securityKey &&
          x.receiver?.trim().toLowerCase() ===
            data.receiver?.trim().toLowerCase())),
  );
  useEffect(() => {
    QRCode.toDataURL(JSON.stringify(data), {
      width: 220,
      margin: 3,
      errorCorrectionLevel: "M",
    }).then(setQr);
  }, [message.id]);
  const add = () => {
    if (existingRecord)
      return setToast(
        `Transaction ${data.reference} already exists. No duplicate was added.`,
      );
    const record = {
      id: `IMPORTED-${message.id}`,
      owner: user.id,
      sender: data.sender,
      senderPhone: data.senderPhone,
      receiver: data.receiver,
      receiverPhone: data.receiverPhone,
      from: data.from,
      to: data.to,
      amount: data.amount,
      currency: data.currency,
      rate: data.rate,
      account: data.account,
      category: data.category,
      date: data.date,
      status: "Pending",
      tag: "Received in chat",
      key: data.securityKey,
      remark: data.note,
      sourceReference: data.reference,
      importedFromMessage: message.id,
    };
    save((d) => ({ ...d, records: [record, ...d.records] }));
    setToast(`${data.reference} added to your transactions`);
  };
  return (
    <motion.article
      className={`transaction-message ${message.sender} ${expanded ? "expanded" : ""}`}
      tabIndex="0"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="transaction-message-head">
        <span>
          <Icon name="ReceiptText" />
          <b>{data.reference}</b>
        </span>
        <small>{message.time}</small>
        <button
          type="button"
          className="transaction-toggle"
          onClick={onActions}
          aria-label="Transaction message actions"
        >
          <Icon name="MoreVertical" />
        </button>
        <button
          className="transaction-toggle"
          onClick={() => setExpanded((x) => !x)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? "Collapse transaction details"
              : "Expand transaction details"
          }
        >
          <Icon name={expanded ? "ChevronUp" : "ChevronDown"} />
        </button>
      </div>
      {!expanded && (
        <button
          type="button"
          className="transaction-preview"
          onClick={() => setExpanded(true)}
          aria-label={`Open full transaction ${data.reference}`}
        >
          <span><small>Receiver</small><b>{data.receiver}</b></span>
          <span><small>Amount</small><b>{data.amount} {data.currency}</b></span>
          <Icon name="ChevronRight" />
        </button>
      )}
      <div className="transaction-message-body">
        {qr && (
          <img
            src={qr}
            alt={`QR code for transaction ${data.reference}`}
            loading="lazy"
          />
        )}
        <dl>
          <div>
            <dt>Sender</dt>
            <dd>{data.sender}</dd>
          </div>
          <div>
            <dt>Receiver</dt>
            <dd>{data.receiver}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>
              {data.amount} {data.currency}
            </dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>
              {data.from} → {data.to}
            </dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{data.date}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{data.status}</dd>
          </div>
          <div>
            <dt>Rate</dt>
            <dd>{data.rate}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{data.category}</dd>
          </div>
          {data.note && (
            <div>
              <dt>Note</dt>
              <dd>{data.note}</dd>
            </div>
          )}
          <div>
            <dt>Security key</dt>
            <dd className="security-private">
              <span className="mono">
                {data.securityKey
                  ? keyVisible
                    ? data.securityKey
                    : "••••••"
                  : "Not generated"}
              </span>
              {data.securityKey && (
                <button
                  onClick={() => setKeyVisible((x) => !x)}
                  aria-label={
                    keyVisible ? "Hide security key" : "Reveal security key"
                  }
                >
                  <Icon name={keyVisible ? "EyeOff" : "Eye"} />
                  {keyVisible ? "Hide" : "Reveal"}
                </button>
              )}
            </dd>
          </div>
        </dl>
      </div>
      <button
        className={`transaction-add ${existingRecord ? "exists" : ""}`}
        onClick={add}
      >
        <Icon name={existingRecord ? "CircleCheck" : "PlusCircle"} />
        {existingRecord ? "Already in transactions" : "Add to my transactions"}
      </button>
    </motion.article>
  );
}
function ShareRecordModal({ record, db, save, user, close, setToast }) {
  const [qr, setQr] = useState("");
  const [contactId, setContactId] = useState("");
  const data = transactionPayload(record);
  const text = transactionText(data);
  useEffect(() => {
    QRCode.toDataURL(JSON.stringify(data), {
      width: 340,
      margin: 4,
      errorCorrectionLevel: "M",
    }).then(setQr);
  }, [record.id]);
  const share = async () => {
    try {
      const qrBlob = qr ? await (await fetch(qr)).blob() : null;
      const qrFile = qrBlob
        ? new File([qrBlob], `${record.id}-qr.png`, { type: "image/png" })
        : null;
      if (
        navigator.share &&
        qrFile &&
        navigator.canShare?.({ files: [qrFile] })
      )
        await navigator.share({
          title: `DataChat ${record.id}`,
          text,
          files: [qrFile],
        });
      else if (navigator.share)
        await navigator.share({ title: `DataChat ${record.id}`, text });
      else {
        await navigator.clipboard.writeText(text);
        setToast("Record copied because device sharing is unavailable");
      }
    } catch (e) {
      if (e.name !== "AbortError")
        setToast("Sharing failed; use Copy text or Download instead");
    }
  };
  const sendToContact = () => {
    const contact = db.contacts.find(
      (x) => x.id === contactId && x.owner === user.id,
    );
    if (!contact) return setToast("Choose a contact first");
    save((d) => ({
      ...d,
      messages: [
        ...d.messages,
        {
          id: uid("m"),
          owner: user.id,
          contact: contact.id,
          sender: "me",
          content: text,
          recordId: record.id,
          transaction: data,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ],
    }));
    setToast(`${record.id} sent to ${contact.name}`);
    close();
  };
  return (
    <Modal title="Share transaction record" close={close} wide>
      <div className="record-share">
        <div className="qr share-card">
          {qr && <img src={qr} alt={`QR code for ${record.id}`} />}
          <div className="share-summary">
            <b>{record.id}</b>
            <span>{record.receiver}</span>
            <small>
              {record.amount} {record.currency} · {record.status}
            </small>
          </div>
        </div>
        <div className="share-copy">
          <div className="premium-note">
            <Icon name="ShieldCheck" />
            <div>
              <b>Confirm before cash release</b>
              <small>
                The receiver name and security key are included in both formats.
              </small>
            </div>
          </div>
          <label className="share-text">
            Transaction text
            <textarea readOnly value={text} />
          </label>
          <div className="contact-send">
            <select
              aria-label="Choose contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">Choose a contact…</option>
              {db.contacts
                .filter((x) => x.owner === user.id && !x.blocked)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.phone}
                  </option>
                ))}
            </select>
            <button
              className="primary"
              onClick={sendToContact}
              disabled={!contactId}
            >
              <Icon name="MessageCircle" />
              Send to contact
            </button>
          </div>
          <div className="share-actions">
            <button className="primary" onClick={share}>
              <Icon name="Share2" />
              Share
            </button>
            <button
              className="secondary"
              onClick={async () => {
                await navigator.clipboard?.writeText(text);
                setToast("Transaction text copied");
              }}
            >
              <Icon name="Copy" />
              Copy text
            </button>
            <button
              className="secondary"
              onClick={() => downloadText(`${record.id}.txt`, text)}
            >
              <Icon name="Download" />
              Download .txt
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
function RecordModal({ record, user, save, close, setToast }) {
  const currencies = useCurrencyCodes();
  const isNew = !record.id,
    submit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.currentTarget)),
        obj = {
          ...record,
          ...f,
          amount: +f.amount,
          rate: +f.rate,
          id: record.id || "TXN-" + Math.floor(1000 + Math.random() * 9000),
          owner: user.id,
          tag: f.status === "Pending" ? "Pending review" : f.tag,
          key:
            record.key ||
            f.key ||
            String(
              crypto.getRandomValues(new Uint32Array(1))[0] % 1000000,
            ).padStart(6, "0"),
        };
      save((d) => ({
        ...d,
        records: isNew
          ? [obj, ...d.records]
          : d.records.map((x) => (x.id === obj.id ? obj : x)),
      }));
      setToast(isNew ? "Transaction created" : "Transaction saved");
      close();
    };
  return (
    <Modal
      title={isNew ? "New transaction" : "Edit transaction"}
      close={close}
      wide
    >
      <form className="form grid" onSubmit={submit}>
        <label>
          Sender name
          <input name="sender" required defaultValue={record.sender} />
        </label>
        <label>
          Sender phone
          <input
            name="senderPhone"
            required
            defaultValue={record.senderPhone}
          />
        </label>
        <label>
          From country
          <select name="from" defaultValue={record.from}>
            {countries.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Receiver name
          <input name="receiver" required defaultValue={record.receiver} />
        </label>
        <label>
          Receiver phone
          <input
            name="receiverPhone"
            required
            defaultValue={record.receiverPhone}
          />
        </label>
        <label>
          To country
          <select name="to" defaultValue={record.to}>
            {countries.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input
            name="amount"
            type="number"
            min="0"
            step=".01"
            required
            defaultValue={record.amount}
          />
        </label>
        <label>
          Currency
          <select name="currency" defaultValue={record.currency || "USD"}>
            {currencies.map((x) => (
              <option key={x} value={x}>{currencyLabel(x)}</option>
            ))}
          </select>
        </label>
        <label>
          Exchange rate
          <input
            name="rate"
            type="number"
            min="0"
            step=".0001"
            defaultValue={record.rate || 1}
          />
        </label>
        <label>
          Bank account
          <input name="account" defaultValue={record.account} />
        </label>
        <label>
          Category
          <select name="category" defaultValue={record.category}>
            {[
              "Remittance",
              "Invoice",
              "Salary",
              "Loan",
              "Refund",
              "Investment",
              "Donation",
              "Other",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Transaction date
          <input
            name="date"
            type="date"
            defaultValue={record.date || today()}
          />
        </label>
        <label>
          Status
          <select name="status" defaultValue={record.status || "Draft"}>
            {["Draft", "Pending", "Completed", "Cancelled"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Tag
          <select name="tag" defaultValue={record.tag || ""}>
            {[
              "",
              "Verified",
              "Pending review",
              "Flagged",
              "Urgent",
              "On hold",
              "Approved",
            ].map((x) => (
              <option key={x || "none"}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Security key
          <div className="input-action">
            <input
              name="key"
              id="security-key"
              readOnly
              defaultValue={
                record.key || Math.floor(100000 + Math.random() * 900000)
              }
            />
            <Icon name="ShieldCheck" />
          </div>
        </label>
        <label className="full">
          Remark
          <textarea name="remark" defaultValue={record.remark} />
        </label>
        <div className="full modal-actions">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button className="primary">
            {isNew ? "Create transaction" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function HandoffModal({ record, close, confirm, setToast }) {
  const receiverId = (record.receiver || "receiver")
    .normalize("NFKD")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 10);
  const transferId = String(record.id)
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  const claimCode = `DC1-${transferId}-${receiverId}-${record.key}`;
  const [qr, setQr] = useState("");
  const [presented, setPresented] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  useEffect(() => {
    QRCode.toDataURL(claimCode, {
      margin: 2,
      width: 260,
      errorCorrectionLevel: "H",
    }).then(setQr);
  }, [claimCode]);
  const verify = () => {
    if (presented.trim().toUpperCase() !== claimCode) {
      setError(
        "Code does not match this transfer and receiver. Do not release cash.",
      );
      return;
    }
    confirm();
  };
  const download = () => {
    const text = [
      "DATACHAT CASH HANDOFF",
      `Transfer: ${record.id}`,
      `Receiver: ${record.receiver}`,
      `Amount: ${money(record.amount, record.currency)}`,
      `Claim code: ${claimCode}`,
      "Only present this code to the authorized sender or cash agent.",
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `${record.id}-${receiverId}-handoff.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const acceptClaimScan = (value) => {
    if (!value) throw new Error("The QR scan was cancelled.");
    setPresented(value);
    setError("");
    setToast("QR code read. Confirm to validate it.");
  };
  const scanCamera = async () => {
    try {
      acceptClaimScan(
        await scanNativeQr("Place the DataChat cash handoff QR inside the frame"),
      );
    } catch (error) {
      setError(error.message || "No readable DataChat QR code was found.");
    }
  };
  const scanFile = async (file) => {
    if (!file) return;
    try {
      acceptClaimScan(await scanQrImage(file, "qr-file-reader"));
    } catch (error) {
      setError(
        error.message || "No readable DataChat QR code was found in that image.",
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  return (
    <Modal title="Secure cash handoff" close={close} wide>
      <div className="handoff-grid">
        <section className="claim-card">
          <span className="eyebrow">RECEIVER CLAIM</span>
          <h3>{record.receiver}</h3>
          <p>
            {record.id} · {money(record.amount, record.currency)}
          </p>
          {qr && (
            <img src={qr} alt={`Cash handoff QR code for ${record.receiver}`} />
          )}
          <code>{claimCode}</code>
          <div className="claim-actions">
            <button
              className="secondary"
              onClick={() => {
                navigator.clipboard?.writeText(claimCode);
                setToast("Receiver claim code copied");
              }}
            >
              <Icon name="Copy" />
              Copy text
            </button>
            <button className="secondary" onClick={download}>
              <Icon name="FileDown" />
              Download .txt
            </button>
          </div>
          <small>
            Give this QR or text code only to {record.receiver}. The six-digit
            secret remains bound to their name and this transfer.
          </small>
        </section>
        <section className="verify-card">
          <span className="eyebrow">CASH AGENT CHECK</span>
          <h3>Verify before releasing cash</h3>
          <p>
            Ask the receiver to present their complete DataChat claim code. The
            receiver name and transfer reference must match.
          </p>
          <label>
            Presented text code
            <textarea
              value={presented}
              onChange={(e) => {
                setPresented(e.target.value);
                setError("");
              }}
              placeholder={claimCode}
            />
          </label>
          <div id="qr-file-reader" className="qr-reader" />
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="image/*"
            onChange={(e) => scanFile(e.target.files?.[0])}
          />
          <button
            className="secondary full-btn"
            onClick={isNativeApp() ? scanCamera : () => fileRef.current?.click()}
          >
            <Icon name="ScanQrCode" />
            {isNativeApp() ? "Open QR camera" : "Choose QR image"}
          </button>
          {isNativeApp() && (
            <button
              className="secondary full-btn"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="ImagePlus" />
              Choose QR image instead
            </button>
          )}
          {error && <div className="error">{error}</div>}
          <button className="primary full-btn" onClick={verify}>
            <Icon name="ShieldCheck" />
            Validate and release cash
          </button>
          <small className="warning">
            <Icon name="TriangleAlert" />
            Never release cash from a screenshot or six-digit number alone;
            validate the complete receiver-bound code.
          </small>
        </section>
      </div>
    </Modal>
  );
}
function Review({ records, close, update }) {
  return (
    <Modal title={`Review queue (${records.length})`} close={close} wide>
      <div className="review-list">
        {records.map((r) => (
          <article>
            <div>
              <span className="mono">{r.id}</span>
              <h3>
                {r.sender} → {r.receiver}
              </h3>
              <p>
                {r.from} to {r.to} · {money(r.amount, r.currency)} · {r.date}
              </p>
              <small>{r.remark}</small>
            </div>
            <div>
              <button
                className="secondary danger"
                onClick={() => update(r.id, { tag: "Flagged" })}
              >
                <Icon name="X" />
                Reject
              </button>
              <button
                className="primary"
                onClick={() =>
                  update(r.id, { status: "Completed", tag: "Verified" })
                }
              >
                <Icon name="Check" />
                Approve
              </button>
            </div>
          </article>
        ))}
        {!records.length && (
          <Empty
            icon="ClipboardCheck"
            title="Review queue is clear"
            text="Pending transactions will appear here."
          />
        )}
      </div>
    </Modal>
  );
}
function Reports({ db, user }) {
  const rows = db.records.filter((x) => x.owner === user.id),
    months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ],
    monthly = months.map((m, i) => ({
      name: m,
      value: rows
        .filter(
          (r) => new Date(r.date).getMonth() === i && r.status === "Completed",
        )
        .reduce((a, x) => a + x.amount, 0),
    })),
    cats = Object.entries(
      rows.reduce(
        (a, r) => ((a[r.category] = (a[r.category] || 0) + r.amount), a),
        {},
      ),
    ).map(([name, value]) => ({ name, value })),
    colors = ["#d7a62b", "#5d92d6", "#45b687", "#9a75da", "#e36e6e"];
  return (
    <div className="page">
      <Header
        title="Reports"
        sub="A clear view of transaction performance and transfer corridors"
      />
      <Stats records={rows} />
      <div className="charts">
        <section className="panel chart-wide">
          <div className="panel-title">
            <div>
              <h2>Completed volume</h2>
              <p>Monthly transaction value for 2026</p>
            </div>
            <span className="badge completed">Live data</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthly}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#111b2d",
                  border: "1px solid #2a3850",
                  borderRadius: 10,
                }}
              />
              <Bar dataKey="value" fill="#d7a62b" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>By category</h2>
              <p>Share of transfer volume</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={cats}
                dataKey="value"
                innerRadius={58}
                outerRadius={86}
                paddingAngle={3}
              >
                {cats.map((x, i) => (
                  <Cell key={x.name} fill={colors[i % colors.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "#111b2d",
                  border: "1px solid #2a3850",
                  borderRadius: 10,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend">
            {cats.map((x, i) => (
              <span key={x.name}>
                <i style={{ background: colors[i % colors.length] }} />
                {x.name}
                <b>{money(x.value)}</b>
              </span>
            ))}
          </div>
        </section>
      </div>
      <section className="panel corridors">
        <div className="panel-title">
          <div>
            <h2>Transfer corridors</h2>
            <p>Activity grouped by sender country</p>
          </div>
        </div>
        {Object.entries(
          rows.reduce((a, r) => {
            const k = r.from + " → " + r.to;
            a[k] = (a[k] || 0) + r.amount;
            return a;
          }, {}),
        )
          .sort((a, b) => b[1] - a[1])
          .map(([k, v], i) => (
            <div key={k}>
              <span>{i + 1}</span>
              <b>{k}</b>
              <em>{money(v)}</em>
            </div>
          ))}
      </section>
    </div>
  );
}
function AdminConsole({ db, save, user, setToast }) {
  const [codeModal, setCodeModal] = useState(false);
  const users = db.users.filter((x) => x.role !== "admin");
  const codes = db.accessCodes || [];
  const updateUser = (id, changes) => {
    save((d) => ({
      ...d,
      users: d.users.map((x) => (x.id === id ? { ...x, ...changes } : x)),
    }));
    setToast("Account access updated");
  };
  const saveConfig = (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    save((d) => ({ ...d, adminConfig: values }));
    setToast("Admin links saved");
  };
  return (
    <div className="page admin-page">
      <Header
        title="Administration"
        sub="Control account access, plans, payment links and cash codes"
        actions={
          <button className="primary" onClick={() => setCodeModal(true)}>
            <Icon name="TicketCheck" />
            Generate access code
          </button>
        }
      />
      <div className="admin-privacy">
        <Icon name="LockKeyhole" />
        <div>
          <b>Account metadata only</b>
          <p>
            This console intentionally cannot display private messages,
            contacts, transactions, security keys, or user backups.
          </p>
        </div>
      </div>
      <div className="stats">
        <Stat
          icon="Users"
          label="User accounts"
          value={users.length}
          note="Excludes administrators"
        />
        <Stat
          icon="UserCheck"
          label="Active access"
          value={
            users.filter((x) => (x.status || "active") === "active").length
          }
          note="Can sign in"
        />
        <Stat
          icon="Crown"
          label="Pro accounts"
          value={users.filter((x) => x.plan === "Pro").length}
          note="Premium access"
        />
        <Stat
          icon="TicketCheck"
          label="Unused codes"
          value={codes.filter((x) => x.status === "available").length}
          note="Ready to redeem"
        />
      </div>
      <section className="panel admin-links">
        <div className="panel-title">
          <div>
            <h2>Repository, payment and support links</h2>
            <p>These appear in the agreement and account-access experience.</p>
          </div>
        </div>
        <form className="admin-link-form" onSubmit={saveConfig}>
          <label>
            Repository URL
            <input
              name="repositoryUrl"
              type="url"
              defaultValue={db.adminConfig?.repositoryUrl}
            />
          </label>
          <label>
            Online payment URL
            <input
              name="paymentUrl"
              type="url"
              defaultValue={db.adminConfig?.paymentUrl}
              placeholder="https://payment-provider.example/..."
            />
          </label>
          <label>
            Support email
            <input
              name="supportEmail"
              type="email"
              defaultValue={db.adminConfig?.supportEmail}
            />
          </label>
          <button className="primary">
            <Icon name="Save" />
            Save links
          </button>
        </form>
      </section>
      <section className="panel admin-section">
        <div className="panel-title">
          <div>
            <h2>Account access</h2>
            <p>
              Identity metadata and access controls—no private workspace
              content.
            </p>
          </div>
        </div>
        <div className="admin-users">
          {users.map((account) => (
            <article key={account.id}>
              <div className="avatar">
                {account.name
                  .split(" ")
                  .map((x) => x[0])
                  .slice(0, 2)}
              </div>
              <div className="admin-identity">
                <b>{account.name}</b>
                <span>{account.email}</span>
                <small>
                  Joined{" "}
                  {account.createdAt
                    ? new Date(account.createdAt).toLocaleDateString()
                    : "before tracking"}{" "}
                  · ID {account.id}
                </small>
              </div>
              <label>
                Plan
                <select
                  value={account.plan || "Free"}
                  onChange={(e) =>
                    updateUser(account.id, { plan: e.target.value })
                  }
                >
                  <option>Free</option>
                  <option>Pro</option>
                </select>
              </label>
              <label>
                Status
                <select
                  value={account.status || "active"}
                  onChange={(e) =>
                    updateUser(account.id, { status: e.target.value })
                  }
                >
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="suspended">Suspended</option>
                </select>
              </label>
            </article>
          ))}
        </div>
      </section>
      <section className="panel admin-section">
        <div className="panel-title">
          <div>
            <h2>Cash and invitation codes</h2>
            <p>
              One-time codes issued after the administrator confirms payment or
              eligibility.
            </p>
          </div>
        </div>
        <div className="code-list">
          {codes.map((item) => (
            <div key={item.id}>
              <code>{item.code}</code>
              <span
                className={
                  "badge " + (item.status === "available" ? "completed" : "")
                }
              >
                {item.status}
              </span>
              <b>{item.plan}</b>
              <span>
                {item.paymentMethod} {item.amount ? "· " + item.amount : ""}
              </span>
              <small>
                {item.usedBy || new Date(item.createdAt).toLocaleDateString()}
              </small>
              <button
                className="icon-btn"
                onClick={() => navigator.clipboard?.writeText(item.code)}
                aria-label={"Copy " + item.code}
              >
                <Icon name="Copy" />
              </button>
            </div>
          ))}
        </div>
      </section>
      {codeModal && (
        <AccessCodeModal
          save={save}
          close={() => setCodeModal(false)}
          setToast={setToast}
        />
      )}
    </div>
  );
}
function AccessCodeModal({ save, close, setToast }) {
  const submit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const raw = Array.from(bytes)
      .map((x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32])
      .join("");
    const code = "DC-" + raw.slice(0, 3) + "-" + raw.slice(3);
    save((d) => ({
      ...d,
      accessCodes: [
        {
          id: uid("code"),
          code,
          plan: f.plan,
          paymentMethod: f.paymentMethod,
          amount: f.amount,
          note: f.note,
          status: "available",
          createdAt: new Date().toISOString(),
        },
        ...(d.accessCodes || []),
      ],
    }));
    navigator.clipboard?.writeText(code);
    setToast("Access code " + code + " generated and copied");
    close();
  };
  return (
    <Modal title="Generate one-time access code" close={close}>
      <form className="form" onSubmit={submit}>
        <div className="premium-note">
          <Icon name="ShieldCheck" />
          <div>
            <b>Single redemption</b>
            <small>
              The code becomes unusable after one successful registration.
            </small>
          </div>
        </div>
        <label>
          Access plan
          <select name="plan">
            <option>Free</option>
            <option>Pro</option>
          </select>
        </label>
        <label>
          Payment method
          <select name="paymentMethod">
            <option>Cash</option>
            <option>Online payment</option>
            <option>Complimentary invitation</option>
          </select>
        </label>
        <label>
          Amount or receipt reference
          <input name="amount" placeholder="e.g. 25 USD or receipt #1024" />
        </label>
        <label>
          Administrator note
          <textarea
            name="note"
            placeholder="Optional internal reason for issuing this code."
          />
        </label>
        <button className="primary">
          <Icon name="WandSparkles" />
          Generate and copy code
        </button>
      </form>
    </Modal>
  );
}
const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (text) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function encryptBackup(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return JSON.stringify({
    format: "datachat-encrypted-backup",
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  });
}
async function decryptBackup(text, password) {
  const packed = JSON.parse(text);
  if (packed.format !== "datachat-encrypted-backup")
    throw new Error("Unsupported backup format");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(packed.salt),
      iterations: 250000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(packed.iv) },
    key,
    base64ToBytes(packed.data),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}
function BackupPanel({ db, save, user, setToast }) {
  const [password, setPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const userBackup = () => ({
    exportedAt: new Date().toISOString(),
    user: { id: user.id, name: user.name, email: user.email, plan: user.plan },
    records: db.records.filter((x) => x.owner === user.id),
    contacts: db.contacts.filter((x) => x.owner === user.id),
    messages: db.messages.filter((x) => x.owner === user.id),
    notifications: (db.notifications || []).filter((x) => x.owner === user.id),
    rateOffers: (db.rateOffers || []).filter((x) => x.owner === user.id),
    reports: (db.reports || []).filter((x) => x.reporterId === user.id),
  });
  const createBackup = async (share) => {
    if (password.length < 8)
      return setToast("Use a backup password of at least 8 characters");
    setBusy(true);
    try {
      const encrypted = await encryptBackup(userBackup(), password);
      const file = new File(
        [encrypted],
        "datachat-backup-" + today() + ".dcbackup",
        { type: "application/json" },
      );
      if (share && navigator.share && navigator.canShare?.({ files: [file] }))
        await navigator.share({
          title: "Encrypted DataChat backup",
          text: "Store this encrypted backup safely.",
          files: [file],
        });
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      setToast(share ? "Backup ready to share" : "Encrypted backup downloaded");
    } catch {
      setToast("Backup could not be created");
    } finally {
      setBusy(false);
    }
  };
  const storeRecoveryCopy = async () => {
    if (user.plan !== "Pro")
      return setToast("Administrator recovery storage is a Pro feature");
    if (password.length < 8)
      return setToast("Use a backup password of at least 8 characters");
    if (
      !confirm(
        "Store an encrypted recovery copy with the administrator? The administrator cannot open it without your password.",
      )
    )
      return;
    setBusy(true);
    try {
      const encrypted = await encryptBackup(userBackup(), password);
      const item = {
        id: uid("recovery"),
        owner: user.id,
        userName: user.name,
        userEmail: user.email,
        filename: `datachat-recovery-${user.id}-${today()}.dcbackup`,
        encrypted,
        passwordHint: passwordHint.trim(),
        createdAt: new Date().toISOString(),
        format: "AES-256-GCM",
        status: "stored",
      };
      save((d) => ({
        ...d,
        recoveryBackups: [
          item,
          ...(d.recoveryBackups || []).filter((x) => x.owner !== user.id),
        ],
      }));
      setToast("Encrypted recovery copy stored in the admin vault");
    } catch {
      setToast("Recovery copy could not be stored");
    } finally {
      setBusy(false);
    }
  };
  const restore = async (file) => {
    if (!file || password.length < 8)
      return setToast("Choose a backup and enter its password");
    if (
      !confirm(
        "Restore this backup? Current workspace data for your account will be replaced.",
      )
    )
      return;
    setBusy(true);
    try {
      const data = await decryptBackup(await file.text(), password);
      if (!data.user || !Array.isArray(data.records)) throw new Error();
      const scoped = (items, key = "owner") =>
        (items || []).map((x) => ({ ...x, [key]: user.id }));
      save((d) => ({
        ...d,
        records: [
          ...d.records.filter((x) => x.owner !== user.id),
          ...scoped(data.records),
        ],
        contacts: [
          ...d.contacts.filter((x) => x.owner !== user.id),
          ...scoped(data.contacts),
        ],
        messages: [
          ...d.messages.filter((x) => x.owner !== user.id),
          ...scoped(data.messages),
        ],
        notifications: [
          ...(d.notifications || []).filter((x) => x.owner !== user.id),
          ...scoped(data.notifications),
        ],
        rateOffers: [
          ...(d.rateOffers || []).filter((x) => x.owner !== user.id),
          ...scoped(data.rateOffers),
        ],
        reports: [
          ...(d.reports || []).filter((x) => x.reporterId !== user.id),
          ...scoped(data.reports, "reporterId"),
        ],
      }));
      setToast("Backup restored successfully");
    } catch {
      setToast("Restore failed. Check the file and backup password.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel backup-card">
      <div className="panel-title">
        <div>
          <h2>Encrypted backup & recovery</h2>
          <p>
            Export your entire private workspace without giving administrators
            access.
          </p>
        </div>
        <Icon name="CloudCog" />
      </div>
      <label>
        Backup password
        <input
          type="password"
          minLength="8"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
        <small>
          This password is never stored. If you forget it, the backup cannot be
          opened.
        </small>
      </label>
      {user.plan === "Pro" && (
        <label>
          Password hint for recovery (optional)
          <input
            value={passwordHint}
            onChange={(e) => setPasswordHint(e.target.value)}
            maxLength="80"
            placeholder="A hint only—not the password"
          />
          <small>
            The administrator can see this hint but never receives your
            password.
          </small>
        </label>
      )}
      <div className="backup-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => createBackup(false)}
        >
          <Icon name="Download" />
          Save to phone
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => createBackup(true)}
        >
          <Icon name="Share2" />
          Share to Drive or Gmail
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="History" />
          Restore backup
        </button>
        {user.plan === "Pro" && (
          <button
            className="primary"
            disabled={busy}
            onClick={storeRecoveryCopy}
          >
            <Icon name="Vault" />
            Store with admin
          </button>
        )}
        <input
          ref={fileRef}
          hidden
          type="file"
          accept=".dcbackup,application/json"
          onChange={(e) => restore(e.target.files?.[0])}
        />
      </div>
      <div className="backup-scope">
        <Icon name="LockKeyhole" />
        <span>
          Includes your records, contacts, messages, notifications, market
          offers, and reports. AES-256-GCM encrypted on this device.
        </span>
      </div>
      {user.plan === "Pro" && (
        <div className="vault-status">
          <Icon name="ShieldCheck" />
          <span>
            <b>Pro recovery vault</b>
            <small>
              {(db.recoveryBackups || []).some((x) => x.owner === user.id)
                ? `Encrypted copy stored ${new Date((db.recoveryBackups || []).find((x) => x.owner === user.id).createdAt).toLocaleDateString()}`
                : "No administrator recovery copy stored yet"}
            </small>
          </span>
        </div>
      )}
    </section>
  );
}
function Settings({
  db,
  save,
  user,
  logout,
  setToast,
  onPlanChanged,
  biometricAvailable,
  biometricEnabled,
  onBiometricChange,
}) {
  const [agreement, setAgreement] = useState(false),
    [geez, setGeez] = useState(localStorage.getItem("geez") === "true"),
    [billing, setBilling] = useState({ configured: false, priceLabel: "Set in Stripe" }),
    [billingBusy, setBillingBusy] = useState(false),
    [billingError, setBillingError] = useState(""),
    [permissionStatus, setPermissionStatus] = useState(""),
    [permissionRequest, setPermissionRequest] = useState(null),
    [verifyEmailOpen, setVerifyEmailOpen] = useState(false),
    [verifyEmailSent, setVerifyEmailSent] = useState(false),
    [verifyEmailBusy, setVerifyEmailBusy] = useState(false);
  useEffect(() => {
    fetch(apiUrl("/api/stripe/config"))
      .then((response) => response.json())
      .then(setBilling)
      .catch(() => setBilling({ configured: Boolean(STRIPE_PAYMENT_LINK), paymentLink: STRIPE_PAYMENT_LINK, priceLabel: STRIPE_PAYMENT_LINK ? "Stripe test checkout" : "Server unavailable" }));
  }, []);
  const startCardCheckout = async () => {
    if (cloudConfigured && !user.emailVerified) {
      setBillingError("Verify your email before upgrading to Pro.");
      setVerifyEmailOpen(true);
      return;
    }
    setBillingBusy(true);
    setBillingError("");
    try {
      const response = await fetch(apiUrl("/api/stripe/create-checkout-session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, email: user.email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Checkout could not start.");
      window.location.assign(result.url);
    } catch (error) {
      const fallbackPaymentLink =
        billing.paymentLink ||
        db.adminConfig?.paymentUrl ||
        STRIPE_PAYMENT_LINK;
      if (fallbackPaymentLink) {
        const checkout = new URL(fallbackPaymentLink);
        checkout.searchParams.set("prefilled_email", user.email);
        checkout.searchParams.set("client_reference_id", user.id);
        window.location.assign(checkout.toString());
        return;
      }
      setBillingError(`${error.message} Contact the administrator or try again later.`);
      setBillingBusy(false);
    }
  };
  const redeemCashCode = async (event) => {
    event.preventDefault();
    setBillingError("");
    if (cloudConfigured && !user.emailVerified) {
      setVerifyEmailOpen(true);
      return setBillingError("Verify your email before activating Pro.");
    }
    const code = new FormData(event.currentTarget).get("cashCode").trim().toUpperCase();
    try {
      const match = cloudConfigured
        ? await redeemProAccessCode(code)
        : (db.accessCodes || []).find(
            (item) =>
              item.code.toUpperCase() === code &&
              item.status === "available",
          );
      if (!match)
        throw new Error("Code not found, expired, or already used.");
      const now = new Date().toISOString();
      save((d) => ({
        ...d,
        users: d.users.map((x) =>
          x.id === user.id
            ? { ...x, plan: "Pro", cashCodeId: match.id }
            : x,
        ),
        accessCodes: (d.accessCodes || []).map((x) =>
          x.id === match.id
            ? {
                ...x,
                status: "used",
                usedBy: user.email,
                usedByName: user.name,
                usedById: user.id,
                usedAt: now,
              }
            : x,
        ),
      }));
      onPlanChanged({ plan: "Pro", cashCodeId: match.id });
      event.currentTarget.reset();
      setToast("Cash code accepted. DataChat Pro is now active.");
    } catch (error) {
      setBillingError(error.message);
    }
  };
  const choosePhoto = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024)
      return setToast("Choose a JPG, PNG or WebP image under 2 MB");
    try {
      const profilePhoto = cloudConfigured ? await uploadProfilePhoto(user.id, file) : await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      save((d) => ({
        ...d,
        users: d.users.map((x) =>
          x.id === user.id ? { ...x, profilePhoto } : x,
        ),
      }));
      setToast("Profile picture updated");
    } catch (error) {
      setToast(`Profile picture failed: ${error.message}`);
    }
  };
  const changeCommunityVisibility = async (visible) => {
    try {
      if (cloudConfigured) await updateCommunityVisibility(visible);
      save((state) => ({
        ...state,
        users: state.users.map((account) =>
          account.id === user.id
            ? { ...account, visibleInCommunity: visible }
            : account,
        ),
      }));
      setToast(
        visible
          ? "Your public profile is now visible in Community."
          : "Your profile is hidden. Your QR code still works.",
      );
    } catch (error) {
      setToast(`Visibility update failed: ${error.message}`);
    }
  };
  return (
    <div className="page settings">
      <Header
        title="Settings"
        sub="Manage your workspace, appearance and privacy"
      />
      <section className="profile panel">
        <div className="profile-photo-control">
          <UserAvatar person={user} large />
          <label className="photo-button" title="Choose profile picture">
            <Icon name="Camera" />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => choosePhoto(e.target.files?.[0])}
            />
          </label>
        </div>
        <div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
        </div>
        <span className="pro">
          <Icon name="Crown" />
          {user.plan}
        </span>
      </section>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Email &amp; recovery</h2>
              <p>Verify ownership and recover account access</p>
            </div>
          </div>
          <Setting
            icon={user.emailVerified ? "BadgeCheck" : "MailWarning"}
            title="Email verification"
            text={
              user.emailVerified
                ? `${user.email} is verified`
                : "Free messaging works now; verification is required for Pro"
            }
          >
            {user.emailVerified ? (
              <span className="badge completed">Verified</span>
            ) : (
              <button
                className="secondary"
                onClick={() => setVerifyEmailOpen(true)}
              >
                Verify
              </button>
            )}
          </Setting>
          <Setting
            icon="KeyRound"
            title="Forgot password"
            text="Send a recovery code from the sign-in page"
          >
            <button
              className="secondary"
              onClick={() => {
                localStorage.setItem("dc-open-recovery", "1");
                logout();
              }}
            >
              Open recovery
            </button>
          </Setting>
          <Setting
            icon="UsersRound"
            title="Community visibility"
            text={
              user.visibleInCommunity
                ? "Members can discover your public name, username, country, and photo"
                : "Hidden from discovery; people can still add you using your QR"
            }
          >
            <label className="switch">
              <input
                type="checkbox"
                checked={Boolean(user.visibleInCommunity)}
                onChange={(event) =>
                  changeCommunityVisibility(event.target.checked)
                }
              />
              <span />
            </label>
          </Setting>
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Device security</h2>
              <p>Protect an active session when the mobile app opens</p>
            </div>
          </div>
          <Setting
            icon="Fingerprint"
            title="Biometric access"
            text={
              isNativeApp()
                ? biometricAvailable
                  ? "Unlock with fingerprint, face, or device PIN"
                  : "Set up biometrics or a device PIN in phone settings first"
                : "Available in the installed Android and iOS apps"
            }
          >
            <label className="switch">
              <input
                type="checkbox"
                checked={biometricEnabled}
                disabled={!isNativeApp()}
                onChange={async (event) => {
                  const enabled = event.target.checked;
                  try {
                    await onBiometricChange(enabled);
                  } catch (error) {
                    setToast(error.message);
                  }
                }}
              />
              <span />
            </label>
          </Setting>
          <p className="form-note">
            Biometric access protects this device after login. Your DataChat
            username and password remain the account recovery method.
          </p>
          <Setting
            icon="BellRing"
            title="Message notifications"
            text="Show an alert when a new direct message arrives"
          >
            <button
              className="secondary"
              onClick={() => setPermissionRequest("notifications")}
            >
              Enable
            </button>
          </Setting>
          <Setting
            icon="Mic"
            title="Microphone"
            text="Required only for Pro voice messages"
          >
            <button
              className="secondary"
              onClick={() => setPermissionRequest("microphone")}
            >
              Check
            </button>
          </Setting>
          {permissionStatus && (
            <p className="form-note">{permissionStatus}</p>
          )}
          {isNativeApp() &&
            permissionStatus.toLowerCase().includes("blocked") && (
              <button
                type="button"
                className="secondary full-btn"
                onClick={() => openNativeAppSettings().catch(() => {})}
              >
                <Icon name="Settings" />
                Open Android app permissions
              </button>
            )}
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Appearance</h2>
              <p>Personalize your input experience</p>
            </div>
          </div>
          <Setting
            icon="Languages"
            title="Ge'ez keyboard"
            text="Show Ethiopic input tools in text fields"
          >
            <label className="switch">
              <input
                type="checkbox"
                checked={geez}
                onChange={(e) => {
                  setGeez(e.target.checked);
                  localStorage.setItem("geez", e.target.checked);
                }}
              />
              <span />
            </label>
          </Setting>
          <Setting
            icon="Moon"
            title="Dark appearance"
            text="Optimized for clarity and low light"
          >
            <span className="badge completed">Active</span>
          </Setting>
        </section>
        {user.role !== "admin" && (
          <BackupPanel db={db} save={save} user={user} setToast={setToast} />
        )}
        <section className="panel pro-card">
          <span className="eyebrow">DATACHAT PRO</span>
          <h2>Professional privileges</h2>
          <p>
            Unlimited records, CSV portability, advanced reports, priority
            support, and secure external backup readiness.
          </p>
          <ul>
            <li>
              <Icon name="Check" />
              Unlimited transaction records
            </li>
            <li>
              <Icon name="Check" />
              Approval workflows & audit trail
            </li>
            <li>
              <Icon name="Check" />
              Advanced analytics and exports
            </li>
          </ul>
          {user.plan === "Pro" ? (
            <div className="billing-active" role="status">
              <Icon name="BadgeCheck" />
              <span><b>Pro is active</b><small>Your premium features are unlocked.</small></span>
            </div>
          ) : (
            <div className="billing-options">
              <div className="billing-choice">
                <span className="billing-icon"><Icon name="CreditCard" /></span>
                <div><b>Card subscription</b><small>{billing.priceLabel} · processed securely by Stripe</small></div>
                <button className="primary" disabled={billingBusy} onClick={startCardCheckout}>
                  {billingBusy ? "Opening checkout…" : "Pay securely by card"}
                </button>
              </div>
              {!billing.configured && <p className="billing-note"><Icon name="Info" /> Card checkout is temporarily unavailable. You can still use an administrator cash code.</p>}
              <div className="billing-divider"><span>or pay cash</span></div>
              <form className="cash-code-form" onSubmit={redeemCashCode}>
                <label htmlFor="cash-code">Administrator activation code</label>
                <div><input id="cash-code" name="cashCode" required autoComplete="one-time-code" placeholder="DC-ABC-123" /><button className="secondary">Activate Pro</button></div>
                <small>Pay the administrator in cash, then enter the unique unused code you receive.</small>
              </form>
              {billingError && <div className="error billing-error" role="alert">{billingError}</div>}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Privacy & legal</h2>
              <p>How DataChat protects your workspace</p>
            </div>
          </div>
          <Setting
            icon="ShieldCheck"
            title="Private agreement"
            text="Data ownership, confidentiality and acceptable use"
          >
            <button className="icon-btn" onClick={() => setAgreement(true)}>
              <Icon name="ChevronRight" />
            </button>
          </Setting>
          <Setting
            icon="Database"
            title="Data isolation"
            text="Records are scoped to your authenticated user"
          >
            <span className="badge completed">Protected</span>
          </Setting>
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>About</h2>
              <p>Product and account information</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Application</dt>
              <dd>DataChat</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>1.3.3</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{user.plan}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>Private Supabase workspace</dd>
            </div>
          </dl>
          <button className="secondary danger full-btn" onClick={logout}>
            <Icon name="LogOut" />
            Sign out
          </button>
        </section>
      </div>
      {permissionRequest && (
        <Modal
          title={permissionRequest === "notifications" ? "Enable message alerts" : "Enable voice messages"}
          close={() => setPermissionRequest(null)}
        >
          <div className="permission-consent">
            <span className="permission-consent-icon">
              <Icon name={permissionRequest === "notifications" ? "BellRing" : "Mic"} size={32} />
            </span>
            <h3>{permissionRequest === "notifications" ? "Never miss a new message" : "Record and send your voice"}</h3>
            <p>
              {permissionRequest === "notifications"
                ? "DataChat will ask Android to show private, high-priority message alerts. You can change this later in phone settings."
                : "DataChat uses the microphone only while you are recording a voice message. Recording stops when you tap stop or leave the chat."}
            </p>
            <button
              className="primary full-btn"
              onClick={async () => {
                const requested = permissionRequest;
                setPermissionRequest(null);
                try {
                  if (requested === "notifications") {
                    const granted = await requestNotificationPermission();
                    setPermissionStatus(granted ? "Notifications enabled" : "Notification permission was not granted");
                  } else {
                    const stream = await requestMicrophonePermission();
                    stream.getTracks().forEach((track) => track.stop());
                    setPermissionStatus("Microphone enabled");
                  }
                } catch (error) {
                  setPermissionStatus(`${requested === "microphone" ? "Microphone" : "Notification"} permission is blocked: ${error.message}`);
                }
              }}
            >
              <Icon name="ShieldCheck" />
              Continue to phone permission
            </button>
            <button className="secondary full-btn" onClick={() => setPermissionRequest(null)}>Not now</button>
          </div>
        </Modal>
      )}
      {verifyEmailOpen && (
        <Modal
          title="Verify your email"
          close={() => {
            setVerifyEmailOpen(false);
            setVerifyEmailSent(false);
          }}
        >
          <form
            className="form"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                setVerifyEmailBusy(true);
                if (!verifyEmailSent) {
                  await requestEmailOtp(user.email, {}, false);
                  setVerifyEmailSent(true);
                  setToast(`Verification code sent to ${user.email}`);
                  return;
                }
                const token = new FormData(event.currentTarget).get("otp");
                await verifyEmailOtp(user.email, token, "email");
                await markEmailVerified();
                onPlanChanged({ emailVerified: true });
                save((current) => ({
                  ...current,
                  users: current.users.map((account) =>
                    account.id === user.id
                      ? { ...account, emailVerified: true }
                      : account,
                  ),
                }));
                setVerifyEmailOpen(false);
                setToast("Email verified. Pro activation is now available.");
              } catch (error) {
                setToast(`Email verification failed: ${error.message}`);
              } finally {
                setVerifyEmailBusy(false);
              }
            }}
          >
            <p className="form-note">
              We will send an eight-digit code to <b>{user.email}</b>. Check
              Spam or Promotions if it is not in your inbox.
            </p>
            {verifyEmailSent && (
              <label>
                Verification code
                <input
                  name="otp"
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  minLength="8"
                  maxLength="8"
                  required
                  autoComplete="one-time-code"
                  placeholder="Enter 8 digits"
                />
              </label>
            )}
            <button className="primary" disabled={verifyEmailBusy}>
              {verifyEmailBusy
                ? "Please wait…"
                : verifyEmailSent
                  ? "Confirm email"
                  : "Send verification code"}
            </button>
          </form>
        </Modal>
      )}
      {agreement && (
        <Modal title="Private agreement" close={() => setAgreement(false)} wide>
          <div className="legal">
            <p>Effective July 18, 2026</p>
            <h3>1. Your data</h3>
            <p>
              You retain ownership of the information you enter. DataChat
              separates records by authenticated account and does not
              intentionally expose one user's workspace to another.
            </p>
            <h3>1A. Limited administrator access</h3>
            <p>
              Administrators may view account metadata such as your name, email,
              plan, account status, registration date, and access-code history
              to operate the service. The administrator console is not
              authorized to display your messages, contacts, financial records,
              transaction security keys, or encrypted backup contents.
            </p>
            <h3>2. Financial responsibility</h3>
            <p>
              DataChat is a recordkeeping and communication tool, not a bank or
              money transmitter. Users remain responsible for verifying
              identities, payment instructions, exchange rates, and legal
              compliance.
            </p>
            <h3>3. Security keys</h3>
            <p>
              Transaction security keys are shared secrets. Exchange them only
              with the intended sender or receiver and never treat them as a
              replacement for regulated identity verification.
            </p>
            <h3>4. Confidentiality and retention</h3>
            <p>
              Keep credentials private. Export important records for backup. In
              this standalone edition, information is stored in this browser and
              may be lost if browser storage is cleared.
            </p>
            <h3>5. Acceptable use</h3>
            <p>
              Do not use DataChat for fraud, sanctions evasion, money
              laundering, harassment, or any unlawful activity.
            </p>
            <h3>6. Consent</h3>
            <p>
              By using the application you acknowledge this agreement and accept
              responsibility for the accuracy and lawful use of your records.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Setting({ icon, title, text, children }) {
  return (
    <div className="setting">
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <b>{title}</b>
        <small>{text}</small>
      </div>
      {children}
    </div>
  );
}
function Modal({ title, close, children, wide }) {
  return createPortal(
    <motion.div
      className="scrim"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <motion.section
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="X" />
          </button>
        </div>
        {children}
      </motion.section>
    </motion.div>,
    document.body,
  );
}
function Empty({ icon, title, text }) {
  return (
    <div className="empty">
      <span>
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export default App;
