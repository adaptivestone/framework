import { migrationRunLog } from '../migrationRecorder.ts';

export default class Migration3000B {
  async up() {
    migrationRunLog.push('3000_b.ts');
  }
}
