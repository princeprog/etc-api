import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DatabaseModule } from '../../database/database.module';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [JwtModule.register({}), DatabaseModule],
  controllers: [RolesController],
  providers: [RolesService, ActivityHistoryService, AccessTokenGuard, RolesGuard],
  exports: [RolesService],
})
export class RolesModule {}
