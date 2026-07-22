import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMailServiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65_535)
  port: number;

  @IsBoolean()
  secure: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(320)
  fromAddress: string;

  @IsBoolean()
  enabled: boolean;
}

export class UpdateMailServiceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65_535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  password?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  fromAddress?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
