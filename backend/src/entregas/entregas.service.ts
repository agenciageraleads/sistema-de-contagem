import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEntregaDto } from './dto/create-entrega.dto';

const SPOKE_BASE_URL = 'https://api.getcircuit.com/public/v0.2b';

@Injectable()
export class EntregasService {
  private readonly logger = new Logger(EntregasService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async listar() {
    return this.prisma.entrega.findMany({
      where: {
        status: { not: 'FINALIZADA' },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        criador: {
          select: { id: true, nome: true, login: true },
        },
      },
    });
  }

  async listarMotoristas() {
    const response = await this.spokeRequest('/drivers');
    return response.drivers || [];
  }

  async criar(userId: number, dto: CreateEntregaDto) {
    const coords = await this.resolverCoordenadasGoogle(dto.googleMapsUrl);

    return this.prisma.entrega.create({
      data: {
        numeroPedido: dto.numeroPedido.trim(),
        clienteNome: dto.clienteNome.trim(),
        telefone: this.clean(dto.telefone),
        enderecoTexto: dto.enderecoTexto.trim(),
        bairro: this.clean(dto.bairro),
        cidade: this.clean(dto.cidade),
        uf: this.clean(dto.uf)?.toUpperCase(),
        googleMapsUrl: this.clean(dto.googleMapsUrl),
        latitude: coords?.latitude,
        longitude: coords?.longitude,
        pagamento: this.clean(dto.pagamento),
        observacoes: this.clean(dto.observacoes),
        motoristaSpokeId: this.clean(dto.motoristaSpokeId),
        motoristaNome: this.clean(dto.motoristaNome),
        status: coords ? 'COORDENADA_RESOLVIDA' : 'RASCUNHO',
        statusDetalhe: coords
          ? 'Coordenada extraída do link do Google Maps.'
          : 'Entrega salva aguardando criação da rota.',
        createdBy: userId,
      },
    });
  }

  async criarRotaSpoke(id: number) {
    const entrega = await this.prisma.entrega.findUnique({ where: { id } });
    if (!entrega) throw new NotFoundException('Entrega não encontrada');
    if (!entrega.motoristaSpokeId) {
      throw new BadRequestException('Selecione um motorista antes de criar a rota.');
    }

    const hoje = new Date();
    const plan = await this.spokeRequest('/plans', {
      method: 'POST',
      body: {
        title: `Entrega ${entrega.motoristaNome || ''} ${hoje.toLocaleDateString('pt-BR')}`.trim(),
        starts: {
          day: hoje.getDate(),
          month: hoje.getMonth() + 1,
          year: hoje.getFullYear(),
        },
        drivers: [entrega.motoristaSpokeId],
      },
    });

    const stop = await this.spokeRequest(`/${plan.id}/stops`, {
      method: 'POST',
      body: this.montarPayloadStop(entrega),
    });

    const operation = await this.spokeRequest(`/${plan.id}:optimize`, {
      method: 'POST',
      body: {},
    });

    const planAtualizado = await this.spokeRequest(`/${plan.id}`);
    const routeId = Array.isArray(planAtualizado.routes)
      ? planAtualizado.routes[0]
      : null;

    return this.prisma.entrega.update({
      where: { id },
      data: {
        planSpokeId: plan.id,
        stopSpokeId: stop.id,
        routeSpokeId: routeId,
        trackingLink: stop.trackingLink,
        webAppLink: stop.webAppLink,
        spokeOperationId: operation.id,
        status: 'ROTA_OTIMIZADA',
        statusDetalhe: `Rota criada na Spoke. ${operation?.result?.numOptimizedStops || 0} parada(s) otimizada(s).`,
      },
    });
  }

  async criarRotaLote(ids: number[]) {
    const entregaIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (entregaIds.length === 0) {
      throw new BadRequestException('Selecione ao menos uma entrega para criar a rota.');
    }

    const entregas = await this.prisma.entrega.findMany({
      where: { id: { in: entregaIds } },
      orderBy: { createdAt: 'asc' },
    });

    if (entregas.length !== entregaIds.length) {
      throw new NotFoundException('Uma ou mais entregas não foram encontradas.');
    }

    const jaPossuemRota = entregas.filter((entrega) => entrega.planSpokeId);
    if (jaPossuemRota.length > 0) {
      throw new BadRequestException('Remova da seleção as entregas que já possuem rota.');
    }

    const motoristaSpokeId = entregas[0].motoristaSpokeId;
    if (!motoristaSpokeId) {
      throw new BadRequestException('Selecione um motorista antes de criar a rota.');
    }

    const motoristaDiferente = entregas.some(
      (entrega) => entrega.motoristaSpokeId !== motoristaSpokeId,
    );
    if (motoristaDiferente) {
      throw new BadRequestException('Todas as entregas da rota precisam ser do mesmo motorista.');
    }

    const hoje = new Date();
    const motoristaNome = entregas[0].motoristaNome || '';
    const plan = await this.spokeRequest('/plans', {
      method: 'POST',
      body: {
        title: `Entregas ${motoristaNome} ${hoje.toLocaleDateString('pt-BR')}`.trim(),
        starts: {
          day: hoje.getDate(),
          month: hoje.getMonth() + 1,
          year: hoje.getFullYear(),
        },
        drivers: [motoristaSpokeId],
      },
    });

    const stops: Array<{ entrega: (typeof entregas)[number]; stop: any }> = [];
    for (const entrega of entregas) {
      const stop = await this.spokeRequest(`/${plan.id}/stops`, {
        method: 'POST',
        body: this.montarPayloadStop(entrega),
      });
      stops.push({ entrega, stop });
    }

    const operation = await this.spokeRequest(`/${plan.id}:optimize`, {
      method: 'POST',
      body: {},
    });

    const planAtualizado = await this.spokeRequest(`/${plan.id}`);
    const routeId = Array.isArray(planAtualizado.routes)
      ? planAtualizado.routes[0]
      : null;

    await this.prisma.$transaction(
      stops.map(({ entrega, stop }) =>
        this.prisma.entrega.update({
          where: { id: entrega.id },
          data: {
            planSpokeId: plan.id,
            stopSpokeId: stop.id,
            routeSpokeId: routeId,
            trackingLink: stop.trackingLink,
            webAppLink: stop.webAppLink,
            spokeOperationId: operation.id,
            status: 'ROTA_OTIMIZADA',
            statusDetalhe: `Rota única criada na Spoke com ${entregas.length} parada(s).`,
          },
        }),
      ),
    );

    return {
      planSpokeId: plan.id,
      routeSpokeId: routeId,
      totalEntregas: entregas.length,
      totalParadas: operation?.result?.numOptimizedStops || stops.length,
    };
  }

  async distribuir(id: number) {
    const entrega = await this.prisma.entrega.findUnique({ where: { id } });
    if (!entrega?.planSpokeId) {
      throw new BadRequestException('Crie a rota antes de distribuir.');
    }

    const operation = await this.spokeRequest(`/${entrega.planSpokeId}:distribute`, {
      method: 'POST',
      body: {},
    });

    await this.prisma.entrega.updateMany({
      where: { planSpokeId: entrega.planSpokeId },
      data: {
        spokeOperationId: operation.id || entrega.spokeOperationId,
        status: 'DISTRIBUIDA',
        statusDetalhe: 'Rota distribuída para o motorista na Spoke.',
      },
    });

    return this.prisma.entrega.findMany({
      where: { planSpokeId: entrega.planSpokeId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async excluir(id: number) {
    const entrega = await this.prisma.entrega.findUnique({ where: { id } });
    if (!entrega) throw new NotFoundException('Entrega não encontrada.');

    return this.prisma.entrega.delete({ where: { id } });
  }

  async finalizar(id: number) {
    const entrega = await this.prisma.entrega.findUnique({ where: { id } });
    if (!entrega) throw new NotFoundException('Entrega não encontrada.');

    if (entrega.planSpokeId) {
      await this.prisma.entrega.updateMany({
        where: { planSpokeId: entrega.planSpokeId },
        data: {
          status: 'FINALIZADA',
          statusDetalhe: 'Rota finalizada e ocultada da lista operacional.',
        },
      });

      return this.prisma.entrega.findMany({
        where: { planSpokeId: entrega.planSpokeId },
        orderBy: { createdAt: 'asc' },
      });
    }

    return this.prisma.entrega.update({
      where: { id },
      data: {
        status: 'FINALIZADA',
        statusDetalhe: 'Entrega finalizada e ocultada da lista operacional.',
      },
    });
  }

  private montarPayloadStop(entrega: any) {
    const vendedor = this.extrairCampoObservacoes(
      entrega.observacoes,
      /^Nome Vendedor\s*:\s*(.+)$/i,
    );
    const enderecoCompleto = [
      entrega.enderecoTexto,
      entrega.bairro,
      entrega.cidade,
      entrega.uf,
    ]
      .filter(Boolean)
      .join(', ');

    const address: Record<string, any> = {
      addressName: entrega.clienteNome,
      addressLineOne: entrega.enderecoTexto,
      addressLineTwo: [entrega.bairro, entrega.cidade, entrega.uf]
        .filter(Boolean)
        .join(', '),
      city: entrega.cidade || undefined,
      state: entrega.uf || undefined,
      country: 'BR',
    };

    if (entrega.latitude && entrega.longitude) {
      address.latitude = Number(entrega.latitude);
      address.longitude = Number(entrega.longitude);
    }

    return {
      address,
      recipient: {
        name: entrega.clienteNome,
        phone: this.formatarTelefone(entrega.telefone),
      },
      orderInfo: {
        sellerOrderId: entrega.numeroPedido,
        products: [`Pedido ${entrega.numeroPedido}`],
        sellerName: vendedor || 'Portal Distribuidora',
      },
      notes: [
        `Pedido ${entrega.numeroPedido}.`,
        `Cliente: ${entrega.clienteNome}.`,
        vendedor ? `Vendedor: ${vendedor}.` : null,
        entrega.telefone ? `Telefone: ${entrega.telefone}.` : null,
        `Endereço informado: ${enderecoCompleto}.`,
        entrega.pagamento ? `Pagamento: ${entrega.pagamento}.` : null,
        entrega.latitude && entrega.longitude
          ? `Coordenada Google: ${entrega.latitude}, ${entrega.longitude}.`
          : null,
        entrega.googleMapsUrl ? `Link: ${entrega.googleMapsUrl}` : null,
        entrega.observacoes,
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  private async resolverCoordenadasGoogle(url?: string | null) {
    if (!url || !/^https?:\/\//i.test(url)) return null;

    try {
      let currentUrl = url;
      for (let i = 0; i < 5; i++) {
        const direct = this.extractCoords(currentUrl);
        if (direct) return direct;

        const response = await fetch(currentUrl, { redirect: 'manual' });
        const location = response.headers.get('location');
        if (!location) {
          const finalCoords = this.extractCoords(response.url);
          return finalCoords;
        }
        currentUrl = new URL(location, currentUrl).toString();
      }
    } catch (error: any) {
      this.logger.warn(`Não foi possível resolver Google Maps: ${error.message}`);
    }

    return null;
  }

  private extractCoords(value: string) {
    const decoded = decodeURIComponent(value);
    const patterns = [
      /search\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/i,
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
      /[?&]q=(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/i,
      /[?&]ll=(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/i,
    ];

    for (const pattern of patterns) {
      const match = decoded.match(pattern);
      if (!match) continue;
      return {
        latitude: Number(match[1]),
        longitude: Number(match[2]),
      };
    }

    return null;
  }

  private async spokeRequest(path: string, options?: { method?: string; body?: any }) {
    const apiKey = this.configService.get<string>('SPOKE_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('SPOKE_API_KEY não configurada no backend.');
    }

    const response = await fetch(`${SPOKE_BASE_URL}${path}`, {
      method: options?.method || 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new BadRequestException(data.message || 'Erro na API Spoke');
    }

    return data;
  }

  private clean(value?: string | null) {
    const cleaned = value?.trim();
    return cleaned ? cleaned : null;
  }

  private extrairCampoObservacoes(value: string | null | undefined, regex: RegExp) {
    if (!value) return null;
    const linha = value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => regex.test(item));
    const match = linha?.match(regex);
    return match?.[1]?.trim() || null;
  }

  private formatarTelefone(value?: string | null) {
    const digits = value?.replace(/\D/g, '') || '';
    if (!digits) return null;
    if (digits.startsWith('55')) return `+${digits}`;
    return `+55${digits}`;
  }
}
