import { Module } from '@nestjs/common';
import { VestingController } from './vesting/vesting.controller';
import { VestingService } from './vesting/vesting.service';

@Module({ controllers: [VestingController], providers: [VestingService] })
export class AppModule {}
