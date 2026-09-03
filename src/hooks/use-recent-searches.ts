'use client'

import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'kone_recent_searches'
const MAX_ENTRIES = 5

export type RecentSearch = {
  keyword: string
  country: string
  city: string
  timestamp: number
}

function loadSearches(): RecentSearch[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as RecentSearch[]
  } catch {
    return []
  }
}

function saveSearches(searches: RecentSearch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches))
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

export function useRecentSearches() {
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([])

  useEffect(() => {
    setRecentSearches(loadSearches())
  }, [])

  const addSearch = useCallback((keyword: string, country: string, city: string) => {
    if (!keyword.trim()) return

    const entry: RecentSearch = {
      keyword: keyword.trim(),
      country: country.trim(),
      city: city.trim(),
      timestamp: Date.now(),
    }

    setRecentSearches((prev) => {
      // Remove duplicate (same keyword + country + city)
      const filtered = prev.filter(
        (s) => !(s.keyword === entry.keyword && s.country === entry.country && s.city === entry.city),
      )
      const next = [entry, ...filtered].slice(0, MAX_ENTRIES)
      saveSearches(next)
      return next
    })
  }, [])

  const clearRecent = useCallback(() => {
    setRecentSearches([])
    saveSearches([])
  }, [])

  return { recentSearches, addSearch, clearRecent }
}
