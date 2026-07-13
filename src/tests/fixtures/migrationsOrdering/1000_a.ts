import { migrationRunLog } from '../migrationRecorder.ts';

export default class Migration1000A {
  async up() {
    migrationRunLog.push('1000_a.ts');
  }
}
