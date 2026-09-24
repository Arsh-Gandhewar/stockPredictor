import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeepAuditService } from './deep-audit.service';

@Controller('deep-audit')
export class DeepAuditController {
  constructor(private readonly deepAuditService: DeepAuditService) {}

  @Get('search')
  async searchStocks(@Query('q') query: string) {
    if (!query || query.trim().length < 2) {
      return [];
    }
    return this.deepAuditService.searchStocks(query.trim());
  }

  @Get(':ticker')
  @Throttle({ expensive: { ttl: 60000, limit: 30 } })
  async getDeepAudit(@Param('ticker') ticker: string) {
    return this.deepAuditService.audit(ticker);
  }
}
