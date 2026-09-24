'use client';

import { useQuery } from '@tanstack/react-query';
import { searchUniversalStocks, fetchDeepAudit, ResolvedTicker, DeepAuditReport } from '@/lib/api';

export function useDeepAuditSearch(query: string) {
  return useQuery<ResolvedTicker[]>({
    queryKey: ['deep-audit-search', query],
    queryFn: () => searchUniversalStocks(query),
    enabled: query.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useDeepAudit(ticker: string | null) {
  return useQuery<DeepAuditReport>({
    queryKey: ['deep-audit', ticker],
    queryFn: () => fetchDeepAudit(ticker!),
    enabled: !!ticker,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
