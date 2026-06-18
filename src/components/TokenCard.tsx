import { useState, useEffect } from "react";
import { Copy, Check } from "lucide-react";
import { formatMarketCap, relativeFromNow, shortenAddress } from "@/lib/format";
import type { MigrationRow } from "@/lib/migrations.types";

export function TokenCard({
  token,
  onOpen,
}: {
  token: MigrationRow;
  onOpen: (t: MigrationRow) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [imgErr, setImgErr] = useState(false);

  // FIX: relativeFromNow calls Date.now() — must be client-side only to avoid hydration mismatch
  const [relTime, setRelTime] = useState<string>("—");
  useEffect(() => {
    setRelTime(relativeFromNow(token.migrated_at));
    const id = setInterval(() => setRelTime(relativeFromNow(token.migrated_at)), 30_000);
    return () => clearInterval(id);
  }, [token.migrated_at]);

  const initial = (token.symbol || token.name || token.mint_address || "?")
    .slice(0, 1)
    .toUpperCase();

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(token.mint_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={() => onOpen(token)}
      className="group flex w-full flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-left transition hover:border-ring/40 hover:bg-secondary/40 focus:outline-none focus:ring-2 focus:ring-ring/40"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-border bg-secondary">
          {token.image_url && !imgErr ? (
            <img
              src={token.image_url}
              alt={token.name ?? token.symbol ?? token.mint_address}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setImgErr(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-accent text-base font-semibold text-accent-foreground">
              {initial}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-foreground">
            {token.name || "Unknown"}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            ${token.symbol || "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Market Cap
          </div>
          <div className="mt-0.5 font-medium text-foreground">
            {formatMarketCap(token.market_cap)}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Migracja
          </div>
          <div className="mt-0.5 font-medium text-foreground">
            {relTime}
          </div>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={handleCopy}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleCopy(e as unknown as React.MouseEvent);
        }}
        className="flex items-center justify-between rounded-lg border border-border bg-secondary/60 px-3 py-2 font-mono text-xs text-muted-foreground hover:text-foreground"
      >
        <span className="truncate">{shortenAddress(token.mint_address)}</span>
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </div>
    </button>
  );
}
