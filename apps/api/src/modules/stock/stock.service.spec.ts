import { Test, TestingModule } from '@nestjs/testing';
import { StockService } from './stock.service';
import { DatabaseService } from '../../database/database.service';
import { YahooMarketDataProvider } from './providers/yahoo-market-data.provider';
import { NewsService } from '../news/news.service';
import { QuantPredictionService } from '../prediction/prediction.service';

describe('StockService', () => {
  let service: StockService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: DatabaseService, useValue: {} },
        { provide: YahooMarketDataProvider, useValue: { getUniverse: jest.fn().mockReturnValue([]) } },
        { provide: NewsService, useValue: {} },
        { provide: QuantPredictionService, useValue: {} },
      ],
    }).compile();

    service = module.get<StockService>(StockService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
