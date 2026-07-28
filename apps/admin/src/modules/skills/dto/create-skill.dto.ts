import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSkillDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  version: string;
}
