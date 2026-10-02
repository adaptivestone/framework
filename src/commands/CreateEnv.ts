import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import AbstractCommand from '../modules/AbstractCommand.ts';

const ENV_FILE = '.env';
const EXAMPLE_FILE = '.env.example';
const SALT_LINE = /^AUTH_SALT=.*$/m;

class CreateEnv extends AbstractCommand {
  static get description() {
    return 'Create .env from .env.example with a fresh AUTH_SALT. Does nothing if .env already exists.';
  }

  static isShouldInitModels = false;

  async run() {
    if (existsSync(ENV_FILE)) {
      this.logger?.info(`${ENV_FILE} already exists, nothing changed.`);
      return true;
    }
    const salt = `AUTH_SALT=${randomBytes(32).toString('hex')}`;
    const hasExample = existsSync(EXAMPLE_FILE);
    let contents = hasExample ? await readFile(EXAMPLE_FILE, 'utf8') : '';
    if (SALT_LINE.test(contents)) {
      contents = contents.replace(SALT_LINE, () => salt);
    } else {
      const separator = contents === '' || contents.endsWith('\n') ? '' : '\n';
      contents += `${separator}${salt}\n`;
    }
    // `wx`: never overwrite a .env that appeared in the meantime.
    await writeFile(ENV_FILE, contents, { flag: 'wx' });
    // The salt is a secret: report the file, never the value.
    this.logger?.info(
      `Created ${ENV_FILE}${hasExample ? ` from ${EXAMPLE_FILE}` : ''} with a new AUTH_SALT.`,
    );
    return true;
  }
}

export default CreateEnv;
