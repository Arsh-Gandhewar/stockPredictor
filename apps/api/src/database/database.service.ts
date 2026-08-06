import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { prisma } from 'db';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  // Expose the prisma instance directly
  public readonly client = prisma;

  async onModuleInit() {
    this.logger.log('Connecting to the database via Prisma...');
    await this.client.$connect();
    this.logger.log('Database connected successfully.');
  }

  async onModuleDestroy() {
    this.logger.log('Closing database connection...');
    await this.client.$disconnect();
    this.logger.log('Database connection closed.');
  }
}
