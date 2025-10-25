import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { LeadStage } from '@prisma/client';
import { Transform } from 'class-transformer';

export class QueryProspectsDto {
  @IsOptional()
  @IsEnum(LeadStage)
  stage?: LeadStage;

  @IsOptional()
  @IsString()
  from?: string; // ISO date

  @IsOptional()
  @IsString()
  to?: string;   // ISO date

  @IsOptional()
  @IsString()
  q?: string;    // search (name/email/phone/tag)

  @IsOptional()
  @IsString()
  setterId?: string;

  @IsOptional()
  @IsString()
  closerId?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  pageSize?: number = 50;
}
