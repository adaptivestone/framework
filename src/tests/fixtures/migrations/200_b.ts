import { migrationRunLog } from '../migrationRecorder.ts';

export default class Migration200B {
  async up() {
    migrationRunLog.push('200_b.ts');
  }
}
