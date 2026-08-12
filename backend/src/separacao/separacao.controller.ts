import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  Get,
  Param,
  Res,
  ParseIntPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { SeparacaoService } from './separacao.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('separacao')
export class SeparacaoController {
  constructor(private readonly separacaoService: SeparacaoService) {}

  @UseGuards(JwtAuthGuard)
  @Post('acao')
  async registrarAcao(
    @Req() req: any,
    @Body()
    body: {
      nunota: number;
      acao: string;
      codusuSankhya?: number;
      localizacao?: string;
      box?: string;
    },
  ) {
    return this.separacaoService.registrarAcao({
      nunota: body.nunota,
      userId: req.user?.id,
      codusu: body.codusuSankhya,
      acao: body.acao,
      localizacao: body.localizacao,
      box: body.box,
    });
  }

  @Get('produto-imagem/:codprod')
  async obterImagemProduto(
    @Param('codprod', ParseIntPipe) codprod: number,
    @Res() res: Response,
  ) {
    const imagem = await this.separacaoService.buscarImagemProduto(codprod);

    res.setHeader('Content-Type', imagem.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(imagem.buffer);
  }
}
