import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesService, LocalTestObjectStore } from './files.service';
import { FilesController } from './files.controller';

@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [
    {
      provide: FilesService,
      useFactory: () =>
        new FilesService(new LocalTestObjectStore(), {
          linkSecret: process.env.FILE_LINK_SECRET,
        }),
    },
  ],
  exports: [FilesService],
})
export class FilesModule {}
