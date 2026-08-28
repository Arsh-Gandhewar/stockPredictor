import { ServerConfig } from '../config.js';
import { translateError, McpError } from '../errors/mcp-errors.js';
import { logger } from '../logging/logger.js';

export interface QuantxClientOptions {
  config: ServerConfig;
  customFetch?: typeof fetch;
}

export class QuantxClient {
  private readonly config: ServerConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(options: QuantxClientOptions) {
    this.config = options.config;
    this.fetchImpl = options.customFetch || globalThis.fetch.bind(globalThis);
  }

  /**
   * Internal HTTP execution engine with timeout, request correlation, and safe error translation.
   */
  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
      userId?: string;
      requestId?: string;
      isWriteOperation?: boolean;
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, userId, requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, isWriteOperation = false } = options;
    const url = `${this.config.apiUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'x-api-key': this.config.apiKey,
      'x-request-id': requestId,
      'x-user-id': (userId || this.config.authUserId) || '',
    };

    const maxRetries = isWriteOperation ? 0 : 2;
    let attempt = 0;
    const startTime = Date.now();

    while (attempt <= maxRetries) {
      attempt++;
      try {
        logger.debug(`QuantX request: ${method} ${endpoint}`, { requestId, userScope: userId });

        const signal = AbortSignal.timeout(this.config.requestTimeoutMs);
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal,
        });

        const durationMs = Date.now() - startTime;

        if (!res.ok) {
          let errorBody: any;
          try {
            errorBody = await res.json();
          } catch {
            errorBody = { message: await res.text().catch(() => res.statusText) };
          }

          const message = errorBody?.message || errorBody?.error || `HTTP ${res.status}: ${res.statusText}`;

          logger.warn(`QuantX HTTP error ${res.status} on ${method} ${endpoint}`, {
            requestId,
            durationMs,
            status: String(res.status),
            error: message,
          });

          // Non-retryable HTTP client errors (400, 401, 403, 404, 409, 422)
          if (res.status >= 400 && res.status < 500) {
            throw translateError({ status: res.status, message }, requestId);
          }

          // Upstream server errors (500, 502, 503, 504)
          if (attempt > maxRetries) {
            throw translateError({ status: res.status, message }, requestId);
          }

          // Wait before retry with backoff
          await new Promise((r) => setTimeout(r, 200 * attempt));
          continue;
        }

        const data = (await res.json()) as T;
        logger.debug(`QuantX response received: ${method} ${endpoint}`, { requestId, durationMs, status: '200' });
        return data;
      } catch (err: unknown) {
        if (err instanceof McpError) {
          throw err;
        }
        if (attempt > maxRetries) {
          throw translateError(err, requestId);
        }
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }

    throw new McpError('TIMEOUT', `QuantX request to ${endpoint} exceeded retry limits.`, { details: { requestId } });
  }

  // ── Market Data Endpoints ──

  async getHealth(requestId?: string): Promise<any> {
    return this.request<any>('/health', { requestId });
  }

  async getMarketStatus(requestId?: string): Promise<any> {
    return this.request<any>('/stock/market-status', { requestId });
  }

  async getMarketSummary(requestId?: string): Promise<any[]> {
    return this.request<any[]>('/stock/market-summary', { requestId });
  }

  async getQuote(ticker: string, requestId?: string): Promise<any> {
    return this.request<any>(`/stock/${encodeURIComponent(ticker)}/quote`, { requestId });
  }

  async getChart(ticker: string, range: string = '6mo', requestId?: string): Promise<any[]> {
    return this.request<any[]>(`/stock/${encodeURIComponent(ticker)}/chart?range=${encodeURIComponent(range)}`, { requestId });
  }

  async searchStocks(query: string, requestId?: string): Promise<any[]> {
    return this.request<any[]>(`/stock/search?q=${encodeURIComponent(query)}`, { requestId });
  }

  async getAllStocks(requestId?: string): Promise<any[]> {
    return this.request<any[]>('/stock/all', { requestId });
  }

  async getTopPicks(requestId?: string): Promise<any[]> {
    return this.request<any[]>('/stock/top-picks', { requestId });
  }

  async getHighRiskOpportunities(requestId?: string): Promise<any[]> {
    return this.request<any[]>('/stock/high-risk-high-reward', { requestId });
  }

  async getMovementCatalyst(ticker: string, requestId?: string): Promise<any> {
    return this.request<any>(`/stock/${encodeURIComponent(ticker)}/catalyst`, { requestId });
  }

  async getStockProfile(ticker: string, requestId?: string): Promise<any> {
    return this.request<any>(`/stock/${encodeURIComponent(ticker)}/profile`, { requestId });
  }

  // ── Quant Predictions & Governance ──

  async getPrediction(ticker: string, requestId?: string): Promise<any> {
    return this.request<any>(`/prediction/${encodeURIComponent(ticker)}`, { requestId });
  }

  async getTopRankedPredictions(requestId?: string): Promise<any[]> {
    return this.request<any[]>('/prediction/top-ranked', { requestId });
  }

  async getMarketRegime(requestId?: string): Promise<any> {
    return this.request<any>('/prediction/regime', { requestId });
  }

  async getModelStatus(requestId?: string): Promise<any> {
    return this.request<any>('/prediction/model-status', { requestId });
  }

  async getModelPerformance(requestId?: string): Promise<any> {
    return this.request<any>('/prediction/model-performance', { requestId });
  }

  async getProductionScorecard(requestId?: string): Promise<any> {
    return this.request<any>('/prediction/scorecard', { requestId });
  }

  async getGovernance(requestId?: string): Promise<any> {
    return this.request<any>('/prediction/governance', { requestId });
  }

  // ── Portfolio & Paper Trading Endpoints ──

  async getPortfolio(userId: string, requestId?: string): Promise<any> {
    return this.request<any>('/portfolio', { userId, requestId });
  }

  async getPortfolioTrades(
    userId: string,
    params?: { ticker?: string; type?: string; page?: number; limit?: number },
    requestId?: string
  ): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.ticker) query.set('ticker', params.ticker);
    if (params?.type) query.set('type', params.type);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));

    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<any[]>(`/portfolio/trades${qs}`, { userId, requestId });
  }

  async getPortfolioSellSignals(userId: string, requestId?: string): Promise<any[]> {
    return this.request<any[]>('/portfolio/sell-signals', { userId, requestId });
  }

  async executeTrade(
    userId: string,
    tradeData: {
      ticker: string;
      type: 'BUY' | 'SELL';
      quantity: number;
      orderType?: 'MARKET' | 'LIMIT';
      idempotencyKey?: string;
    },
    requestId?: string
  ): Promise<any> {
    return this.request<any>('/portfolio/trade', {
      method: 'POST',
      body: tradeData,
      userId,
      requestId,
      isWriteOperation: true,
    });
  }

  async resetPortfolio(userId: string, requestId?: string): Promise<any> {
    return this.request<any>('/portfolio/reset', {
      method: 'POST',
      userId,
      requestId,
      isWriteOperation: true,
    });
  }

  // ── News & Sentiment Endpoints ──

  async getMarketNews(category?: string, query?: string, limit: number = 30, requestId?: string): Promise<any[]> {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (query) q.set('q', query);
    if (limit) q.set('limit', String(limit));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return this.request<any[]>(`/news${qs}`, { requestId });
  }

  async getStockNews(ticker: string, requestId?: string): Promise<any[]> {
    return this.request<any[]>(`/news/${encodeURIComponent(ticker)}`, { requestId });
  }
}
