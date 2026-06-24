import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [JwtModule.register({}), DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, ActivityHistoryService, AccessTokenGuard, RolesGuard],
  exports: [JwtModule, AuthService, AccessTokenGuard, RolesGuard],
})
export class AuthModule {}
