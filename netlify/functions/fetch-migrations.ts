// Netlify Function — runs the Pump.fun → PumpSwap migration sync.
//
// Triggered hourly by Netlify's scheduler (see netlify.toml) and also
// callable directly via HTTP. When invoked with ?force=true the
// Warsaw time-window gate (09:00 / 17:00 Europe/Warsaw) is bypassed and
// the fetch runs immediately.
//
// All Helius + Supabase logic is implemented INSIDE this function so it
// does not depend on the TanStack server route (which is not deployed
// on a Netlify static SPA build).
import type { Handler, HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(status: number, body: unknown) {
  return {
    statusCode: status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
    },
    body: JSON.stringify(body),
  };
}

function warsawHour(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  return hour;
}

interface HeliusSignature {
  signature: string;
  blockTime: number | null;
  err: unknown;
}

interface HeliusTxToken {
  mint: string;
}

interface HeliusTx {
  signature: string;
  timestamp: number;
  tokenTransfers?: HeliusTxToken[];
  events?: {
    swap?: { tokenInputs?: HeliusTxToken[]; tokenOutputs?: HeliusTxToken[] };
  };
}

interface HeliusAsset {
  id: string;
  content?: {
    metadata?: { name?: string; symbol?: string };
    links?: { image?: string };
    files?: Array<{ uri?: string; cdn_uri?: string }>;
  };
  token_info?: {
    supply?: number;
    decimals?: number;
    price_info?: { price_per_token?: number };
  };
}

async function rpc(url: string, method: string, params: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
  });
  if (!res.ok) throw new Error(`Helius ${method} failed: ${res.status}`);
  const data = (await res.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (data.error) throw new Error(`Helius ${method}: ${data.error.message}`);
  return data.result;
}

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SOL_MINT = "So11111111111111111111111111111111111111112";

function readForce(event: HandlerEvent): boolean {
  try {
    const qp = event?.queryStringParameters ?? {};
    const v = (qp.force ?? "").toString().toLowerCase();
    if (v === "true" || v === "1") return true;

    const extendedEvent = event as HandlerEvent & {
      rawQuery?: string;
      rawUrl?: string;
      multiValueQueryStringParameters?: Record<string, string[]> | null;
    };
    const multiForce = extendedEvent.multiValueQueryStringParameters?.force ?? [];
    if (multiForce.some((value) => value.toLowerCase() === "true" || value === "1")) return true;

    const raw = (extendedEvent.rawQuery ?? "").toLowerCase();
    if (raw.includes("force=true") || raw.includes("force=1")) return true;

    if (extendedEvent.rawUrl) {
      const forceFromUrl = new URL(extendedEvent.rawUrl).searchParams.get("force")?.toLowerCase();
      if (forceFromUrl === "true" || forceFromUrl === "1") return true;
    }

    if (event?.body) {
      const decodedBody = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
      const bodyStr = decodedBody.toLowerCase();
      if (bodyStr.includes('"force":true') || bodyStr.includes('"force": true')) return true;
      try {
        const parsed = JSON.parse(decodedBody) as { force?: unknown };
        if (parsed.force === true || parsed.force === "true" || parsed.force === 1) return true;
      } catch {
        // ignore non-JSON bodies
      }
    }
    return false;
  } catch {
    return false;
  }
}

function getRequiredEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function extractErrorMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return "Nie można przetworzyć obiektu błędu";
    }
  }
  return String(err);
}

