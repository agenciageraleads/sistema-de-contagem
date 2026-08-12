import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateEntregaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  numeroPedido: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clienteNome: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  telefone?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  enderecoTexto: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  bairro?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  cidade?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2)
  uf?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  googleMapsUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  pagamento?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  observacoes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  motoristaSpokeId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  motoristaNome?: string;
}
