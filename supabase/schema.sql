-- Influence Map MVP — Database Schema
-- Supabase SQL Editor で実行してください

-- ========================================
-- テーブル作成
-- ========================================

-- アーティスト
CREATE TABLE IF NOT EXISTS artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_ja TEXT,
  genres TEXT[] DEFAULT '{}',
  birth_year INTEGER,
  death_year INTEGER,
  country TEXT,
  image_url TEXT,
  musicbrainz_id TEXT,
  wikidata_id TEXT UNIQUE,
  spotify_url TEXT,
  youtube_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 影響関係
CREATE TABLE IF NOT EXISTS influences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  influenced_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  influence_type TEXT DEFAULT 'musical' CHECK (influence_type IN (
    'musical', 'lyrical', 'philosophical', 'aesthetic', 'personal'
  )),
  trust_level TEXT DEFAULT 'wikidata' CHECK (trust_level IN (
    'self_stated', 'expert_db', 'wikidata', 'academic', 'community'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(influencer_id, influenced_id, influence_type)
);

-- 出典
CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influence_id UUID NOT NULL REFERENCES influences(id) ON DELETE CASCADE,
  source_type TEXT,
  title TEXT NOT NULL,
  url TEXT,
  publication_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- インデックス
-- ========================================

CREATE INDEX IF NOT EXISTS idx_artists_name ON artists (name);
CREATE INDEX IF NOT EXISTS idx_artists_name_ja ON artists (name_ja);
CREATE INDEX IF NOT EXISTS idx_artists_wikidata_id ON artists (wikidata_id);
CREATE INDEX IF NOT EXISTS idx_influences_influencer ON influences (influencer_id);
CREATE INDEX IF NOT EXISTS idx_influences_influenced ON influences (influenced_id);
CREATE INDEX IF NOT EXISTS idx_sources_influence ON sources (influence_id);

-- テキスト検索用（日本語・英語両対応）
CREATE INDEX IF NOT EXISTS idx_artists_name_trgm ON artists USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artists_name_ja_trgm ON artists USING gin (name_ja gin_trgm_ops);

-- ========================================
-- Row Level Security (公開読み取り専用)
-- ========================================

ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE influences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;

-- 全員が読み取り可能
CREATE POLICY "Artists are publicly readable"
  ON artists FOR SELECT
  USING (true);

CREATE POLICY "Influences are publicly readable"
  ON influences FOR SELECT
  USING (true);

CREATE POLICY "Sources are publicly readable"
  ON sources FOR SELECT
  USING (true);
