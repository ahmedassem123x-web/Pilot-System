import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth(): { ok: boolean } {
    return { ok: true };
  }
}
