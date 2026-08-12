import { Module } from '@nestjs/common';
import { SeparacaoController } from './separacao.controller';
import { SeparacaoService } from './separacao.service';
import { SankhyaModule } from '../sankhya/sankhya.module';

@Module({
  imports: [SankhyaModule],
  controllers: [SeparacaoController],
  providers: [SeparacaoService],
})
export class SeparacaoModule {}
