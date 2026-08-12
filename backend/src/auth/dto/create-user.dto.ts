// DTO para criação de usuário
import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  nome: string;

  @IsString()
  @IsNotEmpty({ message: 'Login é obrigatório' })
  @MinLength(3, { message: 'Login deve ter pelo menos 3 caracteres' })
  login: string;

  @IsString()
  @IsNotEmpty({ message: 'Senha é obrigatória' })
  @MinLength(4, { message: 'Senha deve ter pelo menos 4 caracteres' })
  senha: string;

  @IsEnum(UserRole, { message: 'Role deve ser OPERADOR, SUPERVISOR ou ADMIN' })
  @IsOptional()
  role?: UserRole;

  @IsOptional()
  @IsInt({ message: 'Código do usuário no Sankhya deve ser numérico' })
  @Min(1, { message: 'Código do usuário no Sankhya deve ser maior que zero' })
  codusuSankhya?: number;
}
