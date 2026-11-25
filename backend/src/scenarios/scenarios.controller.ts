import { Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { CATALOG } from './catalog';
import { runScenario } from './runner';

@Controller('scenarios')
export class ScenariosController {
  @Get()
  list() {
    return CATALOG.map(({ id, title, description }) => ({ id, title, description }));
  }

  /** Runs on a fresh vault; 409 ScenarioBusy if another run is going. */
  @Post(':id/run') @HttpCode(200)
  run(@Param('id') id: string) {
    const s = CATALOG.find((x) => x.id === id);
    if (!s) throw new NotFoundException({ error: 'UnknownScenario' });
    return runScenario(s);
  }
}
