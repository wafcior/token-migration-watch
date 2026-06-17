import { useEffect } from "react";
import { X, ExternalLink, Copy } from "lucide-react";
import { formatMarketCap, shortenAddress } from "@/lib/format";
import type { MigrationRow } from "@/lib/migrations.types";

interface Platform {
  id: string;
  label: string;
  description: string;
  url: (mint: string) => string;
  accent: string;
}

const platforms: Platform[] = [
  {
    id: "gmgn",
    label: "GMGN",
    description: "Wykresy i analityka on-chain",
    url: (m) => `https://gmgn.ai/sol/token/${m}`,
    accent: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  },
  {
    id: "axiom",
    label: "Axiom",
    description: "Pro trading terminal",
    url: (m) => `https://axiom.trade/token/${m}`,
    accent: "bg-violet-500/10 text-violet-700 border-violet-500/20",
  },
  {
    id: "jupiter",
    label: "Jupiter",
    description: "Najlepsze ceny swapu na Solanie",
    url: (m) => `https://jup.ag/swap/SOL-${m}`,
    accent: "bg-orange-500/10 text-orange-700 border-orange-500/20",
  },
];

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function TokenModal({
  token,
  onClose,
}: {
  token: MigrationRow | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!token) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [token, onClose]);

  if (!token) return null;

  const mint = token.mint_address;
  const jupiterUrl = `https://jup.ag/swap/SOL-${mint}`;

  const openPlatform = (platform: Platform) => {
    const url = platform.url(mint);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openPhantom = () => {
    const target = jupiterUrl;
    if (isMobile()) {
      const deepLink = `phantom://browse/url?url=${encodeURIComponent(target)}`;
      // Try the deep link; fall back to web after a short delay
      const start = Date.now();
      window.location.href = deepLink;
      setTimeout(() => {
        if (Date.now() - start < 1600 && document.visibilityState === "visible") {
          window.open(target, "_blank", "noopener,noreferrer");
        }
      }, 1200);
    } else {
      window.open(target, "_blank", "noopener,noreferrer");
    }
  };

  const copyMint = async () => {
    try {
      await navigator.clipboard.writeText(mint);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-3xl border border-border bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-border bg-secondary">
              {token.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={token.image_url}
                  alt={token.name ?? mint}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground">
                  {(token.symbol || token.name || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-foreground">
                {token.name || "Unknown"}
              </div>
              <div className="text-sm text-muted-foreground">
                ${token.symbol || "—"} · MC {formatMarketCap(token.market_cap)}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Zamknij"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <button
            onClick={copyMint}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3 text-left font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{shortenAddress(mint, 6, 6)}</span>
            <Copy className="h-3.5 w-3.5" />
          </button>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Wykresy i tradeing
            </div>
            {platforms.map((p) => (
              <button
                key={p.id}
                onClick={() => openPlatform(p)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left transition hover:opacity-90 active:scale-[0.99] ${p.accent}`}
              >
                <div>
                  <div className="text-base font-semibold">{p.label}</div>
                  <div className="text-xs opacity-80">{p.description}</div>
                </div>
                <ExternalLink className="h-4 w-4" />
              </button>
            ))}
            <button
              onClick={openPhantom}
              className="flex w-full items-center justify-between rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-4 text-left text-indigo-700 transition hover:opacity-90 active:scale-[0.99]"
            >
              <div>
                <div className="text-base font-semibold">Phantom</div>
                <div className="text-xs opacity-80">
                  Otwórz w przeglądarce Phantom (mobile)
                </div>
              </div>
              <ExternalLink className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
