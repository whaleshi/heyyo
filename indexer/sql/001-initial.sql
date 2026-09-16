-- Independent Heyyo database. No reads or writes to Ayoo's tables.
CREATE TABLE IF NOT EXISTS heyyo_cursor (
  chain_id integer NOT NULL,
  deployment_id text NOT NULL,
  last_block bigint NOT NULL,
  last_block_hash text NOT NULL,
  halted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, deployment_id)
);
CREATE TABLE IF NOT EXISTS heyyo_checkpoints (
  chain_id integer NOT NULL,
  deployment_id text NOT NULL,
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  parent_hash text NOT NULL,
  PRIMARY KEY (chain_id, deployment_id, block_number)
);
CREATE TABLE IF NOT EXISTS heyyo_tokens (
  chain_id integer NOT NULL,
  deployment_id text NOT NULL,
  token_address text NOT NULL CHECK (token_address = lower(token_address)),
  source_address text NOT NULL,
  launch_address text NOT NULL,
  creator_address text NOT NULL,
  pool_address text,
  name text NOT NULL,
  ticker text NOT NULL,
  description text NOT NULL DEFAULT '',
  image text,
  metadata_uri text,
  total_supply_raw numeric(78, 0) NOT NULL CHECK (total_supply_raw > 0),
  token_decimals integer NOT NULL CHECK (token_decimals BETWEEN 0 AND 36),
  quote_decimals integer NOT NULL CHECK (quote_decimals BETWEEN 0 AND 36),
  quote_symbol text NOT NULL CHECK (quote_symbol = 'USDC'),
  graduation_target_raw numeric(78, 0) NOT NULL CHECK (graduation_target_raw > 0),
  quote_reserve_raw numeric(78, 0) NOT NULL DEFAULT 0 CHECK (quote_reserve_raw >= 0),
  price_usd numeric,
  graduated boolean NOT NULL DEFAULT false,
  created_timestamp bigint NOT NULL,
  created_block bigint NOT NULL,
  created_log_index integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token_address)
);
CREATE INDEX IF NOT EXISTS heyyo_tokens_deployment ON heyyo_tokens (chain_id, deployment_id, created_block DESC, created_log_index DESC);
CREATE TABLE IF NOT EXISTS heyyo_events (
  chain_id integer NOT NULL,
  deployment_id text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  event_timestamp bigint NOT NULL,
  token_address text NOT NULL,
  source_address text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('created', 'trade', 'graduated', 'price')),
  payload jsonb NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS heyyo_events_token ON heyyo_events (chain_id, token_address, block_number, log_index);
CREATE TABLE IF NOT EXISTS heyyo_trades (
  chain_id integer NOT NULL,
  token_address text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  event_timestamp bigint NOT NULL,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  quote_amount_raw numeric(78, 0) NOT NULL CHECK (quote_amount_raw >= 0),
  PRIMARY KEY (chain_id, tx_hash, log_index),
  FOREIGN KEY (chain_id, token_address) REFERENCES heyyo_tokens (chain_id, token_address)
);
CREATE INDEX IF NOT EXISTS heyyo_trades_window ON heyyo_trades (chain_id, token_address, event_timestamp);
CREATE TABLE IF NOT EXISTS heyyo_prices (
  chain_id integer NOT NULL,
  token_address text NOT NULL,
  block_number bigint NOT NULL,
  log_index integer NOT NULL,
  event_timestamp bigint NOT NULL,
  price_usd numeric NOT NULL CHECK (price_usd > 0),
  PRIMARY KEY (chain_id, token_address, block_number, log_index)
);
CREATE INDEX IF NOT EXISTS heyyo_prices_window ON heyyo_prices (chain_id, token_address, event_timestamp DESC, block_number DESC, log_index DESC);

-- frontend 42: public registry can be indexed before curve market data is available.
ALTER TABLE heyyo_tokens ADD COLUMN IF NOT EXISTS launch_id numeric(78,0);
ALTER TABLE heyyo_tokens ALTER COLUMN graduation_target_raw DROP NOT NULL;
ALTER TABLE heyyo_tokens DROP CONSTRAINT IF EXISTS heyyo_tokens_quote_symbol_check;
ALTER TABLE heyyo_events DROP CONSTRAINT IF EXISTS heyyo_events_kind_check;
ALTER TABLE heyyo_events ADD CONSTRAINT heyyo_events_kind_check CHECK (kind IN ('created','trade','graduated','price','protocol'));

ALTER TABLE heyyo_tokens ADD COLUMN IF NOT EXISTS metadata_checked_at timestamptz;

CREATE TABLE IF NOT EXISTS heyyo_reward_snapshots (
  chain_id integer NOT NULL, deployment_id text NOT NULL, token_address text NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(chain_id,deployment_id,token_address),
  FOREIGN KEY(chain_id,token_address) REFERENCES heyyo_tokens(chain_id,token_address)
);
CREATE TABLE IF NOT EXISTS heyyo_reward_state (
  chain_id integer NOT NULL, deployment_id text NOT NULL, block_number bigint NOT NULL, block_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(chain_id,deployment_id)
);
CREATE INDEX IF NOT EXISTS heyyo_tokens_creator ON heyyo_tokens(chain_id,deployment_id,creator_address);

-- Per-token market cursors allow historical backfill without rewinding registry/rewards.
ALTER TABLE heyyo_tokens ADD COLUMN IF NOT EXISTS market_block bigint;
ALTER TABLE heyyo_tokens ADD COLUMN IF NOT EXISTS market_block_hash text;
