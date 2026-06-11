import { migrationRunLog } from '../migrationRecorder.ts';

export default class Migration100A {
  async up() {
    migrationRunLog.push('100_a.ts');
  }
}
