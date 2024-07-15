/**
 * @param config path to folder with config files
 * @param models path to folder with moidels files
 * @param controllers path to folder with controllers files
 * @param views path to folder with view files
 * @param locales path to folder with locales files
 * @param emails path to folder with emails files
 */
type FolderConfig = {
  config: string;
  models: string;
  controllers: string;
  views: string;
  emails: string;
};

export default FolderConfig;
