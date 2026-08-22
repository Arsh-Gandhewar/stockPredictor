import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { DatabaseService } from '../../database/database.service';
import { StockService } from '../stock/stock.service';
import { QuantPredictionService } from '../prediction/prediction.service';
import { AiService } from '../ai/ai.service';

describe('PortfolioService', () => {
  let service: PortfolioService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: DatabaseService, useValue: {} },
        { provide: StockService, useValue: {} },
        { provide: QuantPredictionService, useValue: {} },
        { provide: AiService, useValue: {} },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
