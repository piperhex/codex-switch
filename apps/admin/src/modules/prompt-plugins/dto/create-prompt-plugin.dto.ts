import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { PromptPluginType } from '../entities/prompt-plugin-item.entity';

export class CreatePromptPluginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  version: string;

  @IsIn(['injection', 'filter'])
  type: PromptPluginType;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text: string;
}
