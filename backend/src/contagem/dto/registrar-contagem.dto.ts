import { IsNumber, IsNotEmpty, Min } from 'class-validator';

export class RegistrarContagemDto {
    @IsNumber()
    @IsNotEmpty()
    filaId: number;

    @IsNumber()
    @IsNotEmpty()
    @Min(0, { message: 'Quantidade não pode ser negativa' })
    qtd_contada: number;
}
