/**
 * @param config path to folder with config files
 * @param models path to folder with moidels files
 * @param controllers path to folder with controllers files
 * @param migrations path to folder with migrations files
 * @param locales path to folder with locales files
 * @param migrations path to folder with migrations files
 * @param [emails] path to folder with emails files. Optional
 */
type FolderConfig = {
  config: string;
  models: string;
  controllers: string;
  commands: string;
  locales: string;
  migrations: string;
  emails?: string;
};

export default FolderConfig;
