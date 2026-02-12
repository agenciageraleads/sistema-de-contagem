// DTO de Login - Validação dos dados de entrada
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class LoginDto {
    @IsString()
    @IsNotEmpty({ message: 'Login é obrigatório' })
    login: string;

    @IsString()
    @IsNotEmpty({ message: 'Senha é obrigatória' })
    @MinLength(4, { message: 'Senha deve ter pelo menos 4 caracteres' })
    senha: string;
}
