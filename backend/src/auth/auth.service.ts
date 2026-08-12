// Serviço de Autenticação - Login JWT próprio (não consome licença Sankhya)
import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UserRole } from '@prisma/client';

// Payload do token JWT
export interface JwtPayload {
  sub: number;
  login: string;
  role: UserRole;
  nome: string;
  codusuSankhya?: number | null;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // Login do usuário - retorna token JWT
  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { login: loginDto.login },
    });

    if (!user || !user.ativo) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const senhaValida = await bcrypt.compare(loginDto.senha, user.senhaHash);
    if (!senhaValida) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const payload: JwtPayload = {
      sub: user.id,
      login: user.login,
      role: user.role,
      nome: user.nome,
      codusuSankhya: user.codusuSankhya,
    };

    return {
      token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        nome: user.nome,
        login: user.login,
        role: user.role,
        codusuSankhya: user.codusuSankhya,
      },
    };
  }

  // Criar novo usuário (apenas admins)
  async createUser(createUserDto: CreateUserDto) {
    // Verificar se login já existe
    const existente = await this.prisma.user.findUnique({
      where: { login: createUserDto.login },
    });

    if (existente) {
      throw new ConflictException('Login já está em uso');
    }

    // Hash da senha (10 rounds de salt)
    const senhaHash = await bcrypt.hash(createUserDto.senha, 10);

    const user = await this.prisma.user.create({
      data: {
        nome: createUserDto.nome,
        login: createUserDto.login,
        senhaHash,
        codusuSankhya: createUserDto.codusuSankhya ?? null,
        role: createUserDto.role || UserRole.OPERADOR,
      },
      select: {
        id: true,
        nome: true,
        login: true,
        role: true,
        codusuSankhya: true,
        ativo: true,
        createdAt: true,
      },
    });

    // Criar meta padrão para o novo usuário
    await this.prisma.metaUser.create({
      data: {
        userId: user.id,
        metaDiaria: parseInt(process.env.META_DIARIA_PADRAO || '10'),
        metaMensal: parseInt(process.env.META_MENSAL_PADRAO || '1000'),
        vigenciaInicio: new Date(),
      },
    });

    return user;
  }

  // Validar token JWT (usado pelo guard)
  async validateUser(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        nome: true,
        login: true,
        role: true,
        codusuSankhya: true,
        ativo: true,
      },
    });

    if (!user || !user.ativo) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo');
    }

    return user;
  }
  // Listar todos os usuários (Admin)
  async findAllUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        nome: true,
        login: true,
        role: true,
        codusuSankhya: true,
        ativo: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { nome: 'asc' },
    });
  }

  // Atualizar usuário (Admin)
  async updateUser(
    id: number,
    data: {
      nome?: string;
      role?: UserRole;
      ativo?: boolean;
      codusuSankhya?: number | null;
    },
    actor: { id: number; role: UserRole },
  ) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!targetUser) {
      throw new UnauthorizedException('Usuário alvo não encontrado');
    }

    if (actor.role === UserRole.SUPERVISOR) {
      if (targetUser.role === UserRole.ADMIN) {
        throw new ForbiddenException(
          'Supervisor não pode alterar dados de usuário ADMIN',
        );
      }
      if (data.role === UserRole.ADMIN) {
        throw new ForbiddenException(
          'Supervisor não pode promover usuário para ADMIN',
        );
      }
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        nome: true,
        login: true,
        role: true,
        codusuSankhya: true,
        ativo: true,
      },
    });
  }

  // Resetar senha (Admin)
  async resetPassword(
    id: number,
    novaSenha: string,
    actor: { id: number; role: UserRole },
  ) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!targetUser) {
      throw new UnauthorizedException('Usuário alvo não encontrado');
    }

    if (
      actor.role === UserRole.SUPERVISOR &&
      targetUser.role === UserRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Supervisor não pode resetar senha de usuário ADMIN',
      );
    }

    const salt = await bcrypt.genSalt();
    const senhaHash = await bcrypt.hash(novaSenha, salt);

    return this.prisma.user.update({
      where: { id },
      data: { senhaHash },
      select: { id: true, login: true },
    });
  }
}
