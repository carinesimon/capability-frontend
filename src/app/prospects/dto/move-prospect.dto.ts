import { IsEnum } from 'class-validator';
import { LeadStage } from '@prisma/client';

export class MoveProspectDto {
  @IsEnum(LeadStage)
  toStage!: LeadStage;
}
