// Módulo Sankhya
import { Module, Global } from '@nestjs/common';
import { SankhyaService } from './sankhya.service';
import { SankhyaClient } from './sankhya.client';
import { SankhyaController } from './sankhya.controller';

@Global()
@Module({
    controllers: [SankhyaController],
    providers: [SankhyaService, SankhyaClient],
    exports: [SankhyaService, SankhyaClient],
})
export class SankhyaModule { }
