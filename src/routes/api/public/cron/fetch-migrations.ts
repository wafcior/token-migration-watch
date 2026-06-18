import { createFileRoute } from "@tanstack/react-router";

// Cron endpoint — hit every hour (Vercel cron or pg_cron). Internally gated to
// only call Helius at exactly 09:00 or 17:00 in Europe/Warsaw to save credits.

function warsawHour(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "-1");
  // Only "exactly" 09:00 or 17:00 — but cron runs at :00 so any minute within
  // that hour is acceptable. We require hour match only.
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
  const data = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(`Helius ${method}: ${data.error.message}`);
  return data.result;
}

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SOL_MINT = "So11111111111111111111111111111111111111112";

function isForced(request: Request): boolean {
  try {
    const url = new URL(request.url);
    const v = url.searchParams.get("force");
    return v === "true" || v === "1";
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/cron/fetch-migrations")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCron(isForced(request)),
      POST: async ({ request }) => handleCron(isForced(request)),
    },
  },
});

async function handleCron(force: boolean) {
  const hour = warsawHour();
  const isWindow = hour === 9 || hour === 17;
  if (!force && !isWindow) {
    return Response.json({
      skipped: true,
      reason: `Warsaw hour=${hour}; only runs at 09 or 17`,
    });
  }

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Missing HELIUS_API_KEY" }, { status: 500 });
  }
  const migrationAddress =
    process.env.PUMPFUN_MIGRATION_ADDRESS ||
    "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg";

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const dasUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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
        .update({ last_run_at: new Date().toISOString(), last_run_status: "ok" })
        .eq("id", 1);
      return Response.json({ ok: true, processed: 0 });
    }

    // Parse transactions via Helius enhanced API for clearer token info
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
      for (const t of tx.events?.swap?.tokenInputs ?? []) if (t.mint) candidates.push(t.mint);
      for (const t of tx.events?.swap?.tokenOutputs ?? []) if (t.mint) candidates.push(t.mint);
      const mint = candidates.find(
        (m) => m && m !== SOL_MINT && !m.startsWith(PUMP_PROGRAM),
      );
      if (mint) found.push({ mint, signature: tx.signature, ts: tx.timestamp });
    }

    // Dedupe by mint, keep newest
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
      const marketCap = supply && price ? (supply / Math.pow(10, decimals)) * price : null;
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

    return Response.json({ ok: true, processed: rows.length, newest_signature: newest });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/fetch-migrations] error:", message);
    try {
      await supabaseAdmin
        .from("sync_state")
        .update({ last_run_at: new Date().toISOString(), last_run_status: `error: ${message}`.slice(0, 500) })
        .eq("id", 1);
    } catch {
      // ignore
    }
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
