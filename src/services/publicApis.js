const API_TIMEOUT_MS = 9000;

async function fetchJson(url, { signal, timeout = API_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Public API returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export const PUBLIC_API_SOURCES = {
  fx: { name: "Frankfurter", url: "https://frankfurter.dev/", auth: "none" },
  crypto: {
    name: "CoinGecko",
    url: "https://docs.coingecko.com/docs/keyless-public-api",
    auth: "none",
  },
  metals: { name: "Gold API", url: "https://gold-api.com/docs", auth: "none" },
};

export async function getFxRates(base, quotes, options) {
  const list = [...new Set(quotes.filter((x) => x !== base))];
  if (!list.length)
    return {
      date: new Date().toISOString().slice(0, 10),
      rates: { [base]: 1 },
    };
  const rows = await fetchJson(
    `https://api.frankfurter.dev/v2/rates?base=${encodeURIComponent(base)}&quotes=${list.map(encodeURIComponent).join(",")}`,
    options,
  );
  return {
    date: rows[0]?.date || new Date().toISOString().slice(0, 10),
    rates: Object.fromEntries(rows.map((x) => [x.quote, x.rate])),
  };
}

export async function getSupportedCurrencies(options) {
  const rows = await fetchJson(
    "https://api.frankfurter.dev/v2/currencies",
    options,
  );
  return rows
    .map((x) => ({ code: x.iso_code, name: x.name }))
    .filter((x) => x.code)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export const getCryptoPrices = (currency, options) =>
  fetchJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,tether&vs_currencies=${encodeURIComponent(currency.toLowerCase())}&include_24hr_change=true`,
    options,
  );

export const getMetalPrice = (symbol, options) =>
  fetchJson(
    `https://api.gold-api.com/price/${encodeURIComponent(symbol)}`,
    options,
  );
