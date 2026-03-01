import { z } from 'zod'

// --- Artist ---

export const ArtistSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  name_ja: z.string().nullable(),
  genres: z.array(z.string()).nullable(),
  birth_year: z.number().nullable(),
  death_year: z.number().nullable(),
  image_url: z.string().nullable(),
  spotify_url: z.string().nullable(),
  youtube_url: z.string().nullable(),
  wikidata_id: z.string().nullable(),
})

export type Artist = z.infer<typeof ArtistSchema>

export const ArtistSummarySchema = ArtistSchema.pick({
  id: true,
  name: true,
  name_ja: true,
  genres: true,
  birth_year: true,
  image_url: true,
})

export type ArtistSummary = z.infer<typeof ArtistSummarySchema>

// --- Influence ---

export const InfluenceTypeSchema = z.enum([
  'musical',
  'lyrical',
  'philosophical',
  'aesthetic',
  'personal',
])

export type InfluenceType = z.infer<typeof InfluenceTypeSchema>

export const TrustLevelSchema = z.enum([
  'self_stated',
  'expert_db',
  'wikidata',
  'academic',
  'community',
])

export type TrustLevel = z.infer<typeof TrustLevelSchema>

export const InfluenceEdgeSchema = z.object({
  id: z.string(),
  influence_type: InfluenceTypeSchema.nullable(),
  trust_level: TrustLevelSchema.nullable(),
  influencer: ArtistSummarySchema.nullable().optional(),
  influenced: ArtistSummarySchema.nullable().optional(),
})

export type InfluenceEdge = z.infer<typeof InfluenceEdgeSchema>

// --- Graph Node State ---

export interface GraphNodeData {
  id: string
  label: string
  name: string
  name_ja: string | null
  genres: string[] | null
  birth_year: number | null
  image_url: string | null
  isRoot: boolean
  hasChildren: boolean
  connectionCount: number
}

// --- Connection Info (for load-more) ---

export interface DirectionInfo {
  loaded: number
  total: number
}

export interface MoreInfo {
  artistId: string
  influencers: DirectionInfo
  influenced: DirectionInfo
}

// --- Search Filters ---

export interface EraFilter {
  label: string
  min: number | null
  max: number | null
}

// --- Source ---

export const SourceSchema = z.object({
  id: z.string(),
  influence_id: z.string(),
  url: z.string().nullable(),
  title: z.string().nullable(),
})

export type Source = z.infer<typeof SourceSchema>
