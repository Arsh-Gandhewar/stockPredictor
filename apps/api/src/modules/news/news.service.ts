import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { MarketNewsArticle } from './news.interface';
import { TOP_300_INDIAN_UNIVERSE } from '../stock/data/indian-universe.data';

@Injectable()
export class NewsService implements OnModuleDestroy {
  private readonly logger = new Logger(NewsService.name);
  private cachedNews: MarketNewsArticle[] = [];
  private lastFetchedAt: number = 0;
  private readonly CACHE_TTL = 300_000; // Exactly 5 minutes live news refresh cycle
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.cachedNews = this.getFallbackNews();

    this.refreshNewsFeed(true).catch((err) =>
      this.logger.warn(`Initial news ingestion failed: ${err.message}`),
    );

    // Automatically trigger fresh news ingestion every 5 minutes (300,000ms)
    this.refreshTimer = setInterval(() => {
      this.logger.log(
        'Executing automated 5-minute live news refresh and sentiment update...',
      );
      this.refreshNewsFeed(true).catch((err) =>
        this.logger.warn(`Automated 5-min news refresh failed: ${err.message}`),
      );
    }, 300_000);
  }

  /**
   * Refreshes Indian market news from verified live financial RSS sources (every 5 minutes)
   */
  async refreshNewsFeed(
    forceRefresh: boolean = false,
  ): Promise<MarketNewsArticle[]> {
    if (
      !forceRefresh &&
      Date.now() - this.lastFetchedAt < this.CACHE_TTL &&
      this.cachedNews.length > 0
    ) {
      return this.cachedNews;
    }

    try {
      // Fetch Google News RSS for Indian Business & Financial Markets (with 5-second timeout)
      const rssUrl =
        'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en';
      const res = await fetch(rssUrl, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!res.ok) {
        throw new Error(`RSS feed returned status ${res.status}`);
      }

      const xmlText = await res.text();
      const items = this.parseRssXml(xmlText);

      if (items.length > 0) {
        this.cachedNews = items;
        this.lastFetchedAt = Date.now();
      }
    } catch (err: any) {
      this.logger.error(`Failed to stream live financial news: ${err.message}`);
      if (this.cachedNews.length === 0) {
        this.cachedNews = this.getFallbackNews();
      }
    }

    return this.cachedNews;
  }

  /**
   * Fast XML RSS Item Parser for Google News Financial Stream
   */
  private parseRssXml(xml: string): MarketNewsArticle[] {
    const articles: MarketNewsArticle[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && articles.length < 30) {
      const itemContent = match[1];

      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemContent);
      const linkMatch = /<link>([\s\S]*?)<\/link>/.exec(itemContent);
      const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(itemContent);
      const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/.exec(itemContent);

      let rawTitle = titleMatch
        ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim()
        : '';
      const url = linkMatch ? linkMatch[1].trim() : '';
      const pubDate = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();
      let source = sourceMatch ? sourceMatch[1].trim() : 'Financial Express';

      // Extract source name from title if structured as "Headline - Source Name"
      if (rawTitle.includes(' - ')) {
        const parts = rawTitle.split(' - ');
        source = parts.pop()?.trim() || source;
        rawTitle = parts.join(' - ').trim();
      }

      if (!rawTitle || !url) continue;

      // Classify category, affected stock, sentiment, and impact
      const category = this.detectCategory(rawTitle);
      const affected = this.detectAffectedStock(rawTitle);
      const sentiment = this.detectSentiment(rawTitle);
      const impact = this.detectImpact(rawTitle);
      const timeAgo = this.formatTimeAgo(pubDate);

      articles.push({
        id: `news_${Buffer.from(url).toString('base64').substring(0, 16)}`,
        title: rawTitle,
        source,
        url,
        publishedAt: pubDate.toISOString(),
        timeAgo,
        category,
        sentiment,
        impact,
        affectedStock: affected?.ticker,
        affectedStockName: affected?.name,
        summary: `Market report: ${rawTitle}. Analyzed for impact across Indian equities.`,
        whyItMatters: `Material development in ${category.toLowerCase()} sector impacting institutional flows.`,
        fullBody: `${rawTitle}. Verified reporting from ${source}. Published on ${pubDate.toLocaleString('en-IN')}.`,
        isFallback: false,
      });
    }

    return articles;
  }

  private detectCategory(
    title: string,
  ): 'Markets' | 'Corporate' | 'Results' | 'Macro' {
    const t = title.toLowerCase();
    if (
      t.includes('rbi') ||
      t.includes('inflation') ||
      t.includes('gdp') ||
      t.includes('fed') ||
      t.includes('deficit') ||
      t.includes('rupee') ||
      t.includes('repo')
    ) {
      return 'Macro';
    }
    if (
      t.includes('q1') ||
      t.includes('q2') ||
      t.includes('q3') ||
      t.includes('q4') ||
      t.includes('profit') ||
      t.includes('revenue') ||
      t.includes('earnings') ||
      t.includes('pat') ||
      t.includes('ebitda')
    ) {
      return 'Results';
    }
    if (
      t.includes('sensex') ||
      t.includes('nifty') ||
      t.includes('rally') ||
      t.includes('stocks to watch') ||
      t.includes('fii') ||
      t.includes('dii') ||
      t.includes('bull') ||
      t.includes('bear')
    ) {
      return 'Markets';
    }
    return 'Corporate';
  }

  private detectAffectedStock(
    title: string,
  ): { ticker: string; name: string } | undefined {
    const t = title.toLowerCase();
    for (const stock of TOP_300_INDIAN_UNIVERSE) {
      const cleanTicker = stock.ticker.replace('.NS', '').toLowerCase();
      const firstWord = stock.name.split(' ')[0].toLowerCase();

      if (
        (cleanTicker.length >= 3 && t.includes(cleanTicker)) ||
        (firstWord.length >= 4 && t.includes(firstWord))
      ) {
        return { ticker: stock.ticker, name: stock.name };
      }
    }
    return undefined;
  }

  onModuleDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private detectSentiment(title: string): 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' {
    const t = title.toLowerCase();
    const positiveWords = [
      'surge',
      'jump',
      'gain',
      'rally',
      'profit',
      'boost',
      'growth',
      'beats',
      'soar',
      'record',
      'upgrade',
      'expansion',
      'breakout',
      'buyback',
      'dividend',
      'acquisition',
      'outperform',
      'bullish',
      'turnaround',
      'milestone',
      'robust',
      'optimistic',
    ];
    const negativeWords = [
      'fall',
      'drop',
      'slump',
      'crash',
      'loss',
      'decline',
      'plunge',
      'penalty',
      'probe',
      'downgrade',
      'weak',
      'drag',
      'fraud',
      'default',
      'bankruptcy',
      'scam',
      'selloff',
      'bearish',
      'warning',
      'layoff',
      'recall',
      'miss',
      'underperform',
      'investigation',
    ];

    let pos = 0;
    let neg = 0;
    positiveWords.forEach((w) => {
      if (t.includes(w)) pos++;
    });
    negativeWords.forEach((w) => {
      if (t.includes(w)) neg++;
    });

    if (pos > neg) return 'POSITIVE';
    if (neg > pos) return 'NEGATIVE';
    return 'NEUTRAL';
  }

  private detectImpact(title: string): 'HIGH' | 'MEDIUM' | 'LOW' {
    const t = title.toLowerCase();
    if (
      t.includes('rbi') ||
      t.includes('sebi') ||
      t.includes('merger') ||
      t.includes('acquisition') ||
      t.includes('results') ||
      t.includes('huge') ||
      t.includes('investigation')
    ) {
      return 'HIGH';
    }
    if (
      t.includes('order') ||
      t.includes('partnership') ||
      t.includes('dividend') ||
      t.includes('target')
    ) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  private formatTimeAgo(date: Date): string {
    const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  private getFallbackNews(): MarketNewsArticle[] {
    return [
      {
        id: 'news_fallback_1',
        title:
          'RBI Monetary Policy Committee Maintains Repo Rate at 6.50% with Favorable Inflation Trajectory',
        source: 'Economic Times',
        url: 'https://economictimes.indiatimes.com',
        publishedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        timeAgo: '15m ago',
        category: 'Macro',
        sentiment: 'POSITIVE',
        impact: 'HIGH',
        affectedStock: 'HDFCBANK.NS',
        affectedStockName: 'HDFC Bank Limited',
        summary:
          'RBI MPC unanimously votes to keep benchmark policy repo rate unchanged, citing anchored headline inflation and robust industrial capex momentum.',
        whyItMatters:
          'Rate stability preserves low funding spreads for tier-1 scheduled commercial banks and supports long-duration corporate bond liquidity.',
        fullBody:
          'The Reserve Bank of India Monetary Policy Committee has retained the policy repo rate at 6.50%, projecting FY26 real GDP growth at 7.0%. Governor highlighted sustained domestic consumption resilience, easing core inflation prints, and strong balance sheets across Indian banks.',
        isFallback: true,
      },
      {
        id: 'news_fallback_2',
        title:
          'Reliance Industries Clean Energy Gigafactory Complex Nears Operational Commissioning in Jamnagar',
        source: 'LiveMint',
        url: 'https://livemint.com',
        publishedAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
        timeAgo: '32m ago',
        category: 'Corporate',
        sentiment: 'POSITIVE',
        impact: 'HIGH',
        affectedStock: 'RELIANCE.NS',
        affectedStockName: 'Reliance Industries Limited',
        summary:
          'RIL completes advanced testing of its integrated photovoltaic solar giga-complex and electrolyser modules, targeting commercial scale output this fiscal.',
        whyItMatters:
          'Accelerates transformation into a dominant low-carbon green energy ecosystem while diversifying cash flows away from traditional refining cycles.',
        fullBody:
          'Reliance Industries announced that its multi-gigawatt solar PV and energy storage manufacturing complex in Jamnagar is entering the pre-commercial phase. Institutional analysts view this as a primary catalyst for long-term valuation re-rating.',
        isFallback: true,
      },
      {
        id: 'news_fallback_3',
        title:
          'Tata Consultancy Services Expands AI and Cloud Transformation Deal Pipeline in North America & Europe',
        source: 'Business Standard',
        url: 'https://business-standard.com',
        publishedAt: new Date(Date.now() - 48 * 60 * 1000).toISOString(),
        timeAgo: '48m ago',
        category: 'Corporate',
        sentiment: 'POSITIVE',
        impact: 'MEDIUM',
        affectedStock: 'TCS.NS',
        affectedStockName: 'Tata Consultancy Services Limited',
        summary:
          'TCS signs multi-million dollar generative AI enterprise contracts with Fortune 500 financial institutions, bolstering TCV order book resilience.',
        whyItMatters:
          'Demonstrates enterprise IT client commitment to AI modernization despite discretionary macroeconomic budget scrutiny.',
        fullBody:
          'TCS continues to outpace peers in large deal conversions, leveraging its proprietary AI WisdomNext platform. Management expects deal ramp-ups to safeguard operating margins near the 24-26% targeted corridor.',
        isFallback: true,
      },
      {
        id: 'news_fallback_4',
        title:
          'Infosys Reports Steady BFSI Client Inquiries as Global Tech Spending Rebounds Across Digital Channels',
        source: 'Reuters India',
        url: 'https://reuters.com',
        publishedAt: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
        timeAgo: '1h ago',
        category: 'Results',
        sentiment: 'NEUTRAL',
        impact: 'MEDIUM',
        affectedStock: 'INFY.NS',
        affectedStockName: 'Infosys Limited',
        summary:
          'Infosys notes modest pickup in discretionary cloud migration deals from American banking clients, though European decision-making cycles remain extended.',
        whyItMatters:
          'Stabilizing utilization rates and healthy attrition control buffer revenue guidance throughout the forthcoming quarters.',
        fullBody:
          'Infosys executive leadership reaffirmed confidence in large multi-year cost-optimization programs. The stock trades near strong structural support around key long-term moving averages.',
        isFallback: true,
      },
      {
        id: 'news_fallback_5',
        title:
          'Nifty 50 and Sensex Consolidate Near Crucial Resistance as Domestic Institutional Flows Offset Global Selling',
        source: 'CNBC-TV18',
        url: 'https://cnbctv18.com',
        publishedAt: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
        timeAgo: '1h ago',
        category: 'Markets',
        sentiment: 'POSITIVE',
        impact: 'HIGH',
        summary:
          'Indian benchmark indices trade with mild upward bias as relentless domestic systematic investment plan (SIP) inflows absorb foreign portfolio sales.',
        whyItMatters:
          'Sustained retail SIP flows exceeding ₹25,000 crore monthly establish unprecedented downside support for Indian equity markets.',
        fullBody:
          'Domestic Institutional Investors (DIIs) recorded net purchases exceeding ₹3,400 crore today, countering selective overseas fund outflows. Market breadth remains balanced across mid-cap and defensive heavyweights.',
        isFallback: true,
      },
      {
        id: 'news_fallback_6',
        title:
          'ICICI Bank Posts Robust Net Interest Margin Expansion Backed by Retail Credit and SME Expansion',
        source: 'Economic Times',
        url: 'https://economictimes.indiatimes.com',
        publishedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        timeAgo: '2h ago',
        category: 'Results',
        sentiment: 'POSITIVE',
        impact: 'HIGH',
        affectedStock: 'ICICIBANK.NS',
        affectedStockName: 'ICICI Bank Limited',
        summary:
          'ICICI Bank maintains industry-leading asset quality with net NPA below 0.45% and healthy double-digit advances growth across mortgage and business banking.',
        whyItMatters:
          'High return on equity (RoE ~18%) and pristine balance sheet solidify position as top institutional banking pick.',
        fullBody:
          'Credit rating agencies reiterated the highest tier solvency rating for ICICI Bank, citing superior digital underwriting architecture and steady low-cost CASA deposit mobilization.',
        isFallback: true,
      },
      {
        id: 'news_fallback_7',
        title:
          'Bharti Airtel ARPU Expands Further with 5G Network Monetization and Strong Enterprise Cloud Adoption',
        source: 'LiveMint',
        url: 'https://livemint.com',
        publishedAt: new Date(Date.now() - 150 * 60 * 1000).toISOString(),
        timeAgo: '2h ago',
        category: 'Corporate',
        sentiment: 'POSITIVE',
        impact: 'MEDIUM',
        affectedStock: 'BHARTIARTL.NS',
        affectedStockName: 'Bharti Airtel Limited',
        summary:
          'Bharti Airtel average revenue per user crosses key industry milestones on postpaid migration and tariff rationalization.',
        whyItMatters:
          'Expanding free cash flow supports rapid deleveraging and high-margin B2B connectivity services growth.',
        fullBody:
          'Airtel Business segment recorded strong traction among corporate enterprises adopting hybrid data centers and unified SD-WAN networks across Tier-1 and Tier-2 Indian hubs.',
        isFallback: true,
      },
      {
        id: 'news_fallback_8',
        title:
          'Crude Oil Volatility Prompts Caution in Downstream Oil Marketing Companies as Refining Margins Fluctuate',
        source: 'Bloomberg India',
        url: 'https://bloomberg.com',
        publishedAt: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
        timeAgo: '3h ago',
        category: 'Macro',
        sentiment: 'NEGATIVE',
        impact: 'HIGH',
        summary:
          'Global Brent crude swings create near-term volatility for Indian downstream refiners and state-owned fuel retailers.',
        whyItMatters:
          'Imported energy price fluctuations directly impact India trade deficit, rupee stability, and petrochemical margins.',
        fullBody:
          'Brent crude hovered between $74 and $78 per barrel amid geopolitical crosscurrents. Analysts recommend tracking gross refining margins (GRMs) for cues on downstream profitability.',
        isFallback: true,
      },
      {
        id: 'news_fallback_9',
        title:
          'Larsen & Toubro Secures Mega Infrastructure and Clean Energy Orders Across Domestic and Middle East Corridors',
        source: 'Business Standard',
        url: 'https://business-standard.com',
        publishedAt: new Date(Date.now() - 210 * 60 * 1000).toISOString(),
        timeAgo: '3h ago',
        category: 'Corporate',
        sentiment: 'POSITIVE',
        impact: 'MEDIUM',
        affectedStock: 'LT.NS',
        affectedStockName: 'Larsen & Toubro Limited',
        summary:
          'L&T order backlog surpasses record ₹5 lakh crore mark following high-value EPC contract wins in railways, transmission, and hydrogen plants.',
        whyItMatters:
          'Provides superior multi-year revenue visibility and operational leverage as execution velocity quickens.',
        fullBody:
          'The conglomerate announced wins across power transmission, heavy civil engineering, and green hydrogen projects, reinforcing its dominant standing as India capital goods vanguard.',
        isFallback: true,
      },
      {
        id: 'news_fallback_10',
        title:
          'State Bank of India Enhances Provisioning Buffer as Corporate Credit Demand Picks Up Across Manufacturing',
        source: 'Economic Times',
        url: 'https://economictimes.indiatimes.com',
        publishedAt: new Date(Date.now() - 240 * 60 * 1000).toISOString(),
        timeAgo: '4h ago',
        category: 'Results',
        sentiment: 'POSITIVE',
        impact: 'MEDIUM',
        affectedStock: 'SBIN.NS',
        affectedStockName: 'State Bank of India',
        summary:
          'SBI reports healthy credit pipeline from private capex projects in renewable energy, roads, and electronics manufacturing under PLI schemes.',
        whyItMatters:
          'Public sector banking leader remains a prime bellwether for sovereign economic health and core infrastructure credit cycles.',
        fullBody:
          'State Bank of India reported robust capital adequacy ratios exceeding regulatory norms. Corporate credit inquiries experienced notable quarterly expansion across semiconductor and logistics corridors.',
        isFallback: true,
      },
      {
        id: 'news_fallback_11',
        title:
          'Indian IT Sector Braces for Seasonal Weakness While Generative AI Productivity Gains Offset Margin Pressures',
        source: 'Financial Express',
        url: 'https://financialexpress.com',
        publishedAt: new Date(Date.now() - 280 * 60 * 1000).toISOString(),
        timeAgo: '4h ago',
        category: 'Markets',
        sentiment: 'NEUTRAL',
        impact: 'LOW',
        affectedStock: 'WIPRO.NS',
        affectedStockName: 'Wipro Limited',
        summary:
          'Tier-1 and mid-cap Indian software services firms report internal developer productivity boosts of 18-25% from automated coding companions.',
        whyItMatters:
          'Operational efficiency gains cushion wage revisions and protect billing rates in fixed-price engagements.',
        fullBody:
          'Industry bodies highlight that Indian IT service providers are aggressively reskilling workforces in full-stack AI engineering, positioning India as the global hub for enterprise AI deployment.',
        isFallback: true,
      },
      {
        id: 'news_fallback_12',
        title:
          'SEBI Implements Streamlined Framework for Algorithmic & Quantitative Trading Execution Systems',
        source: 'LiveMint',
        url: 'https://livemint.com',
        publishedAt: new Date(Date.now() - 320 * 60 * 1000).toISOString(),
        timeAgo: '5h ago',
        category: 'Macro',
        sentiment: 'NEUTRAL',
        impact: 'MEDIUM',
        summary:
          'Capital markets regulator issues updated governance guidelines for high-frequency algorithmic risk management and audit trails.',
        whyItMatters:
          'Strengthens market microstructure resilience, enhances retail investor protection, and formalizes quantitative model governance.',
        fullBody:
          'The Securities and Exchange Board of India (SEBI) finalized standardized latency and stress-testing norms for institutional algorithmic desks, promoting algorithmic transparency and orderly market execution.',
        isFallback: true,
      },
    ];
  }

  /**
   * Retrieves news with category, search query, and pagination filters
   */
  async getMarketNews(
    category?: string,
    query?: string,
    limit: number = 30,
  ): Promise<MarketNewsArticle[]> {
    const allNews = await this.refreshNewsFeed();

    return allNews
      .filter((item) => {
        const matchesCategory =
          !category ||
          category === 'ALL' ||
          item.category.toLowerCase() === category.toLowerCase();
        const matchesQuery =
          !query ||
          item.title.toLowerCase().includes(query.toLowerCase()) ||
          item.source.toLowerCase().includes(query.toLowerCase()) ||
          (item.affectedStock &&
            item.affectedStock.toLowerCase().includes(query.toLowerCase())) ||
          (item.affectedStockName &&
            item.affectedStockName.toLowerCase().includes(query.toLowerCase()));

        return matchesCategory && matchesQuery;
      })
      .slice(0, limit);
  }

  /**
   * Retrieves news specifically related to a given stock ticker
   */
  async getStockNews(ticker: string): Promise<MarketNewsArticle[]> {
    const allNews = await this.refreshNewsFeed();
    const cleanTicker = ticker.replace('.NS', '').toLowerCase();

    return allNews.filter((item) => {
      return (
        item.affectedStock === ticker ||
        item.title.toLowerCase().includes(cleanTicker) ||
        (item.affectedStockName &&
          item.affectedStockName.toLowerCase().includes(cleanTicker))
      );
    });
  }

  /**
   * Calculates dynamic news sentiment impact score (-20 to +20 points) for a stock
   */
  async getSentimentScoreForStock(
    ticker: string,
    sector?: string,
    companyName?: string,
  ): Promise<{
    sentimentScore: number;
    sentimentLabel: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    topHeadline?: string;
    newsCount: number;
  }> {
    const allNews = await this.refreshNewsFeed();
    const cleanTicker = ticker.replace('.NS', '').toLowerCase();
    const firstName = companyName
      ? companyName.split(' ')[0].toLowerCase()
      : '';
    const sectorLower = sector ? sector.toLowerCase() : '';

    let directPos = 0;
    let directNeg = 0;
    let sectorPos = 0;
    let sectorNeg = 0;
    let topHeadline: string | undefined;
    let totalMatched = 0;

    for (const article of allNews) {
      const titleLower = article.title.toLowerCase();
      const isDirectMatch =
        article.affectedStock === ticker ||
        (cleanTicker.length >= 3 && titleLower.includes(cleanTicker)) ||
        (firstName.length >= 4 && titleLower.includes(firstName));

      const isSectorMatch =
        sectorLower.length >= 3 && titleLower.includes(sectorLower);

      if (isDirectMatch) {
        totalMatched++;
        if (!topHeadline) topHeadline = article.title;
        const weight =
          article.impact === 'HIGH' ? 8 : article.impact === 'MEDIUM' ? 5 : 3;
        if (article.sentiment === 'POSITIVE') directPos += weight;
        else if (article.sentiment === 'NEGATIVE') directNeg += weight;
      } else if (isSectorMatch) {
        totalMatched++;
        if (!topHeadline) topHeadline = article.title;
        const weight = article.impact === 'HIGH' ? 3 : 2;
        if (article.sentiment === 'POSITIVE') sectorPos += weight;
        else if (article.sentiment === 'NEGATIVE') sectorNeg += weight;
      }
    }

    const totalScore = Math.max(
      -20,
      Math.min(20, directPos - directNeg + (sectorPos - sectorNeg)),
    );
    const sentimentLabel: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      totalScore >= 4 ? 'BULLISH' : totalScore <= -4 ? 'BEARISH' : 'NEUTRAL';

    return {
      sentimentScore: totalScore,
      sentimentLabel,
      topHeadline,
      newsCount: totalMatched,
    };
  }
}
