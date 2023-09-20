const fs = require('node:fs').promises;
const { join } = require('node:path');

const getFilesPathWithInheritance = async ({
  internalFolder,
  externalFolder,
  logger,
  filter: { startWithCapital = true, notTests = true, notHidden = true } = {},
}) => {
  let [internalFiles, externalFiles] = await Promise.all([
    fs.readdir(internalFolder, { recursive: true, withFileTypes: true }),
    fs.readdir(externalFolder, { recursive: true, withFileTypes: true }),
  ]);

  const filterIndexFile = (fileDirent) => {
    if (!fileDirent.isFile()) {
      return false;
    }
    const fileArray = fileDirent.name.split('/');
    const file = fileArray[fileArray.length - 1];
    if (startWithCapital && file[0] !== file[0].toUpperCase()) {
      // not start with capital
      return false;
    }
    if (notTests && file.endsWith('.test.js')) {
      return false;
    }
    if (notHidden && file[0] === '.') {
      // not start with dot
      return false;
    }
    return true;
  };

  internalFiles = internalFiles
    .filter(filterIndexFile)
    .map((fileDirent) =>
      join(fileDirent.path, fileDirent.name).replace(`${internalFolder}/`, ''),
    );
  externalFiles = externalFiles
    .filter(filterIndexFile)
    .map((fileDirent) =>
      join(fileDirent.path, fileDirent.name).replace(`${externalFolder}/`, ''),
    );

  const filesToLoad = [];
  for (const file of internalFiles) {
    if (externalFiles.includes(file)) {
      logger(
        `Skipping register INTERNAL file ${file} as it override by EXTERNAL ONE`,
      );
    } else {
      filesToLoad.push({
        path: `${internalFolder}/${file}`,
        file,
      });
    }
  }

  for (const file of externalFiles) {
    filesToLoad.push({
      path: `${externalFolder}/${file}`,
      file,
    });
  }
  return filesToLoad;
};

module.exports = {
  // eslint-disable-next-line import/prefer-default-export
  getFilesPathWithInheritance,
};
