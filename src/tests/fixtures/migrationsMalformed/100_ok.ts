import { migrationRunLog } from '../migrationRecorder.ts';

export default class Migration100Ok {
  async up() {
    migrationRunLog.push('100_ok.ts');
  }
}
