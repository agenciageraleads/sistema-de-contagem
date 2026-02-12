import { IsString, IsOptional, IsEnum, IsBoolean, MinLength } from 'class-validator';
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
}
