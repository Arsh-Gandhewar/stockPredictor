import { IsString, IsNotEmpty, IsNumber, IsPositive, IsIn } from 'class-validator';

export class CreateAlertDto {
  @IsString()
  @IsNotEmpty()
  ticker: string;

  @IsNumber()
  @IsPositive()
  targetPrice: number;

  @IsIn(['ABOVE', 'BELOW'])
  condition: 'ABOVE' | 'BELOW';
}
