import { IsString, IsNotEmpty } from 'class-validator';

export class AddWatchlistDto {
  @IsString()
  @IsNotEmpty()
  ticker: string;
}
