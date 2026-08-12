import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { WatchlistService } from './watchlist.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AddWatchlistDto } from './dto/add-watchlist.dto';

@Controller('watchlist')
@UseGuards(AuthGuard)
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  async getWatchlist(@Req() req: any) {
    const userId = req.userId || 'default_user';
    return this.watchlistService.getUserWatchlist(userId);
  }

  @Post('add')
  async addStock(@Req() req: any, @Body() body: AddWatchlistDto) {
    const userId = req.userId || 'default_user';
    return this.watchlistService.addTicker(userId, body.ticker);
  }

  @Delete(':ticker')
  async removeStock(@Req() req: any, @Param('ticker') ticker: string) {
    const userId = req.userId || 'default_user';
    return this.watchlistService.removeTicker(userId, ticker);
  }
}
