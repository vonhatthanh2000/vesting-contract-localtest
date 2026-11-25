import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AddStakeholderDto, AsDto, AsQueryDto, ClaimDto, EmergencyWithdrawDto, FundDto, JumpDto, ScheduleDto, SetTokenDto, SkipTimeDto, TransferOwnershipDto } from './dto';
import { VestingService } from './vesting.service';

@Controller()
export class VestingController {
  constructor(private readonly vesting: VestingService) {}

  @Post('setup') @HttpCode(200)
  setup() { return this.vesting.setup(); }

  @Get('deployment')
  deployment() { return this.vesting.getDeployment(); }

  @Post('fund') @HttpCode(200)
  fund(@Body() body: FundDto) { return this.vesting.fund(body); }

  @Post('pause') @HttpCode(200)
  pause(@Body() body: AsDto) { return this.vesting.pause(body.as); }

  @Post('unpause') @HttpCode(200)
  unpause(@Body() body: AsDto) { return this.vesting.pause(body.as, true); }

  @Post('emergency-withdraw') @HttpCode(200)
  withdraw(@Body() body: EmergencyWithdrawDto) { return this.vesting.emergencyWithdraw(body); }

  @Post('tokens') @HttpCode(200)
  deployToken() { return this.vesting.deployMockToken(); }

  @Post('token') @HttpCode(200)
  setToken(@Body() body: SetTokenDto) { return this.vesting.setToken(body.token, body.as); }

  @Post('ownership/transfer') @HttpCode(200)
  transfer(@Body() body: TransferOwnershipDto) { return this.vesting.transferOwnership(body.newOwner, body.as); }

  @Post('ownership/accept') @HttpCode(200)
  accept(@Body() body: AsDto) { return this.vesting.acceptOwnership(body.as); }

  @Post('ownership/renounce') @HttpCode(200)
  renounce(@Body() body: AsDto) { return this.vesting.renounceOwnership(body.as); }

  @Post('stakeholders') @HttpCode(200)
  add(@Body() body: AddStakeholderDto) { return this.vesting.addStakeholder(body); }

  @Post('stakeholders/preview') @HttpCode(200)
  preview(@Body() body: AddStakeholderDto) { return this.vesting.previewGenerated(body); }

  @Post('stakeholders/schedule/preview') @HttpCode(200)
  previewSchedule(@Body() body: ScheduleDto) { return this.vesting.previewSchedule(body); }

  @Post('stakeholders/schedule') @HttpCode(200)
  addSchedule(@Body() body: ScheduleDto) { return this.vesting.replaceWithSchedule(body); }

  @Delete('stakeholders/:addr')
  remove(@Param('addr') addr: string, @Query() q: AsQueryDto) { return this.vesting.removeStakeholder(addr, q.as); }

  @Post('claim') @HttpCode(200)
  claim(@Body() body: ClaimDto) { return this.vesting.claim(body); }

  @Get('stakeholders')
  list() { return this.vesting.listStakeholders(); }

  @Get('stakeholders/:addr')
  one(@Param('addr') addr: string) { return this.vesting.getStakeholder(addr); }

  @Get('dashboard')
  dashboard() { return this.vesting.getDashboard(); }

  @Get('time')
  time() { return this.vesting.getTime(); }

  @Post('time/jump') @HttpCode(200)
  jump(@Body() body: JumpDto) { return this.vesting.jumpToUnlock(body); }

  @Get('accounts')
  accounts() { return this.vesting.accounts(); }

  @Get('events')
  events() { return this.vesting.events(); }

  @Get('vault-balances')
  vaultBalances() { return this.vesting.vaultBalances(); }

  @Post('time/skip') @HttpCode(200)
  skip(@Body() body: SkipTimeDto) { return this.vesting.skipTime(body); }
}
