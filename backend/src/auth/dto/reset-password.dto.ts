import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class ResetPasswordDto {
    @IsString()
    @IsNotEmpty({ message: 'Nova senha é obrigatória' })
    @MinLength(4, { message: 'Senha deve ter pelo menos 4 caracteres' })
    novaSenha: string;
}
