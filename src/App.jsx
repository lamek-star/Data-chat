import React, { useEffect, useMemo, useRef, useState } from "react";
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
const seed = {
  users: [
    {
      id: "demo",
      name: "Abel Tesfaye",
      email: "demo@datachat.app",
      password: "demo123",
      plan: "Pro",
    },
  ],
  records: [
    {
      id: "TXN-1048",
      owner: "demo",
      sender: "Abel Tesfaye",
      senderPhone: "+971 50 123 4567",
      from: "UAE",
      receiver: "Sara Bekele",
      receiverPhone: "+251 91 234 5678",
      to: "Ethiopia",
      account: "•••• 8842",
      amount: 1250,
      currency: "USD",
      rate: 132.5,
      category: "Remittance",
      date: "2026-07-18",
      status: "Pending",
      tag: "Pending review",
      key: "482193",
      remark: "Family support",
    },
    {
      id: "TXN-1047",
      owner: "demo",
      sender: "Mulugeta A.",
      senderPhone: "+1 202 555 0144",
      from: "USA",
      receiver: "Hana Worku",
      receiverPhone: "+251 92 444 1188",
      to: "Ethiopia",
      account: "•••• 1229",
      amount: 780,
      currency: "USD",
      rate: 132.2,
      category: "Invoice",
      date: "2026-07-15",
      status: "Completed",
      tag: "Verified",
      key: "716204",
      remark: "Design invoice",
    },
    {
      id: "TXN-1046",
      owner: "demo",
      sender: "Abel Tesfaye",
      senderPhone: "+971 50 123 4567",
      from: "UAE",
      receiver: "Meron Kassa",
      receiverPhone: "+44 7700 900123",
      to: "UK",
      account: "•••• 7601",
      amount: 4200,
      currency: "AED",
      rate: 0.21,
      category: "Investment",
      date: "2026-07-11",
      status: "Completed",
      tag: "Approved",
      key: "903517",
      remark: "July transfer",
    },
  ],
  contacts: [
    {
      id: "c1",
      owner: "demo",
      name: "Sara Bekele",
      phone: "+251 91 234 5678",
      country: "Ethiopia",
      color: "#d7a62b",
    },
    {
      id: "c2",
      owner: "demo",
      name: "Hana Worku",
      phone: "+251 92 444 1188",
      country: "Ethiopia",
      color: "#4c8ed9",
    },
  ],
  messages: [
    {
      id: "m1",
      owner: "demo",
      contact: "c1",
      sender: "them",
      content: "Hi Abel, is the transfer ready?",
      time: "10:24",
    },
    {
      id: "m2",
      owner: "demo",
      contact: "c1",
      sender: "me",
      content: "It is in review. I’ll send the security key once approved.",
      time: "10:26",
    },
  ],
  notifications: [],
};
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(K)) || seed;
  } catch {
    return seed;
  }
};
const money = (n, c = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 0,
  }).format(+n || 0);
const today = () => new Date().toISOString().slice(0, 10);
const uid = (p = "id") =>
  p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
