import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CodexHomePresetDto {
  @IsString()
  @Length(1, 64)
  id: string;

  @IsString()
  @Length(1, 80)
  name: string;

  @IsString()
  @Length(1, 500)
  windowsPath: string;

  @IsString()
  @Length(1, 500)
  macosPath: string;

  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder: number;
}

export class UpdateCodexHomePresetsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CodexHomePresetDto)
  presets: CodexHomePresetDto[];
}

export class CodexHomePresetPlatformDto {
  @IsIn(['windows', 'macos'])
  platform: 'windows' | 'macos';
}
