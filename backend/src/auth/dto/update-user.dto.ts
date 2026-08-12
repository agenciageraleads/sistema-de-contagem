import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  nome?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsBoolean()
  @IsOptional()
  ativo?: boolean;

  @IsOptional()
  @IsInt({ message: 'Código do usuário no Sankhya deve ser numérico' })
  @Min(1, { message: 'Código do usuário no Sankhya deve ser maior que zero' })
  codusuSankhya?: number;
}
