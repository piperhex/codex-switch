import {
  IsBoolean,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertFaqDto {
  @IsString()
  @MaxLength(300)
  questionZh: string;

  @IsString()
  @MaxLength(300)
  questionEn: string;

  @IsString()
  @MaxLength(8000)
  answerZh: string;

  @IsString()
  @MaxLength(8000)
  answerEn: string;

  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(-100000)
  @Max(100000)
  sortOrder: number;
}
