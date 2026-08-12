import { Controller, Get, Param, Query } from '@nestjs/common';
import { NewsService } from './news.service';

@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get()
  async getMarketNews(
    @Query('category') category?: string,
    @Query('q') query?: string,
    @Query('limit') limit: number = 30
  ) {
    return this.newsService.getMarketNews(category, query, limit);
  }

  @Get(':ticker')
  async getStockNews(@Param('ticker') ticker: string) {
    return this.newsService.getStockNews(ticker);
  }
}
