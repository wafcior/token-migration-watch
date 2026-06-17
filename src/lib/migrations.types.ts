export interface MigrationRow {
  id: string;
  mint_address: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  migrated_at: string;
  market_cap: number | null;
  tx_signature: string;
  created_at: string;
}
