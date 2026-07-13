import { migrationRunLog } from '../migrationRecorder.ts';

export default class AddIndex {
  async up() {
    migrationRunLog.push('AddIndex.ts');
  }
}
