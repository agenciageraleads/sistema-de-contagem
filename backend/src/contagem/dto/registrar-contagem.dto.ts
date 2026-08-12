import { IsNumber, IsNotEmpty, IsString, Min } from 'class-validator';

export class RegistrarContagemDto {
  @IsNumber()
  @IsNotEmpty()
  filaId: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(0, { message: 'Quantidade não pode ser negativa' })
  qtd_contada: number;

  @IsString()
  @IsNotEmpty({ message: 'Leia o código de barras do produto antes de confirmar' })
  codigo_barras_lido: string;
}