async function runSync(force: boolean) {
  const hour = warsawHour();
  const isWindow = hour === 9 || hour === 17;
  if (!force && !isWindow) {
    return jsonResponse(200, {
      skipped: true,
      reason: `Warsaw hour=${hour}; only runs at 09 or 17`,
    });
  }

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: "Missing HELIUS_API_KEY" });
  }

  const supabaseUrl = getRequiredEnv("VITE_SUPABASE_URL") || getRequiredEnv("SUPABASE_URL");
  const supabaseKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl) {
    return jsonResponse(500, { ok: false, error: "Missing VITE_SUPABASE_URL or SUPABASE_URL in Netlify environment variables" });
  }
  if (!supabaseKey) {
    return jsonResponse(500, { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables" });
  }
  const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const migrationAddress =
    process.env.PUMPFUN_MIGRATION_ADDRESS ||
    "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg";

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const dasUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;

  try {
    const { data: state } = await supabaseAdmin
      .from("sync_state")
      .select("last_signature")
      .eq("id", 1)
      .maybeSingle();
    const until = state?.last_signature ?? undefined;

    const sigParams: Record<string, unknown> = { limit: 50 };
    if (until) sigParams.until = until;

    const sigs = (await rpc(rpcUrl, "getSignaturesForAddress", [
      migrationAddress,
      sigParams,
    ])) as HeliusSignature[];

    if (!sigs || sigs.length === 0) {
      await supabaseAdmin
        .from("sync_state")
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: "ok",
        })
        .eq("id", 1);
      return jsonResponse(200, { ok: true, processed: 0 });
    }

    const sigList = sigs.filter((s) => !s.err).map((s) => s.signature);
    const parsedRes = await fetch(
      `https://api.helius.xyz/v0/transactions?api-key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: sigList }),
      },
    );
    if (!parsedRes.ok) throw new Error(`parse-tx failed: ${parsedRes.status}`);
    const parsed = (await parsedRes.json()) as HeliusTx[];

    type Found = { mint: string; signature: string; ts: number };
    const found: Found[] = [];
    for (const tx of parsed) {
      const candidates: string[] = [];
      for (const t of tx.tokenTransfers ?? []) if (t.mint) candidates.push(t.mint);
      for (const t of tx.events?.swap?.tokenInputs ?? [])
        if (t.mint) candidates.push(t.mint);
      for (const t of tx.events?.swap?.tokenOutputs ?? [])
        if (t.mint) candidates.push(t.mint);
      const mint = candidates.find(
        (m) => m && m !== SOL_MINT && !m.startsWith(PUMP_PROGRAM),
      );
      if (mint) found.push({ mint, signature: tx.signature, ts: tx.timestamp });
    }

    const uniq = new Map<string, Found>();
    for (const f of found) {
      const prev = uniq.get(f.mint);
      if (!prev || prev.ts < f.ts) uniq.set(f.mint, f);
    }
    const items = [...uniq.values()];

    let assets: HeliusAsset[] = [];
    if (items.length > 0) {
      const assetRes = (await rpc(dasUrl, "getAssetBatch", {
        ids: items.map((i) => i.mint),
      })) as (HeliusAsset | null)[];
      assets = assetRes.filter((a): a is HeliusAsset => !!a);
    }
    const assetByMint = new Map(assets.map((a) => [a.id, a]));

    const rows = items.map((i) => {
      const a = assetByMint.get(i.mint);
      const image =
        a?.content?.links?.image ??
        a?.content?.files?.[0]?.cdn_uri ??
        a?.content?.files?.[0]?.uri ??
        null;
      const supply = a?.token_info?.supply ?? 0;
      const decimals = a?.token_info?.decimals ?? 0;
      const price = a?.token_info?.price_info?.price_per_token ?? 0;
      const marketCap =
        supply && price ? (supply / Math.pow(10, decimals)) * price : null;
      return {
        mint_address: i.mint,
        tx_signature: i.signature,
        name: a?.content?.metadata?.name ?? null,
        symbol: a?.content?.metadata?.symbol ?? null,
        image_url: image,
        migrated_at: new Date(i.ts * 1000).toISOString(),
        market_cap: marketCap,
      };
    });

    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from("migrations")
        .upsert(rows, { onConflict: "mint_address" });
      if (error) throw error; 
    }

    const newest = sigs[0]?.signature ?? until ?? null;
    await supabaseAdmin
      .from("sync_state")
      .update({
        last_signature: newest,
        last_run_at: new Date().toISOString(),
        last_run_status: "ok",
      })
      .eq("id", 1);

    return jsonResponse(200, {
      ok: true,
      processed: rows.length,
      newest_signature: newest,
    });
  } catch (err) {
    const message = extractErrorMsg(err);
    console.error("[fetch-migrations] error:", message);
    try {
      await supabaseAdmin
        .from("sync_state")
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: `error: ${message}`.slice(0, 500),
        })
        .eq("id", 1);
    } catch {
      // ignore
    }
    return jsonResponse(500, { ok: false, error: message });
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const force = readForce(event);
    return await runSync(force);
  } catch (err) {
    const message = extractErrorMsg(err);
    console.error("[fetch-migrations] fatal:", message);
    return jsonResponse(500, { ok: false, error: message });
  }
};
