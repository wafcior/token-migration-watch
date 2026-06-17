// Netlify Scheduled Function — wraps the TanStack server route so the same
// gated logic (09:00 / 17:00 Europe/Warsaw) runs on Netlify cron.
import type { Handler } from "@netlify/functions";

export const handler: Handler = async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return { statusCode: 500, body: "Missing site URL env" };
  }
  try {
    const res = await fetch(`${base}/api/public/cron/fetch-migrations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const text = await res.text();
    return { statusCode: res.status, body: text };
  } catch (err) {
    return {
      statusCode: 500,
      body: `cron error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
