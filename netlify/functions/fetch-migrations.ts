// Netlify Scheduled Function — wraps the TanStack server route so the same
// gated logic (09:00 / 17:00 Europe/Warsaw) runs on Netlify cron.
//
// Also callable directly via HTTP. When invoked with ?force=true the
// underlying endpoint bypasses the Warsaw time-window gate and runs the
// fetch immediately.
import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return { statusCode: 500, body: "Missing site URL env" };
  }

  const force =
    event?.queryStringParameters?.force === "true" ||
    event?.queryStringParameters?.force === "1";

  const target = `${base}/api/public/cron/fetch-migrations${force ? "?force=true" : ""}`;

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: `cron error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
