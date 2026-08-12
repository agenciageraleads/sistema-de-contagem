// Estratégia JWT para autenticação - Valida o token em cada requisição
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService, JwtPayload } from './auth.service';

function getRequiredEnv(configService: ConfigService, key: string): string {
  const value = configService.get<string>(key)?.trim();
  if (!value) {
    throw new Error(`Variável obrigatória ausente: ${key}`);
  }
  return value;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getRequiredEnv(configService, 'JWT_SECRET'),
    });
  }

  // Chamado automaticamente após decodificar o token
  async validate(payload: JwtPayload) {
    const user = await this.authService.validateUser(payload);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
