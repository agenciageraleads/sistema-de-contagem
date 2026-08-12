import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateEntregaDto } from './dto/create-entrega.dto';
import { EntregasService } from './entregas.service';

@Controller('entregas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class EntregasController {
  constructor(private readonly entregasService: EntregasService) {}

  @Get()
  async listar() {
    return this.entregasService.listar();
  }

  @Get('motoristas')
  async listarMotoristas() {
    return this.entregasService.listarMotoristas();
  }

  @Post()
  async criar(
    @CurrentUser('id') userId: number,
    @Body() dto: CreateEntregaDto,
  ) {
    return this.entregasService.criar(userId, dto);
  }

  @Post('criar-rota-lote')
  async criarRotaLote(@Body('ids') ids: number[]) {
    return this.entregasService.criarRotaLote(ids);
  }

  @Post(':id/criar-rota')
  async criarRota(@Param('id', ParseIntPipe) id: number) {
    return this.entregasService.criarRotaSpoke(id);
  }

  @Post(':id/distribuir')
  async distribuir(@Param('id', ParseIntPipe) id: number) {
    return this.entregasService.distribuir(id);
  }

  @Post(':id/finalizar')
  async finalizar(@Param('id', ParseIntPipe) id: number) {
    return this.entregasService.finalizar(id);
  }

  @Delete(':id')
  async excluir(@Param('id', ParseIntPipe) id: number) {
    return this.entregasService.excluir(id);
  }
}