function Icon({ name, size = 18 }) {
  const C = I[name] || I.Circle;
  return <C size={size} strokeWidth={1.8} />;
}
function App() {
  const [db, setDb] = useState(load),
    [user, setUser] = useState(() =>
      JSON.parse(sessionStorage.getItem("dc-user") || "null"),
    ),
    [page, setPage] = useState("home"),
    [toast, setToast] = useState("");
  useEffect(() => localStorage.setItem(K, JSON.stringify(db)), [db]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 2600);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const save = (fn) => setDb((d) => (typeof fn === "function" ? fn(d) : fn));
  const login = (u) => {
    setUser(u);
    sessionStorage.setItem("dc-user", JSON.stringify(u));
  };
  if (!user) return <Auth db={db} save={save} login={login} />;
  const props = { db, save, user, setToast };
  return (
    <div className="app">
      <Sidebar page={page} setPage={setPage} user={user} />
      <main>
        {page === "home" && <Home {...props} setPage={setPage} />}{" "}
        {page === "records" && <Records {...props} />}{" "}
        {page === "reports" && <Reports {...props} />}{" "}
        {page === "settings" && (
          <Settings
            {...props}
            logout={() => {
              sessionStorage.removeItem("dc-user");
              setUser(null);
            }}
          />
        )}
      </main>
      <MobileNav page={page} setPage={setPage} />
      {toast && (
        <div className="toast">
          <Icon name="CheckCircle2" />
          {toast}
        </div>
      )}
    </div>
  );
}
function Auth({ db, save, login }) {
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
            defaultValue={mode === "login" ? "demo@datachat.app" : ""}
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
            defaultValue={mode === "login" ? "demo123" : ""}
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
        {mode === "login" && (
          <div className="demo">Demo: demo@datachat.app / demo123</div>
        )}
      </form>
    </div>
  );
}
const nav = [
  ["home", "MessagesSquare", "Messages"],
  ["records", "TableProperties", "Transactions"],
  ["reports", "ChartNoAxesCombined", "Reports"],
  ["settings", "Settings", "Settings"],
];
function Sidebar({ page, setPage, user }) {
  return (
    <aside>
      <div className="brand">
        <div className="logo">
          <Icon name="MessagesSquare" />
        </div>
        <b>DataChat</b>
      </div>
      <nav>
        {nav.map(([p, i, l]) => (
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
        <div className="avatar">
          {user.name
            .split(" ")
            .map((x) => x[0])
            .slice(0, 2)}
        </div>
        <div>
          <b>{user.name}</b>
          <small>{user.plan} workspace</small>
        </div>
      </div>
    </aside>
  );
}
function MobileNav({ page, setPage }) {
  return (
    <div className="mobile-nav">
      {nav.map(([p, i, l]) => (
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
function Home({ db, save, user, setToast, setPage }) {
  const contacts = db.contacts.filter((x) => x.owner === user.id),
    [selected, setSelected] = useState(contacts[0]?.id),
    [search, setSearch] = useState(""),
    [add, setAdd] = useState(false);
  const c = contacts.find((x) => x.id === selected),
    msgs = db.messages.filter(
      (x) => x.owner === user.id && x.contact === selected,
    );
  const send = (e) => {
    e.preventDefault();
    const inp = e.currentTarget.elements.message;
    if (!inp.value.trim()) return;
    save((d) => ({
      ...d,
      messages: [
        ...d.messages,
        {
          id: uid("m"),
          owner: user.id,
          contact: selected,
          sender: "me",
          content: inp.value.trim(),
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ],
    }));
    inp.value = "";
  };
  return (
    <div className="home">
      <div className={"contact-pane " + (c ? "has-chat" : "")}>
        <Header
          title="Messages"
          sub={`${contacts.length} trusted contacts`}
          actions={
            <>
              <button className="icon-btn" aria-label="Notifications">
                <Icon name="Bell" />
              </button>
              <button className="primary compact" onClick={() => setAdd(true)}>
                <Icon name="UserPlus" />
                Add contact
              </button>
            </>
          }
        />
        <div className="ad">
          <img src="/assets/datachat-transfer-ad.png" alt="Secure international transfer confirmation" />
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
              <div className="avatar" style={{ background: c.color }}>
                {c.name[0]}
              </div>
              <div>
                <b>{c.name}</b>
                <small>
                  {c.phone} · {c.country}
                </small>
              </div>
              <ContactQr c={c} setToast={setToast} />
            </div>
            <div className="messages">
              {msgs.map((m) => (
                <div key={m.id} className={"bubble " + m.sender}>
                  {m.content}
                  <small>{m.time}</small>
                </div>
              ))}
            </div>
            <form className="composer" onSubmit={send}>
              <button type="button" className="icon-btn">
                <Icon name="Paperclip" />
              </button>
              <input
                name="message"
                aria-label="Message"
                placeholder="Write a secure message…"
              />
              <button className="send" aria-label="Send">
                <Icon name="Send" />
              </button>
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
      {add && (
        <ContactModal
          user={user}
          save={save}
          close={() => setAdd(false)}
          setToast={setToast}
        />
      )}
    </div>
  );
}
function ContactQr({ c, setToast }) {
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState("");
  useEffect(() => {
    if (open)
      QRCode.toDataURL(
        JSON.stringify({
          type: "datachat-contact",
          name: c.name,
          phone: c.phone,
          country: c.country,
        }),
        { margin: 2, width: 220 },
      ).then(setUrl);
  }, [open]);
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
          <div className="qr">
            {url && <img src={url} alt="Contact QR code" />}
            <b>{c.name}</b>
            <p>Scan to add this trusted contact.</p>
            <button
              className="secondary"
              onClick={() => {
                navigator.clipboard?.writeText(c.phone);
                setToast("Phone number copied");
              }}
            >
              <Icon name="Copy" />
              Copy phone
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ContactModal({ user, save, close, setToast }) {
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save((d) => ({
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
        },
      ],
    }));
    setToast("Contact added");
    close();
  };
  return (
    <Modal title="Add trusted contact" close={close}>
      <form className="form" onSubmit={submit}>
        <label>
          Full name
          <input name="name" required />
        </label>
        <label>
          Phone number
          <input name="phone" required type="tel" />
        </label>
        <label>
          Country
          <select name="country">
            {countries.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <button className="primary">Add contact</button>
      </form>
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
    [handoff, setHandoff] = useState(null);
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
  const importCsv = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((t) => {
      const lines = t
          .replace(/^\ufeff/, "")
          .split(/\r?\n/)
          .filter(Boolean),
        parse = (s) => {
          const out = [];
          let cur = "",
            q = false;
          for (let i = 0; i < s.length; i++) {
            if (s[i] === '"' && s[i + 1] === '"') {
              cur += '"';
              i++;
            } else if (s[i] === '"') q = !q;
            else if (s[i] === "," && !q) {
              out.push(cur);
              cur = "";
            } else cur += s[i];
          }
          out.push(cur);
          return out;
        };
      const h = parse(lines[0]).map((x) => x.toLowerCase()),
        get = (a, n) => a[h.indexOf(n)] || "";
      const imported = lines.slice(1).map((line) => {
        const a = parse(line);
        return {
          id: get(a, "id") || uid("TXN"),
          owner: user.id,
          sender: get(a, "sender"),
          senderPhone: get(a, "sender phone"),
          from: get(a, "from"),
          receiver: get(a, "receiver"),
          receiverPhone: get(a, "receiver phone"),
          to: get(a, "to"),
          account: get(a, "account"),
          amount: +get(a, "amount") || 0,
          currency: get(a, "currency") || "USD",
          rate: +get(a, "rate") || 1,
          category: get(a, "category") || "Remittance",
          date: get(a, "date") || today(),
          status: get(a, "status") || "Draft",
          tag: get(a, "tag") || "",
          key: get(a, "security key"),
          remark: get(a, "remark"),
        };
      });
      save((d) => ({ ...d, records: [...d.records, ...imported] }));
      setToast(`${imported.length} records imported`);
    });
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
function RecordRow({ r, edit, del, update, handoff }) {
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
          {r.handoffStatus === "Cash released" ? "Cash released" : "Cash handoff"}
        </button>
      </td>
      <td>
        <div className="row-actions">
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
function RecordModal({ record, user, save, close, setToast }) {
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
      key: record.key || f.key || String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"),
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
            {["USD", "EUR", "GBP", "AED", "SAR", "ETB", "CAD"].map((x) => (
              <option key={x}>{x}</option>
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
  const transferId = String(record.id).replace(/[^a-z0-9]/gi, "").toUpperCase();
  const claimCode = `DC1-${transferId}-${receiverId}-${record.key}`;
  const [qr, setQr] = useState("");
  const [presented, setPresented] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  useEffect(() => {
    QRCode.toDataURL(claimCode, { margin: 2, width: 260, errorCorrectionLevel: "H" }).then(setQr);
  }, [claimCode]);
  const verify = () => {
    if (presented.trim().toUpperCase() !== claimCode) {
      setError("Code does not match this transfer and receiver. Do not release cash.");
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
  const scanFile = async (file) => {
    if (!file) return;
    try {
      const scanner = new Html5Qrcode("qr-file-reader");
      const value = await scanner.scanFile(file, false);
      setPresented(value);
      setError("");
      setToast("QR code read. Confirm to validate it.");
      scanner.clear();
    } catch {
      setError("No readable DataChat QR code was found in that image.");
    }
  };
  return (
    <Modal title="Secure cash handoff" close={close} wide>
      <div className="handoff-grid">
        <section className="claim-card">
          <span className="eyebrow">RECEIVER CLAIM</span>
          <h3>{record.receiver}</h3>
          <p>{record.id} · {money(record.amount, record.currency)}</p>
          {qr && <img src={qr} alt={`Cash handoff QR code for ${record.receiver}`} />}
          <code>{claimCode}</code>
          <div className="claim-actions">
            <button className="secondary" onClick={() => { navigator.clipboard?.writeText(claimCode); setToast("Receiver claim code copied"); }}><Icon name="Copy" />Copy text</button>
            <button className="secondary" onClick={download}><Icon name="FileDown" />Download .txt</button>
          </div>
          <small>Give this QR or text code only to {record.receiver}. The six-digit secret remains bound to their name and this transfer.</small>
        </section>
        <section className="verify-card">
          <span className="eyebrow">CASH AGENT CHECK</span>
          <h3>Verify before releasing cash</h3>
          <p>Ask the receiver to present their complete DataChat claim code. The receiver name and transfer reference must match.</p>
          <label>Presented text code<textarea value={presented} onChange={(e) => { setPresented(e.target.value); setError(""); }} placeholder={claimCode} /></label>
          <div id="qr-file-reader" className="qr-reader" />
          <input ref={fileRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => scanFile(e.target.files?.[0])} />
          <button className="secondary full-btn" onClick={() => fileRef.current?.click()}><Icon name="ScanQrCode" />Scan or photograph QR</button>
          {error && <div className="error">{error}</div>}
          <button className="primary full-btn" onClick={verify}><Icon name="ShieldCheck" />Validate and release cash</button>
          <small className="warning"><Icon name="TriangleAlert" />Never release cash from a screenshot or six-digit number alone; validate the complete receiver-bound code.</small>
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
function Settings({ db, save, user, logout, setToast }) {
  const [agreement, setAgreement] = useState(false),
    [geez, setGeez] = useState(localStorage.getItem("geez") === "true");
  return (
    <div className="page settings">
      <Header
        title="Settings"
        sub="Manage your workspace, appearance and privacy"
      />
      <section className="profile panel">
        <div className="avatar large">
          {user.name
            .split(" ")
            .map((x) => x[0])
            .slice(0, 2)}
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
          <button
            className="primary"
            onClick={() => setToast("Your Pro workspace is active")}
          >
            Manage plan
          </button>
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
              <dd>1.0.0</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{user.plan}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>Private local workspace</dd>
            </div>
          </dl>
          <button className="secondary danger full-btn" onClick={logout}>
            <Icon name="LogOut" />
            Sign out
          </button>
        </section>
      </div>
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
  return (
    <div
      className="scrim"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="X" />
          </button>
        </div>
        {children}
      </section>
    </div>
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
