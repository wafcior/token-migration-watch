import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TokenCard } from "@/components/TokenCard";
import { TokenModal } from "@/components/TokenModal";
import type { MigrationRow } from "@/lib/migrations.types";
import {
  formatCountdown,
  formatPolishWarsaw,
  nextWarsawSlot,
} from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PumpSwap Migrations · Solana tokens po bondzie z Pump.fun" },
      {
        name: "description",
        content:
          "Śledź na żywo tokeny Solana, które ukończyły bonding curve na Pump.fun i przeniosły się do PumpSwap AMM.",
      },
      { property: "og:title", content: "PumpSwap Migrations" },
      {
        property: "og:description",
        content:
          "Tokeny Solana po migracji z Pump.fun na PumpSwap. Aktualizowane dwa razy dziennie.",
      },
    ],
  }),
  component: Index,
});

async function fetchMigrations(): Promise<MigrationRow[]> {
  const { data, error } = await supabase
    .from("migrations")
    .select("*")
    .order("migrated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as MigrationRow[];
}

async function fetchSyncState(): Promise<{
  last_run_at: string | null;
  last_run_status: string | null;
}> {
  const { data, error } = await supabase
    .from("sync_state")
    .select("last_run_at,last_run_status")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data ?? { last_run_at: null, last_run_status: null };
}

function Index() {
  const queryClient = useQueryClient();
  const tokensQuery = useQuery({
    queryKey: ["migrations"],
    queryFn: fetchMigrations,
    refetchInterval: 60_000,
  });
  const syncQuery = useQuery({
    queryKey: ["sync_state"],
    queryFn: fetchSyncState,
    refetchInterval: 60_000,
  });

  const [forcing, setForcing] = useState(false);
  const [forceMsg, setForceMsg] = useState<string | null>(null);

  const handleForceFetch = async () => {
    if (forcing) return;
    setForcing(true);
    setForceMsg(null);
    try {
      const res = await fetch("/.netlify/functions/fetch-migrations?force=true", {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ["migrations"] });
      await queryClient.invalidateQueries({ queryKey: ["sync_state"] });
      setForceMsg("Zaktualizowano");
      setTimeout(() => setForceMsg(null), 3000);
    } catch (err) {
      setForceMsg(
        `Błąd: ${err instanceof Error ? err.message : String(err)}`,
      );
      setTimeout(() => setForceMsg(null), 5000);
    } finally {
      setForcing(false);
    }
  };

  const [active, setActive] = useState<MigrationRow | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const nextSlot = useMemo(() => nextWarsawSlot(now), [now]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  PumpSwap <span className="text-primary">Migrations</span>
                </h1>
                <p className="text-sm text-muted-foreground">
                  Tokeny Solana po bonding curve z Pump.fun → PumpSwap (AMM)
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 pt-1">
              <button
                type="button"
                onClick={handleForceFetch}
                disabled={forcing}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {forcing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {forcing ? "Pobieranie…" : "Force fetch now"}
              </button>
              {forceMsg && (
                <span className="text-[11px] text-muted-foreground">{forceMsg}</span>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card px-5 py-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Ostatnia aktualizacja
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {syncQuery.isLoading
                  ? "Wczytywanie…"
                  : formatPolishWarsaw(syncQuery.data?.last_run_at)}
              </div>
              {syncQuery.data?.last_run_status &&
                !syncQuery.data.last_run_status.startsWith("ok") && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {syncQuery.data.last_run_status}
                  </div>
                )}
            </div>
            <div className="rounded-2xl border border-border bg-card px-5 py-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Następna aktualizacja
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {formatPolishWarsaw(nextSlot.toISOString())}
              </div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                za {formatCountdown(nextSlot, now)}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {tokensQuery.isLoading ? (
          <LoadingGrid />
        ) : tokensQuery.isError ? (
          <ErrorState onRetry={() => tokensQuery.refetch()} />
        ) : (tokensQuery.data?.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {tokensQuery.data!.map((t) => (
              <TokenCard key={t.id} token={t} onOpen={setActive} />
            ))}
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-2 text-xs text-muted-foreground sm:px-6 lg:px-8">
        Dane odświeżane o 09:00 i 17:00 czasu warszawskiego.
      </footer>

      <TokenModal token={active} onClose={() => setActive(null)} />
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-48 animate-pulse rounded-2xl border border-border bg-card"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <Activity className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 text-base font-semibold text-foreground">
        Brak migracji do wyświetlenia
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pierwsze tokeny pojawią się po najbliższym uruchomieniu synchronizacji
        (09:00 lub 17:00 czasu warszawskiego).
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
      <h2 className="mt-3 text-base font-semibold text-foreground">
        Nie udało się załadować danych
      </h2>
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Spróbuj ponownie
      </button>
    </div>
  );
}
