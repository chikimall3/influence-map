import { describe, it, expect } from 'vitest'
import { ArtistSchema, InfluenceEdgeSchema, InfluenceTypeSchema, TrustLevelSchema } from '../domain'

describe('ArtistSchema', () => {
  it('validates a complete artist', () => {
    const artist = {
      id: '515e6290-f7e0-443b-85a4-a7bceed6e261',
      name: 'Bob Dylan',
      name_ja: 'ボブ・ディラン',
      genres: ['rock', 'folk'],
      birth_year: 1941,
      death_year: null,
      image_url: null,
      spotify_url: null,
      youtube_url: null,
      wikidata_id: 'Q392',
    }
    expect(ArtistSchema.parse(artist)).toEqual(artist)
  })

  it('rejects invalid uuid', () => {
    expect(() => ArtistSchema.parse({ id: 'not-a-uuid', name: 'Test' })).toThrow()
  })

  it('allows nullable fields', () => {
    const artist = {
      id: '515e6290-f7e0-443b-85a4-a7bceed6e261',
      name: 'Test',
      name_ja: null,
      genres: null,
      birth_year: null,
      death_year: null,
      image_url: null,
      spotify_url: null,
      youtube_url: null,
      wikidata_id: null,
    }
    expect(ArtistSchema.parse(artist)).toEqual(artist)
  })
})

describe('InfluenceTypeSchema', () => {
  it('accepts valid types', () => {
    expect(InfluenceTypeSchema.parse('musical')).toBe('musical')
    expect(InfluenceTypeSchema.parse('lyrical')).toBe('lyrical')
    expect(InfluenceTypeSchema.parse('philosophical')).toBe('philosophical')
  })

  it('rejects invalid types', () => {
    expect(() => InfluenceTypeSchema.parse('unknown')).toThrow()
  })
})

describe('TrustLevelSchema', () => {
  it('accepts valid levels', () => {
    expect(TrustLevelSchema.parse('wikidata')).toBe('wikidata')
    expect(TrustLevelSchema.parse('expert_db')).toBe('expert_db')
  })
})

describe('InfluenceEdgeSchema', () => {
  it('validates an influence with nested artist', () => {
    const edge = {
      id: 'test-edge-1',
      influence_type: 'musical',
      trust_level: 'wikidata',
      influencer: {
        id: '515e6290-f7e0-443b-85a4-a7bceed6e261',
        name: 'Bob Dylan',
        name_ja: 'ボブ・ディラン',
        genres: ['rock'],
        birth_year: 1941,
        image_url: null,
      },
    }
    expect(InfluenceEdgeSchema.parse(edge)).toEqual(edge)
  })
})
