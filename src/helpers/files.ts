import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import { format, join, parse } from 'node:path';

interface getFilesPathWithInheritanceProps {
  internalFolder: string;
  externalFolder: string;
  logger: (val: string) => void;
  loggerFileType?: string;
  filter?: {
    startWithCapital?: boolean;
    notTests?: boolean;
    notHidden?: boolean;
  };
}

const getFilesPathWithInheritance = async ({
  internalFolder,
  externalFolder,
  logger,
  loggerFileType = '',
  filter: { startWithCapital = true, notTests = true, notHidden = true } = {},
}: getFilesPathWithInheritanceProps) => {
  const [internalFiles, externalFiles] = await Promise.all([
    fs.readdir(internalFolder, { recursive: true, withFileTypes: true }),
    fs.readdir(externalFolder, { recursive: true, withFileTypes: true }),
  ]);

  const filterIndexFile = (fileDirent: Dirent) => {
    if (!fileDirent.isFile()) {
      return false;
    }
    const fileArray = fileDirent.name.split('/');
    const file = fileArray[fileArray.length - 1];
    if (startWithCapital && file[0] !== file[0].toUpperCase()) {
      // not start with capital
      return false;
    }
    if (
      notTests &&
      (file.endsWith('.test.js') ||
        file.endsWith('.test.ts') ||
        file.endsWith('.d.ts'))
    ) {
      return false;
    }

    if (!file.endsWith('.js') && !file.endsWith('.ts')) {
      return false;
    }
    if (notHidden && file[0] === '.') {
      // not start with dot
      return false;
    }
    return true;
  };

  const internalFilesString = internalFiles
    .filter(filterIndexFile)
    .map((fileDirent) =>
      join(fileDirent.parentPath, fileDirent.name)
        .replace(`${internalFolder}/`, '')
        .replace(`${internalFolder}`, ''),
    );
  const externalFilesString = externalFiles
    .filter(filterIndexFile)
    .map((fileDirent) =>
      join(fileDirent.parentPath, fileDirent.name)
        .replace(`${externalFolder}/`, '')
        .replace(`${externalFolder}`, ''),
    );

  const filesToLoad = [];
  for (const file of internalFilesString) {
    const fileDetails = parse(file);
    const jsFile = format({
      dir: fileDetails.dir,
      name: fileDetails.name,
      ext: '.js',
    });

    const tsFile = format({
      dir: fileDetails.dir,
      name: fileDetails.name,
      ext: '.ts',
    });

    if (
      externalFilesString.includes(jsFile) ||
      externalFilesString.includes(tsFile)
    ) {
      logger(
        `Skipping register INTERNAL file '${file}' ${
          loggerFileType ? `of type ${loggerFileType}` : ''
        } as it override by EXTERNAL ONE`,
      );
    } else {
      filesToLoad.push({
        path: join(internalFolder, file),
        file,
      });
    }
  }

  for (const file of externalFilesString) {
    filesToLoad.push({
      path: join(externalFolder, file),
      file,
    });
  }
  return filesToLoad;
};

export { getFilesPathWithInheritance };
