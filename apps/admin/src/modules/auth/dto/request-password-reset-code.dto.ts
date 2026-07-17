import { IsEmail } from 'class-validator';

export class RequestPasswordResetCodeDto {
  @IsEmail()
  email: string;
}
