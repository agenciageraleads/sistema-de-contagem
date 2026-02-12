// Controller de Autenticação - Endpoints de login e gestão de usuários
import {
    Controller,
    Post,
    Body,
    Get,
    Put, // Added
    Param, // Added
    ParseIntPipe, // Added
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto'; // Added
import { ResetPasswordDto } from './dto/reset-password.dto'; // Added
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    // POST /api/auth/login - Login do usuário (público)
    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    // POST /api/auth/register - Criar usuário 
    @Post('register')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
    async register(@Body() createUserDto: CreateUserDto) {
        return this.authService.createUser(createUserDto);
    }

    // GET /api/auth/me - Dados do usuário logado
    @Get('me')
    @UseGuards(JwtAuthGuard)
    async me(@CurrentUser() user: any) {
        return user;
    }

    // ============================================
    // Gestão de Usuários (Admin)
    // ============================================

    // GET /api/auth/users - Listar todos os usuários
    @Get('users')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
    async findAllUsers() {
        return this.authService.findAllUsers();
    }

    // PUT /api/auth/users/:id - Atualizar usuário
    @Put('users/:id') // Using Put from @nestjs/common which needs to be imported
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
    async updateUser(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateUserDto: UpdateUserDto,
    ) {
        return this.authService.updateUser(id, updateUserDto);
    }

    // POST /api/auth/users/:id/reset-password - Resetar senha
    @Post('users/:id/reset-password')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
    async resetPassword(
        @Param('id', ParseIntPipe) id: number,
        @Body() resetPasswordDto: ResetPasswordDto,
    ) {
        return this.authService.resetPassword(id, resetPasswordDto.novaSenha);
    }
}
