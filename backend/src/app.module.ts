import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScenarioBusyInterceptor } from './scenarios/runner';
import { ScenariosController } from './scenarios/scenarios.controller';
import { VestingController } from './vesting/vesting.controller';
import { VestingService } from './vesting/vesting.service';

@Module({
  controllers: [VestingController, ScenariosController],
  providers: [VestingService, { provide: APP_INTERCEPTOR, useClass: ScenarioBusyInterceptor }],
})
export class AppModule {}
