import { IsArray, IsBoolean, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CurrencyItemDto {
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Za-z]{3}$/)
  code: string;

  @IsString()
  @Length(1, 40)
  name: string;
}

export class UpdateCurrencySettingsDto {
  @IsOptional()
  @IsString()
  @Length(1, 256)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CurrencyItemDto)
  currencies: CurrencyItemDto[];
}
