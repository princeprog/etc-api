import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AccessTokenGuard } from './guards/access-token.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, RolesGuard],
  exports: [JwtModule, AuthService, AccessTokenGuard, RolesGuard],
})
export class AuthModule {}
