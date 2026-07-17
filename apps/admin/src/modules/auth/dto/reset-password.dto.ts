import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'verificationCode must be a 6-digit number' })
  verificationCode: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
