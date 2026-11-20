import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AddStakeholderDto, FundDto, SkipTimeDto } from './dto';
import { VestingService } from './vesting.service';

@Controller()
export class VestingController {
  constructor(private readonly vesting: VestingService) {}

  @Post('setup') @HttpCode(200)
  setup() { return this.vesting.setup(); }

  @Get('deployment')
  deployment() { return this.vesting.getDeployment(); }

  @Post('fund') @HttpCode(200)
  fund(@Body() body: FundDto) { return this.vesting.fund(body.amount); }

  @Post('stakeholders') @HttpCode(200)
  add(@Body() body: AddStakeholderDto) { return this.vesting.addStakeholder(body); }

  @Get('stakeholders')
  list() { return this.vesting.listStakeholders(); }

  @Get('stakeholders/:addr')
  one(@Param('addr') addr: string) { return this.vesting.getStakeholder(addr); }

  @Get('dashboard')
  dashboard() { return this.vesting.getDashboard(); }

  @Get('time')
  time() { return this.vesting.getTime(); }

  @Post('time/skip') @HttpCode(200)
  skip(@Body() body: SkipTimeDto) { return this.vesting.skipTime(body); }
}
