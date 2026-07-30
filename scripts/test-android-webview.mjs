const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("DataChat Android WebView was not found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
const command = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

await command("Runtime.enable");
const result = await command("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const plugins = window.Capacitor?.Plugins || {};
    const notification = await plugins.LocalNotifications.checkPermissions();
    if (notification.display === "granted") {
      await plugins.LocalNotifications.createChannel({
        id: "datachat-messages",
        name: "DataChat messages",
        description: "Native verification channel",
        importance: 4,
        visibility: 0,
        vibration: true
      });
      await plugins.LocalNotifications.schedule({
        notifications: [{
          id: 132005,
          title: "DataChat verification",
          body: "Notification permission is working",
          channelId: "datachat-messages",
          extra: { verification: true }
        }]
      });
    }
    let microphone = "granted";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      microphone = error.name + ": " + error.message;
    }
    return {
      nativeSettingsPlugin: Boolean(plugins.DataChatNativeSettings),
      localNotificationsPlugin: Boolean(plugins.LocalNotifications),
      notification,
      microphone
    };
  })()`,
});
socket.close();

if (result.exceptionDetails) {
  throw new Error(result.exceptionDetails.text || "Android WebView test failed.");
}
console.log(JSON.stringify(result.result.value, null, 2));
