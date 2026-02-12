// Decorator @CurrentUser() - Extrai o usuário logado da requisição
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
    (data: string | undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user;

        // Se passou um campo específico (ex: @CurrentUser('id')), retorna só ele
        return data ? user?.[data] : user;
    },
);
