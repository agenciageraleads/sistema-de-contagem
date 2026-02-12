// Módulo de Contagem
import { Module } from '@nestjs/common';
import { ContagemService } from './contagem.service';
import { ContagemController } from './contagem.controller';

@Module({
    controllers: [ContagemController],
    providers: [ContagemService],
    exports: [ContagemService],
})
export class ContagemModule { }
