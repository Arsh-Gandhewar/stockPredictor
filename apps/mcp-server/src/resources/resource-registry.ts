import { QuantxClient } from '../adapters/quantx-client.js';
import { AuthContext } from '../auth/auth-context.js';
import { McpError } from '../errors/mcp-errors.js';

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: (client: QuantxClient, context: AuthContext) => Promise<{
    contents: Array<{
      uri: string;
      mimeType: string;
      text: string;
    }>;
  }>;
}

export class ResourceRegistry {
  private readonly resources = new Map<string, ResourceDefinition>();

  register(resource: ResourceDefinition): void {
    this.resources.set(resource.uri, resource);
  }

  getResource(uri: string): ResourceDefinition | undefined {
    return this.resources.get(uri);
  }

  getAllResources(): ResourceDefinition[] {
    return Array.from(this.resources.values());
  }

  async readResource(uri: string, client: QuantxClient, context: AuthContext) {
    const resource = this.resources.get(uri);
    if (!resource) {
      throw new McpError('NOT_FOUND', `Resource '${uri}' is not registered in QuantX MCP server.`, { details: { uri } });
    }
    return resource.read(client, context);
  }
}

export function createDefaultResourceRegistry(): ResourceRegistry {
  const registry = new ResourceRegistry();

  // 1. quantx://market/status
  registry.register({
    uri: 'quantx://market/status',
    name: 'Market Status',
    description: 'Current real-time market state, exchange session status, and market benchmarks.',
    mimeType: 'application/json',
    read: async (client) => {
      const now = Date.now();
      const status = await client.getMarketStatus();
      const summary = await client.getMarketSummary().catch(() => []);

      const payload = {
        uri: 'quantx://market/status',
        marketStatus: status,
        benchmarks: summary,
        dataTimestamp: status?.timestamp || new Date(now).toISOString(),
        retrievedAt: new Date(now).toISOString(),
        dataStatus: status?.status === 'OPEN' ? 'LIVE' : 'MARKET_CLOSED',
        staleAfter: new Date(now + 60_000).toISOString(),
      };

      return {
        contents: [
          {
            uri: 'quantx://market/status',
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  });

  // 2. quantx://portfolio
  registry.register({
    uri: 'quantx://portfolio',
    name: 'User Portfolio',
    description: 'Current portfolio balance, holdings, valuations, and risk state for authenticated user.',
    mimeType: 'application/json',
    read: async (client, context) => {
      const now = Date.now();
      const portfolio = await client.getPortfolio(context.userId);

      const payload = {
        uri: 'quantx://portfolio',
        portfolio,
        dataTimestamp: new Date(now).toISOString(),
        retrievedAt: new Date(now).toISOString(),
        dataStatus: 'AVAILABLE',
        staleAfter: new Date(now + 15_000).toISOString(),
      };

      return {
        contents: [
          {
            uri: 'quantx://portfolio',
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  });

  // 3. quantx://model/current
  registry.register({
    uri: 'quantx://model/current',
    name: 'Active Model Status',
    description: 'Governance scorecard, calibration status, and production readiness of the active LightGBM model.',
    mimeType: 'application/json',
    read: async (client) => {
      const now = Date.now();
      const [modelStatus, governance, scorecard] = await Promise.all([
        client.getModelStatus().catch(() => ({})),
        client.getGovernance().catch(() => ({})),
        client.getProductionScorecard().catch(() => ({})),
      ]);

      const payload = {
        uri: 'quantx://model/current',
        modelStatus,
        governance,
        scorecard,
        dataTimestamp: governance?.lastValidatedAt || new Date(now).toISOString(),
        retrievedAt: new Date(now).toISOString(),
        dataStatus: 'AVAILABLE',
        staleAfter: new Date(now + 300_000).toISOString(),
      };

      return {
        contents: [
          {
            uri: 'quantx://model/current',
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  });

  // 4. quantx://model/performance
  registry.register({
    uri: 'quantx://model/performance',
    name: 'Model Backtest Performance',
    description: 'Summary of institutional walk-forward backtest metrics, CAGR, Sharpe, and Sortino ratios.',
    mimeType: 'application/json',
    read: async (client) => {
      const now = Date.now();
      const performance = await client.getModelPerformance();

      const payload = {
        uri: 'quantx://model/performance',
        performance,
        dataTimestamp: performance?.lastTrained || new Date(now).toISOString(),
        retrievedAt: new Date(now).toISOString(),
        dataStatus: 'AVAILABLE',
        staleAfter: new Date(now + 3600_000).toISOString(),
      };

      return {
        contents: [
          {
            uri: 'quantx://model/performance',
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  });

  // 5. quantx://risk/current
  registry.register({
    uri: 'quantx://risk/current',
    name: 'Current Market Risk & Regime',
    description: 'Real-time market regime classification (Bull, Bear, Sideways, High Volatility) and macro risk posture.',
    mimeType: 'application/json',
    read: async (client) => {
      const now = Date.now();
      const regime = await client.getMarketRegime();

      const payload = {
        uri: 'quantx://risk/current',
        marketRegime: regime?.regime || 'UNKNOWN',
        dataTimestamp: new Date(now).toISOString(),
        retrievedAt: new Date(now).toISOString(),
        dataStatus: 'AVAILABLE',
        staleAfter: new Date(now + 60_000).toISOString(),
      };

      return {
        contents: [
          {
            uri: 'quantx://risk/current',
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  });

  return registry;
}
