import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { prisma } from 'db';

import { PrismaClient } from 'db';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  // Expose the prisma instance directly
  public readonly client: PrismaClient = prisma;

  async onModuleInit() {
    this.logger.log('Connecting to the database via Prisma...');
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.client.$connect();
        this.logger.log('Database connected successfully.');
        return;
      } catch (err: any) {
        this.logger.warn(`Prisma connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
        if (attempt === maxRetries) throw err;
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing database connection...');
    await this.client.$disconnect();
    this.logger.log('Database connection closed.');
  }
}
