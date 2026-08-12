import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CreateAlertDto } from './dto/create-alert.dto';

@Controller('alerts')
@UseGuards(AuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async getAlerts(@Req() req: any) {
    const userId = req.userId || 'default_user';
    return this.alertsService.getUserAlerts(userId);
  }

  @Post()
  async createAlert(
    @Req() req: any,
    @Body() body: CreateAlertDto
  ) {
    const userId = req.userId || 'default_user';
    return this.alertsService.createAlert(userId, body.ticker, body.targetPrice, body.condition);
  }

  @Delete(':id')
  async deleteAlert(@Req() req: any, @Param('id') id: string) {
    const userId = req.userId || 'default_user';
    return this.alertsService.deleteAlert(userId, id);
  }
}
