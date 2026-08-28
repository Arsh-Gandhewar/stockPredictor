import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';
import { TransactionType, OrderType } from 'db';

export class ExecuteTradeDto {
  @IsString()
  @IsNotEmpty({ message: 'Stock ticker is required' })
  ticker: string;

  @IsEnum(TransactionType, { message: 'Type must be BUY or SELL' })
  type: TransactionType;

  @IsInt({ message: 'Quantity must be an integer' })
  @IsPositive({ message: 'Quantity must be greater than zero' })
  @Min(1, { message: 'Minimum 1 share required' })
  @Max(1000000, { message: 'Maximum 1,000,000 shares allowed per simulated order' })
  quantity: number;

  @IsOptional()
  @IsEnum(OrderType, { message: 'Order type must be MARKET or LIMIT' })
  orderType?: OrderType = OrderType.MARKET;

  @IsOptional()
  @IsNumber({}, { message: 'Limit price must be numeric' })
  @IsPositive({ message: 'Limit price must be greater than zero' })
  limitPrice?: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
