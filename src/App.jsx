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
const communityMembers = [
  {
    id: "p1",
    name: "Semhar Tesfay",
    handle: "@semhar.t",
    country: "Eritrea",
    city: "Asmara",
    color: "#8f69d8",
    verified: true,
    bio: "Community member · Tigrinya, English",
  },
  {
    id: "p2",
    name: "Dawit Abraham",
    handle: "@dawit.a",
    country: "Germany",
    city: "Frankfurt",
    color: "#35a57a",
    verified: true,
    bio: "Verified transfer partner · Tigrinya, German",
  },
  {
    id: "p3",
    name: "Rahel Berhane",
    handle: "@rahel.b",
    country: "Canada",
    city: "Toronto",
    color: "#d7a62b",
    verified: false,
    bio: "New community member · Tigrinya, English",
  },
  {
    id: "p4",
    name: "Yonas Mengisteab",
    handle: "@yonas.m",
    country: "UAE",
    city: "Dubai",
    color: "#4c8ed9",
    verified: true,
    bio: "Business member · Arabic, Tigrinya, English",
  },
];
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
    [toast, setToast] = useState(""),
    [onboarding, setOnboarding] = useState(false);
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
    if (!localStorage.getItem(`dc-onboarded-${u.id}`)) setOnboarding(true);
  };
  if (!user) return <Auth db={db} save={save} login={login} />;
  const props = { db, save, user, setToast };
  return (
    <div className="app">
      <Sidebar page={page} setPage={setPage} user={user} />
      <main>
        {page === "home" && <Home {...props} setPage={setPage} />}{" "}
        {page === "portal" && <Portal {...props} setPage={setPage} />}{" "}
        {page === "rates" && <RatesMarketplace {...props} setPage={setPage} />}{" "}
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
      {onboarding && (
        <Onboarding
          user={user}
          close={() => {
            localStorage.setItem(`dc-onboarded-${user.id}`, "true");
            setOnboarding(false);
          }}
        />
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
function Auth({ db, save, login }) {
  const [mode, setMode] = useState("login");
  const [err, setErr] = useState("");
  const [slide, setSlide] = useState(0);
  const slides = [
    {
      image: "/assets/welcome-community.png",
      eyebrow: "CONNECTED COMMUNITY",
      title: "Talk, transfer and stay close.",
      text: "Find trusted people, chat privately, and keep every financial conversation connected to a clear record.",
      icon: "MessagesSquare",
    },
    {
      image: "/assets/welcome-verify.png",
      eyebrow: "SAFE CASH HANDOFF",
      title: "Verify the right receiver.",
      text: "Receiver-bound QR and text codes reduce mistakes before cash is released.",
      icon: "ScanQrCode",
    },
    {
      image: "/assets/datachat-transfer-ad.png",
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
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = f.get("email").trim().toLowerCase();
    const password = f.get("password");
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
              <Icon name="MessagesSquare" />
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
            {mode === "login" ? "WELCOME BACK" : "JOIN DATACHAT"}
          </p>
          <h2>
            {mode === "login"
              ? "Sign in to your workspace"
              : "Create your private workspace"}
          </h2>
          <p>
            {mode === "login"
              ? "Continue your conversations and financial records."
              : "New accounts begin with completely separate data and a short guided tour."}
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
            {mode === "login" ? "Sign in securely" : "Create account"}
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
              ? "First time here? Create an account"
              : "Already have an account? Sign in"}
          </button>
          {mode === "login" && (
            <div className="demo">Demo: demo@datachat.app / demo123</div>
          )}
          <small className="auth-legal">
            <Icon name="LockKeyhole" />
            By continuing, you agree to use DataChat lawfully and protect other
            members' privacy.
          </small>
        </form>
      </section>
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
const nav = [
  ["home", "MessagesSquare", "Messages"],
  ["portal", "UsersRound", "Community"],
  ["rates", "BadgeDollarSign", "Rates"],
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
  const mobileNav = nav.filter(([p]) => p !== "reports");
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
const sampleOffers = [
  {
    id: "offer-1",
    owner: "market",
    provider: "Dawit Exchange",
    contact: "@dawit.a",
    fromCurrency: "USD",
    toCurrency: "ETB",
    rate: 151.5,
    side: "Sell",
    instrument: "Bank transfer",
    min: 100,
    max: 2500,
    location: "Frankfurt · Asmara",
    verified: true,
    note: "Same-day confirmation during business hours.",
  },
  {
    id: "offer-2",
    owner: "market",
    provider: "Semhar Remit",
    contact: "@semhar.t",
    fromCurrency: "EUR",
    toCurrency: "ETB",
    rate: 174.2,
    side: "Sell",
    instrument: "Cash pickup",
    min: 50,
    max: 1200,
    location: "Asmara",
    verified: true,
    note: "Receiver ID required for collection.",
  },
  {
    id: "offer-3",
    owner: "market",
    provider: "Red Sea Payments",
    contact: "+971 50 555 0194",
    fromCurrency: "AED",
    toCurrency: "USD",
    rate: 0.271,
    side: "Buy",
    instrument: "Mobile money",
    min: 200,
    max: 5000,
    location: "Dubai",
    verified: false,
    note: "Rate confirmed again before order acceptance.",
  },
];
function RatesMarketplace({ db, save, user, setToast, setPage }) {
  const [base, setBase] = useState("USD");
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [add, setAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(
      `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=USD,EUR,GBP,CAD,JPY,CHF,TRY,AUD,CNY`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error("Rate service unavailable");
        return r.json();
      })
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
  const offers = [...sampleOffers, ...(db.rateOffers || [])];
  const visible = offers.filter((x) =>
    (x.provider + x.fromCurrency + x.toCurrency + x.instrument + x.location)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const messageProvider = (offer) => {
    let contact = db.contacts.find(
      (x) =>
        x.owner === user.id &&
        (x.phone === offer.contact || x.rateProvider === offer.provider),
    );
    const contactId = contact?.id || uid("c");
    const newContact = contact || {
      id: contactId,
      owner: user.id,
      name: offer.provider,
      phone: offer.contact,
      country: offer.location || "Marketplace",
      color: "#35a57a",
      rateProvider: offer.provider,
    };
    const orderText = `Rate order inquiry: ${offer.side} ${offer.fromCurrency}/${offer.toCurrency} at ${offer.rate}. Instrument: ${offer.instrument}. Please confirm availability, fees, and final amount.`;
    save((d) => ({
      ...d,
      contacts: contact ? d.contacts : [...d.contacts, newContact],
      messages: [
        ...d.messages,
        {
          id: uid("m"),
          owner: user.id,
          contact: contactId,
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
                ? setAdd(true)
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
          close={() => setAdd(false)}
          setToast={setToast}
        />
      )}
    </div>
  );
}
function RateOfferModal({ user, save, close, setToast }) {
  const submit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const offer = {
      ...f,
      id: uid("offer"),
      owner: user.id,
      rate: +f.rate,
      min: +f.min,
      max: +f.max,
      verified: false,
      createdAt: new Date().toISOString(),
    };
    save((d) => ({ ...d, rateOffers: [...(d.rateOffers || []), offer] }));
    setToast("Your market rate was published");
    close();
  };
  const currencies = [
    "USD",
    "EUR",
    "GBP",
    "AED",
    "SAR",
    "ETB",
    "CAD",
    "AUD",
    "CHF",
    "TRY",
    "Other",
  ];
  return (
    <Modal title="Publish a market rate" close={close} wide>
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
          <input name="provider" required defaultValue={user.name} />
        </label>
        <label>
          Contact information
          <input
            name="contact"
            required
            placeholder="Phone, email or @username"
          />
        </label>
        <label>
          Location
          <input name="location" required placeholder="City, country" />
        </label>
        <label>
          Offer type
          <select name="side">
            <option>Sell</option>
            <option>Buy</option>
            <option>Exchange</option>
          </select>
        </label>
        <label>
          From currency
          <select name="fromCurrency">
            {currencies.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          To currency
          <select name="toCurrency" defaultValue="ETB">
            {currencies.map((x) => (
              <option key={x}>{x}</option>
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
            placeholder="e.g. 151.50"
          />
        </label>
        <label>
          Minimum amount
          <input name="min" type="number" min="0" required />
        </label>
        <label>
          Maximum amount
          <input name="max" type="number" min="0" required />
        </label>
        <label>
          Financial instrument
          <select name="instrument">
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
            Publish rate
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Portal({ db, save, user, setToast, setPage }) {
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("All");
  const contacts = db.contacts.filter((x) => x.owner === user.id);
  const addPerson = (person) => {
    if (contacts.some((x) => x.portalId === person.id)) {
      setPage("home");
      setToast("Contact is already in your messages");
      return;
    }
    save((d) => ({
      ...d,
      contacts: [
        ...d.contacts,
        {
          id: uid("c"),
          portalId: person.id,
          owner: user.id,
          name: person.name,
          phone: person.handle,
          country: person.country,
          color: person.color,
          isOnline: true,
        },
      ],
    }));
    setToast(`${person.name} added to your trusted contacts`);
    setPage("home");
  };
  const countriesInPortal = [
    "All",
    ...new Set(communityMembers.map((x) => x.country)),
  ];
  const visible = communityMembers.filter(
    (x) =>
      (x.name + x.handle + x.city)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (country === "All" || x.country === country),
  );
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
            Discover community members by name or location, add people you know,
            and use built-in safety controls in every conversation.
          </p>
          <div className="portal-trust">
            <span>
              <Icon name="BadgeCheck" />
              Verified profiles
            </span>
            <span>
              <Icon name="ShieldAlert" />
              Report & block controls
            </span>
            <span>
              <Icon name="LockKeyhole" />
              Private contact lists
            </span>
          </div>
        </div>
        <div className="portal-orbit">
          <div className="orbit-center">
            <Icon name="UsersRound" size={30} />
          </div>
          {communityMembers.map((x, i) => (
            <div
              key={x.id}
              className={`orbit-user orbit-${i + 1}`}
              style={{ background: x.color }}
            >
              {x.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
          ))}
        </div>
      </section>
      <div className="portal-toolbar">
        <div className="search">
          <Icon name="Search" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people, username or city"
          />
        </div>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          aria-label="Filter community by country"
        >
          {countriesInPortal.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="member-grid">
        {visible.map((person) => (
          <article className="member-card" key={person.id}>
            <div className="member-cover">
              <span className="online-label">
                <i />
                Online
              </span>
            </div>
            <div className="member-avatar" style={{ background: person.color }}>
              {person.name
                .split(" ")
                .map((x) => x[0])
                .join("")}
            </div>
            <div className="member-info">
              <h3>
                {person.name}
                {person.verified && <Icon name="BadgeCheck" size={17} />}
              </h3>
              <span>
                {person.handle} · {person.city}, {person.country}
              </span>
              <p>{person.bio}</p>
              <button className="primary" onClick={() => addPerson(person)}>
                <Icon name="MessageCircle" />
                {contacts.some((x) => x.portalId === person.id)
                  ? "Open chat"
                  : "Connect & chat"}
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="portal-notice">
        <Icon name="Info" />
        <div>
          <b>Internet portal foundation</b>
          <p>
            This edition demonstrates discovery, connection, reporting, and
            blocking locally. Publishing live accounts and realtime messages
            between different devices requires the production backend described
            in the project README.
          </p>
        </div>
      </div>
    </div>
  );
}
function Home({ db, save, user, setToast, setPage }) {
  const contacts = db.contacts.filter((x) => x.owner === user.id),
    [selected, setSelected] = useState(contacts[0]?.id),
    [search, setSearch] = useState(""),
    [add, setAdd] = useState(false),
    [report, setReport] = useState(null);
  const c = contacts.find((x) => x.id === selected),
    msgs = db.messages.filter(
      (x) => x.owner === user.id && x.contact === selected,
    );
  const send = (e) => {
    e.preventDefault();
    if (c?.blocked) return setToast("This member is blocked");
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
          <img
            src="/assets/datachat-transfer-ad.png"
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
              <button
                className="icon-btn"
                title="Report or block user"
                aria-label="Report or block user"
                onClick={() => setReport(c)}
              >
                <Icon name="ShieldAlert" />
              </button>
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
                disabled={c.blocked}
                placeholder="Write a secure message…"
              />
              <button className="send" aria-label="Send" disabled={c.blocked}>
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
      {report && (
        <ReportUser
          contact={report}
          messages={msgs}
          user={user}
          save={save}
          setToast={setToast}
          close={() => setReport(null)}
        />
      )}
    </div>
  );
}
function ReportUser({ contact, messages, user, save, setToast, close }) {
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
          {r.handoffStatus === "Cash released"
            ? "Cash released"
            : "Cash handoff"}
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
            capture="environment"
            onChange={(e) => scanFile(e.target.files?.[0])}
          />
          <button
            className="secondary full-btn"
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="ScanQrCode" />
            Scan or photograph QR
          </button>
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
