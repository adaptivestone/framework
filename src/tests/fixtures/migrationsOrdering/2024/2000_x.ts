import { migrationRunLog } from '../../migrationRecorder.ts';

export default class Migration2000X {
  async up() {
    migrationRunLog.push('2000_x.ts');
  }
}
