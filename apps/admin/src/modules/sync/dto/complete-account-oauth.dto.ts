import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteAccountOAuthDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  code?: string;

  @IsString()
  @MaxLength(256)
  state: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;
}
