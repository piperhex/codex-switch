import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportPersonalAccountsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5 * 1024 * 1024)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  expiresAt?: string;
}
