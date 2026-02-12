import { IsString, IsNotEmpty } from 'class-validator';

export class ReportarProblemaDto {
    @IsString()
    @IsNotEmpty({ message: 'O motivo do reporte não pode ser vazio' })
    motivo: string;
}
