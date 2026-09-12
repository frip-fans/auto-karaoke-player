const path = require('node:path');
const fs = require('node:fs');
const localTools = path.resolve(__dirname, 'media-tools');
const tools = process.env.KARAOKE_MEDIA_TOOLS_DIR || (fs.existsSync(path.join(localTools, 'ffmpeg.exe')) ? localTools : undefined);
module.exports = {
  appId: 'fans.frip.auto-karaoke-player',
  productName: 'Auto Karaoke Player',
  directories: { output: 'out/windows' },
  asar: true,
  npmRebuild: false,
  files: ['dist/**/*', 'package.json'],
  extraResources: tools ? [{ from: path.resolve(tools), to: 'media-tools' }] : [],
  win: { target: [{ target: 'portable', arch: ['x64'] }], executableName: 'Auto Karaoke Player', signExecutable: false },
  portable: { artifactName: 'Auto-Karaoke-Player-${version}-Windows-x64.exe', requestExecutionLevel: 'user', unpackDirName: false },
  beforePack: async context => {
    if (context.electronPlatformName !== 'win32') throw new Error('This configuration builds the Windows portable app.');
    if (!tools) throw new Error('Set KARAOKE_MEDIA_TOOLS_DIR to the Windows media-tools directory.');
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) fs.accessSync(path.join(tools, name), fs.constants.R_OK);
  },
};
