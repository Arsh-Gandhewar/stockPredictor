import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetcher } from '../lib/api';

export function useMarketSummary() {
  return useQuery({
    queryKey: ['market-summary'],
    queryFn: () => fetcher<any[]>('/stock/market-summary'),
    refetchInterval: 60000, // 1 minute
  });
}

export function useTopPicks() {
  return useQuery({
    queryKey: ['top-picks'],
    queryFn: () => fetcher<any[]>('/stock/top-picks'),
  });
}

export function useStockChart(ticker: string) {
  return useQuery({
    queryKey: ['stock-chart', ticker],
    queryFn: () => fetcher<any[]>(`/stock/${ticker}/chart`),
    enabled: !!ticker,
  });
}

export function useStockProfile(ticker: string) {
  return useQuery({
    queryKey: ['stock-profile', ticker],
    queryFn: () => fetcher<any>(`/stock/${ticker}/profile`),
    enabled: !!ticker,
  });
}

export function usePortfolio(userId?: string) {
  return useQuery({
    queryKey: ['portfolio', userId],
    queryFn: () => fetcher<any>('/portfolio', {
      headers: userId ? { 'x-user-id': userId } : undefined
    }),
  });
}

export function useExecuteTrade() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { ticker: string; type: 'BUY' | 'SELL'; quantity: number; userId?: string }) => 
      fetcher('/portfolio/trade', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: data.userId ? { 'x-user-id': data.userId } : undefined
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', variables.userId] });
    },
  });
}
