import { IsNumber, IsOptional, IsString, IsEmail, IsEnum } from 'class-validator';
import { LeadStage } from '@prisma/client';

export class UpdateProspectDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() @IsString() source?: string;

  @IsOptional() @IsNumber() opportunityValue?: number;
  @IsOptional() @IsNumber() saleValue?: number;

  @IsOptional() @IsString() setterId?: string;
  @IsOptional() @IsString() closerId?: string;

  // (facultatif – si tu veux permettre un changement direct de stage via update)
  @IsOptional() @IsEnum(LeadStage) stage?: LeadStage;
}
